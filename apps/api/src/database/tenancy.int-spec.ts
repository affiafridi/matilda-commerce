import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/ids/uuid7';
import { createPool, testAppUrl, testOwnerUrl } from '../test-support/test-db';

interface Ctx {
  brandIds?: string[];
  platform?: boolean;
}

/** Runs `fn` in a transaction with the tenant context set, exactly like the data-access layer. */
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

describe('tenancy schema (step 2.2)', () => {
  let owner: Pool;
  let app: Pool;

  const ids = {
    brandA: uuidv7(),
    brandB: uuidv7(),
    brandOff: uuidv7(),
    ae: uuidv7(),
    sa: uuidv7(),
    marketA: uuidv7(),
    marketB: uuidv7(),
    marketAsa: uuidv7(),
    branchX: uuidv7(),
  };

  const asOwner = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(owner, { platform: true }, fn);
  const asPlatform = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(app, { platform: true }, fn);
  const asBrand = <T>(brandIds: string[], fn: (c: PoolClient) => Promise<T>) =>
    inTx(app, { brandIds }, fn);
  const asNobody = <T>(fn: (c: PoolClient) => Promise<T>) => inTx(app, {}, fn);

  const count = async (c: PoolClient, table: string): Promise<number> =>
    Number((await c.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

  beforeAll(() => {
    owner = createPool(testOwnerUrl());
    app = createPool(testAppUrl());
  });

  afterAll(async () => {
    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await Promise.all([owner.end(), app.end()]);
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await asOwner(async (c) => {
      await c.query(`INSERT INTO currency (code, name, symbol, minor_unit_digits) VALUES
        ('AED','UAE Dirham','AED',2), ('SAR','Saudi Riyal','SAR',2) ON CONFLICT DO NOTHING`);
      await c.query(`INSERT INTO language (code, name, native_name, direction) VALUES
        ('en','English','English','LTR'), ('ar','Arabic','Arabic','RTL') ON CONFLICT DO NOTHING`);
      await c.query(`DELETE FROM country WHERE iso2 IN ('AE','SA','KW')`);
      await c.query(
        `INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'AE','ARE','United Arab Emirates'), ($2,'SA','SAU','Saudi Arabia')`,
        [ids.ae, ids.sa],
      );
      await c.query(
        `INSERT INTO brand (id, slug, name, status, updated_at) VALUES
          ($1,'brand-a','Brand A','ACTIVE', now()), ($2,'brand-b','Brand B','ACTIVE', now()),
          ($3,'brand-off','Brand Off','INACTIVE', now())`,
        [ids.brandA, ids.brandB, ids.brandOff],
      );
      await c.query(
        `INSERT INTO market (id, brand_id, country_id, code, timezone, updated_at) VALUES
          ($1,$2,$3,'ae','Asia/Dubai', now()), ($4,$5,$3,'ae','Asia/Dubai', now()),
          ($6,$2,$7,'sa','Asia/Riyadh', now())`,
        [ids.marketA, ids.brandA, ids.ae, ids.marketB, ids.brandB, ids.marketAsa, ids.sa],
      );
      await c.query(
        `INSERT INTO market_currency (market_id, currency_code, is_default) VALUES ($1,'AED',true), ($2,'AED',true)`,
        [ids.marketA, ids.marketB],
      );
      await c.query(
        `INSERT INTO market_language (market_id, language_code, is_default) VALUES ($1,'en',true), ($2,'en',true)`,
        [ids.marketA, ids.marketB],
      );
      await c.query(
        `INSERT INTO brand_domain (id, brand_id, hostname, market_id, is_primary) VALUES
          ($1,$2,'a.example.test',$3,true), ($4,$5,'b.example.test',$6,true)`,
        [uuidv7(), ids.brandA, ids.marketA, uuidv7(), ids.brandB, ids.marketB],
      );
      await c.query(
        `INSERT INTO brand_domain (id, brand_id, hostname, is_primary) VALUES ($1,$2,'off.example.test',true)`,
        [uuidv7(), ids.brandOff],
      );
      await c.query(
        `INSERT INTO branch (id, code, name, country_id, timezone, updated_at) VALUES ($1,'branch-x','Branch X',$2,'Asia/Dubai', now())`,
        [ids.branchX, ids.ae],
      );
      await c.query(
        `INSERT INTO branch_market (branch_id, market_id, country_id) VALUES ($1,$2,$3)`,
        [ids.branchX, ids.marketA, ids.ae],
      );
    });
  });

  describe('constraints', () => {
    const rejects = (fn: (c: PoolClient) => Promise<unknown>, code: string) =>
      expect(asOwner(fn)).rejects.toMatchObject({ code });

    it('rejects a duplicate hostname', () =>
      rejects(
        (c) =>
          c.query(
            `INSERT INTO brand_domain (id, brand_id, hostname) VALUES ($1,$2,'a.example.test')`,
            [uuidv7(), ids.brandB],
          ),
        '23505',
      ));

    it('rejects an uppercase hostname', () =>
      rejects(
        (c) =>
          c.query(
            `INSERT INTO brand_domain (id, brand_id, hostname) VALUES ($1,$2,'Mixed.Example.test')`,
            [uuidv7(), ids.brandA],
          ),
        '23514',
      ));

    it('rejects a second primary domain for the same brand and market', () =>
      rejects(
        (c) =>
          c.query(
            `INSERT INTO brand_domain (id, brand_id, hostname, market_id, is_primary) VALUES ($1,$2,'a2.example.test',$3,true)`,
            [uuidv7(), ids.brandA, ids.marketA],
          ),
        '23505',
      ));

    it("rejects a domain that points at another brand's market", () =>
      rejects(
        (c) =>
          c.query(
            `INSERT INTO brand_domain (id, brand_id, hostname, market_id) VALUES ($1,$2,'x.example.test',$3)`,
            [uuidv7(), ids.brandA, ids.marketB],
          ),
        '23503',
      ));

    it('rejects linking a branch to a market of another country', () =>
      rejects(
        (c) =>
          c.query(
            `INSERT INTO branch_market (branch_id, market_id, country_id) VALUES ($1,$2,$3)`,
            [ids.branchX, ids.marketAsa, ids.ae],
          ),
        '23503',
      ));

    it('rejects a second default currency and a second default language per market', async () => {
      await rejects(
        (c) =>
          c.query(
            `INSERT INTO market_currency (market_id, currency_code, is_default) VALUES ($1,'SAR',true)`,
            [ids.marketA],
          ),
        '23505',
      );
      await rejects(
        (c) =>
          c.query(
            `INSERT INTO market_language (market_id, language_code, is_default) VALUES ($1,'ar',true)`,
            [ids.marketA],
          ),
        '23505',
      );
    });

    it('rejects a duplicate market per brand and country', () =>
      rejects(
        (c) =>
          c.query(
            `INSERT INTO market (id, brand_id, country_id, code, timezone, updated_at) VALUES ($1,$2,$3,'uae','Asia/Dubai', now())`,
            [uuidv7(), ids.brandA, ids.ae],
          ),
        '23505',
      ));

    it('rejects an invalid brand slug and any slug change', async () => {
      await rejects(
        (c) =>
          c.query(
            `INSERT INTO brand (id, slug, name, updated_at) VALUES ($1,'Bad Slug','x', now())`,
            [uuidv7()],
          ),
        '23514',
      );
      await expect(
        asOwner((c) => c.query(`UPDATE brand SET slug = 'renamed' WHERE id = $1`, [ids.brandA])),
      ).rejects.toThrow('brand.slug is immutable');
    });
  });

  describe('row-level security', () => {
    it('shows a brand only its own rows in every tenancy table', async () => {
      await asBrand([ids.brandA], async (c) => {
        expect(await count(c, 'brand')).toBe(1);
        expect(await count(c, 'brand_domain')).toBe(1);
        expect(await count(c, 'market')).toBe(2);
        expect(await count(c, 'market_currency')).toBe(1);
        expect(await count(c, 'market_language')).toBe(1);
        expect(await count(c, 'branch_market')).toBe(1);
        expect(await count(c, 'branch')).toBe(1);
      });
      await asBrand([ids.brandB], async (c) => {
        expect(await count(c, 'brand')).toBe(1);
        expect(await count(c, 'market')).toBe(1);
        expect(await count(c, 'branch_market')).toBe(0);
        expect(await count(c, 'branch')).toBe(0);
      });
    });

    it('shows several brands when the context lists several', async () => {
      await asBrand([ids.brandA, ids.brandB], async (c) => {
        expect(await count(c, 'brand')).toBe(2);
        expect(await count(c, 'brand_domain')).toBe(2);
      });
    });

    it('shows nothing without a context and everything to the platform', async () => {
      await asNobody(async (c) => {
        for (const t of ['brand', 'brand_domain', 'market', 'branch', 'branch_market']) {
          expect(await count(c, t)).toBe(0);
        }
      });
      await asPlatform(async (c) => {
        expect(await count(c, 'brand')).toBe(3);
        expect(await count(c, 'branch')).toBe(1);
      });
    });

    it("blocks writing another brand's rows", async () => {
      await expect(
        asBrand([ids.brandA], (c) =>
          c.query(
            `INSERT INTO market (id, brand_id, country_id, code, timezone, updated_at) VALUES ($1,$2,$3,'zz','Asia/Dubai', now())`,
            [uuidv7(), ids.brandB, ids.sa],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });

      const updated = await asBrand([ids.brandA], (c) =>
        c.query(`UPDATE brand SET name = 'Hijacked', updated_at = now() WHERE id = $1`, [
          ids.brandB,
        ]),
      );
      expect(updated.rowCount).toBe(0);
      const deleted = await asBrand([ids.brandA], (c) =>
        c.query(`DELETE FROM brand_domain WHERE brand_id = $1`, [ids.brandB]),
      );
      expect(deleted.rowCount).toBe(0);
    });

    it('lets a brand write its own markets but creating branches is platform-only', async () => {
      const kw = uuidv7();
      await asOwner((c) =>
        c.query(`INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'KW','KWT','Kuwait')`, [kw]),
      );
      await expect(
        asBrand([ids.brandA], (c) =>
          c.query(
            `INSERT INTO market (id, brand_id, country_id, code, timezone, updated_at) VALUES ($1,$2,$3,'kw','Asia/Kuwait', now())`,
            [uuidv7(), ids.brandA, kw],
          ),
        ),
      ).resolves.toBeDefined();
      const insertBranch = (c: PoolClient) =>
        c.query(
          `INSERT INTO branch (id, code, name, country_id, timezone, updated_at) VALUES ($1,'branch-y','Y',$2,'Asia/Dubai', now())`,
          [uuidv7(), ids.ae],
        );
      await expect(asBrand([ids.brandA], insertBranch)).rejects.toMatchObject({ code: '42501' });
      await expect(asPlatform(insertBranch)).resolves.toBeDefined();
    });

    it('does not let the runtime role change reference data', async () => {
      await expect(
        asPlatform((c) => c.query(`UPDATE currency SET name = 'x' WHERE code = 'AED'`)),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asPlatform((c) =>
          c.query(
            `INSERT INTO language (code, name, native_name, direction) VALUES ('fr','F','F','LTR')`,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('resolve_brand_domain', () => {
    const resolve = (c: PoolClient, host: string) =>
      c.query('SELECT * FROM resolve_brand_domain($1)', [host]);

    it('resolves only the requested host, without any prior context', async () => {
      await asNobody(async (c) => {
        const { rows } = await resolve(c, 'A.Example.test');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          brand_id: ids.brandA,
          brand_slug: 'brand-a',
          market_id: ids.marketA,
          market_code: 'ae',
          is_primary: true,
        });
      });
    });

    it('ignores unknown hosts and inactive brands', async () => {
      await asNobody(async (c) => {
        expect((await resolve(c, 'unknown.example.test')).rows).toHaveLength(0);
        expect((await resolve(c, 'off.example.test')).rows).toHaveLength(0);
      });
    });

    it('does not leave platform access behind in the transaction', async () => {
      await asNobody(async (c) => {
        await resolve(c, 'a.example.test');
        expect(await count(c, 'brand')).toBe(0);
        expect(await count(c, 'brand_domain')).toBe(0);
      });
    });

    it('cannot be executed by roles other than the runtime role', async () => {
      const { rows } = await owner.query(
        `SELECT has_function_privilege('public', 'resolve_brand_domain(text)', 'EXECUTE') AS pub`,
      );
      expect(rows[0].pub).toBe(false);
    });
  });
});
