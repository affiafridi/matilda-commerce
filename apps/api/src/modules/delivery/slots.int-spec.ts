import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { seed } from '../../cli/seed';
import { hashToken } from '../../common/security/tokens';
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

/**
 * Branch calendar, delivery methods and charges (Phase 4 step 4.4): rules, branch-scoped
 * permissions, brand isolation, money validation and audit.
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'managerA' | 'branchMgrA' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('delivery slots', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketA2 = '';
  let marketB = '';
  let branchA = '';
  let branchA2 = '';
  let branchB = '';
  let sess: Record<Who, Sess>;
  let counter = 0;

  async function session(
    label: string,
    perms: string[],
    brandId: string | null,
    branchId: string | null = null,
  ): Promise<Sess> {
    const staff = await db.staffUser.create({
      data: {
        email: `${label}-${++counter}@example.test`,
        fullName: label,
        status: 'ACTIVE',
        passwordHash: 'fixture-no-login',
        mfaEnrolledAt: new Date(),
      },
    });
    if (perms.length) {
      const role = await db.role.create({
        data: {
          name: `${label} ${++counter}`,
          kind: 'CUSTOM',
          permissions: { create: perms.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await db.staffRoleAssignment.create({
        data: { staffUserId: staff.id, roleId: role.id, brandId, branchId },
      });
    }
    const token = randomBytes(24).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    await db.staffSession.create({
      data: {
        staffUserId: staff.id,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrf),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
        mfaVerifiedAt: new Date(),
        stepUpUntil: new Date(Date.now() + 3_600_000),
      },
    });
    return { token, csrf };
  }

  const call = (who: Who, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) => {
    const s = sess[who];
    return request(app.getHttpServer())
      [method](`/api/v1/admin/brands/${path}`)
      .set('Cookie', `matilda_staff=${s.token}`)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', ORIGIN);
  };

  async function auditActions(targetId: string): Promise<string[]> {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const res = await client.query<{ action: string }>(
        'SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id',
        [targetId],
      );
      return res.rows.map((r) => r.action);
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.DATABASE_URL = testAppUrl();
    owner = createPool(testOwnerUrl());
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testOwnerUrl() }) });
    await seed(db, 'reference');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 0,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadEnv());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query(
      'TRUNCATE staff_user, brand, branch, role, auth_attempt, delivery_area CASCADE',
    );
    await resetAuditLog(owner);
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const om = await db.country.upsert({
      where: { iso2: 'OM' },
      create: { iso2: 'OM', iso3: 'OMN', name: 'Oman' },
      update: {},
    });
    await withScope(db, platformScope, async (tx) => {
      brandA = (await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } })).id;
      brandB = (await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } })).id;
      const mk = async (brandId: string, code: string, countryId = ae.id) => {
        const m = await tx.market.create({
          data: { brandId, countryId, code, timezone: 'Asia/Dubai' },
        });
        await tx.marketCurrency.create({
          data: { marketId: m.id, currencyCode: 'AED', isDefault: true },
        });
        return m.id;
      };
      marketA = await mk(brandA, 'ae');
      marketA2 = await mk(brandA, 'om', om.id);
      marketB = await mk(brandB, 'ae');
      const br = async (code: string, marketId: string) =>
        (
          await tx.branch.create({
            data: {
              code,
              name: code,
              countryId: ae.id,
              timezone: 'Asia/Dubai',
              markets: { create: [{ marketId }] },
            },
          })
        ).id;
      branchA = await br('kitchen-a', marketA);
      branchA2 = await br('kitchen-a2', marketA);
      branchB = await br('kitchen-b', marketB);
    });
    const manage = ['delivery.view', 'delivery.manage', 'branches.calendar'];
    sess = {
      managerA: await session('managera', manage, brandA),
      branchMgrA: await session(
        'branchmgra',
        ['delivery.view', 'branches.calendar'],
        brandA,
        branchA,
      ),
      viewerA: await session('viewera', ['delivery.view'], brandA),
      managerB: await session('managerb', manage, brandB),
      nobody: await session('nobody', [], null),
    };
  });

  const slot = (body: Record<string, unknown> = {}, who: Who = 'managerA', brand = brandA) =>
    call(who, 'post', `${brand}/delivery/slots`).send({
      marketId: marketA,
      branchId: branchA,
      weekday: 5,
      startTime: '14:00',
      endTime: '16:00',
      capacity: 10,
      cutoffTime: '10:00',
      methods: ['SAME_DAY', 'SCHEDULED'],
      ...body,
    });
  const url = (id = '') => `${brandA}/delivery/slots${id ? `/${id}` : ''}`;

  it('creates, reads, filters, updates and deletes a slot with audit', async () => {
    const created = await slot();
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      weekday: 5,
      startTime: '14:00',
      endTime: '16:00',
      capacity: 10,
      cutoffTime: '10:00',
      cutoffDaysBefore: 0,
      zoneId: null,
      status: 'ACTIVE',
    });
    const id = created.body.id as string;
    await slot({ weekday: 6, startTime: '10:00', endTime: '12:00', cutoffTime: '08:00' });
    expect((await call('viewerA', 'get', url())).body).toHaveLength(2);
    expect((await call('viewerA', 'get', `${url()}?weekday=5`)).body).toHaveLength(1);
    expect((await call('viewerA', 'get', `${url()}?branchId=${branchA2}`)).body).toEqual([]);
    expect((await call('viewerA', 'get', url(id))).body.capacity).toBe(10);
    const upd = await call('managerA', 'patch', url(id)).send({
      capacity: 4,
      cutoffDaysBefore: 1,
      cutoffTime: '18:00',
    });
    expect(upd.body).toMatchObject({ capacity: 4, cutoffDaysBefore: 1, cutoffTime: '18:00' });
    expect((await call('managerA', 'delete', url(id))).status).toBe(204);
    expect((await call('managerA', 'get', url(id))).status).toBe(404);
    expect(await auditActions(id)).toEqual([
      'delivery.slot.create',
      'delivery.slot.update',
      'delivery.slot.delete',
    ]);
  });

  it('refuses reversed ranges, late same-day cutoffs, bad capacity and bad times', async () => {
    expect((await slot({ startTime: '16:00', endTime: '14:00' })).body.code).toBe(
      'SLOT_RANGE_INVALID',
    );
    expect((await slot({ cutoffTime: '14:00' })).body.code).toBe('SLOT_CUTOFF_INVALID');
    expect((await slot({ cutoffTime: '20:00', cutoffDaysBefore: 1 })).status).toBe(201);
    const early = { startTime: '07:00', endTime: '08:00', cutoffTime: '06:00' };
    expect((await slot({ ...early, capacity: 0 })).status).toBe(400);
    expect((await slot({ ...early, capacity: 2.5 })).status).toBe(400);
    expect((await slot({ startTime: '25:00' })).status).toBe(400);
    expect((await slot({ weekday: 7 })).status).toBe(400);
    expect((await slot({ methods: [] })).status).toBe(400);
    expect((await slot({ ...early, methods: ['SAME_DAY', 'SAME_DAY'] })).body.code).toBe(
      'DUPLICATE_METHOD_KIND',
    );
    expect((await slot({ cutoffDaysBefore: 15 })).status).toBe(400);
  });

  it('checks the update as a whole, not field by field', async () => {
    const id = (await slot()).body.id as string;
    const bad = await call('managerA', 'patch', url(id)).send({ startTime: '09:00' });
    expect(bad.body.code).toBe('SLOT_CUTOFF_INVALID');
    const reversed = await call('managerA', 'patch', url(id)).send({ endTime: '13:00' });
    expect(reversed.body.code).toBe('SLOT_RANGE_INVALID');
    expect((await call('managerA', 'patch', url(id)).send({})).status).toBe(400);
  });

  it('refuses a duplicate slot but allows the same time in another zone or branch', async () => {
    expect((await slot()).status).toBe(201);
    const dup = await slot();
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SLOT_EXISTS');
    expect((await slot({ branchId: branchA2 })).status).toBe(201);
    const zone = await call('managerA', 'post', `${brandA}/delivery/zones`).send({
      marketId: marketA,
      code: 'central',
      translations: [{ language: 'en', name: 'Central' }],
    });
    expect((await slot({ zoneId: zone.body.id })).status).toBe(201);
  });

  it('keeps zone, branch and market consistent', async () => {
    const zoneA2 = await call('managerA', 'post', `${brandA}/delivery/zones`).send({
      marketId: marketA2,
      code: 'north',
      translations: [{ language: 'en', name: 'North' }],
    });
    expect((await slot({ zoneId: zoneA2.body.id })).body.code).toBe('MARKET_MISMATCH');
    expect((await slot({ zoneId: NIL })).status).toBe(404);
    expect((await slot({ marketId: marketB })).status).toBe(404);
    expect((await slot({ branchId: branchB })).status).toBe(404);
    expect((await slot({ branchId: NIL })).status).toBe(404);
    // A branch that serves the brand but not this market is refused by the database check.
    const other = await slot({ marketId: marketA2 });
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('BRANCH_NOT_AVAILABLE');
  });

  it('protects slots with bookings on record', async () => {
    const id = (await slot()).body.id as string;
    await withScope(db, platformScope, (tx) =>
      tx.slotDay.create({
        data: {
          brandId: brandA,
          slotId: id,
          deliveryDate: new Date('2026-12-04T00:00:00Z'),
          booked: 1,
        },
      }),
    );
    const res = await call('managerA', 'delete', url(id));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_IN_USE');
    const off = await call('managerA', 'patch', url(id)).send({ status: 'INACTIVE' });
    expect(off.body.status).toBe('INACTIVE');
  });

  it('needs delivery.manage to write, delivery.view to read, and stays inside the brand', async () => {
    expect((await slot({}, 'viewerA')).status).toBe(403);
    expect((await slot({}, 'branchMgrA')).status).toBe(403);
    expect((await slot({}, 'nobody')).status).toBe(403);
    expect((await call('nobody', 'get', url())).status).toBe(403);
    const mine = await slot();
    expect((await call('managerB', 'get', url())).status).toBe(403);
    const patch = await call('managerB', 'patch', url(mine.body.id)).send({ capacity: 1 });
    expect(patch.status).toBe(403);
    const viaB = `${brandB}/delivery/slots/${mine.body.id}`;
    expect((await call('managerB', 'get', viaB)).status).toBe(404);
    expect((await call('managerB', 'delete', viaB)).status).toBe(404);
  });

  it('refuses every slot route without a session or a role', async () => {
    const probes: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
      ['get', url()],
      ['post', url()],
      ['get', url(NIL)],
      ['patch', url(NIL)],
      ['delete', url(NIL)],
    ];
    for (const [method, path] of probes) {
      const anon = await request(app.getHttpServer())
        [method](`/api/v1/admin/brands/${path}`)
        .set('Origin', ORIGIN);
      expect([401, 403]).toContain(anon.status);
      expect((await call('nobody', method, path).send({})).status).toBe(403);
      const other = await call('managerB', method, path).send({});
      expect(method === 'get' ? [403] : [400, 403]).toContain(other.status);
    }
  });
});
