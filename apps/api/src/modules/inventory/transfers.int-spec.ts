import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool, QueryResultRow } from 'pg';
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
 * Transfers between branches (Phase 4 step 4.9): request, ship, receive with discrepancies, cancel,
 * the ledger on both sides, concurrency, branch scope, isolation and audit.
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'opsA' | 'srcUser' | 'dstUser' | 'otherUser' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('inventory transfers', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketB = '';
  let branchA = '';
  let branchA2 = '';
  let branchA3 = '';
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
      branchA3 = await br('kitchen-a3', marketA);
      await br('kitchen-b', marketB);
    });
    const ops = ['inventory.view', 'inventory.adjust', 'inventory.transfer'];
    const branchRole = ['inventory.view', 'inventory.transfer'];
    sess = {
      opsA: await session('opsa', ops, brandA),
      srcUser: await session('srcuser', branchRole, brandA, branchA),
      dstUser: await session('dstuser', branchRole, brandA, branchA2),
      otherUser: await session('otheruser', branchRole, brandA, branchA3),
      viewerA: await session('viewera', ['inventory.view'], brandA),
      managerB: await session('managerb', ops, brandB),
      nobody: await session('nobody', [], null),
    };
  });

  const url = (rest = '') => `${brandA}/inventory/transfers${rest}`;

  let p1 = '';
  let p2 = '';
  let variable = '';
  let variation = '';
  let bundle = '';

  const asOwner = async <T extends QueryResultRow>(sql: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      return (await client.query<T>(sql, params)).rows;
    } finally {
      client.release();
    }
  };

  beforeEach(async () => {
    await withScope(db, platformScope, async (tx) => {
      p1 = (await tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } })).id;
      p2 = (await tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } })).id;
      variable = (await tx.product.create({ data: { brandId: brandA, type: 'VARIABLE' } })).id;
      bundle = (await tx.product.create({ data: { brandId: brandA, type: 'BUNDLE' } })).id;
      variation = (
        await tx.variation.create({
          data: { brandId: brandA, productId: variable, sku: 'V-1', combinationKey: 'k1' },
        })
      ).id;
    });
  });

  const makeStock = (
    branchId: string,
    onHand: number,
    ids: { productId: string; variationId?: string } = { productId: p1 },
    extra: Record<string, unknown> = {},
  ) =>
    withScope(
      db,
      platformScope,
      async (tx) =>
        (
          await tx.stockLevel.create({
            data: {
              brandId: brandA,
              branchId,
              productId: ids.productId,
              variationId: ids.variationId ?? null,
              onHand,
              ...extra,
            },
          })
        ).id,
    );
  const levelAt = (branchId: string, productId: string, variationId: string | null = null) =>
    withScope(db, platformScope, (tx) =>
      tx.stockLevel.findFirst({ where: { branchId, productId, variationId } }),
    );
  const onHandAt = async (branchId: string, productId = p1) =>
    (await levelAt(branchId, productId))?.onHand ?? null;

  const ask = (
    body: Record<string, unknown> = {},
    who: Who = 'opsA',
    from = branchA,
    to = branchA2,
  ) =>
    call(who, 'post', url()).send({
      fromBranchId: from,
      toBranchId: to,
      lines: [{ productId: p1, quantity: 5 }],
      ...body,
    });
  const requested = async (body: Record<string, unknown> = {}) => {
    const res = await ask(body);
    expect(res.status).toBe(201);
    return res.body as { id: string; lines: Array<{ id: string }> };
  };
  const act = (
    id: string,
    action: 'ship' | 'receive' | 'cancel',
    body: Record<string, unknown> = {},
    who: Who = 'opsA',
  ) => call(who, 'post', url(`/${id}/${action}`)).send(body);

  describe('request', () => {
    it('records a request and moves nothing', async () => {
      await makeStock(branchA, 20);
      const res = await ask({
        note: 'Weekend stock',
        lines: [
          { productId: p1, quantity: 5 },
          { productId: variable, variationId: variation, quantity: 2 },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'REQUESTED',
        fromBranchId: branchA,
        toBranchId: branchA2,
        note: 'Weekend stock',
        hasDiscrepancy: false,
      });
      expect(res.body.lines).toHaveLength(2);
      expect(res.body.lines[0]).toMatchObject({ quantityShipped: null, quantityReceived: null });
      expect(await onHandAt(branchA)).toBe(20);
      expect(await onHandAt(branchA2)).toBeNull();
      expect(await auditActions(res.body.id)).toEqual(['inventory.transfer.request']);
      expect((await call('viewerA', 'get', url(`/${res.body.id}`))).body.id).toBe(res.body.id);
    });

    it('validates the request', async () => {
      expect((await ask({ toBranchId: branchA })).status).toBe(400);
      expect((await ask({ lines: [] })).status).toBe(400);
      expect((await ask({ lines: [{ productId: p1, quantity: 0 }] })).status).toBe(400);
      expect(
        (
          await ask({
            lines: [
              { productId: p1, quantity: 1 },
              { productId: p1, quantity: 2 },
            ],
          })
        ).status,
      ).toBe(400);
      expect((await ask({ toBranchId: NIL })).status).toBe(404);
      expect((await ask({ fromBranchId: NIL })).status).toBe(404);
      expect((await ask({ lines: [{ productId: NIL, quantity: 1 }] })).status).toBe(404);
      expect(
        (await ask({ lines: [{ productId: p1, variationId: variation, quantity: 1 }] })).status,
      ).toBe(404);
      const noVariation = await ask({ lines: [{ productId: variable, quantity: 1 }] });
      expect(noVariation.status).toBe(422);
      expect(noVariation.body.code).toBe('STOCK_SHAPE_INVALID');
      expect((await ask({ lines: [{ productId: bundle, quantity: 1 }] })).status).toBe(422);
    });
  });

  describe('ship', () => {
    it('takes the shipped quantity out of the sender and writes the ledger', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      const res = await act(t.id, 'ship');
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('IN_TRANSIT');
      expect(res.body.shippedAt).not.toBeNull();
      expect(res.body.lines[0]).toMatchObject({
        quantityRequested: 5,
        quantityShipped: 5,
        quantityReceived: null,
      });
      expect(await onHandAt(branchA)).toBe(15);
      const moves = await asOwner<{
        type: string;
        quantity: number;
        on_hand_after: number;
        transfer_id: string;
      }>(
        'SELECT type, quantity, on_hand_after, transfer_id FROM stock_movement WHERE transfer_id = $1',
        [t.id],
      );
      expect(moves).toEqual([
        { type: 'TRANSFER_OUT', quantity: 5, on_hand_after: 15, transfer_id: t.id },
      ]);
      expect(await auditActions(t.id)).toEqual([
        'inventory.transfer.request',
        'inventory.transfer.ship',
      ]);
    });

    it('ships less than requested, line by line', async () => {
      await makeStock(branchA, 20);
      await makeStock(branchA, 20, { productId: p2 });
      const t = await requested({
        lines: [
          { productId: p1, quantity: 5 },
          { productId: p2, quantity: 4 },
        ],
      });
      const [first, second] = t.lines;
      const res = await act(t.id, 'ship', {
        lines: [
          { lineId: first!.id, quantity: 3 },
          { lineId: second!.id, quantity: 0 },
        ],
      });
      expect(res.status).toBe(201);
      const shipped = res.body.lines
        .map((l: { quantityShipped: number }) => l.quantityShipped)
        .sort();
      expect(shipped).toEqual([0, 3]);
      const total = (await onHandAt(branchA, p1))! + (await onHandAt(branchA, p2))!;
      expect(total).toBe(37);
    });

    it('refuses bad quantities and unknown lines', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      const line = t.lines[0]!.id;
      expect((await act(t.id, 'ship', { lines: [{ lineId: line, quantity: 6 }] })).body.code).toBe(
        'SHIPPED_EXCEEDS_REQUESTED',
      );
      expect((await act(t.id, 'ship', { lines: [{ lineId: line, quantity: 0 }] })).body.code).toBe(
        'NOTHING_TO_SHIP',
      );
      expect((await act(t.id, 'ship', { lines: [{ lineId: NIL, quantity: 1 }] })).status).toBe(404);
      expect(await onHandAt(branchA)).toBe(20);
    });

    it('refuses when the sender lacks the stock, and changes nothing', async () => {
      await makeStock(branchA, 20);
      await makeStock(branchA, 1, { productId: p2 });
      const t = await requested({
        lines: [
          { productId: p1, quantity: 5 },
          { productId: p2, quantity: 4 },
        ],
      });
      const res = await act(t.id, 'ship');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(await onHandAt(branchA, p1)).toBe(20);
      expect(await onHandAt(branchA, p2)).toBe(1);
      expect((await call('opsA', 'get', url(`/${t.id}`))).body.status).toBe('REQUESTED');
      expect(
        await asOwner('SELECT 1 FROM stock_movement WHERE transfer_id = $1', [t.id]),
      ).toHaveLength(0);
    });

    it('refuses when the sender does not track the item or has it reserved', async () => {
      const t = await requested();
      const res = await act(t.id, 'ship');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('STOCK_NOT_FOUND');
      const id = await makeStock(branchA, 10);
      await asOwner('UPDATE stock_level SET reserved = 8 WHERE id = $1', [id]);
      const blocked = await act(t.id, 'ship');
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('STOCK_RESERVED');
      await asOwner('UPDATE stock_level SET reserved = 5 WHERE id = $1', [id]);
      expect((await act(t.id, 'ship')).status).toBe(201);
    });

    it('moves a variation between branches', async () => {
      await makeStock(branchA, 10, { productId: variable, variationId: variation });
      const t = await requested({
        lines: [{ productId: variable, variationId: variation, quantity: 4 }],
      });
      expect((await act(t.id, 'ship')).status).toBe(201);
      expect((await act(t.id, 'receive')).status).toBe(201);
      expect((await levelAt(branchA, variable, variation))?.onHand).toBe(6);
      expect((await levelAt(branchA2, variable, variation))?.onHand).toBe(4);
    });

    it('works only once and only from requested', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      expect((await act(t.id, 'ship')).status).toBe(201);
      const again = await act(t.id, 'ship');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('TRANSFER_STATE');
      expect(await onHandAt(branchA)).toBe(15);
    });
  });

  describe('receive and discrepancies', () => {
    const shipped = async (qty = 10, onHand = 20) => {
      await makeStock(branchA, onHand);
      const t = await requested({ lines: [{ productId: p1, quantity: qty }] });
      expect((await act(t.id, 'ship')).status).toBe(201);
      return t;
    };

    it('adds what arrived to the receiver, creating its stock row', async () => {
      const t = await shipped();
      expect(await onHandAt(branchA2)).toBeNull();
      const res = await act(t.id, 'receive');
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('RECEIVED');
      expect(res.body.receivedAt).not.toBeNull();
      expect(res.body.hasDiscrepancy).toBe(false);
      expect(res.body.lines[0]).toMatchObject({
        quantityShipped: 10,
        quantityReceived: 10,
        discrepancy: false,
      });
      expect(await onHandAt(branchA)).toBe(10);
      expect(await onHandAt(branchA2)).toBe(10);
      const moves = await asOwner<{ type: string; quantity: number }>(
        'SELECT type, quantity FROM stock_movement WHERE transfer_id = $1 ORDER BY id',
        [t.id],
      );
      expect(moves).toEqual([
        { type: 'TRANSFER_OUT', quantity: 10 },
        { type: 'TRANSFER_IN', quantity: 10 },
      ]);
      expect((await act(t.id, 'receive')).body.code).toBe('TRANSFER_STATE');
      expect(await onHandAt(branchA2)).toBe(10);
    });

    it('adds to a row the receiver already has', async () => {
      const t = await shipped();
      await makeStock(branchA2, 7);
      await act(t.id, 'receive');
      expect(await onHandAt(branchA2)).toBe(17);
    });

    it('needs a note when the count differs, then records the shortage', async () => {
      const t = await shipped();
      const line = t.lines[0]!.id;
      const refused = await act(t.id, 'receive', { lines: [{ lineId: line, quantity: 8 }] });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('DISCREPANCY_NOTE_REQUIRED');
      expect(await onHandAt(branchA2)).toBeNull();
      expect((await call('opsA', 'get', url(`/${t.id}`))).body.status).toBe('IN_TRANSIT');
      const res = await act(t.id, 'receive', {
        lines: [{ lineId: line, quantity: 8, note: 'Two vases broken' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.hasDiscrepancy).toBe(true);
      expect(res.body.lines[0]).toMatchObject({
        quantityShipped: 10,
        quantityReceived: 8,
        discrepancy: true,
        difference: -2,
        discrepancyNote: 'Two vases broken',
      });
      expect(await onHandAt(branchA)).toBe(10);
      expect(await onHandAt(branchA2)).toBe(8);
      const sums = await asOwner<{ type: string; quantity: number; reason: string | null }>(
        'SELECT type, quantity, reason FROM stock_movement WHERE transfer_id = $1 ORDER BY id',
        [t.id],
      );
      expect(sums).toEqual([
        { type: 'TRANSFER_OUT', quantity: 10, reason: null },
        { type: 'TRANSFER_IN', quantity: 8, reason: 'Two vases broken' },
      ]);
    });

    it('accepts nothing arriving and more arriving, each with a note', async () => {
      await makeStock(branchA, 20);
      await makeStock(branchA, 20, { productId: p2 });
      const t = await requested({
        lines: [
          { productId: p1, quantity: 5 },
          { productId: p2, quantity: 5 },
        ],
      });
      await act(t.id, 'ship');
      const [a, b] = t.lines;
      const res = await act(t.id, 'receive', {
        lines: [
          { lineId: a!.id, quantity: 0, note: 'Never arrived' },
          { lineId: b!.id, quantity: 6, note: 'Sender packed an extra unit' },
        ],
      });
      expect(res.status).toBe(201);
      const diffs = res.body.lines.map((l: { difference: number }) => l.difference).sort();
      expect(diffs).toEqual([-5, 1]);
      const there = (await onHandAt(branchA2, p1)) ?? 0;
      expect(there).toBe(0);
      expect(await onHandAt(branchA2, p2)).toBe(6);
    });

    it('lists transfers by status, branch and discrepancy', async () => {
      const t = await shipped();
      const clean = await requested({ lines: [{ productId: p1, quantity: 1 }] });
      expect(
        (await call('opsA', 'get', url('?status=REQUESTED'))).body.items.map(
          (x: { id: string }) => x.id,
        ),
      ).toEqual([clean.id]);
      expect((await call('opsA', 'get', url('?status=IN_TRANSIT'))).body.total).toBe(1);
      expect((await call('opsA', 'get', url(`?branchId=${branchA3}`))).body.total).toBe(0);
      expect((await call('opsA', 'get', url(`?branchId=${branchA2}`))).body.total).toBe(2);
      await act(t.id, 'receive', {
        lines: [{ lineId: t.lines[0]!.id, quantity: 9, note: 'One short' }],
      });
      const odd = await call('opsA', 'get', url('?discrepancy=true'));
      expect(odd.body.items.map((x: { id: string }) => x.id)).toEqual([t.id]);
      expect(
        (await call('opsA', 'get', url('?discrepancy=false'))).body.items.map(
          (x: { id: string }) => x.id,
        ),
      ).toEqual([clean.id]);
    });

    it('cannot be received before shipping', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      expect((await act(t.id, 'receive')).body.code).toBe('TRANSFER_STATE');
    });
  });

  describe('cancel', () => {
    it('cancels a request and nothing else', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      const res = await act(t.id, 'cancel', { reason: 'Not needed' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.note).toContain('Cancelled: Not needed');
      expect(await onHandAt(branchA)).toBe(20);
      expect((await act(t.id, 'ship')).body.code).toBe('TRANSFER_STATE');
      expect((await act(t.id, 'cancel')).body.code).toBe('TRANSFER_STATE');
      expect(await auditActions(t.id)).toEqual([
        'inventory.transfer.request',
        'inventory.transfer.cancel',
      ]);
    });

    it('cannot cancel what has shipped', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      await act(t.id, 'ship');
      expect((await act(t.id, 'cancel')).body.code).toBe('TRANSFER_STATE');
      expect(await onHandAt(branchA)).toBe(15);
    });
  });

  describe('concurrency and the ledger', () => {
    it('ships once when asked in parallel', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      const results = await Promise.all(Array.from({ length: 5 }, () => act(t.id, 'ship')));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await onHandAt(branchA)).toBe(15);
    });

    it('receives once when asked in parallel', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      await act(t.id, 'ship');
      const results = await Promise.all(Array.from({ length: 5 }, () => act(t.id, 'receive')));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await onHandAt(branchA2)).toBe(5);
    });

    it('lets only one of two transfers take the last stock', async () => {
      await makeStock(branchA, 5);
      const one = await requested();
      const two = await requested();
      const results = await Promise.all([act(one.id, 'ship'), act(two.id, 'ship')]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await onHandAt(branchA)).toBe(0);
    });

    it('receives into the same new row from parallel transfers without losing units', async () => {
      await makeStock(branchA, 50);
      const ts = await Promise.all(Array.from({ length: 4 }, () => requested()));
      for (const t of ts) await act(t.id, 'ship');
      const results = await Promise.all(ts.map((t) => act(t.id, 'receive')));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await onHandAt(branchA2)).toBe(20);
      expect(await onHandAt(branchA)).toBe(30);
    });

    it('keeps the ledger equal to on-hand on both sides', async () => {
      await makeStock(branchA, 20);
      const t = await requested({ lines: [{ productId: p1, quantity: 12 }] });
      await act(t.id, 'ship', { lines: [{ lineId: t.lines[0]!.id, quantity: 11 }] });
      await act(t.id, 'receive', {
        lines: [{ lineId: t.lines[0]!.id, quantity: 10, note: 'One lost' }],
      });
      const net = await asOwner<{ branch_id: string; net: string }>(
        `SELECT l.branch_id, SUM(CASE WHEN m.type = 'TRANSFER_IN' THEN m.quantity ELSE -m.quantity END) AS net
           FROM stock_movement m JOIN stock_level l ON l.id = m.stock_level_id
          WHERE m.transfer_id = $1 GROUP BY l.branch_id`,
        [t.id],
      );
      const by = Object.fromEntries(net.map((r) => [r.branch_id, Number(r.net)]));
      expect(by[branchA]).toBe(-11);
      expect(by[branchA2]).toBe(10);
      expect(await onHandAt(branchA)).toBe(9);
      expect(await onHandAt(branchA2)).toBe(10);
    });
  });

  describe('scope and isolation', () => {
    it('lets each branch do only its own part', async () => {
      await makeStock(branchA, 20);
      const mine = await ask({}, 'srcUser');
      expect(mine.status).toBe(201);
      const id = mine.body.id as string;
      expect((await act(id, 'ship', {}, 'dstUser')).status).toBe(403);
      expect((await act(id, 'ship', {}, 'otherUser')).status).toBe(403);
      expect((await act(id, 'ship', {}, 'srcUser')).status).toBe(201);
      expect((await act(id, 'receive', {}, 'srcUser')).status).toBe(403);
      expect((await act(id, 'receive', {}, 'otherUser')).status).toBe(403);
      expect((await act(id, 'receive', {}, 'dstUser')).status).toBe(201);
    });

    it('lets either side request or cancel, but not a third branch', async () => {
      const byReceiver = await ask({}, 'dstUser');
      expect(byReceiver.status).toBe(201);
      expect((await ask({}, 'otherUser')).status).toBe(403);
      expect((await act(byReceiver.body.id, 'cancel', {}, 'otherUser')).status).toBe(403);
      expect((await act(byReceiver.body.id, 'cancel', {}, 'srcUser')).status).toBe(201);
    });

    it('shows a branch only the transfers it takes part in', async () => {
      const t = await requested();
      expect((await call('srcUser', 'get', url())).body.total).toBe(1);
      expect((await call('dstUser', 'get', url(`/${t.id}`))).status).toBe(200);
      expect((await call('otherUser', 'get', url())).body.total).toBe(0);
      expect((await call('otherUser', 'get', url(`/${t.id}`))).status).toBe(403);
      expect((await call('viewerA', 'get', url())).body.total).toBe(1);
    });

    it('needs the transfer permission to change anything', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      expect((await ask({}, 'viewerA')).status).toBe(403);
      expect((await act(t.id, 'ship', {}, 'viewerA')).status).toBe(403);
      expect((await act(t.id, 'cancel', {}, 'viewerA')).status).toBe(403);
      expect((await call('nobody', 'get', url())).status).toBe(403);
      expect((await ask({}, 'nobody')).status).toBe(403);
    });

    it('stays inside the brand', async () => {
      await makeStock(branchA, 20);
      const t = await requested();
      expect((await call('managerB', 'get', url())).status).toBe(403);
      expect((await call('managerB', 'get', url(`/${t.id}`))).status).toBe(403);
      expect((await act(t.id, 'ship', {}, 'managerB')).status).toBe(403);
      expect((await call('managerB', 'get', `${brandB}/inventory/transfers/${t.id}`)).status).toBe(
        404,
      );
      expect(
        (await call('managerB', 'post', `${brandB}/inventory/transfers/${t.id}/ship`).send({}))
          .status,
      ).toBe(404);
      expect((await call('managerB', 'get', `${brandB}/inventory/transfers`)).body.items).toEqual(
        [],
      );
      expect((await ask({}, 'managerB')).status).toBe(403);
      expect(await onHandAt(branchA)).toBe(20);
    });

    it('refuses the transfer routes without a session', async () => {
      for (const [method, path] of [
        ['get', url()],
        ['post', url()],
        ['get', url(`/${NIL}`)],
        ['post', url(`/${NIL}/ship`)],
        ['post', url(`/${NIL}/receive`)],
        ['post', url(`/${NIL}/cancel`)],
      ] as const) {
        const anon = await request(app.getHttpServer())
          [method](`/api/v1/admin/brands/${path}`)
          .set('Origin', ORIGIN);
        expect([401, 403]).toContain(anon.status);
      }
    });
  });
});
