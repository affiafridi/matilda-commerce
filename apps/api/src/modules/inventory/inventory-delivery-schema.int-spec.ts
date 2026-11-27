import type { Pool, PoolClient } from 'pg';
import {
  ASSIGNMENT_RULE_KINDS,
  DELIVERY_AREA_LEVELS,
  DELIVERY_METHOD_KINDS,
  OUT_OF_STOCK_BEHAVIORS,
  RESERVATION_STATUSES,
  RESTRICTION_CONDITIONS,
  RESTRICTION_TARGETS,
  STOCK_MOVEMENT_TYPES,
  TRANSFER_STATUSES,
} from '@matilda/validation';
import { uuidv7 } from '../../common/ids/uuid7';
import { createPool, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

/**
 * Inventory and delivery schema (Phase 4 step 4.2, docs/PHASE-4-SCHEMA-DRAFT.md): row-level security
 * on every brand-keyed table, brand isolation, composite keys, checks, triggers and the ledger.
 * Database-backed.
 */

const BRAND_TABLES = [
  'delivery_zone',
  'delivery_zone_translation',
  'delivery_zone_area',
  'branch_zone',
  'delivery_method',
  'delivery_method_translation',
  'zone_charge',
  'branch_hours',
  'delivery_closure',
  'delivery_slot',
  'delivery_restriction',
  'branch_assignment_rule',
  'inventory_setting',
  'stock_level',
  'stock_movement',
  'stock_reservation',
  'stock_reservation_line',
  'slot_day',
  'slot_reservation',
  'stock_transfer',
  'stock_transfer_line',
];
const GLOBAL_TABLES = ['delivery_area', 'delivery_area_translation'];

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
  branch1: string;
  branch2: string;
  tag: string;
}

interface Seeded {
  simple: string;
  variable: string;
  bundle: string;
  variation: string;
  zone: string;
  method: string;
  slot: string;
  stock: string;
  stock2: string;
  reservation: string;
  transfer: string;
}

/** One row in every brand-keyed table for a brand, built through the real constraints. */
async function seedBrand(c: PoolClient, f: BrandFixture, area: string): Promise<Seeded> {
  const now = new Date();
  const brand_id = f.brand;
  const s: Seeded = {
    simple: uuidv7(),
    variable: uuidv7(),
    bundle: uuidv7(),
    variation: uuidv7(),
    zone: uuidv7(),
    method: uuidv7(),
    slot: uuidv7(),
    stock: uuidv7(),
    stock2: uuidv7(),
    reservation: uuidv7(),
    transfer: uuidv7(),
  };
  const T = f.tag.toUpperCase();
  const product = (id: string, type: string, sku: string | null) =>
    ins(c, 'product', { id, brand_id, type, sku, updated_at: now });
  await product(s.simple, 'SIMPLE', `S-${T}-1`);
  await product(s.variable, 'VARIABLE', null);
  await product(s.bundle, 'BUNDLE', `B-${T}-1`);
  await ins(c, 'variation', {
    id: s.variation,
    brand_id,
    product_id: s.variable,
    sku: `V-${T}-1`,
    combination_key: 'size=1kg',
    updated_at: now,
  });

  await ins(c, 'delivery_zone', { id: s.zone, brand_id, market_id: f.market, code: 'central' });
  await ins(c, 'delivery_zone_translation', {
    zone_id: s.zone,
    brand_id,
    language: 'en',
    name: 'Central',
  });
  await ins(c, 'delivery_zone_area', {
    zone_id: s.zone,
    brand_id,
    market_id: f.market,
    area_id: area,
  });
  await ins(c, 'branch_zone', { brand_id, branch_id: f.branch1, zone_id: s.zone, priority: 0 });
  await ins(c, 'delivery_method', {
    id: s.method,
    brand_id,
    market_id: f.market,
    kind: 'SAME_DAY',
    code: 'same-day',
  });
  await ins(c, 'delivery_method_translation', {
    method_id: s.method,
    brand_id,
    language: 'en',
    name: 'Same day',
  });
  await ins(c, 'zone_charge', {
    id: uuidv7(),
    brand_id,
    market_id: f.market,
    zone_id: s.zone,
    method_id: s.method,
    currency_code: 'AED',
    fee_minor: 2500,
  });
  await ins(c, 'branch_hours', {
    id: uuidv7(),
    brand_id,
    branch_id: f.branch1,
    weekday: 1,
    start_time: '09:00',
    end_time: '13:00',
  });
  await ins(c, 'delivery_closure', {
    id: uuidv7(),
    brand_id,
    branch_id: f.branch1,
    closed_on: '2026-12-02',
  });
  await ins(c, 'delivery_slot', {
    id: s.slot,
    brand_id,
    market_id: f.market,
    branch_id: f.branch1,
    zone_id: s.zone,
    weekday: 1,
    start_time: '14:00',
    end_time: '16:00',
    capacity: 5,
    cutoff_time: '12:00',
    methods: '{SAME_DAY}',
  });
  await ins(c, 'delivery_restriction', {
    id: uuidv7(),
    brand_id,
    market_id: f.market,
    target: 'PRODUCT',
    product_id: s.simple,
    condition: 'AREA',
    area_id: area,
  });
  await ins(c, 'branch_assignment_rule', {
    id: uuidv7(),
    brand_id,
    market_id: f.market,
    kind: 'COVERS_AREA',
    position: 0,
  });
  await ins(c, 'inventory_setting', { brand_id });
  await ins(c, 'stock_level', {
    id: s.stock,
    brand_id,
    branch_id: f.branch1,
    product_id: s.simple,
    on_hand: 10,
    reserved: 2,
    updated_at: now,
  });
  await ins(c, 'stock_level', {
    id: s.stock2,
    brand_id,
    branch_id: f.branch1,
    product_id: s.variable,
    variation_id: s.variation,
    on_hand: 4,
    updated_at: now,
  });
  await ins(c, 'stock_movement', {
    id: uuidv7(),
    brand_id,
    stock_level_id: s.stock,
    type: 'RECEIPT',
    quantity: 10,
    on_hand_after: 10,
    reserved_after: 0,
  });
  await ins(c, 'stock_reservation', {
    id: s.reservation,
    brand_id,
    market_id: f.market,
    checkout_ref: `chk-${f.tag}`,
    expires_at: new Date(Date.now() + 900_000),
  });
  await ins(c, 'stock_reservation_line', {
    reservation_id: s.reservation,
    brand_id,
    stock_level_id: s.stock,
    quantity: 2,
  });
  await ins(c, 'slot_day', { brand_id, slot_id: s.slot, delivery_date: '2026-12-07', booked: 1 });
  await ins(c, 'slot_reservation', {
    id: uuidv7(),
    brand_id,
    slot_id: s.slot,
    delivery_date: '2026-12-07',
    checkout_ref: `chk-${f.tag}`,
    expires_at: new Date(Date.now() + 900_000),
  });
  await ins(c, 'stock_transfer', {
    id: s.transfer,
    brand_id,
    from_branch_id: f.branch1,
    to_branch_id: f.branch2,
    updated_at: now,
  });
  await ins(c, 'stock_transfer_line', {
    id: uuidv7(),
    transfer_id: s.transfer,
    brand_id,
    product_id: s.simple,
    quantity_requested: 3,
  });
  return s;
}

