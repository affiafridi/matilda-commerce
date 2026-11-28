import type { Pool, PoolClient } from 'pg';
import {
  CART_STATUSES,
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  cartMachine,
  fulfillmentMachine,
  orderMachine,
  paymentAttemptMachine,
  paymentMachine,
} from '@matilda/validation';
import { uuidv7 } from '../../common/ids/uuid7';
import { createPool, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

/**
 * Commerce schema (Phase 5 step 5.2, docs/PHASE-5-SCHEMA-DRAFT.md): carts, orders, payments and
 * promotions. Row-level security on every table, brand isolation, composite keys, checks, state
 * machines, frozen snapshots, append-only tables and the concurrency guarantees. Database-backed.
 */

const BRAND_TABLES = [
  'cart',
  'cart_line',
  'cart_line_option',
  'cart_line_addon',
  'cart_line_bundle_choice',
  'customer_order',
  'order_line',
  'order_promotion',
  'order_status_history',
  'order_counter',
  'payment_config',
  'payment',
  'payment_attempt',
  'payment_event',
  'promotion',
  'promotion_translation',
  'promotion_market',
  'promotion_target',
  'coupon',
  'promotion_usage',
  'customer_address',
];

const APPEND_ONLY = ['order_line', 'order_promotion', 'order_status_history', 'payment_event'];

interface Ctx {
  brandIds?: string[];
  platform?: boolean;
}

async function inTx<T>(pool: Pool, ctx: Ctx, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.brand_ids', $1, true), set_config('app.platform', $2, true)`,
      [(ctx.brandIds ?? []).join(','), ctx.platform ? 'on' : ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ins(c: PoolClient, table: string, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  await c.query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((k) => row[k]),
  );
}

interface BrandFixture {
  brand: string;
  market: string;
  tag: string;
}

interface Seeded {
  customer: string;
  simple: string;
  variable: string;
  variation: string;
  bundle: string;
  bundleItem: string;
  optionGroup: string;
  choice: string;
  addonItem: string;
  category: string;
  cart: string;
  line: string;
  order: string;
  config: string;
  ccConfig: string;
  payment: string;
  promotion: string;
  coupon: string;
}

const addr = JSON.stringify({ line1: '1 Test Street', area: 'jumeirah' });

/** Fields of a valid draft order; tests override what they want to break. */
const orderRow = (f: { brand: string; market: string }, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  brand_id: f.brand,
  market_id: f.market,
  number: `ZZ-${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
  currency_code: 'AED',
  subtotal_minor: 1000,
  discount_minor: 100,
  delivery_fee_minor: 50,
  tax_minor: 43,
  total_minor: 950,
  tax_inclusive: true,
  guest_email: 'guest@example.test',
  guest_phone: '+971500000000',
  contact_name: 'Test Buyer',
  contact_email: 'guest@example.test',
  contact_phone: '+971500000000',
  recipient_name: 'Test Recipient',
  recipient_phone: '+971500000001',
  delivery_address: addr,
  idempotency_key: `idem-${uuidv7()}`,
  updated_at: new Date(),
  ...over,
});

const lineRow = (f: { brand: string }, order: string, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  brand_id: f.brand,
  order_id: order,
  position: 1,
  kind: 'PRODUCT',
  name: JSON.stringify({ en: 'Test product' }),
  quantity: 1,
  unit_minor: 1000,
  discount_minor: 0,
  tax_minor: 48,
  total_minor: 1000,
  ...over,
});

/** One row in every brand-keyed table for a brand, built through the real constraints. */
async function seedBrand(c: PoolClient, f: BrandFixture): Promise<Seeded> {
  const now = new Date();
  const brand_id = f.brand;
  const T = f.tag.toUpperCase();
  const s: Seeded = {
    customer: uuidv7(),
    simple: uuidv7(),
    variable: uuidv7(),
    variation: uuidv7(),
    bundle: uuidv7(),
    bundleItem: uuidv7(),
    optionGroup: uuidv7(),
    choice: uuidv7(),
    addonItem: uuidv7(),
    category: uuidv7(),
    cart: uuidv7(),
    line: uuidv7(),
    order: uuidv7(),
    config: uuidv7(),
    ccConfig: uuidv7(),
    payment: uuidv7(),
    promotion: uuidv7(),
    coupon: uuidv7(),
  };
  const product = (id: string, type: string, sku: string | null) =>
    ins(c, 'product', { id, brand_id, type, sku, updated_at: now });
  await product(s.simple, 'SIMPLE', `CS-${T}-1`);
  await product(s.variable, 'VARIABLE', null);
  await product(s.bundle, 'BUNDLE', `CB-${T}-1`);
  await ins(c, 'variation', {
    id: s.variation,
    brand_id,
    product_id: s.variable,
    sku: `CV-${T}-1`,
    combination_key: 'size=1kg',
    updated_at: now,
  });
  await ins(c, 'bundle_item', {
    id: s.bundleItem,
    brand_id,
    bundle_product_id: s.bundle,
    component_product_id: s.simple,
  });
  await ins(c, 'option_group', {
    id: s.optionGroup,
    brand_id,
    product_id: s.simple,
    key: 'message',
    type: 'SELECT',
  });
  await ins(c, 'option_choice', {
    id: s.choice,
    brand_id,
    option_group_id: s.optionGroup,
    key: 'plain',
  });
  const addonGroup = uuidv7();
  await ins(c, 'addon_group', { id: addonGroup, brand_id, product_id: s.simple, key: 'extras' });
  await ins(c, 'addon_item', {
    id: s.addonItem,
    brand_id,
    addon_group_id: addonGroup,
    kind: 'INLINE',
    key: 'card',
  });
  await ins(c, 'category', { id: s.category, brand_id, updated_at: now });
  await ins(c, 'customer', {
    id: s.customer,
    brand_id,
    email: `buyer-${f.tag}@example.test`,
    password_hash: 'fixture-no-login',
    full_name: 'Buyer',
    updated_at: now,
  });

  // Cart with a product line, an option, an add-on and a bundle line.
  await ins(c, 'cart', {
    id: s.cart,
    brand_id,
    market_id: f.market,
    currency_code: 'AED',
    customer_id: s.customer,
    updated_at: now,
  });
  await ins(c, 'cart_line', {
    id: s.line,
    brand_id,
    cart_id: s.cart,
    product_id: s.simple,
    quantity: 2,
  });
  await ins(c, 'cart_line_option', {
    id: uuidv7(),
    brand_id,
    line_id: s.line,
    option_group_id: s.optionGroup,
    choice_id: s.choice,
  });
  await ins(c, 'cart_line_addon', {
    line_id: s.line,
    brand_id,
    addon_item_id: s.addonItem,
    quantity: 1,
  });
  const bundleLine = uuidv7();
  await ins(c, 'cart_line', {
    id: bundleLine,
    brand_id,
    cart_id: s.cart,
    product_id: s.bundle,
    quantity: 1,
  });
  await ins(c, 'cart_line_bundle_choice', {
    line_id: bundleLine,
    brand_id,
    bundle_item_id: s.bundleItem,
  });

  // Payment configurations: a card gateway (encrypted envelope) and cash on delivery.
  await ins(c, 'payment_config', {
    id: s.ccConfig,
    brand_id,
    market_id: f.market,
    provider: 'CCAVENUE',
    version: 1,
    status: 'INACTIVE',
    display_name: JSON.stringify({ en: 'Card' }),
    enabled_methods: ['card'],
    credentials_encrypted: 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCC',
    credentials_last4: '1234',
  });
  await ins(c, 'payment_config', {
    id: s.config,
    brand_id,
    market_id: f.market,
    provider: 'COD',
    version: 1,
    display_name: JSON.stringify({ en: 'Cash on delivery' }),
    enabled_methods: ['cash'],
    cod_zone_ids: [],
  });

  // Order: draft with a line and a promotion, then placed.
  await ins(c, 'customer_order', {
    ...orderRow(f, {
      id: s.order,
      number: `${T}M-100001`,
      customer_id: s.customer,
      guest_email: null,
      guest_phone: null,
    }),
  });
  await ins(c, 'order_line', lineRow(f, s.order));
  await ins(c, 'order_promotion', {
    id: uuidv7(),
    brand_id,
    order_id: s.order,
    name: JSON.stringify({ en: 'Welcome' }),
    kind: 'PERCENT_OFF',
    amount_minor: 100,
  });
  await c.query(`UPDATE customer_order SET status = 'PENDING_PAYMENT' WHERE id = $1`, [s.order]);
  await ins(c, 'payment', {
    id: s.payment,
    brand_id,
    order_id: s.order,
    provider: 'COD',
    config_id: s.config,
    config_version: 1,
    currency_code: 'AED',
    amount_minor: 950,
    updated_at: now,
  });
  await ins(c, 'payment_attempt', {
    id: uuidv7(),
    brand_id,
    payment_id: s.payment,
    reference: `REF-${T}-1`,
    amount_minor: 950,
    currency_code: 'AED',
    idempotency_key: `attempt-${uuidv7()}`,
    expires_at: new Date(Date.now() + 15 * 60 * 1000),
  });
  await ins(c, 'payment_event', {
    id: uuidv7(),
    brand_id,
    payment_id: s.payment,
    provider: 'COD',
    event_key: `evt-${T}-1`,
    kind: 'created',
    accepted: true,
  });

  // Promotions: an order-wide percentage and a category promotion with its target, plus a coupon.
  await ins(c, 'promotion', {
    id: s.promotion,
    brand_id,
    code: 'WELCOME',
    kind: 'PERCENT_OFF',
    percent_bps: 1000,
    updated_at: now,
  });
  await ins(c, 'promotion_translation', {
    promotion_id: s.promotion,
    brand_id,
    language: 'en',
    name: 'Welcome',
  });
  await ins(c, 'promotion_market', { promotion_id: s.promotion, brand_id, market_id: f.market });
  const catPromo = uuidv7();
  await ins(c, 'promotion', {
    id: catPromo,
    brand_id,
    code: 'CATEGORY10',
    kind: 'FIXED_OFF',
    scope: 'CATEGORY',
    fixed_minor: 1000,
    currency_code: 'AED',
    updated_at: now,
  });
  await ins(c, 'promotion_target', {
    id: uuidv7(),
    brand_id,
    promotion_id: catPromo,
    category_id: s.category,
  });
  await ins(c, 'coupon', {
    id: s.coupon,
    brand_id,
    promotion_id: s.promotion,
    code: `WELCOME-${T}`,
    usage_limit: 100,
  });
  await ins(c, 'promotion_usage', {
    id: uuidv7(),
    brand_id,
    promotion_id: s.promotion,
    coupon_id: s.coupon,
    order_id: s.order,
    customer_id: s.customer,
    amount_minor: 100,
  });
  await ins(c, 'order_counter', { brand_id, prefix: `${T}M` });
  return s;
}

describe('commerce schema (step 5.2)', () => {
  let owner: Pool;
  let app: Pool;

  const ids = {
    ae: uuidv7(),
    brandA: uuidv7(),
    brandB: uuidv7(),
    marketA: uuidv7(),
    marketB: uuidv7(),
    area: uuidv7(),
  };
  let A: Seeded;
  let B: Seeded;
  const fa = { brand: ids.brandA, market: ids.marketA, tag: 'a' };
  const fb = { brand: ids.brandB, market: ids.marketB, tag: 'b' };

  const asOwner = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(owner, { platform: true }, fn);
  const asPlatform = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(app, { platform: true }, fn);
  const asBrand = <T>(brandIds: string[], fn: (c: PoolClient) => Promise<T>) =>
    inTx(app, { brandIds }, fn);
  const asNobody = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(app, {}, fn);
  const inA = <T>(fn: (c: PoolClient) => Promise<T>) => asBrand([ids.brandA], fn);
  const rejects = (fn: (c: PoolClient) => Promise<unknown>, code: string) =>
    expect(inA(fn)).rejects.toMatchObject({ code });

  const CHECK = '23514';
  const FK = '23503';
  const UNIQUE = '23505';
  const DENIED = '42501';

  beforeAll(async () => {
    owner = createPool(testOwnerUrl());
    app = createPool(testAppUrl());
    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await asOwner(async (c) => {
      await c.query(`INSERT INTO currency (code, name, symbol, minor_unit_digits) VALUES
        ('AED','UAE Dirham','AED',2) ON CONFLICT DO NOTHING`);
      await c.query(`INSERT INTO language (code, name, native_name, direction) VALUES
        ('en','English','English','LTR'), ('ar','Arabic','Arabic','RTL') ON CONFLICT DO NOTHING`);
      await c.query(`DELETE FROM country WHERE iso2 = 'AE'`);
      await c.query(
        `INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'AE','ARE','United Arab Emirates')`,
        [ids.ae],
      );
      await c.query(
        `INSERT INTO brand (id, slug, name, status, updated_at) VALUES
          ($1,'com-a','Commerce A','ACTIVE', now()), ($2,'com-b','Commerce B','ACTIVE', now())`,
        [ids.brandA, ids.brandB],
      );
      await c.query(
        `INSERT INTO market (id, brand_id, country_id, code, timezone, updated_at) VALUES
          ($1,$2,$3,'ae','Asia/Dubai', now()), ($4,$5,$3,'ae','Asia/Dubai', now())`,
        [ids.marketA, ids.brandA, ids.ae, ids.marketB, ids.brandB],
      );
      await c.query(
        `INSERT INTO market_currency (market_id, currency_code, is_default) VALUES ($1,'AED',true), ($2,'AED',true)`,
        [ids.marketA, ids.marketB],
      );
      await ins(c, 'delivery_area', {
        id: ids.area,
        country_id: ids.ae,
        level: 'EMIRATE',
        code: 'dubai',
      });
      A = await seedBrand(c, fa);
      B = await seedBrand(c, fb);
    });
  });

  afterAll(async () => {
    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await Promise.all([owner.end(), app.end()]);
  });

  describe('structure', () => {
    it('has the 21 brand-keyed tables with brand_id, forced RLS and one scope policy', async () => {
      const { rows } = await owner.query(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
                EXISTS (SELECT 1 FROM information_schema.columns k
                         WHERE k.table_name = c.relname AND k.column_name = 'brand_id') AS has_brand
           FROM pg_class c WHERE c.relname = ANY ($1) ORDER BY c.relname`,
        [BRAND_TABLES],
      );
      expect(rows).toHaveLength(BRAND_TABLES.length);
      for (const r of rows) {
        expect(r).toMatchObject({ rls: true, forced: true, has_brand: true });
        expect(Number(r.policies)).toBe(1);
      }
    });

    it('indexes the leading columns of every foreign key', async () => {
      const { rows } = await owner.query(
        `SELECT c.conrelid::regclass::text AS tbl, c.conname
           FROM pg_constraint c
          WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1)
            AND NOT EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid
                 AND array_to_string((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1], ',') = array_to_string(c.conkey, ','))`,
        [BRAND_TABLES],
      );
      expect(rows).toEqual([]);
    });

    it('does not let the runtime role truncate, alter or change append-only tables', async () => {
      for (const t of APPEND_ONLY) {
        await expect(app.query(`TRUNCATE ${t}`)).rejects.toMatchObject({ code: DENIED });
        await expect(
          inTx(app, { platform: true }, (c) => c.query(`DELETE FROM ${t}`)),
        ).rejects.toMatchObject({ code: DENIED });
      }
      await expect(app.query('ALTER TABLE payment ADD COLUMN x int')).rejects.toMatchObject({
        code: DENIED,
      });
    });

    it('uses the same enum values as the shared contracts', async () => {
      const values = async (type: string) =>
        (
          await owner.query(
            `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = $1 ORDER BY e.enumsortorder`,
            [type],
          )
        ).rows.map((r) => r.enumlabel);
      expect(await values('OrderStatus')).toEqual([...ORDER_STATUSES]);
      expect(await values('PaymentStatus')).toEqual([...PAYMENT_STATUSES]);
      expect(await values('FulfillmentStatus')).toEqual([...FULFILLMENT_STATUSES]);
      expect(await values('PaymentAttemptStatus')).toEqual([...PAYMENT_ATTEMPT_STATUSES]);
      expect(await values('CartStatus')).toEqual([...CART_STATUSES]);
      expect(await values('PaymentProvider')).toEqual([...PAYMENT_PROVIDERS]);
    });

    it('stores no raw card data columns anywhere in the commerce tables', async () => {
      const { rows } = await owner.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_name = ANY ($1)
            AND column_name ~* '(card_?number|pan|cvv|cvc|expiry_?(month|year)|track_?data)'`,
        [BRAND_TABLES],
      );
      expect(rows).toEqual([]);
    });
  });

  describe('brand isolation matrix (every brand-keyed table)', () => {
    const counts = (c: PoolClient, table: string, brand: string) =>
      c
        .query(
          `SELECT count(*) FILTER (WHERE brand_id = $1) AS own, count(*) FILTER (WHERE brand_id <> $1) AS other FROM ${table}`,
          [brand],
        )
        .then((r) => ({ own: Number(r.rows[0].own), other: Number(r.rows[0].other) }));

    it.each(BRAND_TABLES.filter((t) => t !== 'customer_address'))(
      '%s: a brand sees only its own rows',
      async (table) => {
        const a = await asBrand([ids.brandA], (c) => counts(c, table, ids.brandA));
        expect(a).toMatchObject({ other: 0 });
        expect(a.own).toBeGreaterThan(0);
        const b = await asBrand([ids.brandB], (c) => counts(c, table, ids.brandB));
        expect(b).toMatchObject({ other: 0 });
        expect(b.own).toBeGreaterThan(0);
      },
    );

    it.each(BRAND_TABLES.filter((t) => t !== 'customer_address'))(
      '%s: no context sees nothing, a platform actor sees both brands',
      async (table) => {
        const none = await asNobody((c) => c.query(`SELECT count(*) AS n FROM ${table}`));
        expect(Number(none.rows[0].n)).toBe(0);
        const platform = await asPlatform((c) =>
          c.query(`SELECT count(DISTINCT brand_id) AS n FROM ${table}`),
        );
        expect(Number(platform.rows[0].n)).toBe(2);
      },
    );

    it('customer_address is isolated by brand too', async () => {
      await asOwner(async (c) => {
        for (const [f, s] of [
          [fa, A],
          [fb, B],
        ] as const) {
          await ins(c, 'customer_address', {
            id: uuidv7(),
            brand_id: f.brand,
            customer_id: s.customer,
            recipient_name: 'R',
            phone: '+971500000002',
            line1: '1 Road',
            area_id: ids.area,
            updated_at: new Date(),
          });
        }
      });
      const a = await asBrand([ids.brandA], (c) => counts(c, 'customer_address', ids.brandA));
      expect(a).toEqual({ own: 1, other: 0 });
      const none = await asNobody((c) => c.query('SELECT count(*) AS n FROM customer_address'));
      expect(Number(none.rows[0].n)).toBe(0);
    });

    it("a brand cannot insert, update or delete another brand's rows", async () => {
      await expect(
        asBrand([ids.brandA], (c) =>
          ins(c, 'order_counter', { brand_id: ids.brandB, prefix: 'XX' }),
        ),
      ).rejects.toMatchObject({ code: DENIED });
      const updated = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE coupon SET usage_limit = 9 WHERE id = $1`, [B.coupon]),
      );
      expect(updated.rowCount).toBe(0);
      const deleted = await asBrand([ids.brandA], (c) =>
        c.query(`DELETE FROM cart WHERE id = $1`, [B.cart]),
      );
      expect(deleted.rowCount).toBe(0);
      const own = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE coupon SET usage_limit = 90 WHERE id = $1`, [A.coupon]),
      );
      expect(own.rowCount).toBe(1);
    });
  });

  describe('composite keys reject cross-brand references', () => {
    it("an order cannot use another brand's market", () =>
      rejects(
        (c) => ins(c, 'customer_order', orderRow({ brand: ids.brandA, market: ids.marketB })),
        FK,
      ));
    it("a cart line cannot use another brand's product", () =>
      rejects(
        (c) =>
          ins(c, 'cart_line', {
            id: uuidv7(),
            brand_id: ids.brandA,
            cart_id: A.cart,
            product_id: B.simple,
            quantity: 1,
          }),
        FK,
      ));
    it("a cart cannot belong to another brand's customer", () =>
      rejects(
        (c) =>
          ins(c, 'cart', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            currency_code: 'AED',
            customer_id: B.customer,
            updated_at: new Date(),
          }),
        FK,
      ));
    it('an order must use a currency of its market', async () => {
      await asOwner((c) =>
        c.query(`INSERT INTO currency (code, name, symbol, minor_unit_digits)
        VALUES ('USD','US Dollar','$',2) ON CONFLICT DO NOTHING`),
      );
      await rejects((c) => ins(c, 'customer_order', orderRow(fa, { currency_code: 'USD' })), FK);
    });
    it("a payment cannot use another brand's config", () =>
      rejects(async (c) => {
        const order = uuidv7();
        await ins(c, 'customer_order', orderRow(fa, { id: order }));
        await ins(c, 'payment', {
          id: uuidv7(),
          brand_id: ids.brandA,
          order_id: order,
          provider: 'COD',
          config_id: B.config,
          config_version: 1,
          currency_code: 'AED',
          amount_minor: 950,
          updated_at: new Date(),
        });
      }, FK));
    it("a coupon cannot point at another brand's promotion", () =>
      rejects(
        (c) =>
          ins(c, 'coupon', {
            id: uuidv7(),
            brand_id: ids.brandA,
            promotion_id: B.promotion,
            code: 'STOLEN',
          }),
        FK,
      ));
    it("a promotion target cannot use another brand's category", () =>
      rejects(async (c) => {
        const promo = uuidv7();
        await ins(c, 'promotion', {
          id: promo,
          brand_id: ids.brandA,
          code: 'X-CAT',
          kind: 'FREE_DELIVERY',
          scope: 'CATEGORY',
          updated_at: new Date(),
        });
        await ins(c, 'promotion_target', {
          id: uuidv7(),
          brand_id: ids.brandA,
          promotion_id: promo,
          category_id: B.category,
        });
      }, FK));
  });

  describe('state machines', () => {
    it.each([
      ['order', ORDER_STATUSES, orderMachine],
      ['payment', PAYMENT_STATUSES, paymentMachine],
      ['fulfillment', FULFILLMENT_STATUSES, fulfillmentMachine],
      ['attempt', PAYMENT_ATTEMPT_STATUSES, paymentAttemptMachine],
      ['cart', CART_STATUSES, cartMachine],
    ] as const)(
      'the database %s machine allows exactly the transitions of the shared contract',
      async (name, states, machine) => {
        for (const from of states) {
          for (const to of states) {
            const { rows } = await owner.query('SELECT commerce_transition_ok($1, $2, $3) AS ok', [
              name,
              from,
              to,
            ]);
            expect({ from, to, ok: rows[0].ok }).toEqual({
              from,
              to,
              ok: (machine.can as (a: string, b: string) => boolean)(from, to),
            });
          }
        }
      },
    );

    it('starts every order as a draft, unpaid and unassigned', () =>
      rejects((c) => ins(c, 'customer_order', orderRow(fa, { status: 'CONFIRMED' })), CHECK));

    it('moves an order along the machine and refuses jumps', async () => {
      await inA(async (c) => {
        await expect(
          c
            .query(`SAVEPOINT s`)
            .then(() =>
              c.query(`UPDATE customer_order SET status = 'CONFIRMED' WHERE id = $1`, [A.order]),
            )
            .then(() => 'ok'),
        ).resolves.toBe('ok');
        await c.query(`ROLLBACK TO s`);
        await expect(
          c.query(`UPDATE customer_order SET status = 'COMPLETED' WHERE id = $1`, [A.order]),
        ).rejects.toMatchObject({ code: CHECK });
      });
    });

    it('records a history row for every status change, with the actor and reason', async () => {
      const id = uuidv7();
      const rows = await inA(async (c) => {
        await ins(c, 'customer_order', orderRow(fa, { id }));
        await ins(c, 'order_line', lineRow(fa, id));
        await c.query(`SELECT set_config('app.status_reason', 'customer paid', true)`);
        await c.query(
          `UPDATE customer_order SET status = 'PENDING_PAYMENT', payment_status = 'PENDING' WHERE id = $1`,
          [id],
        );
        return (
          await c.query(
            `SELECT dimension, from_status, to_status, reason FROM order_status_history
              WHERE order_id = $1 ORDER BY dimension, to_status`,
            [id],
          )
        ).rows;
      });
      expect(rows).toEqual([
        { dimension: 'ORDER', from_status: null, to_status: 'DRAFT', reason: null },
        {
          dimension: 'ORDER',
          from_status: 'DRAFT',
          to_status: 'PENDING_PAYMENT',
          reason: 'customer paid',
        },
        {
          dimension: 'PAYMENT',
          from_status: 'UNPAID',
          to_status: 'PENDING',
          reason: 'customer paid',
        },
      ]);
    });

    it('never deletes orders, payments or attempts', async () => {
      for (const [table, id] of [
        ['customer_order', A.order],
        ['payment', A.payment],
      ] as const) {
        await expect(
          inA((c) => c.query(`DELETE FROM ${table} WHERE id = $1`, [id])),
        ).rejects.toMatchObject({ code: DENIED });
      }
    });
  });

  describe('orders: totals, snapshots and numbers', () => {
    it('refuses a total that does not equal its parts and negative amounts', async () => {
      await rejects((c) => ins(c, 'customer_order', orderRow(fa, { total_minor: 951 })), CHECK);
      await rejects(
        (c) => ins(c, 'customer_order', orderRow(fa, { discount_minor: -1, total_minor: 1051 })),
        CHECK,
      );
      // Tax added on top when prices exclude tax.
      await inA((c) =>
        ins(c, 'customer_order', orderRow(fa, { tax_inclusive: false, total_minor: 993 })),
      );
    });

    it('needs a customer or a guest email and phone, and a well-formed number and key', async () => {
      await rejects(
        (c) => ins(c, 'customer_order', orderRow(fa, { guest_email: null, guest_phone: null })),
        CHECK,
      );
      await rejects((c) => ins(c, 'customer_order', orderRow(fa, { number: 'bad number' })), CHECK);
      await rejects(
        (c) => ins(c, 'customer_order', orderRow(fa, { idempotency_key: 'short' })),
        CHECK,
      );
    });

    it('keeps order numbers and idempotency keys unique per brand, not across brands', async () => {
      const row = orderRow(fa, { number: 'UQ-100001', idempotency_key: 'idempotency-key-0001' });
      await inA((c) => ins(c, 'customer_order', row));
      await rejects((c) => ins(c, 'customer_order', orderRow(fa, { number: 'UQ-100001' })), UNIQUE);
      await rejects(
        (c) => ins(c, 'customer_order', orderRow(fa, { idempotency_key: 'idempotency-key-0001' })),
        UNIQUE,
      );
      await asBrand([ids.brandB], (c) =>
        ins(
          c,
          'customer_order',
          orderRow(fb, { number: 'UQ-100001', idempotency_key: 'idempotency-key-0001' }),
        ),
      );
    });

    it('checks line arithmetic and zero-price gifts', async () => {
      const id = uuidv7();
      await inA((c) => ins(c, 'customer_order', orderRow(fa, { id })));
      await rejects(async (c) => {
        await ins(c, 'customer_order', orderRow(fa, { id: uuidv7() }));
        await ins(c, 'order_line', lineRow(fa, id, { total_minor: 999 }));
      }, CHECK);
      await rejects(
        (c) =>
          ins(c, 'order_line', lineRow(fa, id, { kind: 'GIFT', unit_minor: 5, total_minor: 5 })),
        CHECK,
      );
      await inA((c) =>
        ins(
          c,
          'order_line',
          lineRow(fa, id, { kind: 'GIFT', unit_minor: 0, total_minor: 0, position: 2 }),
        ),
      );
    });

    it('freezes an order once it leaves draft, except status, branch and payment choice', async () => {
      await rejects(
        (c) => c.query(`UPDATE customer_order SET total_minor = 1 WHERE id = $1`, [A.order]),
        CHECK,
      );
      await rejects(
        (c) =>
          c.query(`UPDATE customer_order SET delivery_address = '{}'::jsonb WHERE id = $1`, [
            A.order,
          ]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE customer_order SET contact_phone = '000' WHERE id = $1`, [A.order]),
        CHECK,
      );
      await inA((c) =>
        c.query(
          `UPDATE customer_order SET payment_method = 'cash', payment_provider = 'COD', payment_config_version = 1 WHERE id = $1`,
          [A.order],
        ),
      );
    });

    it('does not let an order move to another customer, but a guest order can be linked once', async () => {
      await rejects(
        (c) => c.query(`UPDATE customer_order SET customer_id = NULL WHERE id = $1`, [A.order]),
        CHECK,
      );
      const id = uuidv7();
      await inA(async (c) => {
        await ins(c, 'customer_order', orderRow(fa, { id }));
        await ins(c, 'order_line', lineRow(fa, id));
        await c.query(`UPDATE customer_order SET status = 'PENDING_PAYMENT' WHERE id = $1`, [id]);
        await c.query(`UPDATE customer_order SET customer_id = $2 WHERE id = $1`, [id, A.customer]);
      });
    });

    it('needs a line and a matching subtotal to leave draft', async () => {
      const bare = uuidv7();
      await inA((c) => ins(c, 'customer_order', orderRow(fa, { id: bare })));
      await rejects(
        (c) =>
          c.query(`UPDATE customer_order SET status = 'PENDING_PAYMENT' WHERE id = $1`, [bare]),
        CHECK,
      );
      const off = uuidv7();
      await inA(async (c) => {
        await ins(
          c,
          'customer_order',
          orderRow(fa, { id: off, subtotal_minor: 900, total_minor: 850 }),
        );
        await ins(c, 'order_line', lineRow(fa, off));
      });
      await rejects(
        (c) => c.query(`UPDATE customer_order SET status = 'PENDING_PAYMENT' WHERE id = $1`, [off]),
        CHECK,
      );
    });

    it('accepts lines and promotions only while the order is a draft', async () => {
      await rejects((c) => ins(c, 'order_line', lineRow(fa, A.order, { position: 9 })), CHECK);
      await rejects(
        (c) =>
          ins(c, 'order_promotion', {
            id: uuidv7(),
            brand_id: ids.brandA,
            order_id: A.order,
            name: '{}',
            kind: 'FREE_DELIVERY',
            amount_minor: 0,
          }),
        CHECK,
      );
    });

    it.each(APPEND_ONLY)('%s is append-only, even for the owner', async (table) => {
      await expect(
        asOwner((c) => c.query(`UPDATE ${table} SET brand_id = brand_id`)),
      ).rejects.toMatchObject({
        code: DENIED,
      });
      await expect(asOwner((c) => c.query(`DELETE FROM ${table}`))).rejects.toMatchObject({
        code: DENIED,
      });
    });

    it('validates order counters', async () => {
      await asOwner(async (c) => {
        await expect(
          c.query(`UPDATE order_counter SET prefix = 'bad prefix' WHERE brand_id = $1`, [
            ids.brandA,
          ]),
        ).rejects.toMatchObject({ code: CHECK });
      });
    });
  });

  describe('payments', () => {
    it('allows one active config per brand, market and provider, and versions beside it', async () => {
      await rejects(
        (c) =>
          ins(c, 'payment_config', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            provider: 'COD',
            version: 2,
            display_name: '{}',
            enabled_methods: [],
            cod_zone_ids: [],
          }),
        UNIQUE,
      );
      await inA((c) =>
        ins(c, 'payment_config', {
          id: uuidv7(),
          brand_id: ids.brandA,
          market_id: ids.marketA,
          provider: 'COD',
          version: 2,
          status: 'INACTIVE',
          display_name: '{}',
          enabled_methods: [],
          cod_zone_ids: [],
        }),
      );
    });

    it('stores credentials only as an encrypted envelope, only for the card gateway', async () => {
      const base = (over: Record<string, unknown>) => ({
        id: uuidv7(),
        brand_id: ids.brandA,
        market_id: ids.marketA,
        provider: 'CCAVENUE',
        version: 9,
        status: 'INACTIVE',
        display_name: '{}',
        enabled_methods: ['card'],
        cod_zone_ids: [],
        ...over,
      });
      await rejects((c) => ins(c, 'payment_config', base({ credentials_encrypted: null })), CHECK);
      await rejects(
        (c) =>
          ins(
            c,
            'payment_config',
            base({ credentials_encrypted: '{"merchant":"123","key":"secret"}' }),
          ),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'payment_config', base({ provider: 'COD', credentials_encrypted: 'v1.a.b.c' })),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(
            c,
            'payment_config',
            base({ credentials_encrypted: 'v1.a.b.c', credentials_last4: '12345' }),
          ),
        CHECK,
      );
    });

    it('limits cash-on-delivery settings to cash on delivery configs', async () => {
      await rejects(
        (c) =>
          ins(c, 'payment_config', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            provider: 'MANUAL',
            version: 1,
            status: 'INACTIVE',
            display_name: '{}',
            enabled_methods: [],
            cod_zone_ids: [],
            cod_max_order_minor: 500,
          }),
        CHECK,
      );
    });

    it('never edits a config version in place, only deactivates it, and never deletes one', async () => {
      await rejects(
        (c) =>
          c.query(`UPDATE payment_config SET credentials_last4 = '9999' WHERE id = $1`, [
            A.ccConfig,
          ]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE payment_config SET test_mode = false WHERE id = $1`, [A.ccConfig]),
        CHECK,
      );
      await inA((c) =>
        c.query(`UPDATE payment_config SET status = 'INACTIVE' WHERE id = $1`, [A.config]),
      );
      await inA((c) =>
        c.query(`UPDATE payment_config SET status = 'ACTIVE' WHERE id = $1`, [A.config]),
      );
      await expect(
        inA((c) => c.query(`DELETE FROM payment_config WHERE id = $1`, [A.ccConfig])),
      ).rejects.toMatchObject({ code: DENIED });
    });

    const newOrder = async (over: Record<string, unknown> = {}) => {
      const id = uuidv7();
      await inA(async (c) => {
        await ins(c, 'customer_order', orderRow(fa, { id, ...over }));
      });
      return id;
    };
    const paymentRow = (order: string, over: Record<string, unknown> = {}) => ({
      id: uuidv7(),
      brand_id: ids.brandA,
      order_id: order,
      provider: 'COD',
      config_id: A.config,
      config_version: 1,
      currency_code: 'AED',
      amount_minor: 950,
      updated_at: new Date(),
      ...over,
    });

    it('matches the order total and currency, and the config market, provider and version', async () => {
      const order = await newOrder();
      await rejects((c) => ins(c, 'payment', paymentRow(order, { amount_minor: 949 })), CHECK);
      await rejects((c) => ins(c, 'payment', paymentRow(order, { provider: 'MANUAL' })), CHECK);
      await rejects((c) => ins(c, 'payment', paymentRow(order, { config_version: 2 })), CHECK);
      await inA((c) => ins(c, 'payment', paymentRow(order)));
    });

    it('has one payment per order and keeps paid and refunded within the amount', async () => {
      await rejects((c) => ins(c, 'payment', paymentRow(A.order)), UNIQUE);
      await rejects(
        (c) => c.query(`UPDATE payment SET paid_minor = 951 WHERE id = $1`, [A.payment]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE payment SET refunded_minor = 1 WHERE id = $1`, [A.payment]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE payment SET amount_minor = 10 WHERE id = $1`, [A.payment]),
        CHECK,
      );
    });

    it('moves payment status only along the machine', async () => {
      await rejects(
        (c) => c.query(`UPDATE payment SET status = 'REFUNDED' WHERE id = $1`, [A.payment]),
        CHECK,
      );
      await inA(async (c) => {
        await c.query(`UPDATE payment SET status = 'PENDING' WHERE id = $1`, [A.payment]);
        await c.query(`UPDATE payment SET status = 'PAID', paid_minor = 950 WHERE id = $1`, [
          A.payment,
        ]);
        await c.query(
          `UPDATE payment SET status = 'PARTIALLY_REFUNDED', refunded_minor = 100 WHERE id = $1`,
          [A.payment],
        );
      });
      await rejects(
        (c) => c.query(`UPDATE payment SET status = 'PENDING' WHERE id = $1`, [A.payment]),
        CHECK,
      );
    });

    it('moves attempts forward only and keeps references and keys unique per brand', async () => {
      const att = await inA((c) =>
        c.query(`SELECT id, reference FROM payment_attempt WHERE payment_id = $1`, [A.payment]),
      );
      const id = att.rows[0].id as string;
      await inA((c) =>
        c.query(`UPDATE payment_attempt SET status = 'SUCCEEDED' WHERE id = $1`, [id]),
      );
      await rejects(
        (c) => c.query(`UPDATE payment_attempt SET status = 'FAILED' WHERE id = $1`, [id]),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'payment_attempt', {
            id: uuidv7(),
            brand_id: ids.brandA,
            payment_id: A.payment,
            reference: att.rows[0].reference,
            amount_minor: 1,
            currency_code: 'AED',
            idempotency_key: `other-${uuidv7()}`,
            expires_at: new Date(Date.now() + 60_000),
          }),
        UNIQUE,
      );
      await rejects(
        (c) =>
          ins(c, 'payment_attempt', {
            id: uuidv7(),
            brand_id: ids.brandA,
            payment_id: A.payment,
            reference: `R-${uuidv7()}`,
            amount_minor: 1,
            currency_code: 'AED',
            idempotency_key: `other-${uuidv7()}`,
            expires_at: new Date(Date.now() - 60_000),
          }),
        CHECK,
      );
    });

    it('applies a repeated provider callback only once, even concurrently', async () => {
      const key = `cb-${uuidv7()}`;
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          inA((c) =>
            c.query(
              `INSERT INTO payment_event (id, brand_id, payment_id, provider, event_key, kind, accepted)
               VALUES ($1, $2, $3, 'CCAVENUE', $4, 'callback', true) ON CONFLICT DO NOTHING`,
              [uuidv7(), ids.brandA, A.payment, key],
            ),
          ),
        ),
      );
      expect(results.reduce((n, r) => n + (r.rowCount ?? 0), 0)).toBe(1);
    });
  });

  describe('carts', () => {
    const cartRow = (over: Record<string, unknown> = {}) => ({
      id: uuidv7(),
      brand_id: ids.brandA,
      market_id: ids.marketA,
      currency_code: 'AED',
      guest_token_hash: `hash-${uuidv7()}`,
      updated_at: new Date(),
      ...over,
    });

    it('belongs to exactly one of a customer or a guest token', async () => {
      await rejects((c) => ins(c, 'cart', cartRow({ guest_token_hash: null })), CHECK);
      await rejects((c) => ins(c, 'cart', cartRow({ customer_id: A.customer })), CHECK);
    });

    it('has one open cart per customer, but allows old carts beside it', async () => {
      await rejects(
        (c) => ins(c, 'cart', cartRow({ customer_id: A.customer, guest_token_hash: null })),
        UNIQUE,
      );
      await inA((c) =>
        ins(
          c,
          'cart',
          cartRow({ customer_id: A.customer, guest_token_hash: null, status: 'ABANDONED' }),
        ),
      );
    });

    it('keeps guest token hashes unique and coupon codes well formed', async () => {
      const row = cartRow({ guest_token_hash: 'same-hash' });
      await inA((c) => ins(c, 'cart', row));
      await rejects((c) => ins(c, 'cart', cartRow({ guest_token_hash: 'same-hash' })), UNIQUE);
      await rejects((c) => ins(c, 'cart', cartRow({ coupon_code: 'lower case' })), CHECK);
    });

    it('moves cart status along the machine: converted and merged are final', async () => {
      const id = uuidv7();
      await inA(async (c) => {
        await ins(c, 'cart', cartRow({ id }));
        await c.query(`UPDATE cart SET status = 'ABANDONED' WHERE id = $1`, [id]);
        await c.query(`UPDATE cart SET status = 'OPEN' WHERE id = $1`, [id]);
        await c.query(`UPDATE cart SET status = 'CONVERTED' WHERE id = $1`, [id]);
      });
      await rejects((c) => c.query(`UPDATE cart SET status = 'OPEN' WHERE id = $1`, [id]), CHECK);
    });

    it('limits quantity, text and lines per cart', async () => {
      const cart = uuidv7();
      await inA((c) => ins(c, 'cart', cartRow({ id: cart })));
      const line = (over: Record<string, unknown> = {}) => ({
        id: uuidv7(),
        brand_id: ids.brandA,
        cart_id: cart,
        product_id: A.simple,
        quantity: 1,
        ...over,
      });
      await rejects((c) => ins(c, 'cart_line', line({ quantity: 0 })), CHECK);
      await rejects((c) => ins(c, 'cart_line', line({ quantity: 100 })), CHECK);
      await inA(async (c) => {
        for (let i = 0; i < 50; i++) await ins(c, 'cart_line', line());
      });
      await rejects((c) => ins(c, 'cart_line', line()), CHECK);
    });

    it('stocks variable products by variation and nothing else', async () => {
      const cart = uuidv7();
      await inA((c) => ins(c, 'cart', cartRow({ id: cart })));
      const line = (over: Record<string, unknown>) => ({
        id: uuidv7(),
        brand_id: ids.brandA,
        cart_id: cart,
        quantity: 1,
        ...over,
      });
      await rejects((c) => ins(c, 'cart_line', line({ product_id: A.variable })), CHECK);
      await rejects(
        (c) => ins(c, 'cart_line', line({ product_id: A.simple, variation_id: A.variation })),
        CHECK,
      );
      await inA((c) =>
        ins(c, 'cart_line', line({ product_id: A.variable, variation_id: A.variation })),
      );
    });

    it('refuses options, add-ons and bundle choices that belong to another product', async () => {
      const cart = uuidv7();
      const otherLine = uuidv7();
      await inA(async (c) => {
        await ins(c, 'cart', cartRow({ id: cart }));
        await ins(c, 'cart_line', {
          id: otherLine,
          brand_id: ids.brandA,
          cart_id: cart,
          product_id: A.variable,
          variation_id: A.variation,
          quantity: 1,
        });
      });
      await rejects(
        (c) =>
          ins(c, 'cart_line_option', {
            id: uuidv7(),
            brand_id: ids.brandA,
            line_id: otherLine,
            option_group_id: A.optionGroup,
            choice_id: A.choice,
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'cart_line_addon', {
            line_id: otherLine,
            brand_id: ids.brandA,
            addon_item_id: A.addonItem,
            quantity: 1,
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'cart_line_bundle_choice', {
            line_id: otherLine,
            brand_id: ids.brandA,
            bundle_item_id: A.bundleItem,
          }),
        CHECK,
      );
    });

    it('needs an option choice or text', () =>
      rejects(
        (c) =>
          ins(c, 'cart_line_option', {
            id: uuidv7(),
            brand_id: ids.brandA,
            line_id: A.line,
            option_group_id: A.optionGroup,
          }),
        CHECK,
      ));
  });

  describe('promotions and coupons', () => {
    const promo = (over: Record<string, unknown> = {}) => ({
      id: uuidv7(),
      brand_id: ids.brandA,
      code: `P-${uuidv7().slice(-12)}`,
      kind: 'PERCENT_OFF',
      percent_bps: 500,
      updated_at: new Date(),
      ...over,
    });

    it('needs the value that matches its kind and no other', async () => {
      await rejects((c) => ins(c, 'promotion', promo({ percent_bps: null })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ percent_bps: 10001 })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ percent_bps: 0 })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ fixed_minor: 5 })), CHECK);
      await rejects(
        (c) =>
          ins(c, 'promotion', promo({ kind: 'FIXED_OFF', percent_bps: null, fixed_minor: 100 })),
        CHECK,
      );
      await rejects(
        (c) => ins(c, 'promotion', promo({ kind: 'FREE_GIFT', percent_bps: null })),
        CHECK,
      );
      await rejects((c) => ins(c, 'promotion', promo({ kind: 'FREE_DELIVERY' })), CHECK);
      await inA(async (c) => {
        await ins(c, 'promotion', promo({ kind: 'FREE_DELIVERY', percent_bps: null }));
        await ins(
          c,
          'promotion',
          promo({ kind: 'FREE_GIFT', percent_bps: null, gift_product_id: A.simple }),
        );
        await ins(
          c,
          'promotion',
          promo({ kind: 'FIXED_OFF', percent_bps: null, fixed_minor: 100, currency_code: 'AED' }),
        );
      });
    });

    it('validates caps, schedule, limits and priority', async () => {
      await rejects((c) => ins(c, 'promotion', promo({ max_discount_minor: 0 })), CHECK);
      await rejects(
        (c) =>
          ins(
            c,
            'promotion',
            promo({ kind: 'FREE_DELIVERY', percent_bps: null, max_discount_minor: 5 }),
          ),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(
            c,
            'promotion',
            promo({ starts_at: new Date('2026-12-02'), ends_at: new Date('2026-12-01') }),
          ),
        CHECK,
      );
      await rejects((c) => ins(c, 'promotion', promo({ usage_limit: 0 })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ usage_limit: 5, used_count: 6 })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ priority: -1 })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ min_subtotal_minor: -1 })), CHECK);
      await rejects((c) => ins(c, 'promotion', promo({ code: A.promotion && 'WELCOME' })), UNIQUE);
    });

    it('needs targets that match its scope, checked at commit', async () => {
      await rejects((c) => ins(c, 'promotion', promo({ scope: 'CATEGORY' })), CHECK);
      const order = promo();
      await inA(async (c) => {
        await ins(c, 'promotion', order);
        await expect(
          ins(c, 'promotion_target', {
            id: uuidv7(),
            brand_id: ids.brandA,
            promotion_id: order.id,
            category_id: A.category,
          }),
        ).rejects.toMatchObject({ code: CHECK });
      });
      const prod = promo({ scope: 'PRODUCT' });
      await inA(async (c) => {
        await ins(c, 'promotion', prod);
        await expect(
          ins(c, 'promotion_target', {
            id: uuidv7(),
            brand_id: ids.brandA,
            promotion_id: prod.id,
            category_id: A.category,
          }),
        ).rejects.toMatchObject({ code: CHECK });
      });
      await inA(async (c) => {
        const p2 = promo({ scope: 'PRODUCT' });
        await ins(c, 'promotion', p2);
        await ins(c, 'promotion_target', {
          id: uuidv7(),
          brand_id: ids.brandA,
          promotion_id: p2.id,
          product_id: A.simple,
        });
      });
    });

    it('keeps coupon codes upper-case and unique per brand', async () => {
      await rejects(
        (c) =>
          ins(c, 'coupon', {
            id: uuidv7(),
            brand_id: ids.brandA,
            promotion_id: A.promotion,
            code: 'lower',
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'coupon', {
            id: uuidv7(),
            brand_id: ids.brandA,
            promotion_id: A.promotion,
            code: 'WELCOME-A',
          }),
        UNIQUE,
      );
      await asBrand([ids.brandB], (c) =>
        ins(c, 'coupon', {
          id: uuidv7(),
          brand_id: ids.brandB,
          promotion_id: B.promotion,
          code: 'SAME-CODE',
        }),
      );
      await inA((c) =>
        ins(c, 'coupon', {
          id: uuidv7(),
          brand_id: ids.brandA,
          promotion_id: A.promotion,
          code: 'SAME-CODE',
        }),
      );
    });

    it('counts a promotion once per order', () =>
      rejects(
        (c) =>
          ins(c, 'promotion_usage', {
            id: uuidv7(),
            brand_id: ids.brandA,
            promotion_id: A.promotion,
            order_id: A.order,
            amount_minor: 1,
          }),
        UNIQUE,
      ));

    it('lets only as many concurrent orders use a coupon as its limit allows', async () => {
      const coupon = uuidv7();
      await inA((c) =>
        ins(c, 'coupon', {
          id: coupon,
          brand_id: ids.brandA,
          promotion_id: A.promotion,
          code: 'LASTFIVE',
          usage_limit: 5,
        }),
      );
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          inA((c) =>
            c.query(
              `UPDATE coupon SET used_count = used_count + 1
                WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit) RETURNING id`,
              [coupon],
            ),
          ),
        ),
      );
      expect(results.filter((r) => r.rowCount === 1)).toHaveLength(5);
      await rejects(
        (c) => c.query(`UPDATE coupon SET used_count = used_count + 1 WHERE id = $1`, [coupon]),
        CHECK,
      );
    });
  });

  describe('order numbers and saved addresses', () => {
    it('hands out unique, increasing order numbers to concurrent orders', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, () =>
          inA((c) =>
            c.query(
              `UPDATE order_counter SET next_value = next_value + 1 WHERE brand_id = $1 RETURNING next_value - 1 AS n`,
              [ids.brandA],
            ),
          ),
        ),
      );
      const numbers = results.map((r) => Number(r.rows[0].n));
      expect(new Set(numbers).size).toBe(30);
      expect(Math.max(...numbers) - Math.min(...numbers)).toBe(29);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(100000);
    });

    it('has at most one default address per customer', async () => {
      const row = (isDefault: boolean) => ({
        id: uuidv7(),
        brand_id: ids.brandA,
        customer_id: A.customer,
        recipient_name: 'R',
        phone: '+971500000003',
        line1: '2 Road',
        area_id: ids.area,
        is_default: isDefault,
        updated_at: new Date(),
      });
      await inA((c) => ins(c, 'customer_address', row(true)));
      await rejects((c) => ins(c, 'customer_address', row(true)), UNIQUE);
      await inA((c) => ins(c, 'customer_address', row(false)));
    });
  });
});
