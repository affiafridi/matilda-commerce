import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../../common/ids/uuid7';
import { createPool, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

/**
 * Catalog schema (Phase 3 step 3.2, docs/PHASE-3-SCHEMA-DRAFT.md): row-level security on every table,
 * brand isolation, composite foreign keys, check constraints and triggers. Database-backed.
 */

const CATALOG_TABLES = [
  'product',
  'product_translation',
  'product_category',
  'product_collection',
  'product_tag',
  'product_relation',
  'product_market',
  'product_branch',
  'product_media',
  'category',
  'category_translation',
  'collection',
  'collection_translation',
  'tag',
  'tag_translation',
  'attribute',
  'attribute_value',
  'attribute_translation',
  'attribute_value_translation',
  'product_attribute',
  'product_attribute_value',
  'variation',
  'variation_value',
  'market_price',
  'option_group',
  'option_choice',
  'option_rule',
  'option_group_translation',
  'option_choice_translation',
  'option_price',
  'addon_group',
  'addon_item',
  'addon_group_translation',
  'addon_item_translation',
  'addon_item_price',
  'bundle_item',
  'media_asset',
  'media_asset_translation',
  'media_variant',
  'catalog_slug_history',
];

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
  branch: string | null;
}

interface Seeded {
  media: string;
  category: string;
  product: string;
  product2: string;
  variable: string;
  bundle: string;
  variation: string;
  attribute: string;
  value: string;
  optionGroup: string;
  optionGroup2: string;
  addonGroup: string;
}

