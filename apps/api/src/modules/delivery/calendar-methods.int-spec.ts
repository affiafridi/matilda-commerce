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

describe('delivery calendar, methods and charges', () => {
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

  const hours = (branchId = branchA) => `${brandA}/delivery/branches/${branchId}/hours`;
  const week = {
    days: [
      {
        weekday: 1,
        ranges: [
          { start: '09:00', end: '13:00' },
          { start: '15:00', end: '21:00' },
        ],
      },
      { weekday: 5, ranges: [{ start: '10:00', end: '14:00' }] },
    ],
  };

  describe('opening hours', () => {
    it('stores and returns the week in local time, closed days empty', async () => {
      const put = await call('managerA', 'put', hours()).send(week);
      expect(put.status).toBe(200);
      const got = await call('viewerA', 'get', hours());
      expect(got.status).toBe(200);
      expect(got.body.timezone).toBe('Asia/Dubai');
      expect(got.body.days).toHaveLength(7);
      expect(got.body.days[1].ranges).toEqual(week.days[0]!.ranges);
      expect(got.body.days[0].ranges).toEqual([]);
      const cleared = await call('managerA', 'put', hours()).send({ days: [] });
      expect(cleared.body.days.every((d: { ranges: unknown[] }) => d.ranges.length === 0)).toBe(
        true,
      );
      expect(await auditActions(branchA)).toEqual(['delivery.hours.put', 'delivery.hours.put']);
    });

    it('rejects overlapping, reversed and duplicate days', async () => {
      const bad = (days: unknown[]) => call('managerA', 'put', hours()).send({ days });
      expect(
        (
          await bad([
            {
              weekday: 1,
              ranges: [
                { start: '09:00', end: '14:00' },
                { start: '13:00', end: '18:00' },
              ],
            },
          ])
        ).status,
      ).toBe(400);
      expect((await bad([{ weekday: 1, ranges: [{ start: '18:00', end: '09:00' }] }])).status).toBe(
        400,
      );
      expect(
        (
          await bad([
            { weekday: 1, ranges: [] },
            { weekday: 1, ranges: [] },
          ])
        ).status,
      ).toBe(400);
      expect((await bad([{ weekday: 7, ranges: [] }])).status).toBe(400);
    });

    it('lets a branch manager keep their own branch only', async () => {
      expect((await call('branchMgrA', 'put', hours(branchA)).send(week)).status).toBe(200);
      expect((await call('branchMgrA', 'put', hours(branchA2)).send(week)).status).toBe(403);
      expect((await call('branchMgrA', 'get', hours(branchA2))).status).toBe(403);
      expect((await call('viewerA', 'put', hours()).send(week)).status).toBe(403);
    });

    it('does not reveal or touch branches the brand does not serve', async () => {
      expect((await call('managerA', 'put', hours(branchB)).send(week)).status).toBe(404);
      expect((await call('managerA', 'get', hours(NIL))).status).toBe(404);
      expect((await call('managerB', 'get', hours())).status).toBe(403);
    });
  });

  describe('closures', () => {
    const closure = (who: Who, body: Record<string, unknown>) =>
      call(who, 'post', `${brandA}/delivery/closures`).send(body);

    it('closes dates for the brand, a market or a branch and lists them by range', async () => {
      const all = await closure('managerA', { closedOn: '2026-12-02', reason: 'National Day' });
      expect(all.status).toBe(201);
      expect(all.body).toMatchObject({ closedOn: '2026-12-02', marketId: null, branchId: null });
      await closure('managerA', { closedOn: '2026-12-25', marketId: marketA });
      await closure('managerA', { closedOn: '2027-01-01', branchId: branchA });
      expect((await call('viewerA', 'get', `${brandA}/delivery/closures`)).body).toHaveLength(3);
      const ranged = await call(
        'viewerA',
        'get',
        `${brandA}/delivery/closures?from=2026-12-10&to=2026-12-31`,
      );
      expect(ranged.body).toHaveLength(1);
      expect(
        (await call('viewerA', 'get', `${brandA}/delivery/closures?branchId=${branchA}`)).body,
      ).toHaveLength(1);
      expect(await auditActions(all.body.id)).toEqual(['delivery.closure.create']);
    });

    it('validates dates and scope', async () => {
      expect((await closure('managerA', { closedOn: '2026-02-30' })).status).toBe(400);
      expect(
        (
          await closure('managerA', {
            closedOn: '2026-12-02',
            marketId: marketA,
            branchId: branchA,
          })
        ).status,
      ).toBe(400);
      expect(
        (await closure('managerA', { closedOn: '2026-12-02', marketId: marketB })).status,
      ).toBe(404);
      expect(
        (await closure('managerA', { closedOn: '2026-12-02', branchId: branchB })).status,
      ).toBe(404);
    });

    it('lets a branch manager close their branch but not the brand or a market', async () => {
      expect(
        (await closure('branchMgrA', { closedOn: '2026-12-02', branchId: branchA })).status,
      ).toBe(201);
      expect(
        (await closure('branchMgrA', { closedOn: '2026-12-02', branchId: branchA2 })).status,
      ).toBe(403);
      expect((await closure('branchMgrA', { closedOn: '2026-12-02' })).status).toBe(403);
      expect(
        (await closure('branchMgrA', { closedOn: '2026-12-02', marketId: marketA })).status,
      ).toBe(403);
      const brandWide = await closure('managerA', { closedOn: '2026-12-03' });
      const own = await call('branchMgrA', 'get', `${brandA}/delivery/closures`);
      expect(own.body).toHaveLength(1);
      expect(
        (await call('branchMgrA', 'delete', `${brandA}/delivery/closures/${brandWide.body.id}`))
          .status,
      ).toBe(403);
      expect(
        (await call('branchMgrA', 'delete', `${brandA}/delivery/closures/${own.body[0].id}`))
          .status,
      ).toBe(204);
      expect(
        (await call('managerA', 'delete', `${brandA}/delivery/closures/${brandWide.body.id}`))
          .status,
      ).toBe(204);
      expect((await call('managerA', 'delete', `${brandA}/delivery/closures/${NIL}`)).status).toBe(
        404,
      );
    });

    it('keeps closures apart between brands', async () => {
      const mine = await closure('managerA', { closedOn: '2026-12-02' });
      expect(
        (await call('managerB', 'delete', `${brandA}/delivery/closures/${mine.body.id}`)).status,
      ).toBe(403);
      expect(
        (await call('managerB', 'delete', `${brandB}/delivery/closures/${mine.body.id}`)).status,
      ).toBe(404);
      expect((await call('managerB', 'get', `${brandB}/delivery/closures`)).body).toEqual([]);
    });
  });

  describe('methods', () => {
    const method = (body: Record<string, unknown> = {}, who: Who = 'managerA') =>
      call(who, 'post', `${brandA}/delivery/methods`).send({
        marketId: marketA,
        kind: 'SAME_DAY',
        code: 'same-day',
        translations: [{ language: 'en', name: 'Same day' }],
        ...body,
      });

    it('creates, updates, translates and deletes with audit', async () => {
      const created = await method();
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      const base = `${brandA}/delivery/methods/${id}`;
      expect((await call('managerA', 'patch', base).send({ status: 'INACTIVE' })).body.status).toBe(
        'INACTIVE',
      );
      const ar = await call('managerA', 'put', `${base}/translations/ar`).send({
        name: 'نفس اليوم',
      });
      expect(ar.body.translations).toHaveLength(2);
      expect((await call('managerA', 'delete', `${base}/translations/en`)).status).toBe(422);
      expect((await call('viewerA', 'get', base)).status).toBe(200);
      expect(
        (await call('viewerA', 'get', `${brandA}/delivery/methods?marketId=${marketA}`)).body,
      ).toHaveLength(1);
      expect((await call('managerA', 'delete', base)).status).toBe(204);
      expect(await auditActions(id)).toEqual([
        'delivery.method.create',
        'delivery.method.update',
        'delivery.method.translation.put',
        'delivery.method.delete',
      ]);
    });

    it('validates input and refuses duplicates and foreign markets', async () => {
      expect((await method({ translations: [{ language: 'ar', name: 'x' }] })).body.code).toBe(
        'ENGLISH_REQUIRED',
      );
      expect((await method({ kind: 'TELEPORT' })).status).toBe(400);
      expect((await method({ marketId: marketB })).status).toBe(404);
      expect((await method()).status).toBe(201);
      const dup = await method();
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('METHOD_CODE_TAKEN');
      expect((await method({ code: 'other' }, 'viewerA')).status).toBe(403);
    });
  });

  describe('charges', () => {
    let zoneId = '';
    let zone2Id = '';
    let methodId = '';
    let method2Id = '';

    beforeEach(async () => {
      const zone = async (marketId: string, code: string) =>
        (
          await call('managerA', 'post', `${brandA}/delivery/zones`).send({
            marketId,
            code,
            translations: [{ language: 'en', name: code }],
          })
        ).body.id as string;
      zoneId = await zone(marketA, 'central');
      zone2Id = await zone(marketA2, 'north');
      const method = async (marketId: string, code: string) =>
        (
          await call('managerA', 'post', `${brandA}/delivery/methods`).send({
            marketId,
            kind: 'SCHEDULED',
            code,
            translations: [{ language: 'en', name: code }],
          })
        ).body.id as string;
      methodId = await method(marketA, 'scheduled');
      method2Id = await method(marketA2, 'scheduled-2');
    });

    const charge = (body: Record<string, unknown> = {}, who: Who = 'managerA') =>
      call(who, 'post', `${brandA}/delivery/charges`).send({
        zoneId,
        methodId,
        currencyCode: 'aed',
        feeMinor: 2500,
        minimumOrderMinor: 10000,
        freeOverMinor: 30000,
        ...body,
      });

    it('sets, changes and removes a charge in integer minor units, with audit', async () => {
      const created = await charge();
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        marketId: marketA,
        currencyCode: 'AED',
        feeMinor: 2500,
        minimumOrderMinor: 10000,
        freeOverMinor: 30000,
      });
      const id = created.body.id as string;
      const upd = await call('managerA', 'patch', `${brandA}/delivery/charges/${id}`).send({
        feeMinor: 0,
        freeOverMinor: null,
      });
      expect(upd.body).toMatchObject({ feeMinor: 0, freeOverMinor: null });
      expect(
        (await call('viewerA', 'get', `${brandA}/delivery/charges?zoneId=${zoneId}`)).body,
      ).toHaveLength(1);
      expect((await call('managerA', 'delete', `${brandA}/delivery/charges/${id}`)).status).toBe(
        204,
      );
      expect(await auditActions(id)).toEqual([
        'delivery.charge.create',
        'delivery.charge.update',
        'delivery.charge.delete',
      ]);
    });

    it('refuses fractional, negative and inconsistent amounts', async () => {
      expect((await charge({ feeMinor: 25.5 })).status).toBe(400);
      expect((await charge({ feeMinor: -1 })).status).toBe(400);
      expect((await charge({ freeOverMinor: 5000 })).status).toBe(400);
      const ok = await charge();
      const patch = (b: Record<string, unknown>) =>
        call('managerA', 'patch', `${brandA}/delivery/charges/${ok.body.id}`).send(b);
      expect((await patch({ minimumOrderMinor: 40000 })).body.code).toBe('THRESHOLD_BELOW_MINIMUM');
      expect((await patch({ feeMinor: 1.5 })).status).toBe(400);
    });

    it('keeps zone, method and currency inside one market', async () => {
      expect((await charge({ methodId: method2Id })).body.code).toBe('MARKET_MISMATCH');
      expect((await charge({ currencyCode: 'USD' })).body.code).toBe('CURRENCY_NOT_IN_MARKET');
      expect((await charge({ zoneId: NIL })).status).toBe(404);
      expect((await charge()).status).toBe(201);
      const dup = await charge();
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('CHARGE_EXISTS');
      expect((await charge({ zoneId: zone2Id, methodId: method2Id })).status).toBe(201);
    });

    it('blocks deleting a zone or method that has a charge', async () => {
      await charge();
      const method = await call('managerA', 'delete', `${brandA}/delivery/methods/${methodId}`);
      expect(method.body.code).toBe('METHOD_IN_USE');
      const zone = await call('managerA', 'delete', `${brandA}/delivery/zones/${zoneId}`);
      expect(zone.body.code).toBe('ZONE_IN_USE');
    });

    it('needs delivery.manage to write and stays inside the brand', async () => {
      expect((await charge({}, 'viewerA')).status).toBe(403);
      expect((await charge({}, 'branchMgrA')).status).toBe(403);
      expect((await charge({}, 'nobody')).status).toBe(403);
      const ok = await charge();
      expect((await call('managerB', 'get', `${brandA}/delivery/charges`)).status).toBe(403);
      const viaB = await call('managerB', 'patch', `${brandB}/delivery/charges/${ok.body.id}`).send(
        { feeMinor: 1 },
      );
      expect(viaB.status).toBe(404);
    });
  });

  describe('every route refuses missing sessions and roles', () => {
    it('probes all calendar, method and charge routes', async () => {
      const b = brandA;
      const probes: Array<['get' | 'post' | 'put' | 'patch' | 'delete', string]> = [
        ['get', `${b}/delivery/branches/${branchA}/hours`],
        ['put', `${b}/delivery/branches/${branchA}/hours`],
        ['get', `${b}/delivery/closures`],
        ['post', `${b}/delivery/closures`],
        ['delete', `${b}/delivery/closures/${NIL}`],
        ['get', `${b}/delivery/methods`],
        ['post', `${b}/delivery/methods`],
        ['get', `${b}/delivery/methods/${NIL}`],
        ['patch', `${b}/delivery/methods/${NIL}`],
        ['put', `${b}/delivery/methods/${NIL}/translations/ar`],
        ['delete', `${b}/delivery/methods/${NIL}/translations/ar`],
        ['delete', `${b}/delivery/methods/${NIL}`],
        ['get', `${b}/delivery/charges`],
        ['post', `${b}/delivery/charges`],
        ['patch', `${b}/delivery/charges/${NIL}`],
        ['delete', `${b}/delivery/charges/${NIL}`],
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
});