describe('inventory and delivery schema (step 4.2)', () => {
  let owner: Pool;
  let app: Pool;

  const ids = {
    ae: uuidv7(),
    brandA: uuidv7(),
    brandB: uuidv7(),
    marketA: uuidv7(),
    marketB: uuidv7(),
    a1: uuidv7(),
    a2: uuidv7(),
    b1: uuidv7(),
    b2: uuidv7(),
    stray: uuidv7(),
    emirate: uuidv7(),
    city: uuidv7(),
    area: uuidv7(),
  };
  let A: Seeded;
  let B: Seeded;

  const asOwner = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(owner, { platform: true }, fn);
  const asPlatform = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(app, { platform: true }, fn);
  const asBrand = <T>(brandIds: string[], fn: (c: PoolClient) => Promise<T>) =>
    inTx(app, { brandIds }, fn);
  const asNobody = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(app, {}, fn);
  const rejects = (fn: (c: PoolClient) => Promise<unknown>, code: string) =>
    expect(asOwner(fn)).rejects.toMatchObject({ code });

  const CHECK = '23514';
  const FK = '23503';
  const UNIQUE = '23505';
  const EXCLUDE = '23P01';

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
          ($1,'inv-a','Inventory A','ACTIVE', now()), ($2,'inv-b','Inventory B','ACTIVE', now())`,
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
      await c.query(
        `INSERT INTO branch (id, code, name, country_id, timezone, updated_at) VALUES
          ($1,'inv-a1','A1',$5,'Asia/Dubai', now()), ($2,'inv-a2','A2',$5,'Asia/Dubai', now()),
          ($3,'inv-b1','B1',$5,'Asia/Dubai', now()), ($4,'inv-b2','B2',$5,'Asia/Dubai', now()),
          ($6,'inv-stray','Stray',$5,'Asia/Dubai', now())`,
        [ids.a1, ids.a2, ids.b1, ids.b2, ids.ae, ids.stray],
      );
      // The stray branch serves nobody: it is linked to no market.
      await c.query(
        `INSERT INTO branch_market (branch_id, market_id, country_id) VALUES
          ($1,$5,$7), ($2,$5,$7), ($3,$6,$7), ($4,$6,$7)`,
        [ids.a1, ids.a2, ids.b1, ids.b2, ids.marketA, ids.marketB, ids.ae],
      );
      await ins(c, 'delivery_area', {
        id: ids.emirate,
        country_id: ids.ae,
        level: 'EMIRATE',
        code: 'dubai',
      });
      await ins(c, 'delivery_area', {
        id: ids.city,
        country_id: ids.ae,
        parent_id: ids.emirate,
        level: 'CITY',
        code: 'dubai-city',
      });
      await ins(c, 'delivery_area', {
        id: ids.area,
        country_id: ids.ae,
        parent_id: ids.city,
        level: 'AREA',
        code: 'jumeirah',
      });
      await ins(c, 'delivery_area_translation', {
        area_id: ids.area,
        language: 'en',
        name: 'Jumeirah',
      });
      A = await seedBrand(
        c,
        { brand: ids.brandA, market: ids.marketA, branch1: ids.a1, branch2: ids.a2, tag: 'a' },
        ids.area,
      );
      B = await seedBrand(
        c,
        { brand: ids.brandB, market: ids.marketB, branch1: ids.b1, branch2: ids.b2, tag: 'b' },
        ids.area,
      );
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
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = c.relname || '_scope') AS scope_policies,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
                EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name = 'brand_id') AS has_brand
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)`,
        [BRAND_TABLES],
      );
      expect(BRAND_TABLES).toHaveLength(21);
      expect(rows).toHaveLength(21);
      for (const r of rows) {
        expect({
          t: r.relname,
          rls: r.rls,
          forced: r.forced,
          p: Number(r.policies),
          s: Number(r.scope_policies),
          b: r.has_brand,
        }).toEqual({ t: r.relname, rls: true, forced: true, p: 1, s: 1, b: true });
      }
    });

    it('keeps the two location tables global (no brand column, no row-level security)', async () => {
      const { rows } = await owner.query(
        `SELECT c.relname, c.relrowsecurity AS rls,
                EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name = 'brand_id') AS has_brand
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)`,
        [GLOBAL_TABLES],
      );
      expect(rows).toHaveLength(2);
      for (const r of rows)
        expect({ t: r.relname, rls: r.rls, b: r.has_brand }).toEqual({
          t: r.relname,
          rls: false,
          b: false,
        });
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
        [[...BRAND_TABLES, ...GLOBAL_TABLES]],
      );
      expect(rows).toEqual([]);
    });

    it('does not let the runtime role truncate, alter or change the ledger', async () => {
      const { rows } = await owner.query(
        `SELECT t AS tbl, has_table_privilege('matilda_app', t, 'TRUNCATE') AS can_truncate,
                has_table_privilege('matilda_app', t, 'TRIGGER') AS can_trigger
           FROM unnest($1::text[]) AS t`,
        [[...BRAND_TABLES, ...GLOBAL_TABLES]],
      );
      for (const r of rows) {
        expect({ t: r.tbl, truncate: r.can_truncate, trigger: r.can_trigger }).toEqual({
          t: r.tbl,
          truncate: false,
          trigger: false,
        });
      }
      const ledger = await owner.query(
        `SELECT has_table_privilege('matilda_app','stock_movement','UPDATE') AS u,
                has_table_privilege('matilda_app','stock_movement','DELETE') AS d,
                has_table_privilege('matilda_app','stock_movement','INSERT') AS i`,
      );
      expect(ledger.rows[0]).toEqual({ u: false, d: false, i: true });
    });

    it('uses the same enum values as the shared contracts', async () => {
      const labels = async (type: string) =>
        (
          await owner.query(
            `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder`,
            [type],
          )
        ).rows.map((r) => r.enumlabel);
      expect(await labels('DeliveryAreaLevel')).toEqual([...DELIVERY_AREA_LEVELS]);
      expect(await labels('DeliveryMethodKind')).toEqual([...DELIVERY_METHOD_KINDS]);
      expect(await labels('RestrictionTarget')).toEqual([...RESTRICTION_TARGETS]);
      expect(await labels('RestrictionCondition')).toEqual([...RESTRICTION_CONDITIONS]);
      expect(await labels('AssignmentRuleKind')).toEqual([...ASSIGNMENT_RULE_KINDS]);
      expect(await labels('StockMovementType')).toEqual([...STOCK_MOVEMENT_TYPES]);
      expect(await labels('OutOfStockBehavior')).toEqual([...OUT_OF_STOCK_BEHAVIORS]);
      expect(await labels('ReservationStatus')).toEqual([...RESERVATION_STATUSES]);
      expect(await labels('TransferStatus')).toEqual([...TRANSFER_STATUSES]);
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

    it.each(BRAND_TABLES)('%s: a brand sees only its own rows', async (table) => {
      const a = await asBrand([ids.brandA], (c) => counts(c, table, ids.brandA));
      expect(a).toMatchObject({ other: 0 });
      expect(a.own).toBeGreaterThan(0);
      const b = await asBrand([ids.brandB], (c) => counts(c, table, ids.brandB));
      expect(b).toMatchObject({ other: 0 });
      expect(b.own).toBeGreaterThan(0);
    });

    it.each(BRAND_TABLES)(
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

    it("a brand cannot insert, update or delete another brand's rows", async () => {
      await expect(
        asBrand([ids.brandA], (c) =>
          ins(c, 'branch_assignment_rule', {
            id: uuidv7(),
            brand_id: ids.brandB,
            market_id: ids.marketB,
            kind: 'PRIORITY',
            position: 5,
          }),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const updated = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE stock_level SET low_stock_threshold = 9 WHERE id = $1`, [B.stock]),
      );
      expect(updated.rowCount).toBe(0);
      const deleted = await asBrand([ids.brandA], (c) =>
        c.query(`DELETE FROM delivery_slot WHERE id = $1`, [B.slot]),
      );
      expect(deleted.rowCount).toBe(0);
      const own = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE stock_level SET low_stock_threshold = 3 WHERE id = $1`, [A.stock]),
      );
      expect(own.rowCount).toBe(1);
    });
  });

  describe('composite keys reject cross-brand references', () => {
    it("a zone cannot use another brand's market", () =>
      rejects(
        (c) =>
          ins(c, 'delivery_zone', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketB,
            code: 'x',
          }),
        FK,
      ));

    it("a charge cannot join brand A's zone with brand B's method", () =>
      rejects(
        (c) =>
          ins(c, 'zone_charge', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            zone_id: A.zone,
            method_id: B.method,
            currency_code: 'AED',
            fee_minor: 1,
          }),
        FK,
      ));

    it("stock cannot be attached to another brand's product", () =>
      rejects(
        (c) =>
          ins(c, 'stock_level', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a2,
            product_id: B.simple,
            updated_at: new Date(),
          }),
        FK,
      ));

    it("a reservation line cannot use another brand's stock row", () =>
      rejects(
        (c) =>
          ins(c, 'stock_reservation_line', {
            reservation_id: A.reservation,
            brand_id: ids.brandA,
            stock_level_id: B.stock,
            quantity: 1,
          }),
        FK,
      ));

    it("a slot day cannot count against another brand's slot", () =>
      rejects(
        (c) =>
          ins(c, 'slot_day', {
            brand_id: ids.brandA,
            slot_id: B.slot,
            delivery_date: '2026-12-08',
          }),
        FK,
      ));

    it('a restriction needs a product of its own brand', () =>
      rejects(
        (c) =>
          ins(c, 'delivery_restriction', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            target: 'PRODUCT',
            product_id: B.simple,
            condition: 'AREA',
            area_id: ids.area,
          }),
        FK,
      ));

    it('a charge must use a currency of its market', () =>
      rejects(
        (c) =>
          c
            .query(
              `INSERT INTO currency (code, name, symbol, minor_unit_digits) VALUES ('USD','US Dollar','$',2) ON CONFLICT DO NOTHING`,
            )
            .then(() =>
              ins(c, 'zone_charge', {
                id: uuidv7(),
                brand_id: ids.brandA,
                market_id: ids.marketA,
                zone_id: A.zone,
                method_id: A.method,
                currency_code: 'USD',
                fee_minor: 1,
              }),
            ),
        FK,
      ));

    it('a variation stock row must use the variation of its own product', async () => {
      const other = uuidv7();
      await rejects(async (c) => {
        await ins(c, 'product', {
          id: other,
          brand_id: ids.brandA,
          type: 'VARIABLE',
          updated_at: new Date(),
        });
        await ins(c, 'stock_level', {
          id: uuidv7(),
          brand_id: ids.brandA,
          branch_id: ids.a2,
          product_id: other,
          variation_id: A.variation,
          updated_at: new Date(),
        });
      }, FK);
    });
  });

  describe('branches must serve the brand', () => {
    it('refuses rows that name a branch with no market of the brand', async () => {
      const bad = (table: string, row: Record<string, unknown>) =>
        rejects((c) => ins(c, table, row), CHECK);
      await bad('branch_hours', {
        id: uuidv7(),
        brand_id: ids.brandA,
        branch_id: ids.stray,
        weekday: 2,
        start_time: '09:00',
        end_time: '10:00',
      });
      await bad('stock_level', {
        id: uuidv7(),
        brand_id: ids.brandA,
        branch_id: ids.stray,
        product_id: A.simple,
        updated_at: new Date(),
      });
      await bad('stock_level', {
        id: uuidv7(),
        brand_id: ids.brandA,
        branch_id: ids.b1,
        product_id: A.simple,
        updated_at: new Date(),
      });
      await bad('stock_transfer', {
        id: uuidv7(),
        brand_id: ids.brandA,
        from_branch_id: ids.a1,
        to_branch_id: ids.stray,
        updated_at: new Date(),
      });
      await bad('delivery_closure', {
        id: uuidv7(),
        brand_id: ids.brandA,
        branch_id: ids.stray,
        closed_on: '2026-12-25',
      });
    });

    it('refuses a branch zone or slot outside the markets the branch is linked to', async () => {
      await rejects(
        (c) =>
          ins(c, 'branch_zone', { brand_id: ids.brandA, branch_id: ids.stray, zone_id: A.zone }),
        CHECK,
      );
      // Branch b1 serves brand B only; brand A's zone and slot cannot use it.
      await rejects(
        (c) => ins(c, 'branch_zone', { brand_id: ids.brandA, branch_id: ids.b1, zone_id: A.zone }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'delivery_slot', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            branch_id: ids.b1,
            weekday: 1,
            start_time: '10:00',
            end_time: '11:00',
            capacity: 1,
            cutoff_time: '08:00',
            methods: '{NEXT_DAY}',
          }),
        CHECK,
      );
    });

    it('allows a second branch of the brand', async () => {
      await asOwner((c) =>
        ins(c, 'branch_zone', {
          brand_id: ids.brandA,
          branch_id: ids.a2,
          zone_id: A.zone,
          priority: 1,
        }),
      );
      await asOwner((c) => c.query('DELETE FROM branch_zone WHERE branch_id = $1', [ids.a2]));
    });
  });

  describe('locations', () => {
    it('keeps the tree in order: emirate, city, area, same country, no cycles', async () => {
      await rejects(
        (c) =>
          ins(c, 'delivery_area', {
            id: uuidv7(),
            country_id: ids.ae,
            level: 'CITY',
            code: 'orphan',
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'delivery_area', {
            id: uuidv7(),
            country_id: ids.ae,
            parent_id: ids.area,
            level: 'AREA',
            code: 'under-area',
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'delivery_area', {
            id: uuidv7(),
            country_id: ids.ae,
            parent_id: ids.emirate,
            level: 'EMIRATE',
            code: 'second-top',
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          c.query(`UPDATE delivery_area SET parent_id = $1, level = 'AREA' WHERE id = $2`, [
            ids.area,
            ids.emirate,
          ]),
        CHECK,
      );
      // An area may sit directly under an emirate.
      await asOwner(async (c) => {
        await ins(c, 'delivery_area', {
          id: uuidv7(),
          country_id: ids.ae,
          parent_id: ids.emirate,
          level: 'AREA',
          code: 'direct-area',
        });
        await c.query(`DELETE FROM delivery_area WHERE code = 'direct-area'`);
      });
    });

    it('refuses a parent from another country and duplicate codes', async () => {
      await rejects(async (c) => {
        const other = uuidv7();
        await c.query(
          `INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'QQ','QQQ','Elsewhere')`,
          [other],
        );
        await ins(c, 'delivery_area', {
          id: uuidv7(),
          country_id: other,
          parent_id: ids.emirate,
          level: 'CITY',
          code: 'cross-country',
        });
      }, FK);
      await rejects(
        (c) =>
          ins(c, 'delivery_area', {
            id: uuidv7(),
            country_id: ids.ae,
            parent_id: ids.emirate,
            level: 'CITY',
            code: 'dubai-city',
          }),
        UNIQUE,
      );
    });

    it('a zone covers an area once per market and only areas of the market country', async () => {
      await rejects(
        (c) =>
          ins(c, 'delivery_zone_area', {
            zone_id: A.zone,
            brand_id: ids.brandA,
            market_id: ids.marketA,
            area_id: ids.area,
          }),
        UNIQUE,
      );
      await rejects(async (c) => {
        const other = uuidv7();
        const foreign = uuidv7();
        await c.query(
          `INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'QQ','QQQ','Elsewhere')`,
          [other],
        );
        await ins(c, 'delivery_area', {
          id: foreign,
          country_id: other,
          level: 'EMIRATE',
          code: 'abroad',
        });
        await ins(c, 'delivery_zone_area', {
          zone_id: A.zone,
          brand_id: ids.brandA,
          market_id: ids.marketA,
          area_id: foreign,
        });
      }, CHECK);
    });
  });

  describe('delivery checks', () => {
    it('refuses overlapping opening hours but allows touching ranges and a lunch break', async () => {
      await rejects(
        (c) =>
          ins(c, 'branch_hours', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a1,
            weekday: 1,
            start_time: '12:00',
            end_time: '15:00',
          }),
        EXCLUDE,
      );
      await asOwner(async (c) => {
        await ins(c, 'branch_hours', {
          id: uuidv7(),
          brand_id: ids.brandA,
          branch_id: ids.a1,
          weekday: 1,
          start_time: '13:00',
          end_time: '17:00',
        });
        await c.query(`DELETE FROM branch_hours WHERE branch_id = $1 AND start_time = '13:00'`, [
          ids.a1,
        ]);
      });
      await rejects(
        (c) =>
          ins(c, 'branch_hours', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a2,
            weekday: 9,
            start_time: '09:00',
            end_time: '10:00',
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'branch_hours', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a2,
            weekday: 2,
            start_time: '10:00',
            end_time: '09:00',
          }),
        CHECK,
      );
    });

    it('has one closure per brand, market or branch and date', async () => {
      await rejects(
        (c) =>
          ins(c, 'delivery_closure', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a1,
            closed_on: '2026-12-02',
          }),
        UNIQUE,
      );
      await asOwner(async (c) => {
        await ins(c, 'delivery_closure', {
          id: uuidv7(),
          brand_id: ids.brandA,
          closed_on: '2026-12-02',
        });
        await ins(c, 'delivery_closure', {
          id: uuidv7(),
          brand_id: ids.brandA,
          market_id: ids.marketA,
          closed_on: '2026-12-02',
        });
        await c.query(`DELETE FROM delivery_closure WHERE brand_id = $1 AND branch_id IS NULL`, [
          ids.brandA,
        ]);
      });
      await rejects(
        (c) =>
          ins(c, 'delivery_closure', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            branch_id: ids.a1,
            closed_on: '2027-01-01',
          }),
        CHECK,
      );
    });

    it('validates slots: capacity, cutoff before a same-day start, methods, weekday', async () => {
      const base = {
        brand_id: ids.brandA,
        market_id: ids.marketA,
        branch_id: ids.a1,
        weekday: 3,
        start_time: '10:00',
        end_time: '12:00',
        capacity: 4,
        cutoff_time: '08:00',
        methods: '{SAME_DAY}',
      };
      const make = (extra: Record<string, unknown>) =>
        rejects((c) => ins(c, 'delivery_slot', { id: uuidv7(), ...base, ...extra }), CHECK);
      await make({ capacity: 0 });
      await make({ end_time: '09:00' });
      await make({ cutoff_time: '11:00' });
      await make({ methods: '{}' });
      await make({ weekday: 7 });
      await make({ cutoff_days_before: 15 });
      // A cutoff on the day before may be later in the day than the start.
      await asOwner(async (c) => {
        await ins(c, 'delivery_slot', {
          id: uuidv7(),
          ...base,
          cutoff_time: '18:00',
          cutoff_days_before: 1,
        });
        await c.query(`DELETE FROM delivery_slot WHERE weekday = 3`);
      });
    });

    it('refuses negative charges and a zero free-delivery threshold', async () => {
      await rejects(
        (c) => c.query(`UPDATE zone_charge SET fee_minor = -1 WHERE zone_id = $1`, [A.zone]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE zone_charge SET free_over_minor = 0 WHERE zone_id = $1`, [A.zone]),
        CHECK,
      );
    });

    it('accepts each restriction shape and refuses malformed ones', async () => {
      const base = { id: undefined as unknown, brand_id: ids.brandA, market_id: ids.marketA };
      const row = (extra: Record<string, unknown>) => ({ ...base, id: uuidv7(), ...extra });
      await asOwner(async (c) => {
        await ins(
          c,
          'delivery_restriction',
          row({ target: 'PRODUCT', product_id: A.simple, condition: 'WEEKDAY', weekday: 5 }),
        );
        await ins(
          c,
          'delivery_restriction',
          row({
            target: 'PRODUCT',
            product_id: A.simple,
            condition: 'METHOD',
            method_kind: 'SAME_DAY',
          }),
        );
        await ins(
          c,
          'delivery_restriction',
          row({ target: 'PRODUCT', product_id: A.simple, condition: 'ZONE', zone_id: A.zone }),
        );
        await ins(
          c,
          'delivery_restriction',
          row({
            target: 'PRODUCT',
            product_id: A.simple,
            condition: 'DATE_RANGE',
            date_from: '2026-12-24',
            date_to: '2026-12-26',
          }),
        );
      });
      const bad = (extra: Record<string, unknown>) =>
        rejects((c) => ins(c, 'delivery_restriction', row(extra)), CHECK);
      await bad({ target: 'PRODUCT', condition: 'WEEKDAY', weekday: 5 });
      await bad({ target: 'PRODUCT', product_id: A.simple, condition: 'WEEKDAY', weekday: 8 });
      await bad({
        target: 'PRODUCT',
        product_id: A.simple,
        condition: 'DATE_RANGE',
        date_from: '2026-12-26',
        date_to: '2026-12-24',
      });
      await bad({ target: 'PRODUCT', product_id: A.simple, condition: 'METHOD', weekday: 1 });
      await bad({ target: 'CATEGORY', product_id: A.simple, condition: 'WEEKDAY', weekday: 1 });
      await bad({
        target: 'PRODUCT',
        product_id: A.simple,
        condition: 'AREA',
        area_id: ids.area,
        zone_id: A.zone,
      });
    });

    it('keeps assignment rule positions unique per market', () =>
      rejects(
        (c) =>
          ins(c, 'branch_assignment_rule', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            kind: 'PRIORITY',
            position: 0,
          }),
        UNIQUE,
      ));
  });

  describe('stock: overselling, shape and the ledger', () => {
    it('refuses reserving more than is on hand unless backorder is allowed', async () => {
      await rejects(
        (c) => c.query(`UPDATE stock_level SET reserved = 11 WHERE id = $1`, [A.stock]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE stock_level SET on_hand = 1 WHERE id = $1`, [A.stock]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE stock_level SET on_hand = -1 WHERE id = $1`, [A.stock]),
        CHECK,
      );
      await asOwner(async (c) => {
        await c.query(
          `UPDATE stock_level SET out_of_stock = 'ALLOW_BACKORDER', reserved = 14 WHERE id = $1`,
          [A.stock],
        );
        await c.query(`UPDATE stock_level SET out_of_stock = NULL, reserved = 2 WHERE id = $1`, [
          A.stock,
        ]);
      });
    });

    it('holds the last unit for only one of two concurrent buyers', async () => {
      await asOwner((c) =>
        c.query(`UPDATE stock_level SET on_hand = 1, reserved = 0 WHERE id = $1`, [A.stock]),
      );
      const take = () =>
        inTx(app, { brandIds: [ids.brandA] }, (c) =>
          c.query(
            `UPDATE stock_level SET reserved = reserved + 1
              WHERE id = $1 AND on_hand - reserved >= 1`,
            [A.stock],
          ),
        );
      const results = await Promise.all([take(), take(), take()]);
      expect(results.map((r) => r.rowCount).sort()).toEqual([0, 0, 1]);
      await asOwner((c) =>
        c.query(`UPDATE stock_level SET on_hand = 10, reserved = 2 WHERE id = $1`, [A.stock]),
      );
    });

    it('stocks simple products on the product, variable ones per variation, bundles never', async () => {
      await rejects(
        (c) =>
          ins(c, 'stock_level', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a2,
            product_id: A.bundle,
            updated_at: new Date(),
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'stock_level', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a2,
            product_id: A.variable,
            updated_at: new Date(),
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'stock_transfer_line', {
            id: uuidv7(),
            transfer_id: A.transfer,
            brand_id: ids.brandA,
            product_id: A.bundle,
            quantity_requested: 1,
          }),
        CHECK,
      );
    });

    it('has one stock row per branch and item', async () => {
      await rejects(
        (c) =>
          ins(c, 'stock_level', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a1,
            product_id: A.simple,
            updated_at: new Date(),
          }),
        UNIQUE,
      );
      await rejects(
        (c) =>
          ins(c, 'stock_level', {
            id: uuidv7(),
            brand_id: ids.brandA,
            branch_id: ids.a1,
            product_id: A.variable,
            variation_id: A.variation,
            updated_at: new Date(),
          }),
        UNIQUE,
      );
    });

    it('keeps the ledger append-only, even for the owner', async () => {
      await rejects(
        (c) =>
          c.query(`UPDATE stock_movement SET quantity = 99 WHERE stock_level_id = $1`, [A.stock]),
        '42501',
      );
      await rejects(
        (c) => c.query(`DELETE FROM stock_movement WHERE stock_level_id = $1`, [A.stock]),
        '42501',
      );
      await expect(
        asBrand([ids.brandA], (c) =>
          c.query(`DELETE FROM stock_movement WHERE stock_level_id = $1`, [A.stock]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await rejects(
        (c) =>
          ins(c, 'stock_movement', {
            id: uuidv7(),
            brand_id: ids.brandA,
            stock_level_id: A.stock,
            type: 'ADJUSTMENT_OUT',
            quantity: 0,
            on_hand_after: 10,
            reserved_after: 0,
          }),
        CHECK,
      );
    });

    it('rebuilds a stock level from its movements', async () => {
      const rollback = new Error('rollback');
      await expect(
        asOwner(async (c) => {
          const level = uuidv7();
          await ins(c, 'stock_level', {
            id: level,
            brand_id: ids.brandA,
            branch_id: ids.a2,
            product_id: A.simple,
            updated_at: new Date(),
          });
          const plus = ['RECEIPT', 'ADJUSTMENT_IN', 'RETURN', 'TRANSFER_IN'];
          let on = 0;
          for (const [type, quantity] of [
            ['RECEIPT', 20],
            ['SALE', 5],
            ['WASTAGE', 2],
            ['TRANSFER_OUT', 3],
            ['RETURN', 1],
          ] as const) {
            on += plus.includes(type) ? quantity : -quantity;
            await ins(c, 'stock_movement', {
              id: uuidv7(),
              brand_id: ids.brandA,
              stock_level_id: level,
              type,
              quantity,
              on_hand_after: on,
              reserved_after: 0,
            });
          }
          await c.query(`UPDATE stock_level SET on_hand = $2 WHERE id = $1`, [level, on]);
          const { rows } = await c.query(
            `SELECT l.on_hand,
                    COALESCE(SUM(CASE WHEN m.type IN ('RECEIPT','ADJUSTMENT_IN','RETURN','TRANSFER_IN') THEN m.quantity ELSE -m.quantity END), 0)::int AS rebuilt
               FROM stock_level l JOIN stock_movement m ON m.stock_level_id = l.id WHERE l.id = $1 GROUP BY l.on_hand`,
            [level],
          );
          expect(rows[0]).toEqual({ on_hand: 11, rebuilt: 11 });
          throw rollback; // leave no ledger rows behind (the ledger cannot be deleted)
        }),
      ).rejects.toBe(rollback);
    });
  });

  describe('reservations, slots and transfers', () => {
    it('lets a reservation leave ACTIVE once and never come back', async () => {
      await asOwner((c) =>
        c.query(`UPDATE stock_reservation SET status = 'COMMITTED' WHERE id = $1`, [A.reservation]),
      );
      await rejects(
        (c) =>
          c.query(`UPDATE stock_reservation SET status = 'RELEASED' WHERE id = $1`, [
            A.reservation,
          ]),
        CHECK,
      );
      await rejects(
        (c) =>
          c.query(`UPDATE stock_reservation SET status = 'ACTIVE' WHERE id = $1`, [A.reservation]),
        CHECK,
      );
    });

    it('validates reservation windows, units and quantities', async () => {
      await rejects(
        (c) =>
          ins(c, 'stock_reservation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            checkout_ref: 'x',
            created_at: new Date(),
            expires_at: new Date(Date.now() - 1000),
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'slot_reservation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            slot_id: A.slot,
            delivery_date: '2026-12-08',
            units: 0,
            checkout_ref: 'x',
            expires_at: new Date(Date.now() + 1000),
          }),
        CHECK,
      );
      await rejects(
        (c) =>
          c.query(`UPDATE stock_reservation_line SET quantity = 0 WHERE reservation_id = $1`, [
            A.reservation,
          ]),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE slot_day SET booked = -1 WHERE slot_id = $1`, [A.slot]),
        CHECK,
      );
    });

    it('books a slot atomically up to its capacity', async () => {
      await asOwner((c) =>
        ins(c, 'slot_day', {
          brand_id: ids.brandA,
          slot_id: A.slot,
          delivery_date: '2026-12-14',
          booked: 0,
        }),
      );
      const book = () =>
        inTx(app, { brandIds: [ids.brandA] }, (c) =>
          c.query(
            `UPDATE slot_day d SET booked = d.booked + 1
               FROM delivery_slot s
              WHERE d.slot_id = $1 AND d.delivery_date = '2026-12-14' AND s.id = d.slot_id
                AND d.booked + 1 <= s.capacity`,
            [A.slot],
          ),
        );
      const results = await Promise.all(Array.from({ length: 8 }, book));
      expect(results.filter((r) => r.rowCount === 1)).toHaveLength(5);
      const { rows } = await asOwner((c) =>
        c.query(`SELECT booked FROM slot_day WHERE slot_id = $1 AND delivery_date = '2026-12-14'`, [
          A.slot,
        ]),
      );
      expect(rows[0].booked).toBe(5);
    });

    it('moves transfers forward only and needs two different branches', async () => {
      await rejects(
        (c) =>
          ins(c, 'stock_transfer', {
            id: uuidv7(),
            brand_id: ids.brandA,
            from_branch_id: ids.a1,
            to_branch_id: ids.a1,
            updated_at: new Date(),
          }),
        CHECK,
      );
      await rejects(
        (c) => c.query(`UPDATE stock_transfer SET status = 'RECEIVED' WHERE id = $1`, [A.transfer]),
        CHECK,
      );
      await asOwner(async (c) => {
        await c.query(`UPDATE stock_transfer SET status = 'IN_TRANSIT' WHERE id = $1`, [
          A.transfer,
        ]);
        await c.query(`UPDATE stock_transfer SET status = 'RECEIVED' WHERE id = $1`, [A.transfer]);
      });
      await rejects(
        (c) =>
          c.query(`UPDATE stock_transfer SET status = 'REQUESTED' WHERE id = $1`, [A.transfer]),
        CHECK,
      );
    });

    it('validates transfer line quantities', async () => {
      await rejects(
        (c) =>
          c.query(`UPDATE stock_transfer_line SET quantity_shipped = 99 WHERE transfer_id = $1`, [
            B.transfer,
          ]),
        CHECK,
      );
      await rejects(
        (c) =>
          c.query(`UPDATE stock_transfer_line SET quantity_requested = 0 WHERE transfer_id = $1`, [
            B.transfer,
          ]),
        CHECK,
      );
      await rejects(
        (c) =>
          ins(c, 'stock_transfer_line', {
            id: uuidv7(),
            transfer_id: B.transfer,
            brand_id: ids.brandB,
            product_id: B.simple,
            quantity_requested: 1,
          }),
        UNIQUE,
      );
    });

    it('limits inventory settings to sensible ranges', async () => {
      await rejects(
        (c) =>
          c.query(`UPDATE inventory_setting SET reservation_minutes = 0 WHERE brand_id = $1`, [
            ids.brandA,
          ]),
        CHECK,
      );
      await rejects(
        (c) =>
          c.query(`UPDATE inventory_setting SET max_extensions = 9 WHERE brand_id = $1`, [
            ids.brandA,
          ]),
        CHECK,
      );
    });
  });
});
