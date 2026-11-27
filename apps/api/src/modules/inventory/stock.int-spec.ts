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
 * Stock levels, settings and the movement ledger (Phase 4 step 4.7): rules, concurrency, scope,
 * isolation and audit.
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'managerA' | 'branchMgrA' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('inventory stock and ledger', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
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
      await mk(brandA, 'om', om.id);
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
    const manage = ['inventory.view', 'inventory.adjust'];
    sess = {
      managerA: await session('managera', manage, brandA),
      branchMgrA: await session(
        'branchmgra',
        ['inventory.view', 'inventory.adjust'],
        brandA,
        branchA,
      ),
      viewerA: await session('viewera', ['inventory.view'], brandA),
      managerB: await session('managerb', manage, brandB),
      nobody: await session('nobody', [], null),
    };
  });

  let simple = '';
  let variable = '';
  let variation = '';
  let bundle = '';

  beforeEach(async () => {
    await withScope(db, platformScope, async (tx) => {
      simple = (await tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } })).id;
      variable = (await tx.product.create({ data: { brandId: brandA, type: 'VARIABLE' } })).id;
      bundle = (await tx.product.create({ data: { brandId: brandA, type: 'BUNDLE' } })).id;
      variation = (
        await tx.variation.create({
          data: { brandId: brandA, productId: variable, sku: 'V-1', combinationKey: 'k1' },
        })
      ).id;
    });
  });

  const url = (rest = '') => `${brandA}/inventory${rest}`;
  const track = (body: Record<string, unknown> = {}, who: Who = 'managerA') =>
    call(who, 'post', url('/stock')).send({ branchId: branchA, productId: simple, ...body });
  const move = (id: string, body: Record<string, unknown>, who: Who = 'managerA') =>
    call(who, 'post', url(`/stock/${id}/movements`)).send(body);
  const stockOf = async (id: string) => (await call('managerA', 'get', url(`/stock/${id}`))).body;

  describe('settings', () => {
    it('returns defaults, updates them and keeps the audit trail', async () => {
      const got = await call('viewerA', 'get', url('/settings'));
      expect(got.body).toEqual({
        reservationMinutes: 15,
        maxExtensions: 1,
        defaultOutOfStock: 'SHOW_UNAVAILABLE',
      });
      const put = await call('managerA', 'put', url('/settings')).send({
        reservationMinutes: 30,
        defaultOutOfStock: 'HIDE',
      });
      expect(put.body).toMatchObject({
        reservationMinutes: 30,
        maxExtensions: 1,
        defaultOutOfStock: 'HIDE',
      });
      expect((await call('viewerA', 'get', url('/settings'))).body.reservationMinutes).toBe(30);
      expect(
        (await call('managerA', 'put', url('/settings')).send({ reservationMinutes: 0 })).status,
      ).toBe(400);
      expect(
        (await call('managerA', 'put', url('/settings')).send({ maxExtensions: 6 })).status,
      ).toBe(400);
      expect(await auditActions(brandA)).toEqual(['inventory.settings.put']);
    });

    it('is brand-wide: a branch manager and a viewer cannot change it', async () => {
      expect(
        (await call('branchMgrA', 'put', url('/settings')).send({ maxExtensions: 2 })).status,
      ).toBe(403);
      expect(
        (await call('viewerA', 'put', url('/settings')).send({ maxExtensions: 2 })).status,
      ).toBe(403);
    });

    it('writes backorder on the rows that follow the default', async () => {
      const id = (await track()).body.id as string;
      const other = (
        await track({ productId: variable, variationId: variation, outOfStock: 'HIDE' })
      ).body.id as string;
      const put = await call('managerA', 'put', url('/settings')).send({
        defaultOutOfStock: 'ALLOW_BACKORDER',
      });
      expect(put.body.rowsSetToBackorder).toBe(1);
      expect((await stockOf(id)).outOfStock).toBe('ALLOW_BACKORDER');
      expect((await stockOf(other)).outOfStock).toBe('HIDE');
      const fresh = await track({ branchId: branchA2 });
      expect(fresh.body.outOfStock).toBe('ALLOW_BACKORDER');
      expect(fresh.body.effectiveOutOfStock).toBe('ALLOW_BACKORDER');
    });
  });

  describe('stock rows', () => {
    it('starts tracking at zero and returns the row with available stock', async () => {
      const res = await track({ lowStockThreshold: 3 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        branchId: branchA,
        productId: simple,
        variationId: null,
        onHand: 0,
        reserved: 0,
        available: 0,
        lowStockThreshold: 3,
        low: true,
        outOfStock: null,
        effectiveOutOfStock: 'SHOW_UNAVAILABLE',
      });
    });

    it('keeps stock on simple products and variations only', async () => {
      expect((await track({ productId: variable })).body.code).toBe('STOCK_SHAPE_INVALID');
      expect((await track({ productId: bundle })).body.code).toBe('STOCK_SHAPE_INVALID');
      expect((await track({ variationId: variation })).body.code).toBe('STOCK_SHAPE_INVALID');
      expect((await track({ productId: variable, variationId: variation })).status).toBe(201);
    });

    it('refuses duplicates and unknown or foreign references', async () => {
      expect((await track()).status).toBe(201);
      const dup = await track();
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('STOCK_ROW_EXISTS');
      expect((await track({ productId: NIL })).status).toBe(404);
      expect((await track({ branchId: NIL })).status).toBe(404);
      expect((await track({ branchId: branchB })).status).toBe(404);
      expect((await track({ lowStockThreshold: -1 })).status).toBe(400);
    });

    it('changes the threshold and behaviour, and lists with filters and a low flag', async () => {
      const id = (await track({ lowStockThreshold: 2 })).body.id as string;
      const other = (await track({ branchId: branchA2 })).body.id as string;
      await move(id, { type: 'RECEIPT', quantity: 10 });
      const upd = await call('managerA', 'patch', url(`/stock/${id}`)).send({
        lowStockThreshold: 20,
        outOfStock: 'HIDE',
      });
      expect(upd.body).toMatchObject({ lowStockThreshold: 20, low: true, outOfStock: 'HIDE' });
      expect((await call('managerA', 'patch', url(`/stock/${id}`)).send({})).status).toBe(400);
      const all = await call('viewerA', 'get', url('/stock'));
      expect(all.body).toMatchObject({ total: 2, page: 1 });
      expect(
        (await call('viewerA', 'get', url(`/stock?branchId=${branchA2}`))).body.items[0].id,
      ).toBe(other);
      expect((await call('viewerA', 'get', url('/stock?low=false'))).body.total).toBe(0);
      expect(
        (await call('viewerA', 'get', url(`/stock?productId=${simple}&low=true`))).body.total,
      ).toBe(2);
    });
  });

  describe('movements and the ledger', () => {
    it('records receipts, adjustments and wastage and returns history newest first', async () => {
      const id = (await track()).body.id as string;
      const r = await move(id, {
        type: 'RECEIPT',
        quantity: 10,
        reason: 'Delivery',
        referenceType: 'po',
        referenceId: 'P-1',
      });
      expect(r.status).toBe(201);
      expect(r.body.stock).toMatchObject({ onHand: 10, available: 10 });
      expect(r.body.movement).toMatchObject({
        type: 'RECEIPT',
        quantity: 10,
        onHandAfter: 10,
        referenceId: 'P-1',
      });
      expect(
        (await move(id, { type: 'ADJUSTMENT_OUT', quantity: 3, reason: 'Recount' })).body.stock
          .onHand,
      ).toBe(7);
      expect(
        (await move(id, { type: 'WASTAGE', quantity: 2, reason: 'Wilted' })).body.stock.onHand,
      ).toBe(5);
      expect(
        (await move(id, { type: 'ADJUSTMENT_IN', quantity: 1, reason: 'Found' })).body.stock.onHand,
      ).toBe(6);
      const hist = await call('viewerA', 'get', url(`/stock/${id}/movements?limit=3`));
      expect(hist.body.items.map((m: { type: string }) => m.type)).toEqual([
        'ADJUSTMENT_IN',
        'WASTAGE',
        'ADJUSTMENT_OUT',
      ]);
      expect(hist.body.items[0].actorStaffId).toBeTruthy();
      const older = await call(
        'viewerA',
        'get',
        url(`/stock/${id}/movements?limit=3&before=${hist.body.next}`),
      );
      expect(older.body.items.map((m: { type: string }) => m.type)).toEqual(['RECEIPT']);
      expect(older.body.next).toBeNull();
      expect(await auditActions(id)).toEqual([
        'inventory.stock.create',
        'inventory.stock.receipt',
        'inventory.stock.adjustment_out',
        'inventory.stock.wastage',
        'inventory.stock.adjustment_in',
      ]);
    });

    it('requires a reason for adjustments, whole positive quantities and manual types only', async () => {
      const id = (await track()).body.id as string;
      expect((await move(id, { type: 'ADJUSTMENT_IN', quantity: 1 })).status).toBe(400);
      expect((await move(id, { type: 'WASTAGE', quantity: 1 })).status).toBe(400);
      expect((await move(id, { type: 'RECEIPT', quantity: 0 })).status).toBe(400);
      expect((await move(id, { type: 'RECEIPT', quantity: 1.5 })).status).toBe(400);
      expect((await move(id, { type: 'SALE', quantity: 1, reason: 'x' })).status).toBe(400);
      expect((await move(id, { type: 'TRANSFER_IN', quantity: 1, reason: 'x' })).status).toBe(400);
      expect((await move(id, { type: 'RECEIPT', quantity: 1_000_001 })).status).toBe(400);
      expect((await move(id, { type: 'RECEIPT', quantity: 1 })).status).toBe(201);
    });

    it('never takes stock below zero or below what is reserved', async () => {
      const id = (await track()).body.id as string;
      await move(id, { type: 'RECEIPT', quantity: 10 });
      const over = await move(id, { type: 'ADJUSTMENT_OUT', quantity: 11, reason: 'x' });
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('INSUFFICIENT_STOCK');
      await owner.query('UPDATE stock_level SET reserved = 5 WHERE id = $1', [id]);
      const held = await move(id, { type: 'WASTAGE', quantity: 6, reason: 'x' });
      expect(held.status).toBe(409);
      expect(held.body.code).toBe('STOCK_RESERVED');
      expect(
        (await move(id, { type: 'WASTAGE', quantity: 5, reason: 'x' })).body.stock,
      ).toMatchObject({
        onHand: 5,
        reserved: 5,
        available: 0,
      });
      const sw = await call('managerA', 'patch', url(`/stock/${id}`)).send({
        outOfStock: 'ALLOW_BACKORDER',
      });
      expect(sw.body.outOfStock).toBe('ALLOW_BACKORDER');
      expect((await move(id, { type: 'WASTAGE', quantity: 4, reason: 'x' })).status).toBe(201);
      const off = await call('managerA', 'patch', url(`/stock/${id}`)).send({ outOfStock: 'HIDE' });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('STOCK_RESERVED');
    });

    it('gives the last unit to exactly one of many parallel requests', async () => {
      const id = (await track()).body.id as string;
      await move(id, { type: 'RECEIPT', quantity: 1 });
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          move(id, { type: 'ADJUSTMENT_OUT', quantity: 1, reason: 'race' }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect((await stockOf(id)).onHand).toBe(0);
    });

    it('keeps on-hand equal to the sum of the ledger under parallel changes', async () => {
      const id = (await track()).body.id as string;
      await Promise.all([
        ...Array.from({ length: 5 }, () => move(id, { type: 'RECEIPT', quantity: 4 })),
        ...Array.from({ length: 5 }, () => move(id, { type: 'WASTAGE', quantity: 3, reason: 'x' })),
      ]);
      const level = await stockOf(id);
      const client = await owner.connect();
      try {
        await client.query(`SELECT set_config('app.platform','on',false)`);
        const sum = await client.query<{ net: string }>(
          `SELECT COALESCE(SUM(CASE WHEN type IN ('RECEIPT','ADJUSTMENT_IN','RETURN','TRANSFER_IN') THEN quantity ELSE -quantity END), 0) AS net
             FROM stock_movement WHERE stock_level_id = $1`,
          [id],
        );
        expect(Number(sum.rows[0]!.net)).toBe(level.onHand);
      } finally {
        client.release();
      }
      expect(level.onHand).toBeGreaterThanOrEqual(0);
    });

    it('records a stocktake as an adjustment of the difference', async () => {
      const id = (await track()).body.id as string;
      await move(id, { type: 'RECEIPT', quantity: 6 });
      const up = await call('managerA', 'post', url(`/stock/${id}/count`)).send({
        counted: 20,
        reason: 'Monthly count',
      });
      expect(up.status).toBe(201);
      expect(up.body.movement).toMatchObject({
        type: 'ADJUSTMENT_IN',
        quantity: 14,
        referenceType: 'stocktake',
      });
      const down = await call('managerA', 'post', url(`/stock/${id}/count`)).send({
        counted: 0,
        reason: 'Emptied',
      });
      expect(down.body.movement).toMatchObject({ type: 'ADJUSTMENT_OUT', quantity: 20 });
      expect((await stockOf(id)).onHand).toBe(0);
      const same = await call('managerA', 'post', url(`/stock/${id}/count`)).send({
        counted: 0,
        reason: 'again',
      });
      expect(same.body.code).toBe('NO_CHANGE');
      expect(
        (await call('managerA', 'post', url(`/stock/${id}/count`)).send({ counted: 3 })).status,
      ).toBe(400);
    });

    it('cannot be rewritten: the ledger rows are append-only for the runtime role', async () => {
      const id = (await track()).body.id as string;
      const m = await move(id, { type: 'RECEIPT', quantity: 2 });
      const appPool = createPool(testAppUrl());
      const client = await appPool.connect();
      try {
        await client.query(`SELECT set_config('app.platform','on',false)`);
        await expect(
          client.query('UPDATE stock_movement SET quantity = 99 WHERE id = $1', [
            m.body.movement.id,
          ]),
        ).rejects.toThrow();
        await expect(
          client.query('DELETE FROM stock_movement WHERE id = $1', [m.body.movement.id]),
        ).rejects.toThrow();
      } finally {
        client.release();
        await appPool.end();
      }
    });
  });

  describe('scope and isolation', () => {
    it('limits a branch manager to their own branch', async () => {
      const mine = (await track()).body.id as string;
      const theirs = (await track({ branchId: branchA2 })).body.id as string;
      expect((await move(mine, { type: 'RECEIPT', quantity: 3 }, 'branchMgrA')).status).toBe(201);
      expect((await move(theirs, { type: 'RECEIPT', quantity: 3 }, 'branchMgrA')).status).toBe(403);
      expect((await call('branchMgrA', 'get', url(`/stock/${theirs}`))).status).toBe(403);
      expect((await call('branchMgrA', 'get', url(`/stock/${theirs}/movements`))).status).toBe(403);
      expect(
        (await call('branchMgrA', 'patch', url(`/stock/${theirs}`)).send({ lowStockThreshold: 1 }))
          .status,
      ).toBe(403);
      const list = await call('branchMgrA', 'get', url('/stock'));
      expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([mine]);
      expect((await track({ branchId: branchA2 }, 'branchMgrA')).status).toBe(403);
    });

    it('lets viewers read but not change, and refuses outsiders', async () => {
      const id = (await track()).body.id as string;
      expect((await call('viewerA', 'get', url(`/stock/${id}`))).status).toBe(200);
      expect((await move(id, { type: 'RECEIPT', quantity: 1 }, 'viewerA')).status).toBe(403);
      expect((await track({}, 'viewerA')).status).toBe(403);
      expect((await call('nobody', 'get', url('/stock'))).status).toBe(403);
      expect((await call('managerB', 'get', url('/stock'))).status).toBe(403);
      expect((await move(id, { type: 'RECEIPT', quantity: 1 }, 'managerB')).status).toBe(403);
      const viaB = await call('managerB', 'get', `${brandB}/inventory/stock/${id}`);
      expect(viaB.status).toBe(404);
      expect((await call('managerB', 'get', `${brandB}/inventory/stock`)).body.total).toBe(0);
    });

    it('refuses every inventory route without a session or a role', async () => {
      const probes: Array<['get' | 'post' | 'put' | 'patch', string]> = [
        ['get', url('/settings')],
        ['put', url('/settings')],
        ['get', url('/stock')],
        ['post', url('/stock')],
        ['get', url(`/stock/${NIL}`)],
        ['patch', url(`/stock/${NIL}`)],
        ['post', url(`/stock/${NIL}/movements`)],
        ['post', url(`/stock/${NIL}/count`)],
        ['get', url(`/stock/${NIL}/movements`)],
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
