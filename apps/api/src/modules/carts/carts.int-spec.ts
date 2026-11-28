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
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { TenantResolver } from '../tenancy/tenant-resolver.service';

/**
 * The cart over HTTP and the database (Phase 5 step 5.4): guest and customer carts, the cookie and
 * CSRF rules, validation against the catalog, merging at sign-in, and brand isolation.
 */

const PLATFORM = { brandIds: [], platform: true } as const;
const HOST = { a: 'alpha.test', aAll: 'alpha-all.test', b: 'beta.test' } as const;
const password = () => `Cu-${randomBytes(10).toString('hex')}`;

interface Session {
  cookie: string;
  csrf: string;
}
interface CallOptions {
  cookie?: string;
  session?: Session;
  origin?: string | null;
  query?: string;
}

describe('cart (HTTP + database)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let mail: ConsoleMailAdapter;
  const id = {
    brandA: '',
    brandB: '',
    marketA: '',
    marketSa: '',
    rose: '',
    cake: '',
    message: '',
    candle: '',
    roseB: '',
    draft: '',
  };
  let counter = 0;

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
    await owner.query('TRUNCATE customer, staff_user, brand, branch, auth_attempt CASCADE');
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
      const mSa = await market(a.id, sa.id, 'ksa');
      const mB = await market(b.id, ae.id, 'ae');
      await tx.brandDomain.createMany({
        data: [
          { brandId: a.id, hostname: HOST.a, marketId: mA.id, isPrimary: true },
          { brandId: a.id, hostname: HOST.aAll },
          { brandId: b.id, hostname: HOST.b, marketId: mB.id, isPrimary: true },
        ],
      });

      const product = async (
        brandId: string,
        marketIds: string[],
        key: string,
        price: number,
        extra: Record<string, unknown> = {},
      ) => {
        const p = await tx.product.create({
          data: {
            brandId,
            type: 'SIMPLE',
            status: 'PUBLISHED',
            sku: `C-${key.toUpperCase()}`,
            translations: { create: [{ language: 'en', name: key, slug: key }] },
            ...extra,
          },
        });
        for (const marketId of marketIds) {
          await tx.productMarket.create({ data: { brandId, productId: p.id, marketId } });
          await tx.marketPrice.create({
            data: { brandId, marketId, currencyCode: 'AED', productId: p.id, regularMinor: price },
          });
        }
        return p.id;
      };
      id.brandA = a.id;
      id.brandB = b.id;
      id.marketA = mA.id;
      id.marketSa = mSa.id;
      id.rose = await product(a.id, [mA.id, mSa.id], 'rose', 25000, { maxQuantity: 5 });
      id.draft = await product(a.id, [mA.id], 'draft', 100);
      id.roseB = await product(b.id, [mB.id], 'rose-b', 100);
      id.cake = await product(a.id, [mA.id], 'cake', 18000);
      const message = await tx.optionGroup.create({
        data: {
          brandId: a.id,
          productId: id.cake,
          key: 'message',
          type: 'TEXT',
          maxLength: 10,
          translations: { create: [{ language: 'en', label: 'Message' }] },
        },
      });
      id.message = message.id;
      const addons = await tx.addonGroup.create({
        data: { brandId: a.id, productId: id.cake, key: 'extras' },
      });
      const candle = await tx.addonItem.create({
        data: {
          brandId: a.id,
          addonGroupId: addons.id,
          kind: 'INLINE',
          key: 'candles',
          maxQuantity: 5,
          translations: { create: [{ language: 'en', label: 'Candles' }] },
        },
      });
      id.candle = candle.id;
      await tx.addonItemPrice.create({
        data: {
          brandId: a.id,
          addonItemId: candle.id,
          marketId: mA.id,
          currencyCode: 'AED',
          deltaMinor: 300,
        },
      });
    });
    // Draft products are not buyable.
    await withScope(db, PLATFORM, (tx) =>
      tx.product.update({ where: { id: id.draft }, data: { status: 'DRAFT' } }),
    );
  });

  // ------------------------------------------------------------------ helpers

  const call = (
    host: string,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
    opts: CallOptions = {},
  ) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/cart${path}${opts.query ?? ''}`)
      .set('Host', host);
    const origin = opts.origin === undefined ? `http://${host}` : opts.origin;
    if (origin) req = req.set('Origin', origin);
    const cookies = [opts.session?.cookie, opts.cookie].filter(Boolean).join('; ');
    if (cookies) req = req.set('Cookie', cookies);
    if (opts.session) req = req.set('X-CSRF-Token', opts.session.csrf);
    return body ? req.send(body) : req;
  };

  const cookieOf = (res: request.Response, name: string): string | undefined => {
    const all = (res.headers['set-cookie'] ?? []) as unknown as string[];
    return all.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  };

  const line = (productId: string, over: Record<string, unknown> = {}) => ({
    productId,
    quantity: 1,
    ...over,
  });

  /** Adds a first item as a guest and returns the cart cookie. */
  async function guest(host: string = HOST.a, productId = id.rose, quantity = 1) {
    const res = await call(host, 'post', '/lines', line(productId, { quantity })).expect(201);
    const cookie = cookieOf(res, 'matilda_cart') as string;
    return { cookie, cart: res.body.cart };
  }

  const authPost = (host: string, path: string, body: object, cookie?: string) => {
    let req = request(app.getHttpServer())
      .post(`/api/v1/customer${path}`)
      .set('Host', host)
      .set('Origin', `http://${host}`);
    if (cookie) req = req.set('Cookie', cookie);
    return req.send(body);
  };

  /** Registers and verifies an account (not yet signed in). */
  async function account(host: string = HOST.a) {
    const email = `buyer${++counter}@example.test`;
    const pw = password();
    await authPost(host, '/auth/register', {
      email,
      password: pw,
      fullName: 'Test Customer',
    }).expect(202);
    const token = /token=([\w-]+)/.exec(mail.outbox.at(-1)?.text ?? '')?.[1] as string;
    await authPost(host, '/auth/verify-email', { token }).expect(204);
    return { email, pw };
  }

  /** Signs in, optionally carrying a guest cart cookie like a browser would. */
  async function signIn(
    acct: { email: string; pw: string },
    host: string = HOST.a,
    guestCookie?: string,
  ) {
    const res = await authPost(
      host,
      '/auth/login',
      { email: acct.email, password: acct.pw },
      guestCookie,
    ).expect(200);
    const session: Session = {
      cookie: cookieOf(res, 'matilda_customer') as string,
      csrf: res.body.csrfToken as string,
    };
    return { session, res };
  }

  const customer = async (host: string = HOST.a): Promise<Session> =>
    (await signIn(await account(host), host)).session;

  const cartRows = (where = '') =>
    withScope(db, PLATFORM, (tx) =>
      tx.cart.findMany({
        where: where ? { status: where as 'OPEN' } : {},
        orderBy: { createdAt: 'asc' },
      }),
    );

  // ------------------------------------------------------------------ reading

  it('answers null with no store caching when the visitor has no cart, and never creates one', async () => {
    const res = await call(HOST.a, 'get', '').expect(200);
    expect(res.body).toEqual({ cart: null });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await cartRows()).toHaveLength(0);
  });

  it('rejects an unknown host', async () => {
    await call('nowhere.test', 'get', '').expect(404);
  });

  // ------------------------------------------------------------------ guest cart

  it('creates a guest cart on the first add, prices it in the backend and sets an HttpOnly cookie', async () => {
    const res = await call(
      HOST.a,
      'post',
      '/lines',
      // Anything price-like the client sends is ignored.
      { ...line(id.rose, { quantity: 2 }), unitMinor: 1, totalMinor: 1 },
    ).expect(201);
    expect(res.headers['set-cookie']?.[0]).toMatch(/matilda_cart=.+HttpOnly/i);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/i);
    const cart = res.body.cart;
    expect(cart.currency).toBe('AED');
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: id.rose, quantity: 2, issues: [] });
    expect(cart.quote.lines[0]).toMatchObject({ unitMinor: 25000, totalMinor: 50000 });
    expect(cart.quote.totals.totalMinor).toBe(50000);
    // The quote is signed and expires in 15 minutes; no delivery is quoted before an area and method are chosen.
    expect(cart.quote.signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(cart.quote.expiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(cart.quote.delivery).toBeNull();
    expect(cart.quote.tax).toEqual({ rateBps: 0, inclusive: true });

    const rows = await cartRows();
    expect(rows).toHaveLength(1);
    // The secret itself is never stored, only its hash.
    const token = (cookieOf(res, 'matilda_cart') as string).split('=')[1] as string;
    expect(rows[0]?.guestTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.guestTokenHash).not.toBe(token);
    expect(rows[0]?.customerId).toBeNull();
  });

  it('shows the same cart to the cookie holder and no cart to anyone else', async () => {
    const { cookie, cart } = await guest();
    const mine = await call(HOST.a, 'get', '', undefined, { cookie }).expect(200);
    expect(mine.body.cart.id).toBe(cart.id);
    expect((await call(HOST.a, 'get', '').expect(200)).body.cart).toBeNull();
    expect(
      (await call(HOST.a, 'get', '', undefined, { cookie: 'matilda_cart=forged' }).expect(200)).body
        .cart,
    ).toBeNull();
  });

  it("a cart cookie is worthless on another brand's host", async () => {
    const { cookie } = await guest();
    expect((await call(HOST.b, 'get', '', undefined, { cookie }).expect(200)).body.cart).toBeNull();
    const added = await call(HOST.b, 'post', '/lines', line(id.roseB), { cookie }).expect(201);
    expect(added.body.cart.lines).toHaveLength(1);
    const rows = await cartRows();
    expect(rows).toHaveLength(2);
  });

  it('raises the quantity when the same configuration is added again and splits different choices', async () => {
    const { cookie } = await guest(HOST.a, id.cake, 1);
    const same = await call(HOST.a, 'post', '/lines', line(id.cake, { quantity: 2 }), { cookie });
    expect(same.status).toBe(201);
    expect(same.body.cart.lines).toHaveLength(1);
    expect(same.body.cart.lines[0].quantity).toBe(3);
    expect(cookieOf(same, 'matilda_cart')).toBeUndefined();

    const withText = await call(
      HOST.a,
      'post',
      '/lines',
      line(id.cake, { options: [{ optionId: id.message, valueIds: [], text: 'Hello Sara' }] }),
      { cookie },
    ).expect(201);
    expect(withText.body.cart.lines).toHaveLength(2);
    const lines = withText.body.cart.lines as { options: unknown[] }[];
    expect(lines.find((l) => l.options.length)?.options).toEqual([
      { optionId: id.message, valueIds: [], text: 'Hello Sara' },
    ]);

    // Same text again raises that line, not a third one.
    const again = await call(
      HOST.a,
      'post',
      '/lines',
      line(id.cake, { options: [{ optionId: id.message, valueIds: [], text: 'Hello Sara' }] }),
      { cookie },
    ).expect(201);
    expect(again.body.cart.lines).toHaveLength(2);
  });

  it('prices add-ons as their own quote lines multiplied by the product quantity', async () => {
    const res = await call(
      HOST.a,
      'post',
      '/lines',
      line(id.cake, { quantity: 2, addOns: [{ addOnId: id.candle, quantity: 3 }] }),
    ).expect(201);
    const quote = res.body.cart.quote;
    const addon = quote.lines.find((l: { kind: string }) => l.kind === 'ADD_ON');
    expect(addon).toMatchObject({ quantity: 6, unitMinor: 300, totalMinor: 1800 });
    expect(quote.totals.totalMinor).toBe(2 * 18000 + 1800);
  });

  // ------------------------------------------------------------------ validation

  it.each([
    ['an unknown product', () => line('0197a000-0000-7000-8000-000000000000'), 'product'],
    ['a draft product', () => line(id.draft), 'product'],
    ["another brand's product", () => line(id.roseB), 'product'],
    ['more than the product allows', () => line(id.rose, { quantity: 6 }), 'quantity'],
    [
      'a customization text that is too long',
      () =>
        line(id.cake, { options: [{ optionId: id.message, valueIds: [], text: 'x'.repeat(11) }] }),
      'options',
    ],
  ])('refuses %s with a field error and creates no cart', async (_name, body, field) => {
    const res = await call(HOST.a, 'post', '/lines', body()).expect(422);
    expect(res.body.code ?? res.body.error?.code).toBe('CART_LINE_INVALID');
    const errors = (res.body.errors ?? res.body.error?.errors) as { path: string }[];
    expect(errors.map((e) => e.path)).toContain(field);
    expect(cookieOf(res, 'matilda_cart')).toBeUndefined();
    expect(await cartRows()).toHaveLength(0);
  });

  it('refuses malformed bodies and ignores nothing it should reject', async () => {
    await call(HOST.a, 'post', '/lines', { productId: 'nope', quantity: 1 }).expect(400);
    await call(HOST.a, 'post', '/lines', line(id.rose, { quantity: 0 })).expect(400);
    await call(HOST.a, 'post', '/lines', line(id.rose, { quantity: 100 })).expect(400);
    await call(HOST.a, 'post', '/lines', line(id.rose, { note: 'x'.repeat(201) })).expect(400);
  });

  it('refuses a merged quantity above the product maximum', async () => {
    const { cookie } = await guest(HOST.a, id.rose, 4);
    await call(HOST.a, 'post', '/lines', line(id.rose, { quantity: 2 }), { cookie }).expect(422);
    const cart = (await call(HOST.a, 'get', '', undefined, { cookie })).body.cart;
    expect(cart.lines[0].quantity).toBe(4);
  });

  it('holds at most 50 lines', async () => {
    const { cookie } = await guest(HOST.a, id.cake, 1);
    for (let i = 1; i < 50; i += 1) {
      await call(
        HOST.a,
        'post',
        '/lines',
        line(id.cake, { options: [{ optionId: id.message, valueIds: [], text: `m${i}` }] }),
        { cookie },
      ).expect(201);
    }
    const res = await call(
      HOST.a,
      'post',
      '/lines',
      line(id.cake, { options: [{ optionId: id.message, valueIds: [], text: 'one-more' }] }),
      { cookie },
    ).expect(422);
    expect(res.body.code ?? res.body.error?.code).toBe('CART_FULL');
  }, 60_000);

  // ------------------------------------------------------------------ changing lines

  it('changes quantity and note, validating the new quantity, and removes lines', async () => {
    const { cookie, cart } = await guest(HOST.a, id.rose, 1);
    const lineId = cart.lines[0].id as string;
    const patched = await call(
      HOST.a,
      'patch',
      `/lines/${lineId}`,
      { quantity: 3, note: 'Gift' },
      { cookie },
    ).expect(200);
    expect(patched.body.cart.lines[0]).toMatchObject({ quantity: 3, note: 'Gift' });
    expect(patched.body.cart.quote.totals.totalMinor).toBe(75000);

    await call(HOST.a, 'patch', `/lines/${lineId}`, { quantity: 6 }, { cookie }).expect(422);
    await call(HOST.a, 'patch', `/lines/${lineId}`, {}, { cookie }).expect(400);
    await call(HOST.a, 'patch', `/lines/${lineId}`, { note: null }, { cookie }).expect(200);

    const removed = await call(HOST.a, 'delete', `/lines/${lineId}`, undefined, { cookie }).expect(
      200,
    );
    expect(removed.body.cart.lines).toEqual([]);
    expect(removed.body.cart.quote.totals.totalMinor).toBe(0);
    await call(HOST.a, 'delete', `/lines/${lineId}`, undefined, { cookie }).expect(404);
  });

  it("one guest can never change another guest's lines", async () => {
    const one = await guest();
    const two = await guest();
    const lineOfOne = one.cart.lines[0].id as string;
    await call(
      HOST.a,
      'patch',
      `/lines/${lineOfOne}`,
      { quantity: 2 },
      { cookie: two.cookie },
    ).expect(404);
    await call(HOST.a, 'delete', `/lines/${lineOfOne}`, undefined, { cookie: two.cookie }).expect(
      404,
    );
    await call(HOST.a, 'patch', `/lines/${lineOfOne}`, { quantity: 2 }).expect(404);
    expect(
      (await call(HOST.a, 'get', '', undefined, { cookie: one.cookie })).body.cart.lines[0]
        .quantity,
    ).toBe(1);
  });

  it('captures contact details and rejects bad ones', async () => {
    const { cookie } = await guest();
    const res = await call(
      HOST.a,
      'patch',
      '/contact',
      { contactEmail: 'Shopper@Example.TEST', contactPhone: '+971 50 123 4567' },
      { cookie },
    ).expect(200);
    expect(res.body.cart).toMatchObject({
      contactEmail: 'shopper@example.test',
      contactPhone: '+971 50 123 4567',
    });
    await call(HOST.a, 'patch', '/contact', { contactEmail: 'not-an-email' }, { cookie }).expect(
      400,
    );
    await call(HOST.a, 'patch', '/contact', { contactPhone: 'abc' }, { cookie }).expect(400);
    const cleared = await call(
      HOST.a,
      'patch',
      '/contact',
      { contactPhone: null },
      { cookie },
    ).expect(200);
    expect(cleared.body.cart.contactPhone).toBeNull();
    await call(HOST.a, 'patch', '/contact', { contactEmail: 'a@b.test' }).expect(404);
  });

  // ------------------------------------------------------------------ browser safety

  it('refuses mutations without a same-brand origin but allows reads', async () => {
    await call(HOST.a, 'post', '/lines', line(id.rose), { origin: null }).expect(403);
    await call(HOST.a, 'post', '/lines', line(id.rose), { origin: `http://${HOST.b}` }).expect(403);
    await call(HOST.a, 'post', '/lines', line(id.rose), { origin: 'http://evil.test' }).expect(403);
    await call(HOST.a, 'get', '', undefined, { origin: null }).expect(200);
    expect(await cartRows()).toHaveLength(0);
  });

  // ------------------------------------------------------------------ customer cart

  it('gives a signed-in customer one cart that needs the CSRF token and sets no cart cookie', async () => {
    const session = await customer();
    const noCsrf = request(app.getHttpServer())
      .post('/api/v1/cart/lines')
      .set('Host', HOST.a)
      .set('Origin', `http://${HOST.a}`)
      .set('Cookie', session.cookie)
      .send(line(id.rose));
    expect((await noCsrf).status).toBe(403);

    const first = await call(HOST.a, 'post', '/lines', line(id.rose), { session }).expect(201);
    expect(cookieOf(first, 'matilda_cart')).toBeUndefined();
    const second = await call(HOST.a, 'post', '/lines', line(id.cake), { session }).expect(201);
    expect(second.body.cart.id).toBe(first.body.cart.id);
    expect(second.body.cart.lines).toHaveLength(2);
    const rows = await cartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerId).not.toBeNull();
    expect(rows[0]?.guestTokenHash).toBeNull();
    // Another device with the same account sees the same cart.
    expect((await call(HOST.a, 'get', '', undefined, { session })).body.cart.id).toBe(
      first.body.cart.id,
    );
  });

  it('a customer never sees a cart on another brand', async () => {
    const session = await customer();
    await call(HOST.a, 'post', '/lines', line(id.rose), { session }).expect(201);
    // The brand A session cookie means nothing on brand B: the visitor is just a guest there.
    expect((await call(HOST.b, 'get', '', undefined, { session })).body.cart).toBeNull();
  });

  // ------------------------------------------------------------------ merging at sign-in

  it('adopts the guest cart at sign-in when the customer has none and clears the cart cookie', async () => {
    const { cookie, cart } = await guest(HOST.a, id.rose, 2);
    const { session, res } = await signIn(await account(), HOST.a, cookie);
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/matilda_cart=;/);

    const mine = await call(HOST.a, 'get', '', undefined, { session });
    expect(mine.body.cart.id).toBe(cart.id);
    expect(mine.body.cart.lines[0].quantity).toBe(2);
    // The old guest cookie no longer finds anything.
    expect((await call(HOST.a, 'get', '', undefined, { cookie })).body.cart).toBeNull();
    const rows = await cartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.guestTokenHash).toBeNull();
  });

  it('merges a guest cart into the customer cart by adding quantities of identical items', async () => {
    const acct = await account();
    const { session } = await signIn(acct);
    await call(HOST.a, 'post', '/lines', line(id.rose, { quantity: 2 }), { session }).expect(201);
    await call(HOST.a, 'post', '/lines', line(id.cake), { session }).expect(201);
    // Later a guest (another browser) shops, then signs in to the same account.
    const { cookie } = await guest(HOST.a, id.rose, 2);
    await call(HOST.a, 'post', '/lines', line(id.cake), { cookie }).expect(201);
    await call(
      HOST.a,
      'post',
      '/lines',
      line(id.cake, { options: [{ optionId: id.message, valueIds: [], text: 'Hi' }] }),
      { cookie },
    ).expect(201);

    const { session: fresh } = await signIn(acct, HOST.a, cookie);
    const cart = (await call(HOST.a, 'get', '', undefined, { session: fresh })).body.cart;
    const byProduct = (productId: string) =>
      (cart.lines as { productId: string; quantity: number; options: unknown[] }[]).filter(
        (l) => l.productId === productId,
      );
    expect(byProduct(id.rose)).toHaveLength(1);
    expect(byProduct(id.rose)[0]?.quantity).toBe(4);
    expect(byProduct(id.cake)).toHaveLength(2);
    expect(byProduct(id.cake).find((l) => l.options.length === 0)?.quantity).toBe(2);

    const rows = await cartRows();
    expect(rows.map((r) => r.status).sort()).toEqual(['MERGED', 'OPEN']);
    expect((await call(HOST.a, 'get', '', undefined, { cookie })).body.cart).toBeNull();
  });

  it('keeps a merged quantity above a product maximum visible as an issue instead of dropping it', async () => {
    const acct = await account();
    const { session } = await signIn(acct);
    await call(HOST.a, 'post', '/lines', line(id.rose, { quantity: 4 }), { session }).expect(201);
    const { cookie } = await guest(HOST.a, id.rose, 4);
    const { session: fresh } = await signIn(acct, HOST.a, cookie);
    const cart = (await call(HOST.a, 'get', '', undefined, { session: fresh })).body.cart;
    expect(cart.lines[0].quantity).toBe(8);
    expect(cart.lines[0].issues.map((i: { field: string }) => i.field)).toContain('quantity');
    expect(cart.quote.totals.totalMinor).toBe(0);
  });

  it('a garbage cart cookie never blocks sign-in', async () => {
    const { res } = await signIn(await account(), HOST.a, 'matilda_cart=garbage');
    expect(res.status).toBe(200);
  });

  // ------------------------------------------------------------------ changes after adding

  it('shows a product that stopped being sold as an issue and leaves it out of the totals', async () => {
    const { cookie } = await guest(HOST.a, id.rose, 1);
    await call(HOST.a, 'post', '/lines', line(id.cake), { cookie }).expect(201);
    await withScope(db, PLATFORM, (tx) =>
      tx.product.update({ where: { id: id.rose }, data: { status: 'DRAFT' } }),
    );
    const res = await call(HOST.a, 'get', '', undefined, { cookie }).expect(200);
    const lines = res.body.cart.lines as { productId: string; issues: { field: string }[] }[];
    expect(lines.find((l) => l.productId === id.rose)?.issues.map((i) => i.field)).toEqual([
      'product',
    ]);
    expect(lines.find((l) => l.productId === id.cake)?.issues).toEqual([]);
    expect(res.body.cart.quote.totals.totalMinor).toBe(18000);
  });

  it('reopens an abandoned cart when its owner comes back', async () => {
    const { cookie, cart } = await guest();
    await withScope(db, PLATFORM, (tx) =>
      tx.cart.update({
        where: { id: cart.id },
        data: { status: 'ABANDONED', abandonedAt: new Date() },
      }),
    );
    expect((await call(HOST.a, 'get', '', undefined, { cookie })).body.cart.id).toBe(cart.id);
    await call(HOST.a, 'post', '/lines', line(id.cake), { cookie }).expect(201);
    const row = (await cartRows())[0];
    expect(row?.status).toBe('OPEN');
    expect(row?.abandonedAt).toBeNull();
  });

  // ------------------------------------------------------------------ markets

  it('keeps one market per cart: an empty cart follows the shopper, a filled one refuses', async () => {
    const { cookie, cart } = await guest(HOST.a, id.rose, 1);
    // Brand-wide domain, choosing the other market, while the cart holds items.
    await call(HOST.aAll, 'get', '', undefined, { cookie, query: '?market=ksa' }).expect(409);
    await call(HOST.aAll, 'post', '/lines', line(id.rose), { cookie, query: '?market=ksa' }).expect(
      409,
    );
    // Without a market the brand-wide domain uses the cart's own market.
    expect((await call(HOST.aAll, 'get', '', undefined, { cookie })).body.cart.id).toBe(cart.id);

    await call(HOST.a, 'delete', `/lines/${cart.lines[0].id}`, undefined, { cookie }).expect(200);
    const moved = await call(HOST.aAll, 'post', '/lines', line(id.rose), {
      cookie,
      query: '?market=ksa',
    }).expect(201);
    expect(moved.body.cart.marketId).toBe(id.marketSa);
    expect(moved.body.cart.id).toBe(cart.id);
  });

  it('needs a market on brand-wide domains when there is no cart yet', async () => {
    await call(HOST.aAll, 'post', '/lines', line(id.rose)).expect(404);
    await call(HOST.aAll, 'post', '/lines', line(id.rose), { query: '?market=nowhere' }).expect(
      404,
    );
    await call(HOST.aAll, 'post', '/lines', line(id.rose), { query: '?market=ksa' }).expect(201);
  });
});