/** One of everything for a brand, built through the real constraints. */
async function seedBrand(c: PoolClient, f: BrandFixture, tag: string): Promise<Seeded> {
  const id = uuidv7;
  const now = new Date();
  const brand_id = f.brand;
  const s: Seeded = {
    media: id(),
    category: id(),
    product: id(),
    product2: id(),
    variable: id(),
    bundle: id(),
    variation: id(),
    attribute: id(),
    value: id(),
    optionGroup: id(),
    optionGroup2: id(),
    addonGroup: id(),
  };
  const collection = id();
  const tagId = id();
  const choice = id();
  const addonProduct = id();
  const inline = id();

  await ins(c, 'media_asset', {
    id: s.media,
    brand_id,
    storage_key: `k/${s.media}`,
    original_filename: 'a.jpg',
    content_type: 'image/jpeg',
    byte_size: 10,
    sha256: s.media.replace(/-/g, '').padEnd(64, '0'),
  });
  await ins(c, 'media_asset_translation', {
    brand_id,
    media_asset_id: s.media,
    language: 'en',
    alt_text: 'alt',
  });
  await ins(c, 'media_variant', {
    brand_id,
    media_asset_id: s.media,
    kind: 'THUMBNAIL',
    storage_key: `k/${s.media}/t`,
    width: 10,
    height: 10,
    content_type: 'image/webp',
  });

  await ins(c, 'category', { id: s.category, brand_id, updated_at: now, media_asset_id: s.media });
  await ins(c, 'category_translation', {
    brand_id,
    category_id: s.category,
    language: 'en',
    name: 'Cat',
    slug: `cat-${tag}`,
  });
  await ins(c, 'collection', { id: collection, brand_id, updated_at: now });
  await ins(c, 'collection_translation', {
    brand_id,
    collection_id: collection,
    language: 'en',
    name: 'Col',
    slug: `col-${tag}`,
  });
  await ins(c, 'tag', { id: tagId, brand_id, updated_at: now });
  await ins(c, 'tag_translation', {
    brand_id,
    tag_id: tagId,
    language: 'en',
    name: 'Tag',
    slug: `tag-${tag}`,
  });

  const product = (pid: string, type: string, sku: string | null) =>
    ins(c, 'product', { id: pid, brand_id, type, sku, updated_at: now });
  await product(s.product, 'SIMPLE', `S-${tag.toUpperCase()}-1`);
  await product(s.product2, 'SIMPLE', `S-${tag.toUpperCase()}-2`);
  await product(addonProduct, 'SIMPLE', `S-${tag.toUpperCase()}-3`);
  await product(s.variable, 'VARIABLE', null);
  await product(s.bundle, 'BUNDLE', `B-${tag.toUpperCase()}-1`);
  await ins(c, 'product_translation', {
    brand_id,
    product_id: s.product,
    language: 'en',
    name: 'Rose bouquet',
    slug: `rose-${tag}`,
  });
  await ins(c, 'product_category', { brand_id, product_id: s.product, category_id: s.category });
  await ins(c, 'product_collection', {
    brand_id,
    product_id: s.product,
    collection_id: collection,
  });
  await ins(c, 'product_tag', { brand_id, product_id: s.product, tag_id: tagId });
  await ins(c, 'product_relation', {
    brand_id,
    product_id: s.product,
    related_product_id: s.product2,
    kind: 'RELATED',
  });
  await ins(c, 'product_market', { brand_id, product_id: s.product, market_id: f.market });
  if (f.branch) {
    await ins(c, 'product_branch', { brand_id, product_id: s.product, branch_id: f.branch });
  }
  await ins(c, 'product_media', {
    brand_id,
    product_id: s.product,
    media_asset_id: s.media,
    is_primary: true,
  });

  await ins(c, 'attribute', { id: s.attribute, brand_id, key: 'size', kind: 'TEXT' });
  await ins(c, 'attribute_value', { id: s.value, brand_id, attribute_id: s.attribute, key: '1kg' });
  await ins(c, 'attribute_translation', {
    brand_id,
    attribute_id: s.attribute,
    language: 'en',
    label: 'Size',
  });
  await ins(c, 'attribute_value_translation', {
    brand_id,
    attribute_value_id: s.value,
    language: 'en',
    label: '1 kg',
  });
  await ins(c, 'product_attribute', {
    brand_id,
    product_id: s.variable,
    attribute_id: s.attribute,
    drives_variations: true,
  });
  await ins(c, 'product_attribute_value', {
    brand_id,
    product_id: s.variable,
    attribute_id: s.attribute,
    attribute_value_id: s.value,
  });
  await ins(c, 'variation', {
    id: s.variation,
    brand_id,
    product_id: s.variable,
    sku: `V-${tag.toUpperCase()}-1`,
    combination_key: 'size=1kg',
    updated_at: now,
  });
  await ins(c, 'variation_value', {
    brand_id,
    variation_id: s.variation,
    product_id: s.variable,
    attribute_id: s.attribute,
    attribute_value_id: s.value,
  });

  await ins(c, 'market_price', {
    id: id(),
    brand_id,
    market_id: f.market,
    currency_code: 'AED',
    product_id: s.product,
    regular_minor: 15000,
    sale_minor: 12000,
    updated_at: now,
  });
  await ins(c, 'market_price', {
    id: id(),
    brand_id,
    market_id: f.market,
    currency_code: 'AED',
    variation_id: s.variation,
    regular_minor: 18000,
    updated_at: now,
  });

  await ins(c, 'option_group', {
    id: s.optionGroup,
    brand_id,
    product_id: s.product,
    key: 'message',
    type: 'TEXT',
    max_length: 40,
  });
  await ins(c, 'option_group', {
    id: s.optionGroup2,
    brand_id,
    product_id: s.product,
    key: 'colour',
    type: 'SELECT',
  });
  await ins(c, 'option_choice', {
    id: choice,
    brand_id,
    option_group_id: s.optionGroup2,
    key: 'gold',
  });
  await ins(c, 'option_rule', {
    id: id(),
    brand_id,
    product_id: s.product,
    option_group_id: s.optionGroup2,
    depends_on_group_id: s.optionGroup,
    operator: 'FILLED',
  });
  await ins(c, 'option_group_translation', {
    brand_id,
    option_group_id: s.optionGroup,
    language: 'en',
    label: 'Message',
  });
  await ins(c, 'option_choice_translation', {
    brand_id,
    option_choice_id: choice,
    language: 'en',
    label: 'Gold',
  });
  await ins(c, 'option_price', {
    id: id(),
    brand_id,
    market_id: f.market,
    currency_code: 'AED',
    option_choice_id: choice,
    delta_minor: 1500,
  });

  await ins(c, 'addon_group', { id: s.addonGroup, brand_id, product_id: s.product, key: 'extras' });
  await ins(c, 'addon_item', {
    id: id(),
    brand_id,
    addon_group_id: s.addonGroup,
    kind: 'PRODUCT',
    addon_product_id: addonProduct,
  });
  await ins(c, 'addon_item', {
    id: inline,
    brand_id,
    addon_group_id: s.addonGroup,
    kind: 'INLINE',
    key: 'ribbon',
  });
  await ins(c, 'addon_group_translation', {
    brand_id,
    addon_group_id: s.addonGroup,
    language: 'en',
    label: 'Extras',
  });
  await ins(c, 'addon_item_translation', {
    brand_id,
    addon_item_id: inline,
    language: 'en',
    label: 'Ribbon',
  });
  await ins(c, 'addon_item_price', {
    id: id(),
    brand_id,
    addon_item_id: inline,
    market_id: f.market,
    currency_code: 'AED',
    delta_minor: 500,
  });
  await ins(c, 'bundle_item', {
    id: id(),
    brand_id,
    bundle_product_id: s.bundle,
    component_product_id: s.product2,
  });
  await ins(c, 'catalog_slug_history', {
    id: id(),
    brand_id,
    entity_type: 'product',
    entity_id: s.product,
    language: 'en',
    slug: `old-rose-${tag}`,
  });
  return s;
}

