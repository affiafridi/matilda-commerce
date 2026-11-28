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
import { ConsoleMailAdapter } from '../../common/mail/console-mail.adapter';
import { hashToken } from '../../common/security/tokens';
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { TenantResolver } from '../tenancy/tenant-resolver.service';

/**
 * Promotions and coupons (Phase 5 step 5.5): the staff API (validation, permissions, brand
 * isolation, deletion rules) and how promotions and coupons change the cart's quote.
 */

const ORIGIN = 'http://localhost:3001';
const API = '/api/v1/admin/brands';
const PLATFORM = { brandIds: [], platform: true } as const;
const HOST = { a: 'alpha.test', b: 'beta.test' } as const;
const password = () => `Cu-${randomBytes(10).toString('hex')}`;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Staff {
  call: (method: Method, path: string, body?: object) => request.Test;
}
interface Session {
  cookie: string;
  csrf: string;
}

describe('promotions and coupons (HTTP + database)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let mail: ConsoleMailAdapter;
  let counter = 0;
  const id = {
    brandA: '',
    brandB: '',
    marketA: '',
    marketOther: '',
    marketB: '',
    rose: '',
    cake: '',
    card: '',
    roseB: '',
    flowers: '',
  };
  let manager: Staff;
  let viewer: Staff;
  let managerB: Staff;

  async function staff(label: string, permissions: string[], brandId: string): Promise<Staff> {
    const user = await db.staffUser.create({
      data: {
        email: `${label}-${++counter}@example.test`,
        fullName: label,
        status: 'ACTIVE',
        passwordHash: 'fixture-no-login',
        mfaEnrolledAt: new Date(),
      },
    });
    const role = await db.role.create({
      data: {
        name: `${label} ${++counter}`,
        kind: 'CUSTOM',
        permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });
    await db.staffRoleAssignment.create({
      data: { staffUserId: user.id, roleId: role.id, brandId },
    });
    const token = randomBytes(24).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    await db.staffSession.create({
      data: {
        staffUserId: user.id,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrf),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
        mfaVerifiedAt: new Date(),
        stepUpUntil: new Date(Date.now() + 3_600_000),
      },
    });
    return {
      call: (method, path, body) => {
        const req = request(app.getHttpServer())
          [method](`${API}${path}`)
          .set('Cookie', `matilda_staff=${token}`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf);
        return body ? req.send(body) : req;
      },
    };
  }

  /** Owner queries need platform context: row-level security is forced for every role. */
  const q = async (sql: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.platform', 'on', true)");
      const res = await client.query(sql, params);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

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
    mail = app.get(ConsoleMailAdapter);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE customer, staff_user, brand, branch, role, auth_attempt CASCADE');
    await resetAuditLog(owner);
    mail.outbox.length = 0;
    app.get(TenantResolver).invalidateAll();
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const sa = await db.country.upsert({
      where: { iso2: 'SA' },
      update: {},
      create: { iso2: 'SA', iso3: 'SAU', name: 'Saudi Arabia' },
    });
    await withScope(db, PLATFORM, async (tx) => {
      const a = await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } });
      const b = await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } });
      const market = async (brandId: string, countryId: string, code: string) => {
        const m = await tx.market.create({
          data: { brandId, countryId, code, timezone: 'Asia/Dubai', status: 'ACTIVE' },
        });
        await tx.marketCurrency.create({
          data: { marketId: m.id, currencyCode: 'AED', isDefault: true },
        });
        return m;
      };
      const mA = await market(a.id, ae.id, 'ae');
      const mO = await market(a.id, sa.id, 'ksa');
      const mB = await market(b.id, ae.id, 'ae');
      await tx.brandDomain.createMany({
        data: [
          { brandId: a.id, hostname: HOST.a, marketId: mA.id, isPrimary: true },
          { brandId: b.id, hostname: HOST.b, marketId: mB.id, isPrimary: true },
        ],
      });
      const product = async (brandId: string, marketId: string, key: string, price: number) => {
        const p = await tx.product.create({
          data: {
            brandId,
            type: 'SIMPLE',
            status: 'PUBLISHED',
            sku: `PR-${key.toUpperCase()}`,
            translations: { create: [{ language: 'en', name: key, slug: key }] },
          },
        });
        await tx.productMarket.create({ data: { brandId, productId: p.id, marketId } });
        await tx.marketPrice.create({
          data: { brandId, marketId, currencyCode: 'AED', productId: p.id, regularMinor: price },
        });
        return p.id;
      };
      id.brandA = a.id;
      id.brandB = b.id;
      id.marketA = mA.id;
      id.marketOther = mO.id;
      id.marketB = mB.id;
      id.rose = await product(a.id, mA.id, 'rose', 25000);
      id.cake = await product(a.id, mA.id, 'cake', 18000);
      id.card = await product(a.id, mA.id, 'card', 500);
      id.roseB = await product(b.id, mB.id, 'rose-b', 25000);
      const flowers = await tx.category.create({
        data: {
          brandId: a.id,
          status: 'PUBLISHED',
          translations: { create: [{ language: 'en', name: 'Flowers', slug: 'flowers' }] },
        },
      });
      id.flowers = flowers.id;
      await tx.productCategory.create({
        data: { brandId: a.id, productId: id.rose, categoryId: flowers.id },
      });
    });
    const MANAGE = ['promotions.view', 'promotions.manage'];
    manager = await staff('manager', MANAGE, id.brandA);
    viewer = await staff('viewer', ['promotions.view'], id.brandA);
    managerB = await staff('managerb', MANAGE, id.brandB);
  });

  // ------------------------------------------------------------------ helpers

  const P = (rest = '') => `/${id.brandA}/promotions${rest}`;
  const en = (name: string) => [{ language: 'en', name }];
  const percent = (code: string, over: Record<string, unknown> = {}) => ({
    code,
    kind: 'PERCENT_OFF',
    percentBps: 1000,
    translations: en(`${code} offer`),
    ...over,
  });

  async function create(body: object, who: Staff = manager) {
    const res = await who.call('post', P(), body);
    expect(res.status).toBe(201);
    return res.body as { id: string; code: string; [k: string]: unknown };
  }

  const shop = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    opts: { cookie?: string; session?: Session; host?: string } = {},
  ) => {
    const host = opts.host ?? HOST.a;
    let req = request(app.getHttpServer())
      [method](`/api/v1/cart${path}`)
      .set('Host', host)
      .set('Origin', `http://${host}`);
    const cookies = [opts.session?.cookie, opts.cookie].filter(Boolean).join('; ');
    if (cookies) req = req.set('Cookie', cookies);
    if (opts.session) req = req.set('X-CSRF-Token', opts.session.csrf);
    return body ? req.send(body) : req;
  };

  const cookieOf = (res: request.Response, name: string): string | undefined => {
    const all = (res.headers['set-cookie'] ?? []) as unknown as string[];
    return all.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  };

  /** A guest cart holding the given products; returns its cookie. */
  async function cartWith(items: { productId: string; quantity?: number }[]) {
    let cookie: string | undefined;
    for (const item of items) {
      const res = await shop(
        'post',
        '/lines',
        { productId: item.productId, quantity: item.quantity ?? 1 },
        { cookie },
      ).expect(201);
      cookie ??= cookieOf(res, 'matilda_cart');
    }
    return cookie as string;
  }

  const quoteOf = async (cookie: string, session?: Session) =>
    (await shop('get', '', undefined, { cookie, session }).expect(200)).body.cart.quote;

  async function account() {
    const email = `buyer${++counter}@example.test`;
    const pw = password();
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(`/api/v1/customer${path}`)
        .set('Host', HOST.a)
        .set('Origin', `http://${HOST.a}`)
        .send(body);
    await post('/auth/register', { email, password: pw, fullName: 'Test Customer' }).expect(202);
    const token = /token=([\w-]+)/.exec(mail.outbox.at(-1)?.text ?? '')?.[1] as string;
    await post('/auth/verify-email', { token }).expect(204);
    const res = await post('/auth/login', { email, password: pw }).expect(200);
    return {
      cookie: cookieOf(res, 'matilda_customer') as string,
      csrf: res.body.csrfToken as string,
    } satisfies Session;
  }

  // ------------------------------------------------------------------ staff API

  it('creates a promotion with names, markets and defaults', async () => {
    const created = await create(
      percent('SPRING', {
        marketIds: [id.marketA],
        translations: [
          { language: 'en', name: 'Spring offer', description: '10 percent off' },
          { language: 'ar', name: 'عرض الربيع' },
        ],
        startsAt: '2026-12-01T00:00:00Z',
        endsAt: '2026-12-31T00:00:00Z',
        usageLimit: 500,
        maxDiscountMinor: 20000,
      }),
    );
    expect(created).toMatchObject({
      code: 'SPRING',
      kind: 'PERCENT_OFF',
      scope: 'ORDER',
      percentBps: 1000,
      priority: 100,
      combinable: false,
      audience: 'EVERYONE',
      status: 'ACTIVE',
      usedCount: 0,
      marketIds: [id.marketA],
      couponCount: 0,
      maxDiscountMinor: 20000,
      startsAt: '2026-12-01T00:00:00.000Z',
    });
    expect((created.translations as unknown[]).length).toBe(2);
    const fetched = await manager.call('get', P(`/${created.id}`)).expect(200);
    expect(fetched.body.id).toBe(created.id);
  });

  it.each([
    [
      'a percentage promotion without a percentage',
      { kind: 'PERCENT_OFF', percentBps: undefined },
      'percentBps',
    ],
    [
      'a fixed amount without a currency',
      { kind: 'FIXED_OFF', percentBps: undefined, fixedMinor: 500 },
      'currencyCode',
    ],
    [
      'a fixed amount with a percentage',
      { kind: 'FIXED_OFF', fixedMinor: 500, currencyCode: 'AED' },
      'percentBps',
    ],
    [
      'a gift promotion without a gift',
      { kind: 'FREE_GIFT', percentBps: undefined },
      'giftProductId',
    ],
    [
      'free delivery on one product',
      { kind: 'FREE_DELIVERY', percentBps: undefined, scope: 'PRODUCT' },
      'scope',
    ],
    ['a product scope with no targets', { scope: 'PRODUCT' }, 'targets.productIds'],
    [
      'targets that do not match the scope',
      { scope: 'ORDER', targets: { productIds: ['0197a000-0000-7000-8000-000000000000'] } },
      'targets.productIds',
    ],
    [
      'a maximum discount on a fixed amount',
      {
        kind: 'FIXED_OFF',
        percentBps: undefined,
        fixedMinor: 500,
        currencyCode: 'AED',
        maxDiscountMinor: 100,
      },
      'maxDiscountMinor',
    ],
    [
      'an end before the start',
      { startsAt: '2026-12-10T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
      'endsAt',
    ],
    ['no English name', { translations: [{ language: 'ar', name: 'عرض' }] }, 'translations'],
    [
      'a repeated language',
      {
        translations: [
          { language: 'en', name: 'a' },
          { language: 'en', name: 'b' },
        ],
      },
      'translations',
    ],
  ])('refuses %s', async (_name, over, path) => {
    const res = await manager.call('post', P(), percent('BAD', over));
    expect(res.status).toBe(422);
    expect(res.body.code ?? res.body.error?.code).toBe('PROMOTION_INVALID');
    const errors = (res.body.errors ?? res.body.error?.errors) as { path: string }[];
    expect(errors.map((e) => e.path)).toContain(path);
  });

  it('refuses malformed bodies', async () => {
    await manager.call('post', P(), { code: 'x' }).expect(400);
    await manager.call('post', P(), percent('OK', { percentBps: 10001 })).expect(400);
    await manager.call('post', P(), percent('OK', { priority: -1 })).expect(400);
    await manager.call('post', P(), percent('OK', { startsAt: 'tomorrow' })).expect(400);
  });

  it('keeps promotion codes unique per brand but not across brands', async () => {
    await create(percent('DUP'));
    await manager.call('post', P(), percent('DUP')).expect(409);
    await managerB.call('post', `/${id.brandB}/promotions`, percent('DUP')).expect(201);
  });

  it('lists in priority order with search, status filter and paging', async () => {
    await create(percent('LATE', { priority: 300 }));
    await create(percent('EARLY', { priority: 10 }));
    const off = await create(percent('OFF', { priority: 20, status: 'INACTIVE' }));
    const all = await manager.call('get', P()).expect(200);
    expect(all.body.items.map((p: { code: string }) => p.code)).toEqual(['EARLY', 'OFF', 'LATE']);
    expect(all.body.total).toBe(3);
    const active = await manager.call('get', P('?status=ACTIVE')).expect(200);
    expect(active.body.items.map((p: { code: string }) => p.code)).toEqual(['EARLY', 'LATE']);
    const found = await manager.call('get', P('?q=off')).expect(200);
    expect(found.body.items.map((p: { id: string }) => p.id)).toContain(off.id);
    const page = await manager.call('get', P('?limit=1&page=2')).expect(200);
    expect(page.body.items.map((p: { code: string }) => p.code)).toEqual(['OFF']);
  });

  it('changes a promotion, replacing markets, targets and names as sets, and re-checks the whole', async () => {
    const created = await create(percent('EDIT', { marketIds: [id.marketA] }));
    const patched = await manager
      .call('patch', P(`/${created.id}`), {
        priority: 5,
        status: 'INACTIVE',
        marketIds: [],
        translations: [{ language: 'en', name: 'Renamed' }],
      })
      .expect(200);
    expect(patched.body).toMatchObject({ priority: 5, status: 'INACTIVE', marketIds: [] });
    expect(patched.body.translations).toEqual([
      { language: 'en', name: 'Renamed', description: null },
    ]);

    // Changing the scope without targets, or the kind without its values, is refused.
    await manager.call('patch', P(`/${created.id}`), { scope: 'PRODUCT' }).expect(422);
    await manager.call('patch', P(`/${created.id}`), { kind: 'FIXED_OFF' }).expect(422);
    const scoped = await manager
      .call('patch', P(`/${created.id}`), { scope: 'PRODUCT', targets: { productIds: [id.rose] } })
      .expect(200);
    expect(scoped.body.targets.productIds).toEqual([id.rose]);
    // Explicit null clears an optional value.
    await manager.call('patch', P(`/${created.id}`), { usageLimit: 5 }).expect(200);
    const cleared = await manager
      .call('patch', P(`/${created.id}`), { usageLimit: null })
      .expect(200);
    expect(cleared.body.usageLimit).toBeNull();
    await manager.call('patch', P(`/${created.id}`), {}).expect(400);
  });

  it('a patch never resets a field it did not mention', async () => {
    const created = await create(
      percent('KEEP', {
        audience: 'CUSTOMERS',
        combinable: true,
        requiresCoupon: true,
        minSubtotalMinor: 5000,
        priority: 40,
        marketIds: [id.marketA],
        status: 'INACTIVE',
      }),
    );
    const patched = await manager.call('patch', P(`/${created.id}`), { priority: 41 }).expect(200);
    expect(patched.body).toMatchObject({
      priority: 41,
      audience: 'CUSTOMERS',
      combinable: true,
      requiresCoupon: true,
      minSubtotalMinor: 5000,
      scope: 'ORDER',
      status: 'INACTIVE',
      marketIds: [id.marketA],
    });
  });

  it('refuses markets and targets of another brand and unknown promotions', async () => {
    await manager.call('post', P(), percent('MM', { marketIds: [id.marketB] })).expect(422);
    await manager
      .call('post', P(), percent('TT', { scope: 'PRODUCT', targets: { productIds: [id.roseB] } }))
      .expect(422);
    await manager.call('get', P('/0197a000-0000-7000-8000-000000000000')).expect(404);
  });

  it('enforces permissions and brand isolation', async () => {
    const mine = await create(percent('MINE'));
    expect((await viewer.call('get', P())).status).toBe(200);
    expect((await viewer.call('get', P(`/${mine.id}`))).status).toBe(200);
    expect((await viewer.call('post', P(), percent('NOPE'))).status).toBe(403);
    expect((await viewer.call('patch', P(`/${mine.id}`), { priority: 1 })).status).toBe(403);
    expect((await viewer.call('delete', P(`/${mine.id}`))).status).toBe(403);
    // Another brand's manager has no access to this brand at all.
    expect((await managerB.call('get', P())).status).toBe(403);
    expect((await managerB.call('post', P(), percent('XX'))).status).toBe(403);
    // And a brand B id with brand A's promotion id finds nothing.
    expect((await managerB.call('get', `/${id.brandB}/promotions/${mine.id}`)).status).toBe(404);
  });

  it('deletes only promotions that were never used and have no coupons', async () => {
    const plain = await create(percent('PLAIN'));
    await manager.call('delete', P(`/${plain.id}`)).expect(204);
    await manager.call('get', P(`/${plain.id}`)).expect(404);

    const withCoupon = await create(percent('WITHCOUPON'));
    await manager.call('post', P(`/${withCoupon.id}/coupons`), { code: 'HELLO10' }).expect(201);
    await manager.call('delete', P(`/${withCoupon.id}`)).expect(409);

    const used = await create(percent('USED'));
    await q('UPDATE promotion SET used_count = 1 WHERE id = $1', [used.id]);
    await manager.call('delete', P(`/${used.id}`)).expect(409);
  });

  it('manages coupons: upper-case codes, unique per brand, limits, status and deletion rules', async () => {
    const one = await create(percent('ONE'));
    const two = await create(percent('TWO'));
    const coupon = await manager
      .call('post', P(`/${one.id}/coupons`), { code: 'welcome-10', usageLimit: 3 })
      .expect(201);
    expect(coupon.body).toMatchObject({
      code: 'WELCOME-10',
      usageLimit: 3,
      usedCount: 0,
      status: 'ACTIVE',
    });
    await manager.call('post', P(`/${two.id}/coupons`), { code: 'WELCOME-10' }).expect(409);
    await manager.call('post', P(`/${one.id}/coupons`), { code: 'a b' }).expect(400);
    expect((await manager.call('get', P(`/${one.id}/coupons`)).expect(200)).body).toHaveLength(1);
    // A coupon belongs to its promotion only.
    await manager
      .call('patch', P(`/${two.id}/coupons/${coupon.body.id}`), { status: 'INACTIVE' })
      .expect(404);

    await q('UPDATE coupon SET used_count = 2 WHERE id = $1', [coupon.body.id]);
    await manager
      .call('patch', P(`/${one.id}/coupons/${coupon.body.id}`), { usageLimit: 1 })
      .expect(422);
    const raised = await manager
      .call('patch', P(`/${one.id}/coupons/${coupon.body.id}`), {
        usageLimit: null,
        status: 'INACTIVE',
      })
      .expect(200);
    expect(raised.body).toMatchObject({ usageLimit: null, status: 'INACTIVE' });
    await manager.call('delete', P(`/${one.id}/coupons/${coupon.body.id}`)).expect(409);

    const fresh = await manager
      .call('post', P(`/${one.id}/coupons`), { code: 'FRESH' })
      .expect(201);
    await manager.call('delete', P(`/${one.id}/coupons/${fresh.body.id}`)).expect(204);
    expect((await viewer.call('post', P(`/${one.id}/coupons`), { code: 'VIEW' })).status).toBe(403);
  });

  it('records changes in the audit log', async () => {
    const created = await create(percent('AUDITED'));
    await manager.call('patch', P(`/${created.id}`), { priority: 7 }).expect(200);
    const rows = await q('SELECT action FROM audit_log WHERE target_id = $1 ORDER BY occurred_at', [
      created.id,
    ]);
    expect(rows.rows.map((r: { action: string }) => r.action)).toEqual([
      'promotion.create',
      'promotion.update',
    ]);
  });

  // ------------------------------------------------------------------ in the cart

  it('applies an automatic promotion to the cart quote, spread over the lines', async () => {
    await create(percent('TEN', { priority: 10, combinable: true }));
    const cookie = await cartWith([{ productId: id.rose, quantity: 2 }, { productId: id.cake }]);
    const quote = await quoteOf(cookie);
    // 50000 + 18000 = 68000, ten percent off
    expect(quote.totals).toMatchObject({
      subtotalMinor: 68000,
      discountMinor: 6800,
      totalMinor: 61200,
    });
    expect(quote.promotions.applied).toEqual([
      expect.objectContaining({
        code: 'TEN',
        kind: 'PERCENT_OFF',
        discountMinor: 6800,
        couponId: null,
      }),
    ]);
    const lines = quote.lines as {
      discountMinor: number;
      totalMinor: number;
      unitMinor: number;
      quantity: number;
    }[];
    expect(lines.reduce((a, l) => a + l.discountMinor, 0)).toBe(6800);
    for (const l of lines) expect(l.totalMinor).toBe(l.unitMinor * l.quantity - l.discountMinor);
  });

  it('applies nothing outside its schedule, market or status', async () => {
    await create(percent('FUTURE', { startsAt: '2099-01-01T00:00:00Z' }));
    await create(percent('PAST', { endsAt: '2020-01-01T00:00:00Z' }));
    await create(percent('OTHERMARKET', { marketIds: [id.marketOther] }));
    await create(percent('OFF', { status: 'INACTIVE' }));
    const cookie = await cartWith([{ productId: id.rose }]);
    const quote = await quoteOf(cookie);
    expect(quote.promotions.applied).toEqual([]);
    expect(quote.totals.discountMinor).toBe(0);
  });

  it('applies only above the minimum subtotal and only to the targeted products and categories', async () => {
    const big = await create(percent('BIG', { minSubtotalMinor: 60000 }));
    const small = await cartWith([{ productId: id.rose }]);
    expect((await quoteOf(small)).promotions.applied).toEqual([]);
    await manager.call('delete', P(`/${big.id}`)).expect(204);

    await create(
      percent('CAKES', { scope: 'PRODUCT', combinable: true, targets: { productIds: [id.cake] } }),
    );
    await create(
      percent('FLOWERS', {
        scope: 'CATEGORY',
        percentBps: 5000,
        combinable: true,
        priority: 50,
        targets: { categoryIds: [id.flowers] },
      }),
    );
    const cookie = await cartWith([{ productId: id.rose }, { productId: id.cake }]);
    const quote = await quoteOf(cookie);
    const byCode = Object.fromEntries(
      (quote.promotions.applied as { code: string; discountMinor: number }[]).map((a) => [
        a.code,
        a.discountMinor,
      ]),
    );
    expect(byCode.FLOWERS).toBe(12500);
    expect(byCode.CAKES).toBe(1800);
  });

  it('applies promotions by priority and lets a non-combinable one stand alone', async () => {
    await create(
      percent('SECOND', {
        priority: 20,
        kind: 'FIXED_OFF',
        percentBps: null,
        fixedMinor: 1000,
        currencyCode: 'AED',
        combinable: true,
      }),
    );
    await create(percent('FIRST', { priority: 10, combinable: true }));
    const cookie = await cartWith([{ productId: id.rose }]);
    let quote = await quoteOf(cookie);
    expect(quote.promotions.applied.map((a: { code: string }) => a.code)).toEqual([
      'FIRST',
      'SECOND',
    ]);
    expect(quote.totals.discountMinor).toBe(2500 + 1000);

    await create(percent('SOLO', { priority: 5, percentBps: 5000, combinable: false }));
    quote = await quoteOf(cookie);
    expect(quote.promotions.applied.map((a: { code: string }) => a.code)).toEqual(['SOLO']);
    expect(quote.totals.discountMinor).toBe(12500);
  });

  it('adds a free gift as a zero-price line, only while its condition holds and the gift can be sold', async () => {
    await create({
      code: 'GIFTCARD',
      kind: 'FREE_GIFT',
      giftProductId: id.card,
      minSubtotalMinor: 40000,
      combinable: true,
      translations: en('Free card'),
    });
    const small = await cartWith([{ productId: id.rose }]);
    expect((await quoteOf(small)).lines.some((l: { kind: string }) => l.kind === 'GIFT')).toBe(
      false,
    );

    const big = await cartWith([{ productId: id.rose, quantity: 2 }]);
    const quote = await quoteOf(big);
    const gift = quote.lines.find((l: { kind: string }) => l.kind === 'GIFT');
    expect(gift).toMatchObject({
      productId: id.card,
      quantity: 1,
      unitMinor: 0,
      totalMinor: 0,
      cartLineId: null,
    });
    expect(quote.totals.totalMinor).toBe(50000);

    await withScope(db, PLATFORM, (tx) =>
      tx.product.update({ where: { id: id.card }, data: { status: 'DRAFT' } }),
    );
    expect((await quoteOf(big)).lines.some((l: { kind: string }) => l.kind === 'GIFT')).toBe(false);
  });

  it('reports free delivery for the delivery step', async () => {
    await create({
      code: 'SHIPFREE',
      kind: 'FREE_DELIVERY',
      combinable: true,
      minSubtotalMinor: 20000,
      translations: en('Free delivery'),
    });
    const cookie = await cartWith([{ productId: id.rose }]);
    expect((await quoteOf(cookie)).promotions.freeDelivery).toBe(true);
    const cheap = await cartWith([{ productId: id.card }]);
    expect((await quoteOf(cheap)).promotions.freeDelivery).toBe(false);
  });

  it('keeps customer-only promotions for signed-in customers and first-order ones for new customers', async () => {
    await create(percent('MEMBERS', { audience: 'CUSTOMERS', combinable: true, priority: 10 }));
    await create(
      percent('NEWBIE', {
        audience: 'FIRST_ORDER',
        combinable: true,
        priority: 20,
        percentBps: 500,
      }),
    );
    const guest = await cartWith([{ productId: id.rose }]);
    expect((await quoteOf(guest)).promotions.applied).toEqual([]);

    const session = await account();
    const added = await shop(
      'post',
      '/lines',
      { productId: id.rose, quantity: 1 },
      { session },
    ).expect(201);
    expect(added.body.cart.quote.promotions.applied.map((a: { code: string }) => a.code)).toEqual([
      'MEMBERS',
      'NEWBIE',
    ]);

    // (A customer who already has an order stops qualifying for NEWBIE: covered with order creation in step 5.8.)
  });

  // ------------------------------------------------------------------ coupons in the cart

  async function couponPromotion(
    over: Record<string, unknown> = {},
    code = 'WELCOME10',
    usageLimit?: number,
  ) {
    const promotion = await create(
      percent('WELCOME', { requiresCoupon: true, combinable: true, ...over }),
    );
    const coupon = await manager
      .call('post', P(`/${promotion.id}/coupons`), { code, ...(usageLimit ? { usageLimit } : {}) })
      .expect(201);
    return { promotion, coupon: coupon.body as { id: string } };
  }

  it('applies a coupon on request, normalises its case and lets the shopper remove it', async () => {
    const { coupon } = await couponPromotion();
    const cookie = await cartWith([{ productId: id.rose, quantity: 2 }]);
    expect((await quoteOf(cookie)).totals.discountMinor).toBe(0);

    const applied = await shop('put', '/coupon', { code: ' welcome10 ' }, { cookie }).expect(200);
    expect(applied.body.cart.couponCode).toBe('WELCOME10');
    expect(applied.body.cart.quote.promotions.coupon).toEqual({
      code: 'WELCOME10',
      status: 'APPLIED',
    });
    expect(applied.body.cart.quote.totals).toMatchObject({
      discountMinor: 5000,
      totalMinor: 45000,
    });
    expect(applied.body.cart.quote.promotions.applied[0]).toMatchObject({ couponId: coupon.id });

    const removed = await shop('delete', '/coupon', undefined, { cookie }).expect(200);
    expect(removed.body.cart.couponCode).toBeNull();
    expect(removed.body.cart.quote.totals.discountMinor).toBe(0);
  });

  it.each([
    ['an unknown code', 'NOSUCHCODE', 'not valid'],
    ['a badly formed code', 'a b', null],
  ])('refuses %s', async (_name, code, message) => {
    await couponPromotion();
    const cookie = await cartWith([{ productId: id.rose }]);
    const res = await shop('put', '/coupon', { code }, { cookie });
    expect(res.status).toBe(message ? 422 : 400);
    if (message) expect(JSON.stringify(res.body)).toContain(message);
    expect((await shop('get', '', undefined, { cookie })).body.cart.couponCode).toBeNull();
  });

  it('refuses a coupon that is inactive, used up, below its minimum or for another market', async () => {
    const { promotion, coupon } = await couponPromotion({ minSubtotalMinor: 30000 }, 'BIGSPEND', 1);
    const cookie = await cartWith([{ productId: id.card }]);
    let res = await shop('put', '/coupon', { code: 'BIGSPEND' }, { cookie }).expect(422);
    expect(JSON.stringify(res.body)).toContain('below the minimum');

    const rich = await cartWith([{ productId: id.rose, quantity: 2 }]);
    await shop('put', '/coupon', { code: 'BIGSPEND' }, { cookie: rich }).expect(200);

    await q('UPDATE coupon SET used_count = 1 WHERE id = $1', [coupon.id]);
    res = await shop(
      'put',
      '/coupon',
      { code: 'BIGSPEND' },
      { cookie: await cartWith([{ productId: id.rose, quantity: 2 }]) },
    ).expect(422);
    expect(JSON.stringify(res.body)).toContain('fully used');

    await manager
      .call('patch', P(`/${promotion.id}/coupons/${coupon.id}`), {
        usageLimit: null,
        status: 'INACTIVE',
      })
      .expect(200);
    res = await shop(
      'put',
      '/coupon',
      { code: 'BIGSPEND' },
      { cookie: await cartWith([{ productId: id.rose, quantity: 2 }]) },
    ).expect(422);
    expect(JSON.stringify(res.body)).toContain('not active');

    await manager
      .call('patch', P(`/${promotion.id}/coupons/${coupon.id}`), { status: 'ACTIVE' })
      .expect(200);
    await manager.call('patch', P(`/${promotion.id}`), { marketIds: [id.marketOther] }).expect(200);
    res = await shop(
      'put',
      '/coupon',
      { code: 'BIGSPEND' },
      { cookie: await cartWith([{ productId: id.rose, quantity: 2 }]) },
    ).expect(422);
    expect(JSON.stringify(res.body)).toContain('does not apply');
  });

  it('refuses a coupon on an empty cart and a second coupon replaces the first', async () => {
    await couponPromotion({}, 'FIRSTONE');
    const second = await create(
      percent('SECONDPROMO', { requiresCoupon: true, combinable: true, percentBps: 2000 }),
    );
    await manager.call('post', P(`/${second.id}/coupons`), { code: 'SECONDONE' }).expect(201);
    const empty = await shop('post', '/lines', { productId: id.rose, quantity: 1 }).expect(201);
    const cookie = cookieOf(empty, 'matilda_cart') as string;
    await shop('delete', `/lines/${empty.body.cart.lines[0].id}`, undefined, { cookie }).expect(
      200,
    );
    await shop('put', '/coupon', { code: 'FIRSTONE' }, { cookie }).expect(422);

    await shop('post', '/lines', { productId: id.rose, quantity: 1 }, { cookie }).expect(201);
    await shop('put', '/coupon', { code: 'FIRSTONE' }, { cookie }).expect(200);
    const replaced = await shop('put', '/coupon', { code: 'SECONDONE' }, { cookie }).expect(200);
    expect(replaced.body.cart.couponCode).toBe('SECONDONE');
    expect(
      replaced.body.cart.quote.promotions.applied.map((a: { code: string }) => a.code),
    ).toEqual(['SECONDPROMO']);
  });

  it('a stored coupon that stops working shows as rejected and stops discounting', async () => {
    const { promotion, coupon } = await couponPromotion();
    const cookie = await cartWith([{ productId: id.rose }]);
    await shop('put', '/coupon', { code: 'WELCOME10' }, { cookie }).expect(200);
    await manager
      .call('patch', P(`/${promotion.id}/coupons/${coupon.id}`), { status: 'INACTIVE' })
      .expect(200);
    const cart = (await shop('get', '', undefined, { cookie }).expect(200)).body.cart;
    expect(cart.couponCode).toBe('WELCOME10');
    expect(cart.quote.promotions.coupon).toEqual({
      code: 'WELCOME10',
      status: 'REJECTED',
      reason: 'NOT_ACTIVE',
    });
    expect(cart.quote.totals.discountMinor).toBe(0);
  });

  it('a coupon cannot be applied to another visitor’s cart or without a cart', async () => {
    await couponPromotion();
    await shop('put', '/coupon', { code: 'WELCOME10' }).expect(404);
    await shop('delete', '/coupon').expect(404);
  });

  it('coupons of one brand do not exist on another', async () => {
    await couponPromotion();
    const res = await shop(
      'post',
      '/lines',
      { productId: id.roseB, quantity: 1 },
      { host: HOST.b },
    ).expect(201);
    const cookie = cookieOf(res, 'matilda_cart') as string;
    await shop('put', '/coupon', { code: 'WELCOME10' }, { cookie, host: HOST.b }).expect(422);
  });
});
