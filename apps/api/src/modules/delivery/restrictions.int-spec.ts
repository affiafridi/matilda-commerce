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
 * Delivery restrictions (Phase 4 step 4.6): conditions, targets, consistency, scope and audit.
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'managerA' | 'branchMgrA' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('delivery restrictions', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketA2 = '';
  let marketB = '';
  let branchA = '';
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
      await br('kitchen-a2', marketA);
      await br('kitchen-b', marketB);
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

  let productA = '';
  let categoryA = '';
  let collectionA = '';
  let categoryB = '';
  let areaId = '';
  let zoneId = '';

  beforeEach(async () => {
    await withScope(db, platformScope, async (tx) => {
      productA = (await tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } })).id;
      categoryA = (await tx.category.create({ data: { brandId: brandA } })).id;
      collectionA = (await tx.collection.create({ data: { brandId: brandA } })).id;
      categoryB = (await tx.category.create({ data: { brandId: brandB } })).id;
    });
    areaId = (await db.deliveryArea.findFirstOrThrow({ where: { code: 'dubai' } })).id;
    zoneId = (
      await call('managerA', 'post', `${brandA}/delivery/zones`).send({
        marketId: marketA,
        code: 'central',
        translations: [{ language: 'en', name: 'Central' }],
      })
    ).body.id as string;
  });

  const url = (id = '') => `${brandA}/delivery/restrictions${id ? `/${id}` : ''}`;
  const restrict = (body: Record<string, unknown> = {}, who: Who = 'managerA') =>
    call(who, 'post', url()).send({
      marketId: marketA,
      target: 'CATEGORY',
      targetId: categoryA,
      condition: 'WEEKDAY',
      weekday: 5,
      ...body,
    });

  it('creates one restriction per condition and returns it in a stable shape', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['AREA', { areaId }],
      ['ZONE', { zoneId }],
      ['DATE_RANGE', { dateFrom: '2026-12-24', dateTo: '2026-12-26' }],
      ['WEEKDAY', { weekday: 0 }],
      ['METHOD', { methodKind: 'SAME_DAY' }],
    ];
    for (const [condition, extra] of cases) {
      const res = await restrict({ condition, weekday: undefined, ...extra, note: 'test' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        condition,
        target: 'CATEGORY',
        targetId: categoryA,
        status: 'ACTIVE',
        note: 'test',
      });
    }
    const list = await call('viewerA', 'get', url());
    expect(list.body).toHaveLength(5);
    const range = list.body.find((r: { condition: string }) => r.condition === 'DATE_RANGE');
    expect(range).toMatchObject({ dateFrom: '2026-12-24', dateTo: '2026-12-26', areaId: null });
  });

  it('targets products, categories and collections and filters by them', async () => {
    await restrict({ target: 'PRODUCT', targetId: productA });
    await restrict({ target: 'COLLECTION', targetId: collectionA });
    await restrict();
    expect((await call('viewerA', 'get', `${url()}?target=PRODUCT`)).body).toHaveLength(1);
    expect((await call('viewerA', 'get', `${url()}?targetId=${collectionA}`)).body).toHaveLength(1);
    expect((await call('viewerA', 'get', `${url()}?condition=ZONE`)).body).toHaveLength(0);
    expect((await call('viewerA', 'get', `${url()}?marketId=${marketA}`)).body).toHaveLength(3);
  });

  it('refuses a missing, foreign or wrong-shaped condition', async () => {
    expect((await restrict({ weekday: undefined })).status).toBe(400);
    expect((await restrict({ weekday: 9 })).status).toBe(400);
    expect((await restrict({ condition: 'COLOUR' })).status).toBe(400);
    expect(
      (await restrict({ condition: 'DATE_RANGE', dateFrom: '2026-12-26', dateTo: '2026-12-24' }))
        .status,
    ).toBe(400);
    expect(
      (await restrict({ condition: 'DATE_RANGE', dateFrom: '2026-02-30', dateTo: '2026-03-01' }))
        .status,
    ).toBe(400);
    expect((await restrict({ condition: 'AREA', areaId: undefined })).status).toBe(400);
    expect((await restrict({ target: 'BRAND' })).status).toBe(400);
  });

  it('checks that the target, market, zone and area belong together', async () => {
    expect((await restrict({ targetId: NIL })).status).toBe(404);
    expect((await restrict({ targetId: categoryB })).status).toBe(404);
    expect((await restrict({ target: 'PRODUCT', targetId: categoryA })).status).toBe(404);
    expect((await restrict({ marketId: marketB })).status).toBe(404);
    expect((await restrict({ condition: 'ZONE', zoneId: NIL, weekday: undefined })).status).toBe(
      404,
    );
    expect((await restrict({ condition: 'AREA', areaId: NIL, weekday: undefined })).status).toBe(
      404,
    );
    const muscat = await db.country.findUniqueOrThrow({ where: { iso2: 'OM' } });
    const foreignArea = await db.deliveryArea.create({
      data: { countryId: muscat.id, level: 'EMIRATE', code: 'muscat' },
    });
    const res = await restrict({ condition: 'AREA', areaId: foreignArea.id, weekday: undefined });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AREA_COUNTRY_MISMATCH');
    const zoneOm = await call('managerA', 'post', `${brandA}/delivery/zones`).send({
      marketId: marketA2,
      code: 'om-zone',
      translations: [{ language: 'en', name: 'Oman zone' }],
    });
    const mismatch = await restrict({
      condition: 'ZONE',
      zoneId: zoneOm.body.id,
      weekday: undefined,
    });
    expect(mismatch.body.code).toBe('MARKET_MISMATCH');
  });

  it('changes only the note and status, and deletes with audit', async () => {
    const id = (await restrict()).body.id as string;
    const upd = await call('managerA', 'patch', url(id)).send({
      status: 'INACTIVE',
      note: 'paused',
    });
    expect(upd.body).toMatchObject({ status: 'INACTIVE', note: 'paused', weekday: 5 });
    expect((await call('managerA', 'patch', url(id)).send({})).status).toBe(400);
    expect((await call('viewerA', 'get', url(id))).status).toBe(200);
    expect((await call('managerA', 'delete', url(id))).status).toBe(204);
    expect((await call('managerA', 'get', url(id))).status).toBe(404);
    expect(await auditActions(id)).toEqual([
      'delivery.restriction.create',
      'delivery.restriction.update',
      'delivery.restriction.delete',
    ]);
  });

  it('keeps a zone or area in use until its restrictions are removed', async () => {
    const id = (await restrict({ condition: 'ZONE', zoneId, weekday: undefined })).body
      .id as string;
    const blocked = await call('managerA', 'delete', `${brandA}/delivery/zones/${zoneId}`);
    expect(blocked.body.code).toBe('ZONE_IN_USE');
    await call('managerA', 'delete', url(id));
    expect((await call('managerA', 'delete', `${brandA}/delivery/zones/${zoneId}`)).status).toBe(
      204,
    );
  });

  it('needs delivery.manage to write, delivery.view to read, and stays inside the brand', async () => {
    expect((await restrict({}, 'viewerA')).status).toBe(403);
    expect((await restrict({}, 'branchMgrA')).status).toBe(403);
    expect((await restrict({}, 'nobody')).status).toBe(403);
    expect((await call('nobody', 'get', url())).status).toBe(403);
    const mine = await restrict();
    expect((await call('managerB', 'get', url())).status).toBe(403);
    expect(
      (await call('managerB', 'patch', url(mine.body.id)).send({ status: 'INACTIVE' })).status,
    ).toBe(403);
    const viaB = `${brandB}/delivery/restrictions/${mine.body.id}`;
    expect((await call('managerB', 'get', viaB)).status).toBe(404);
    expect((await call('managerB', 'delete', viaB)).status).toBe(404);
  });

  it('refuses every restriction route without a session or a role', async () => {
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
