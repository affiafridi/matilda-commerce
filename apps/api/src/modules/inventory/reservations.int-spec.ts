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
import {
  createPool,
  resetAuditLog,
  testAppUrl,
  testOwnerUrl,
  testRedisUrl,
} from '../../test-support/test-db';
import { ReservationExpiryJob, RESERVATION_QUEUE } from './reservation-expiry.job';
import { ReservationsService } from './reservations.service';
import { JobsService } from '../jobs/jobs.service';

/**
 * Reservations for stock and delivery slots (Phase 4 step 4.8): holds, confirm, release,
 * extension, expiry, concurrency, staff routes, scope and audit.
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'managerA' | 'branchMgrA' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('inventory reservations', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
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
    process.env.REDIS_URL = testRedisUrl();
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
      await br('kitchen-b', marketB);
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

  const url = (rest = '') => `${brandA}/inventory${rest}`;

  let productA = '';
  const queueClean = async () =>
    app.get(JobsService).queue(RESERVATION_QUEUE).obliterate({ force: true });
  let reservations: ReservationsService;
  const DATE = '2026-12-04'; // a Friday
  const WEEKDAY = 5;

  const asOwner = async <T extends QueryResultRow>(sql: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      return (await client.query<T>(sql, params)).rows;
    } finally {
      client.release();
    }
  };

  const makeStock = (onHand: number, extra: Record<string, unknown> = {}, branchId = branchA) =>
    withScope(db, platformScope, async (tx) => {
      const product =
        extra.productId ??
        (await tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } })).id;
      return (
        await tx.stockLevel.create({
          data: { brandId: brandA, branchId, productId: product as string, onHand, ...extra },
        })
      ).id;
    });
  const levelOf = (id: string) =>
    withScope(db, platformScope, (tx) => tx.stockLevel.findUniqueOrThrow({ where: { id } }));
  const makeSlot = (capacity: number, extra: Record<string, unknown> = {}) =>
    withScope(
      db,
      platformScope,
      async (tx) =>
        (
          await tx.deliverySlot.create({
            data: {
              brandId: brandA,
              marketId: marketA,
              branchId: branchA,
              weekday: WEEKDAY,
              startTime: new Date('1970-01-01T14:00:00Z'),
              endTime: new Date('1970-01-01T16:00:00Z'),
              cutoffTime: new Date('1970-01-01T10:00:00Z'),
              capacity,
              methods: ['SAME_DAY'],
              ...extra,
            },
          })
        ).id,
    );
  const bookedOn = async (slotId: string) =>
    (await withScope(db, platformScope, (tx) => tx.slotDay.findFirst({ where: { slotId } })))
      ?.booked ?? 0;
  const hold = (
    checkoutRef: string,
    lines: Array<[string, number]>,
    slot?: Record<string, unknown>,
  ) =>
    reservations.hold({
      brandId: brandA,
      marketId: marketA,
      checkoutRef,
      lines: lines.map(([stockLevelId, quantity]) => ({ stockLevelId, quantity })),
      ...(slot && { slot: slot as never }),
    });
  const code = async (p: Promise<unknown>) =>
    p.then(
      () => 'OK',
      (e: { code?: string }) => e.code ?? 'ERROR',
    );

  beforeAll(() => {
    reservations = app.get(ReservationsService);
  });

  beforeEach(async () => {
    productA = (
      await withScope(db, platformScope, (tx) =>
        tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } }),
      )
    ).id;
  });

  describe('stock holds', () => {
    it('holds stock without changing on-hand, for the brand window', async () => {
      const id = await makeStock(10, { productId: productA });
      const now = new Date('2026-12-01T10:00:00Z');
      const res = await reservations.hold(
        {
          brandId: brandA,
          marketId: marketA,
          checkoutRef: 'c1',
          lines: [{ stockLevelId: id, quantity: 3 }],
        },
        now,
      );
      expect(res.expiresAt).toBe('2026-12-01T10:15:00.000Z');
      expect(res.slot).toBeNull();
      expect(await levelOf(id)).toMatchObject({ onHand: 10, reserved: 3 });
    });

    it('uses the brand reservation window', async () => {
      await call('managerA', 'put', url('/settings')).send({ reservationMinutes: 40 });
      const id = await makeStock(5);
      const res = await reservations.hold(
        {
          brandId: brandA,
          marketId: marketA,
          checkoutRef: 'c1',
          lines: [{ stockLevelId: id, quantity: 1 }],
        },
        new Date('2026-12-01T10:00:00Z'),
      );
      expect(res.expiresAt).toBe('2026-12-01T10:40:00.000Z');
    });

    it('refuses more than is available and changes nothing', async () => {
      const id = await makeStock(4);
      expect(await code(hold('c1', [[id, 5]]))).toBe('INSUFFICIENT_STOCK');
      expect(await levelOf(id)).toMatchObject({ reserved: 0 });
      expect(await asOwner('SELECT 1 FROM stock_reservation')).toHaveLength(0);
    });

    it('is all or nothing across lines', async () => {
      const a = await makeStock(5);
      const b = await makeStock(1);
      expect(
        await code(
          hold('c1', [
            [a, 2],
            [b, 2],
          ]),
        ),
      ).toBe('INSUFFICIENT_STOCK');
      expect(await levelOf(a)).toMatchObject({ reserved: 0 });
      expect(await levelOf(b)).toMatchObject({ reserved: 0 });
    });

    it('allows one open hold per checkout, even when requested in parallel', async () => {
      const id = await makeStock(10);
      expect(await code(hold('c1', [[id, 1]]))).toBe('OK');
      expect(await code(hold('c1', [[id, 1]]))).toBe('RESERVATION_EXISTS');
      const results = await Promise.all(
        Array.from({ length: 4 }, () => code(hold('c2', [[id, 1]]))),
      );
      expect(results.filter((r) => r === 'OK')).toHaveLength(1);
      expect(await levelOf(id)).toMatchObject({ reserved: 2 });
    });

    it('never holds more than is on hand when many checkouts race', async () => {
      const id = await makeStock(4);
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => code(hold(`race-${i}`, [[id, 1]]))),
      );
      expect(results.filter((r) => r === 'OK')).toHaveLength(4);
      expect(results.filter((r) => r === 'INSUFFICIENT_STOCK')).toHaveLength(8);
      expect(await levelOf(id)).toMatchObject({ onHand: 4, reserved: 4 });
    });

    it('gives the last unit to one of many checkouts holding several rows in opposite orders', async () => {
      const a = await makeStock(3);
      const b = await makeStock(3);
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          code(
            hold(
              `mix-${i}`,
              i % 2
                ? [
                    [a, 1],
                    [b, 1],
                  ]
                : [
                    [b, 1],
                    [a, 1],
                  ],
            ),
          ),
        ),
      );
      expect(results.filter((r) => r === 'OK')).toHaveLength(3);
      expect(await levelOf(a)).toMatchObject({ reserved: 3 });
      expect(await levelOf(b)).toMatchObject({ reserved: 3 });
    });

    it('lets a backorder row be held beyond on-hand', async () => {
      const id = await makeStock(0, { outOfStock: 'ALLOW_BACKORDER' });
      expect(await code(hold('c1', [[id, 5]]))).toBe('OK');
      expect(await levelOf(id)).toMatchObject({ onHand: 0, reserved: 5 });
      const res = await reservations.confirm(brandA, 'c1', 'order-1');
      expect(res.alreadyConfirmed).toBe(false);
      expect(await levelOf(id)).toMatchObject({ onHand: 0, reserved: 0 });
      expect(
        await asOwner('SELECT 1 FROM stock_movement WHERE stock_level_id = $1', [id]),
      ).toHaveLength(0);
    });

    it('rejects unknown stock rows, other brands and bad input', async () => {
      const id = await makeStock(5);
      expect(await code(hold('c1', [[NIL, 1]]))).toBe('STOCK_NOT_FOUND');
      await expect(hold('c1', [])).rejects.toThrow();
      await expect(hold('c1', [[id, 0]])).rejects.toThrow();
      await expect(
        hold('c1', [
          [id, 1],
          [id, 1],
        ]),
      ).rejects.toThrow();
      expect(
        await code(
          reservations.hold({
            brandId: brandB,
            marketId: marketB,
            checkoutRef: 'c1',
            lines: [{ stockLevelId: id, quantity: 1 }],
          }),
        ),
      ).toBe('STOCK_NOT_FOUND');
      expect(
        await code(
          reservations.hold({
            brandId: brandA,
            marketId: marketB,
            checkoutRef: 'c9',
            lines: [{ stockLevelId: id, quantity: 1 }],
          }),
        ),
      ).toBe('MARKET_NOT_FOUND');
    });
  });

  describe('release, confirm, extend', () => {
    it('releases a hold and repeats safely', async () => {
      const id = await makeStock(10);
      await hold('c1', [[id, 4]]);
      expect(await reservations.release(brandA, 'c1')).toMatchObject({ released: 1 });
      expect(await levelOf(id)).toMatchObject({ reserved: 0 });
      expect(await reservations.release(brandA, 'c1')).toMatchObject({ released: 0 });
      expect(await levelOf(id)).toMatchObject({ reserved: 0 });
      expect(await code(hold('c1', [[id, 4]]))).toBe('OK');
    });

    it('confirms into a sale: on-hand and reserved fall and the ledger says why', async () => {
      const id = await makeStock(10);
      await hold('c1', [[id, 4]]);
      expect(await reservations.confirm(brandA, 'c1', 'order-77')).toEqual({
        checkoutRef: 'c1',
        alreadyConfirmed: false,
      });
      expect(await levelOf(id)).toMatchObject({ onHand: 6, reserved: 0 });
      const moves = await asOwner<{
        type: string;
        quantity: number;
        on_hand_after: number;
        reference_id: string;
      }>(
        'SELECT type, quantity, on_hand_after, reference_id FROM stock_movement WHERE stock_level_id = $1',
        [id],
      );
      expect(moves).toEqual([
        { type: 'SALE', quantity: 4, on_hand_after: 6, reference_id: 'order-77' },
      ]);
      expect(await reservations.confirm(brandA, 'c1', 'order-77')).toMatchObject({
        alreadyConfirmed: true,
      });
      expect(await levelOf(id)).toMatchObject({ onHand: 6 });
      expect(await reservations.release(brandA, 'c1')).toMatchObject({ released: 0 });
    });

    it('refuses to confirm an unknown or lapsed hold', async () => {
      const id = await makeStock(10);
      expect(await code(reservations.confirm(brandA, 'nope', 'o'))).toBe('RESERVATION_NOT_FOUND');
      const t0 = new Date('2026-12-01T10:00:00Z');
      await reservations.hold(
        {
          brandId: brandA,
          marketId: marketA,
          checkoutRef: 'c1',
          lines: [{ stockLevelId: id, quantity: 1 }],
        },
        t0,
      );
      expect(
        await code(reservations.confirm(brandA, 'c1', 'o', new Date('2026-12-01T10:15:01Z'))),
      ).toBe('RESERVATION_EXPIRED');
      expect(await levelOf(id)).toMatchObject({ onHand: 10, reserved: 1 });
    });

    it('confirms only once when called in parallel', async () => {
      const id = await makeStock(10);
      await hold('c1', [[id, 4]]);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => reservations.confirm(brandA, 'c1', 'o1')),
      );
      expect(results.filter((r) => !r.alreadyConfirmed)).toHaveLength(1);
      expect(await levelOf(id)).toMatchObject({ onHand: 6, reserved: 0 });
    });

    it('extends within the brand limit and no further', async () => {
      const id = await makeStock(10);
      const t0 = new Date('2026-12-01T10:00:00Z');
      await reservations.hold(
        {
          brandId: brandA,
          marketId: marketA,
          checkoutRef: 'c1',
          lines: [{ stockLevelId: id, quantity: 1 }],
        },
        t0,
      );
      await call('managerA', 'put', url('/settings')).send({ maxExtensions: 0 });
      expect(await code(reservations.extend(brandA, 'c1', new Date('2026-12-01T10:10:00Z')))).toBe(
        'EXTENSION_LIMIT',
      );
      await call('managerA', 'put', url('/settings')).send({ maxExtensions: 1 });
      expect(
        (await reservations.extend(brandA, 'c1', new Date('2026-12-01T10:10:00Z'))).expiresAt,
      ).toBe('2026-12-01T10:25:00.000Z');
      expect(
        (await reservations.extend(brandA, 'c1', new Date('2026-12-01T10:20:00Z'))).expiresAt,
      ).toBe('2026-12-01T10:30:00.000Z');
      expect(await code(reservations.extend(brandA, 'c1', new Date('2026-12-01T10:21:00Z')))).toBe(
        'EXTENSION_LIMIT',
      );
      expect(await code(reservations.extend(brandA, 'missing'))).toBe('RESERVATION_NOT_FOUND');
    });
  });

  describe('expiry', () => {
    const backdate = (ref: string) =>
      asOwner(
        `UPDATE stock_reservation SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE checkout_ref = $1`,
        [ref],
      );

    it('frees due holds and leaves live ones alone', async () => {
      const id = await makeStock(10);
      await hold('old', [[id, 3]]);
      await hold('live', [[id, 2]]);
      await backdate('old');
      expect(await reservations.expireDue()).toBe(1);
      expect(await levelOf(id)).toMatchObject({ reserved: 2 });
      const rows = await asOwner<{ checkout_ref: string; status: string }>(
        'SELECT checkout_ref, status FROM stock_reservation ORDER BY checkout_ref',
      );
      expect(rows).toEqual([
        { checkout_ref: 'live', status: 'ACTIVE' },
        { checkout_ref: 'old', status: 'EXPIRED' },
      ]);
      expect(await reservations.expireDue()).toBe(0);
      expect(await code(reservations.confirm(brandA, 'old', 'o'))).toBe('RESERVATION_NOT_FOUND');
    });

    it('frees each hold once when sweeps run in parallel', async () => {
      const id = await makeStock(10);
      for (const ref of ['a', 'b', 'c']) await hold(ref, [[id, 2]]);
      for (const ref of ['a', 'b', 'c']) await backdate(ref);
      await Promise.all([
        reservations.expireDue(),
        reservations.expireDue(),
        reservations.expireDue(),
      ]);
      expect(await levelOf(id)).toMatchObject({ reserved: 0 });
    });

    it('does not let a confirm and a sweep both take the same hold', async () => {
      const id = await makeStock(10);
      await hold('c1', [[id, 4]]);
      await asOwner(
        `UPDATE stock_reservation SET expires_at = now() + interval '1 second', created_at = now() - interval '1 hour' WHERE checkout_ref = 'c1'`,
      );
      const [c, e] = await Promise.allSettled([
        reservations.confirm(brandA, 'c1', 'o1'),
        reservations.expireDue(new Date(Date.now() + 5000)),
      ]);
      const level = await levelOf(id);
      if (c.status === 'fulfilled') {
        expect(level).toMatchObject({ onHand: 6, reserved: 0 });
      } else {
        expect(level).toMatchObject({ onHand: 10, reserved: 0 });
      }
      expect(e.status).toBe('fulfilled');
    });

    it('runs from the background worker', async () => {
      const id = await makeStock(10);
      await hold('c1', [[id, 3]]);
      await backdate('c1');
      await app.get(ReservationExpiryJob).start(200);
      try {
        const deadline = Date.now() + 10_000;
        let reserved = 3;
        while (reserved !== 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250));
          reserved = (await levelOf(id)).reserved;
        }
        expect(reserved).toBe(0);
      } finally {
        await queueClean();
      }
    });
  });

  describe('slot holds', () => {
    it('books places up to capacity, even in parallel, and frees them again', async () => {
      const slotId = await makeSlot(2);
      const book = (ref: string, units = 1) =>
        code(
          reservations.hold({
            brandId: brandA,
            marketId: marketA,
            checkoutRef: ref,
            slot: { slotId, date: DATE, units },
          }),
        );
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => book(`s${i}`)));
      expect(results.filter((r) => r === 'OK')).toHaveLength(2);
      expect(results.filter((r) => r === 'SLOT_FULL')).toHaveLength(4);
      expect(await bookedOn(slotId)).toBe(2);
      const open = await asOwner<{ checkout_ref: string }>(
        `SELECT checkout_ref FROM slot_reservation WHERE status = 'ACTIVE'`,
      );
      expect(await reservations.release(brandA, open[0]!.checkout_ref)).toMatchObject({
        released: 1,
      });
      expect(await bookedOn(slotId)).toBe(1);
      expect(await book('late')).toBe('OK');
      expect(await book('toomany', 3)).toBe('SLOT_FULL');
    });

    it('capacity is per date', async () => {
      const slotId = await makeSlot(1);
      const next = '2026-12-11';
      const take = (date: string, ref: string) =>
        code(
          reservations.hold({
            brandId: brandA,
            marketId: marketA,
            checkoutRef: ref,
            slot: { slotId, date },
          }),
        );
      expect(await take(DATE, 'a')).toBe('OK');
      expect(await take(DATE, 'b')).toBe('SLOT_FULL');
      expect(await take(next, 'c')).toBe('OK');
    });

    it('checks the slot: weekday, market, status and existence', async () => {
      const slotId = await makeSlot(2);
      const take = (id: string, date: string, market = marketA) =>
        code(
          reservations.hold({
            brandId: brandA,
            marketId: market,
            checkoutRef: `x-${id}-${date}`,
            slot: { slotId: id, date },
          }),
        );
      expect(await take(slotId, '2026-12-05')).toBe('SLOT_DATE_MISMATCH');
      expect(await take(NIL, DATE)).toBe('SLOT_NOT_FOUND');
      const off = await makeSlot(2, {
        status: 'INACTIVE',
        startTime: new Date('1970-01-01T18:00:00Z'),
        endTime: new Date('1970-01-01T20:00:00Z'),
        cutoffTime: new Date('1970-01-01T09:00:00Z'),
      });
      expect(await take(off, DATE)).toBe('SLOT_NOT_FOUND');
      await expect(
        reservations.hold({
          brandId: brandA,
          marketId: marketA,
          checkoutRef: 'bad',
          slot: { slotId, date: '2026-02-30' },
        }),
      ).rejects.toThrow();
    });

    it('holds a slot alone (made to order) and keeps stock and slot together', async () => {
      const slotId = await makeSlot(1);
      const stock = await makeStock(3);
      expect(await code(hold('mto', [], { slotId, date: DATE }))).toBe('OK');
      // The slot is now full, so a cart that also wants stock fails as a whole.
      expect(await code(hold('both', [[stock, 1]], { slotId, date: DATE }))).toBe('SLOT_FULL');
      expect(await levelOf(stock)).toMatchObject({ reserved: 0 });
      expect(await bookedOn(slotId)).toBe(1);
    });

    it('keeps the place on confirm and frees it on expiry', async () => {
      const slotId = await makeSlot(2);
      const stock = await makeStock(5);
      await hold('a', [[stock, 1]], { slotId, date: DATE });
      await hold('b', [], { slotId, date: DATE });
      await reservations.confirm(brandA, 'a', 'o1');
      expect(await bookedOn(slotId)).toBe(2);
      await asOwner(
        `UPDATE slot_reservation SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE checkout_ref = 'b'`,
      );
      expect(await reservations.expireDue()).toBe(1);
      expect(await bookedOn(slotId)).toBe(1);
      expect(await levelOf(stock)).toMatchObject({ onHand: 4, reserved: 0 });
    });

    it('extends a slot-only hold within the limit', async () => {
      const slotId = await makeSlot(2);
      const t0 = new Date('2026-12-01T10:00:00Z');
      await reservations.hold(
        { brandId: brandA, marketId: marketA, checkoutRef: 'a', slot: { slotId, date: DATE } },
        t0,
      );
      expect(
        (await reservations.extend(brandA, 'a', new Date('2026-12-01T10:10:00Z'))).expiresAt,
      ).toBe('2026-12-01T10:25:00.000Z');
      await call('managerA', 'put', url('/settings')).send({ maxExtensions: 0 });
      expect(await code(reservations.extend(brandA, 'a', new Date('2026-12-01T10:11:00Z')))).toBe(
        'EXTENSION_LIMIT',
      );
    });
  });

  describe('staff view and release', () => {
    it('lists open holds and releases a stuck one with audit', async () => {
      const id = await makeStock(10);
      const slotId = await makeSlot(2);
      await hold('stuck', [[id, 3]], { slotId, date: DATE });
      const list = await call('viewerA', 'get', url('/reservations'));
      expect(list.status).toBe(200);
      expect(list.body.stock).toHaveLength(1);
      expect(list.body.stock[0]).toMatchObject({
        checkoutRef: 'stuck',
        status: 'ACTIVE',
        lines: [{ stockLevelId: id, quantity: 3 }],
      });
      expect(list.body.slots[0]).toMatchObject({ checkoutRef: 'stuck', date: DATE, units: 1 });
      expect(
        (await call('managerA', 'get', url('/reservations?status=EXPIRED'))).body.stock,
      ).toEqual([]);
      const rel = await call('managerA', 'post', url('/reservations/stuck/release')).send({});
      expect(rel.status).toBe(201);
      expect(rel.body.released).toBe(2);
      expect(await levelOf(id)).toMatchObject({ reserved: 0 });
      expect(await bookedOn(slotId)).toBe(0);
      expect(
        (await call('managerA', 'post', url('/reservations/stuck/release')).send({})).status,
      ).toBe(404);
      expect(await auditActions('stuck')).toEqual(['inventory.reservation.release']);
    });

    it('needs brand-wide permissions and stays inside the brand', async () => {
      const id = await makeStock(5);
      await hold('c1', [[id, 1]]);
      expect((await call('viewerA', 'post', url('/reservations/c1/release')).send({})).status).toBe(
        403,
      );
      expect((await call('branchMgrA', 'get', url('/reservations'))).status).toBe(403);
      expect(
        (await call('branchMgrA', 'post', url('/reservations/c1/release')).send({})).status,
      ).toBe(403);
      expect((await call('nobody', 'get', url('/reservations'))).status).toBe(403);
      expect((await call('managerB', 'get', url('/reservations'))).status).toBe(403);
      expect(
        (await call('managerB', 'post', url('/reservations/c1/release')).send({})).status,
      ).toBe(403);
      expect(
        (await call('managerB', 'post', `${brandB}/inventory/reservations/c1/release`).send({}))
          .status,
      ).toBe(404);
      expect(
        (await call('managerB', 'get', `${brandB}/inventory/reservations`)).body.stock,
      ).toEqual([]);
      expect(await levelOf(id)).toMatchObject({ reserved: 1 });
    });

    it('refuses the reservation routes without a session', async () => {
      for (const [method, path] of [
        ['get', url('/reservations')],
        ['post', url('/reservations/c1/release')],
      ] as const) {
        const anon = await request(app.getHttpServer())
          [method](`/api/v1/admin/brands/${path}`)
          .set('Origin', ORIGIN);
        expect([401, 403]).toContain(anon.status);
      }
    });
  });
});
