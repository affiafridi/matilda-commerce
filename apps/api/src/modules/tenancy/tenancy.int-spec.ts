import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import { uuidv7 } from '../../common/ids/uuid7';
import type { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { StorefrontContextService } from './storefront-context.service';
import { TenantResolver } from './tenant-resolver.service';

describe('tenant resolution and storefront context (database)', () => {
  let owner: Pool;
  let client: PrismaClient;
  let resolver: TenantResolver;
  let contextService: StorefrontContextService;
  const ids = { a: uuidv7(), b: uuidv7(), ma: uuidv7(), mb: uuidv7(), ae: uuidv7() };

  beforeAll(async () => {
    owner = createPool(testOwnerUrl());
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testAppUrl() }) });
    const prisma = { client } as unknown as PrismaService;
    resolver = new TenantResolver(prisma);
    contextService = new StorefrontContextService(prisma);

    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    const db = await owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.platform', 'on', true)`);
      await db.query(
        `INSERT INTO currency (code, name, symbol, minor_unit_digits) VALUES ('AED','UAE Dirham','AED',2) ON CONFLICT DO NOTHING`,
      );
      await db.query(
        `INSERT INTO language (code, name, native_name, direction) VALUES ('en','English','English','LTR'),('ar','Arabic','Arabic','RTL') ON CONFLICT DO NOTHING`,
      );
      await db.query(`DELETE FROM country WHERE iso2 = 'AE'`);
      await db.query(
        `INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'AE','ARE','United Arab Emirates')`,
        [ids.ae],
      );
      await db.query(
        `INSERT INTO brand (id, slug, name, status, updated_at) VALUES ($1,'alpha','Alpha','ACTIVE', now()), ($2,'beta','Beta','ACTIVE', now())`,
        [ids.a, ids.b],
      );
      await db.query(
        `INSERT INTO market (id, brand_id, country_id, code, status, timezone, updated_at) VALUES ($1,$3,$5,'ae','ACTIVE','Asia/Dubai', now()), ($2,$4,$5,'ae','ACTIVE','Asia/Dubai', now())`,
        [ids.ma, ids.mb, ids.a, ids.b, ids.ae],
      );
      await db.query(`INSERT INTO market_currency VALUES ($1,'AED',true), ($2,'AED',true)`, [
        ids.ma,
        ids.mb,
      ]);
      await db.query(
        `INSERT INTO market_language (market_id, language_code, is_default, sort_order) VALUES ($1,'en',true,0), ($1,'ar',false,1), ($2,'en',true,0)`,
        [ids.ma, ids.mb],
      );
      await db.query(
        `INSERT INTO brand_domain (id, brand_id, hostname, market_id, is_primary) VALUES ($1,$2,'alpha.test',$3,true), ($4,$5,'beta.test',$6,true)`,
        [uuidv7(), ids.a, ids.ma, uuidv7(), ids.b, ids.mb],
      );
      await db.query(
        `INSERT INTO brand_domain (id, brand_id, hostname, market_id, is_primary, redirect_to_primary, default_language_code) VALUES ($1,$2,'www.alpha.test',$3,false,true,'ar')`,
        [uuidv7(), ids.a, ids.ma],
      );
      await db.query('COMMIT');
    } finally {
      db.release();
    }
  });

  afterAll(async () => {
    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await Promise.all([owner.end(), client.$disconnect()]);
  });

  it('resolves each domain to its own brand and market', async () => {
    expect(await resolver.resolve('alpha.test')).toMatchObject({
      brand: { slug: 'alpha' },
      market: { code: 'ae' },
    });
    expect(await resolver.resolve('BETA.test:3000')).toMatchObject({ brand: { slug: 'beta' } });
    expect(await resolver.resolve('missing.test')).toBeNull();
  });

  it('returns only the resolved brand data', async () => {
    const tenant = (await resolver.resolve('alpha.test'))!;
    const ctx = await contextService.load(tenant);
    expect(ctx.brand).toEqual({ slug: 'alpha', name: 'Alpha', themeKey: 'alpha' });
    expect(ctx.market?.currencies).toEqual([
      { code: 'AED', symbol: 'AED', minorUnitDigits: 2, isDefault: true },
    ]);
    expect(ctx.market?.languages.map((l) => l.code)).toEqual(['en', 'ar']);
    expect(ctx.language).toBe('en');
    expect(ctx.redirect).toBeNull();
    expect(JSON.stringify(ctx)).not.toContain('Beta');
  });

  it('reports the primary host and domain language for alias domains', async () => {
    const ctx = await contextService.load((await resolver.resolve('www.alpha.test'))!);
    expect(ctx.redirect).toEqual({ hostname: 'alpha.test' });
    expect(ctx.language).toBe('ar');
  });

  it('stops resolving a brand once it is deactivated (after invalidation)', async () => {
    const db = await owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.platform', 'on', true)`);
      const res = await db.query(`UPDATE brand SET status = 'INACTIVE' WHERE id = $1`, [ids.b]);
      expect(res.rowCount).toBe(1);
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    // Still cached until invalidated.
    expect(await resolver.resolve('beta.test')).not.toBeNull();
    resolver.invalidateBrand(ids.b);
    expect(await resolver.resolve('beta.test')).toBeNull();
  });
});