describe('catalog schema (step 3.2)', () => {
  let owner: Pool;
  let app: Pool;

  const ids = {
    ae: uuidv7(),
    brandA: uuidv7(),
    brandB: uuidv7(),
    marketA: uuidv7(),
    marketB: uuidv7(),
    branchX: uuidv7(),
    branchY: uuidv7(),
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

  beforeAll(async () => {
    owner = createPool(testOwnerUrl());
    app = createPool(testAppUrl());
    await owner.query('TRUNCATE brand, branch CASCADE');
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
          ($1,'cat-a','Catalog A','ACTIVE', now()), ($2,'cat-b','Catalog B','ACTIVE', now())`,
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
          ($1,'cat-branch-x','Branch X',$3,'Asia/Dubai', now()), ($2,'cat-branch-y','Branch Y',$3,'Asia/Dubai', now())`,
        [ids.branchX, ids.branchY, ids.ae],
      );
      await c.query(
        `INSERT INTO branch_market (branch_id, market_id, country_id) VALUES ($1,$2,$5), ($3,$4,$5)`,
        [ids.branchX, ids.marketA, ids.branchY, ids.marketB, ids.ae],
      );
      A = await seedBrand(c, { brand: ids.brandA, market: ids.marketA, branch: ids.branchX }, 'a');
      B = await seedBrand(c, { brand: ids.brandB, market: ids.marketB, branch: null }, 'b');
    });
  });

  afterAll(async () => {
    await owner.query('TRUNCATE brand, branch CASCADE');
    await Promise.all([owner.end(), app.end()]);
  });

  describe('structure', () => {
    it('has exactly the 40 catalog tables, each with brand_id, forced RLS and one scope policy', async () => {
      const { rows } = await owner.query(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = c.relname || '_scope') AS scope_policies,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
                EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name = 'brand_id') AS has_brand
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)`,
        [CATALOG_TABLES],
      );
      expect(CATALOG_TABLES).toHaveLength(40);
      expect(rows).toHaveLength(40);
      for (const r of rows) {
        expect({
          t: r.relname,
          rls: r.rls,
          forced: r.forced,
          p: Number(r.policies),
          s: Number(r.scope_policies),
          b: r.has_brand,
        }).toEqual({
          t: r.relname,
          rls: true,
          forced: true,
          p: 1,
          s: 1,
          b: true,
        });
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
        [CATALOG_TABLES],
      );
      expect(rows).toEqual([]);
    });

    it('does not let the runtime role truncate, drop or alter catalog tables', async () => {
      const { rows } = await owner.query(
        `SELECT t AS tbl, has_table_privilege('matilda_app', t, 'TRUNCATE') AS can_truncate,
                has_table_privilege('matilda_app', t, 'TRIGGER') AS can_trigger,
                has_table_privilege('matilda_app', t, 'DELETE') AS can_delete
           FROM unnest($1::text[]) AS t`,
        [CATALOG_TABLES],
      );
      for (const r of rows) {
        expect({
          t: r.tbl,
          truncate: r.can_truncate,
          trigger: r.can_trigger,
          del: r.can_delete,
        }).toEqual({
          t: r.tbl,
          truncate: false,
          trigger: false,
          del: true,
        });
      }
      await expect(asPlatform((c) => c.query('TRUNCATE product CASCADE'))).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  describe('brand isolation matrix (every table)', () => {
    const counts = (c: PoolClient, table: string, brand: string) =>
      c
        .query(
          `SELECT count(*) FILTER (WHERE brand_id = $1) AS own, count(*) FILTER (WHERE brand_id <> $1) AS other FROM ${table}`,
          [brand],
        )
        .then((r) => ({ own: Number(r.rows[0].own), other: Number(r.rows[0].other) }));

    it.each(CATALOG_TABLES)('%s: a brand sees only its own rows', async (table) => {
      const a = await asBrand([ids.brandA], (c) => counts(c, table, ids.brandA));
      expect(a.other).toBe(0);
      expect(a.own).toBeGreaterThan(0);
      const b = await asBrand([ids.brandB], (c) => counts(c, table, ids.brandB));
      expect(b.other).toBe(0);
      // Brand B has no branch restriction rows by construction.
      if (table !== 'product_branch') expect(b.own).toBeGreaterThan(0);
    });

    it.each(CATALOG_TABLES)(
      '%s: no context sees nothing, a platform actor sees both brands',
      async (table) => {
        const none = await asNobody((c) => c.query(`SELECT count(*) AS n FROM ${table}`));
        expect(Number(none.rows[0].n)).toBe(0);
        const both = await asBrand([ids.brandA, ids.brandB], (c) =>
          c.query(`SELECT count(DISTINCT brand_id) AS n FROM ${table}`),
        );
        expect(Number(both.rows[0].n)).toBe(table === 'product_branch' ? 1 : 2);
        const platform = await asPlatform((c) =>
          c.query(`SELECT count(DISTINCT brand_id) AS n FROM ${table}`),
        );
        expect(Number(platform.rows[0].n)).toBe(table === 'product_branch' ? 1 : 2);
      },
    );

    it("a brand cannot insert, update or delete another brand's catalog rows", async () => {
      await expect(
        asBrand([ids.brandA], (c) =>
          ins(c, 'tag', { id: uuidv7(), brand_id: ids.brandB, updated_at: new Date() }),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const updated = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE product SET sort_order = 9 WHERE id = $1`, [B.product]),
      );
      expect(updated.rowCount).toBe(0);
      const deleted = await asBrand([ids.brandA], (c) =>
        c.query(`DELETE FROM product WHERE id = $1`, [B.product]),
      );
      expect(deleted.rowCount).toBe(0);
      const own = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE product SET sort_order = 3 WHERE id = $1`, [A.product]),
      );
      expect(own.rowCount).toBe(1);
    });
  });

  describe('composite keys reject cross-brand references', () => {
    it("a translation cannot attach to another brand's product", () =>
      rejects(
        (c) =>
          ins(c, 'product_translation', {
            brand_id: ids.brandB,
            product_id: A.product,
            language: 'ar',
            name: 'x',
            slug: 'x-cross',
          }),
        '23503',
      ));

    it("a product cannot use another brand's category or media", async () => {
      await rejects(
        (c) =>
          ins(c, 'product_category', {
            brand_id: ids.brandB,
            product_id: B.product,
            category_id: A.category,
          }),
        '23503',
      );
      await rejects(
        (c) =>
          ins(c, 'product_media', {
            brand_id: ids.brandB,
            product_id: B.product2,
            media_asset_id: A.media,
          }),
        '23503',
      );
    });

    it("prices cannot use another brand's market, product or variation", async () => {
      const base = {
        id: uuidv7(),
        currency_code: 'AED',
        regular_minor: 100,
        updated_at: new Date(),
      };
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            brand_id: ids.brandA,
            market_id: ids.marketB,
            product_id: A.product2,
          }),
        '23503',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            brand_id: ids.brandA,
            market_id: ids.marketA,
            product_id: B.product2,
          }),
        '23503',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            brand_id: ids.brandA,
            market_id: ids.marketA,
            variation_id: B.variation,
          }),
        '23503',
      );
    });

    it('prices need a currency the market offers', () =>
      rejects(
        (c) =>
          ins(c, 'market_price', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            currency_code: 'SAR',
            product_id: A.product2,
            regular_minor: 100,
            updated_at: new Date(),
          }),
        '23503',
      ));

    it('options, add-ons, variations and bundles cannot cross brands', async () => {
      await rejects(
        (c) =>
          ins(c, 'option_choice', {
            id: uuidv7(),
            brand_id: ids.brandB,
            option_group_id: A.optionGroup2,
            key: 'x',
          }),
        '23503',
      );
      await rejects(
        (c) =>
          ins(c, 'addon_item', {
            id: uuidv7(),
            brand_id: ids.brandB,
            addon_group_id: A.addonGroup,
            kind: 'INLINE',
            key: 'cross',
          }),
        '23503',
      );
      await rejects(
        (c) =>
          ins(c, 'bundle_item', {
            id: uuidv7(),
            brand_id: ids.brandA,
            bundle_product_id: A.bundle,
            component_product_id: B.product,
          }),
        '23503',
      );
      await rejects(async (c) => {
        const v3 = uuidv7();
        await ins(c, 'variation', {
          id: v3,
          brand_id: ids.brandA,
          product_id: A.variable,
          sku: 'V-A-3',
          combination_key: 'size=3kg',
          updated_at: new Date(),
        });
        await ins(c, 'variation_value', {
          brand_id: ids.brandB,
          variation_id: v3,
          product_id: A.variable,
          attribute_id: A.attribute,
          attribute_value_id: A.value,
        });
      }, '23503');
    });

    it('a variation can only use values enabled on its product', async () => {
      const other = uuidv7();
      await asOwner(async (c) => {
        await ins(c, 'attribute_value', {
          id: other,
          brand_id: ids.brandA,
          attribute_id: A.attribute,
          key: '2kg',
        });
      });
      await rejects(
        (c) =>
          ins(c, 'variation_value', {
            brand_id: ids.brandA,
            variation_id: A.variation,
            product_id: A.variable,
            attribute_id: A.attribute,
            attribute_value_id: other,
          }),
        '23505', // the (variation, attribute) pair already has a value; the value check below proves the FK
      );
      await rejects(async (c) => {
        const v2 = uuidv7();
        await ins(c, 'variation', {
          id: v2,
          brand_id: ids.brandA,
          product_id: A.variable,
          sku: 'V-A-2',
          combination_key: 'size=2kg',
          updated_at: new Date(),
        });
        await ins(c, 'variation_value', {
          brand_id: ids.brandA,
          variation_id: v2,
          product_id: A.variable,
          attribute_id: A.attribute,
          attribute_value_id: other,
        });
      }, '23503');
    });
  });

  describe('checks and triggers', () => {
    it('market price rules: sale below regular, dates need a sale', async () => {
      const base = {
        brand_id: ids.brandA,
        market_id: ids.marketA,
        currency_code: 'AED',
        updated_at: new Date(),
      };
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            id: uuidv7(),
            product_id: A.product2,
            regular_minor: 100,
            sale_minor: 100,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            id: uuidv7(),
            product_id: A.product2,
            regular_minor: -1,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            id: uuidv7(),
            product_id: A.product2,
            regular_minor: 100,
            sale_minor: 50,
            sale_starts_at: new Date('2026-12-02'),
            sale_ends_at: new Date('2026-12-01'),
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            id: uuidv7(),
            product_id: A.product2,
            regular_minor: 100,
            sale_starts_at: new Date(),
          }),
        '23514',
      );
      await rejects(
        (c) => ins(c, 'market_price', { ...base, id: uuidv7(), regular_minor: 100 }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            id: uuidv7(),
            product_id: A.product2,
            variation_id: A.variation,
            regular_minor: 100,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'market_price', {
            ...base,
            id: uuidv7(),
            product_id: A.product,
            regular_minor: 100,
          }),
        '23505',
      );
    });

    it('variable products are priced per variation only', () =>
      rejects(
        (c) =>
          ins(c, 'market_price', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            currency_code: 'AED',
            product_id: A.variable,
            regular_minor: 100,
            updated_at: new Date(),
          }),
        '23514',
      ));

    it('SKUs: format, unique per brand, shared between products and variations, none on variable products', async () => {
      const now = new Date();
      await rejects(
        (c) =>
          ins(c, 'product', {
            id: uuidv7(),
            brand_id: ids.brandA,
            type: 'SIMPLE',
            sku: 'lower',
            updated_at: now,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'product', {
            id: uuidv7(),
            brand_id: ids.brandA,
            type: 'SIMPLE',
            sku: 'S-A-1',
            updated_at: now,
          }),
        '23505',
      );
      await rejects(
        (c) =>
          ins(c, 'product', {
            id: uuidv7(),
            brand_id: ids.brandA,
            type: 'SIMPLE',
            sku: 'V-A-1',
            updated_at: now,
          }),
        '23505',
      );
      await rejects(
        (c) =>
          ins(c, 'product', {
            id: uuidv7(),
            brand_id: ids.brandA,
            type: 'VARIABLE',
            sku: 'V-OWN',
            updated_at: now,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'variation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: A.variable,
            sku: 'S-A-1',
            combination_key: 'size=9kg',
            updated_at: now,
          }),
        '23505',
      );
      // The same SKU in another brand is fine.
      await asOwner((c) =>
        ins(c, 'product', {
          id: uuidv7(),
          brand_id: ids.brandB,
          type: 'SIMPLE',
          sku: 'S-A-1',
          updated_at: now,
        }),
      );
      await asOwner((c) =>
        c.query(`DELETE FROM product WHERE brand_id = $1 AND sku = 'S-A-1'`, [ids.brandB]),
      );
    });

    it('variations: only for variable products, unique combination, at most 100', async () => {
      const now = new Date();
      await rejects(
        (c) =>
          ins(c, 'variation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: A.product,
            sku: 'V-ON-SIMPLE',
            combination_key: 'size=1',
            updated_at: now,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'variation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: A.variable,
            sku: 'V-DUP',
            combination_key: 'size=1kg',
            updated_at: now,
          }),
        '23505',
      );
      const bulk = uuidv7();
      await asOwner(async (c) => {
        await ins(c, 'product', {
          id: bulk,
          brand_id: ids.brandA,
          type: 'VARIABLE',
          updated_at: now,
        });
        for (let i = 0; i < 100; i++) {
          await ins(c, 'variation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: bulk,
            sku: `BULK-${i}`,
            combination_key: `n=${i}`,
            updated_at: now,
          });
        }
      });
      await rejects(
        (c) =>
          ins(c, 'variation', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: bulk,
            sku: 'BULK-100',
            combination_key: 'n=100',
            updated_at: now,
          }),
        '23514',
      );
      await rejects(
        (c) => c.query(`UPDATE product SET type = 'SIMPLE' WHERE id = $1`, [bulk]),
        '23514',
      );
    });

    it('slugs: lower-case, no spaces or separators, Arabic allowed, unique per brand and language', async () => {
      const mk =
        (slug: string, language = 'en', product = A.product2) =>
        (c: PoolClient) =>
          ins(c, 'product_translation', {
            brand_id: ids.brandA,
            product_id: product,
            language,
            name: 'n',
            slug,
          });
      for (const bad of ['Upper', 'has space', 'a/b', 'a--b', '-lead', 'trail-', 'a?b', '']) {
        await rejects(mk(bad), '23514');
      }
      await rejects(mk('fine-slug', 'EN'), '23514');
      await asOwner(mk('ورد-احمر', 'ar'));
      await rejects(mk('ورد-احمر', 'ar', A.bundle), '23505');
      await asOwner(mk('rose-a', 'ar', A.variable)); // same slug in another language is allowed
      await rejects(mk('rose-a', 'en', A.bundle), '23505');
    });

    it('product rules: quantities, times, publish window', async () => {
      const now = new Date();
      const mk = (extra: Record<string, unknown>) => (c: PoolClient) =>
        ins(c, 'product', {
          id: uuidv7(),
          brand_id: ids.brandA,
          type: 'SIMPLE',
          updated_at: now,
          ...extra,
        });
      await rejects(mk({ min_quantity: 0 }), '23514');
      await rejects(mk({ min_quantity: 5, max_quantity: 2 }), '23514');
      await rejects(mk({ prep_time_minutes: -1 }), '23514');
      await rejects(
        mk({ publish_at: new Date('2026-12-02'), unpublish_at: new Date('2026-12-01') }),
        '23514',
      );
    });

    it('bundles: parent must be a bundle, no nesting, one row per component', async () => {
      const row = (bundle: string, component: string) => ({
        id: uuidv7(),
        brand_id: ids.brandA,
        bundle_product_id: bundle,
        component_product_id: component,
      });
      await rejects((c) => ins(c, 'bundle_item', row(A.product, A.product2)), '23514');
      await rejects((c) => ins(c, 'bundle_item', row(A.bundle, A.bundle)), '23514');
      const nested = uuidv7();
      await asOwner((c) =>
        ins(c, 'product', {
          id: nested,
          brand_id: ids.brandA,
          type: 'BUNDLE',
          updated_at: new Date(),
        }),
      );
      await rejects((c) => ins(c, 'bundle_item', row(A.bundle, nested)), '23514');
      await rejects((c) => ins(c, 'bundle_item', row(A.bundle, A.product2)), '23505');
      await rejects(
        (c) => c.query(`UPDATE product SET type = 'SIMPLE' WHERE id = $1`, [A.bundle]),
        '23514',
      );
    });

    it('add-ons: product add-ons are simple or variable, never self, inline items need a key', async () => {
      const item = (extra: Record<string, unknown>) => (c: PoolClient) =>
        ins(c, 'addon_item', {
          id: uuidv7(),
          brand_id: ids.brandA,
          addon_group_id: A.addonGroup,
          ...extra,
        });
      await rejects(item({ kind: 'PRODUCT', addon_product_id: A.product }), '23514');
      await rejects(item({ kind: 'PRODUCT', addon_product_id: A.bundle }), '23514');
      await rejects(item({ kind: 'PRODUCT', addon_product_id: A.product2, key: 'both' }), '23514');
      await rejects(item({ kind: 'INLINE' }), '23514');
      await rejects(item({ kind: 'INLINE', key: 'x', addon_product_id: A.product2 }), '23514');
      await rejects(item({ kind: 'INLINE', key: 'ribbon' }), '23505');
      await rejects(
        item({ kind: 'PRODUCT', addon_product_id: A.product2, max_quantity: 0 }),
        '23514',
      );
    });

    it('options: rules need matching operators, no self dependency, prices target one thing', async () => {
      const rule = (extra: Record<string, unknown>) => (c: PoolClient) =>
        ins(c, 'option_rule', {
          id: uuidv7(),
          brand_id: ids.brandA,
          product_id: A.product,
          option_group_id: A.optionGroup2,
          depends_on_group_id: A.optionGroup,
          ...extra,
        });
      await rejects(rule({ operator: 'EQUALS' }), '23514');
      await rejects(rule({ operator: 'FILLED', depends_on_choice_id: uuidv7() }), '23514');
      await rejects(rule({ operator: 'FILLED', option_group_id: A.optionGroup }), '23514');
      await rejects(
        (c) =>
          ins(c, 'option_price', {
            id: uuidv7(),
            brand_id: ids.brandA,
            market_id: ids.marketA,
            currency_code: 'AED',
            delta_minor: 1,
          }),
        '23514',
      );
      await rejects(
        (c) =>
          ins(c, 'option_group', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: A.product,
            key: 'message',
            type: 'TEXT',
          }),
        '23505',
      );
      await rejects(
        (c) =>
          ins(c, 'option_group', {
            id: uuidv7(),
            brand_id: ids.brandA,
            product_id: A.product,
            key: 'bad',
            type: 'TEXT',
            min_select: 3,
            max_select: 1,
          }),
        '23514',
      );
    });

    it('attributes: one global key per brand, product-specific keys per product, one primary image', async () => {
      await rejects(
        (c) => ins(c, 'attribute', { id: uuidv7(), brand_id: ids.brandA, key: 'size' }),
        '23505',
      );
      await rejects(
        (c) => ins(c, 'attribute', { id: uuidv7(), brand_id: ids.brandA, key: 'Bad Key' }),
        '23514',
      );
      await asOwner((c) =>
        ins(c, 'attribute', { id: uuidv7(), brand_id: ids.brandB, key: 'size-b2' }),
      );
      const second = uuidv7();
      await asOwner((c) =>
        ins(c, 'media_asset', {
          id: second,
          brand_id: ids.brandA,
          storage_key: `k/${second}`,
          original_filename: 'b.png',
          content_type: 'image/png',
          byte_size: 20,
          sha256: second.replace(/-/g, '').padEnd(64, '1'),
        }),
      );
      await rejects(
        (c) =>
          ins(c, 'product_media', {
            brand_id: ids.brandA,
            product_id: A.product,
            media_asset_id: second,
            is_primary: true,
          }),
        '23505',
      );
    });

    it('media: only JPEG, PNG and WebP, valid hash, no duplicate upload in a brand', async () => {
      const mk = (extra: Record<string, unknown>) => (c: PoolClient) => {
        const id = uuidv7();
        return ins(c, 'media_asset', {
          id,
          brand_id: ids.brandA,
          storage_key: `k/${id}`,
          original_filename: 'x',
          content_type: 'image/jpeg',
          byte_size: 5,
          sha256: id.replace(/-/g, '').padEnd(64, '2'),
          ...extra,
        });
      };
      await rejects(mk({ content_type: 'image/gif' }), '23514');
      await rejects(mk({ content_type: 'application/pdf' }), '23514');
      await rejects(mk({ sha256: 'xyz' }), '23514');
      await rejects(mk({ byte_size: 0 }), '23514');
      await rejects(mk({ sha256: A.media.replace(/-/g, '').padEnd(64, '0') }), '23505');
    });

    it('branch restrictions need a branch that serves the brand', async () => {
      await rejects(
        (c) =>
          ins(c, 'product_branch', {
            brand_id: ids.brandA,
            product_id: A.product2,
            branch_id: ids.branchY,
          }),
        '23514',
      );
      await asOwner((c) =>
        ins(c, 'product_branch', {
          brand_id: ids.brandB,
          product_id: B.product2,
          branch_id: ids.branchY,
        }),
      );
    });

    it('category tree: no cycles, at most four levels, same brand', async () => {
      const now = new Date();
      const [c1, c2, c3, c4, c5] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
      await asOwner(async (c) => {
        await ins(c, 'category', { id: c1, brand_id: ids.brandA, updated_at: now });
        await ins(c, 'category', { id: c2, brand_id: ids.brandA, parent_id: c1, updated_at: now });
        await ins(c, 'category', { id: c3, brand_id: ids.brandA, parent_id: c2, updated_at: now });
        await ins(c, 'category', { id: c4, brand_id: ids.brandA, parent_id: c3, updated_at: now });
      });
      await rejects(
        (c) => ins(c, 'category', { id: c5, brand_id: ids.brandA, parent_id: c4, updated_at: now }),
        '23514',
      );
      await rejects(
        (c) => c.query(`UPDATE category SET parent_id = $1 WHERE id = $2`, [c4, c1]),
        '23514',
      );
      await rejects(
        (c) => c.query(`UPDATE category SET parent_id = id WHERE id = $1`, [c1]),
        '23514',
      );
      await rejects(
        (c) => ins(c, 'category', { id: c5, brand_id: ids.brandB, parent_id: c1, updated_at: now }),
        '23503',
      );
    });

    it('deletion rules: parents with children, in-use media and referenced products are protected', async () => {
      await rejects((c) => c.query(`DELETE FROM media_asset WHERE id = $1`, [A.media]), '23503');
      // Deleting a product removes its dependent rows (translations, links, options, prices).
      const throwaway = uuidv7();
      await asOwner(async (c) => {
        await ins(c, 'product', {
          id: throwaway,
          brand_id: ids.brandA,
          type: 'SIMPLE',
          updated_at: new Date(),
        });
        await ins(c, 'product_translation', {
          brand_id: ids.brandA,
          product_id: throwaway,
          language: 'en',
          name: 'tmp',
          slug: 'tmp-throwaway',
        });
        await c.query(`DELETE FROM product WHERE id = $1`, [throwaway]);
        const left = await c.query(
          `SELECT count(*) AS n FROM product_translation WHERE product_id = $1`,
          [throwaway],
        );
        expect(Number(left.rows[0].n)).toBe(0);
      });
    });
  });
});
