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
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

const ORIGIN = 'http://localhost:3001';
const API = '/api/v1/admin/brands';
const PLATFORM = { brandIds: [], platform: true } as const;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Actor {
  call: (method: Method, path: string, body?: object) => request.Test;
}
describe('catalog listing performance (step 3.12)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let counter = 0;
  let brandA = '';
  let marketA = '';
  let manager: Actor;

  async function actor(
    label: string,
    permissions: string[],
    scope: { brandId: string; marketId?: string } | null,
  ): Promise<Actor> {
    const staff = await db.staffUser.create({
      data: {
        email: `${label}-${++counter}@example.test`,
        fullName: label,
        status: 'ACTIVE',
        passwordHash: 'fixture-no-login',
        mfaEnrolledAt: new Date(),
      },
    });
    if (scope) {
      const role = await db.role.create({
        data: {
          name: `${label} ${++counter}`,
          kind: 'CUSTOM',
          permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await db.staffRoleAssignment.create({
        data: { staffUserId: staff.id, roleId: role.id, ...scope },
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

  const asPlatform = <T>(fn: (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => Promise<T>) =>
    withScope(db, PLATFORM, fn);

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
    await owner.query('TRUNCATE staff_user, brand, branch, role, auth_attempt CASCADE');
    await resetAuditLog(owner);
    await seed(db, 'reference');
    app.get(TenantResolver).invalidateAll();
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const made = await asPlatform(async (tx) => {
      const a = await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } });
      const b = await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } });
      const mk = (brandId: string, code: string) =>
        tx.market.create({
          data: { brandId, countryId: ae.id, code, timezone: 'Asia/Dubai', status: 'ACTIVE' },
        });
      const m = await mk(a.id, 'ae');
      const mb = await mk(b.id, 'ae');
      for (const id of [m.id, mb.id]) {
        await tx.marketCurrency.create({
          data: { marketId: id, currencyCode: 'AED', isDefault: true },
        });
        await tx.marketLanguage.createMany({
          data: [
            { marketId: id, languageCode: 'en', isDefault: true, sortOrder: 0 },
            { marketId: id, languageCode: 'ar', isDefault: false, sortOrder: 1 },
          ],
        });
      }
      await tx.brandDomain.createMany({
        data: [
          { brandId: a.id, hostname: 'alpha.test', marketId: m.id, isPrimary: true },
          { brandId: a.id, hostname: 'alpha-all.test', isPrimary: false },
          { brandId: b.id, hostname: 'beta.test', marketId: mb.id, isPrimary: true },
        ],
      });
      return { a, b, m, mb };
    });
    brandA = made.a.id;
    marketA = made.m.id;
    const MANAGE = [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'products.publish',
      'taxonomy.manage',
      'pricing.edit',
      'media.manage',
    ];
    manager = await actor('manager', MANAGE, { brandId: brandA });
  });

  const PRODUCTS = 5000;

  /** Many published, priced products in one brand, inserted in bulk (not through the API). */
  async function seedMany(): Promise<void> {
    const c = await owner.connect();
    try {
      await c.query(`SELECT set_config('app.platform','on',false)`);
      await c.query(
        `INSERT INTO product (id, brand_id, type, status, sku, sort_order, updated_at)
         SELECT gen_random_uuid(), $1, 'SIMPLE'::"ProductType", (CASE WHEN n % 10 = 0 THEN 'DRAFT' ELSE 'PUBLISHED' END)::"ProductStatus",
                'PERF-' || n, n % 50, now()
         FROM generate_series(1, $2::int) n`,
        [brandA, PRODUCTS],
      );
      await c.query(
        `INSERT INTO product_translation (brand_id, product_id, language, name, slug)
         SELECT brand_id, id, 'en', 'Perf product ' || sku, lower(sku) FROM product WHERE brand_id = $1`,
        [brandA],
      );
      await c.query(
        `INSERT INTO product_market (brand_id, product_id, market_id)
         SELECT brand_id, id, $2 FROM product WHERE brand_id = $1`,
        [brandA, marketA],
      );
      await c.query(
        `INSERT INTO market_price (id, brand_id, market_id, currency_code, product_id, regular_minor, updated_at)
         SELECT gen_random_uuid(), brand_id, $2, 'AED', id, 10000, now() FROM product WHERE brand_id = $1`,
        [brandA, marketA],
      );
      await c.query('ANALYZE product, product_translation, product_market, market_price');
    } finally {
      c.release();
    }
  }

  async function timed(fn: () => request.Test): Promise<{
    ms: number;
    body: { items: unknown[]; total?: number; meta?: { total?: number } };
    status: number;
  }> {
    const start = performance.now();
    const res = await fn();
    const ms = performance.now() - start;
    if (process.env.PERF_LOG)
      process.stdout.write(`PERF ${res.status} ${ms.toFixed(0)} ms
`);
    return { ms, body: res.body, status: res.status };
  }

  // Generous ceilings: they catch a missing index or an accidental N+1 (seconds), not small drift.
  const LIMIT_MS = 1500;

  it(`lists ${PRODUCTS} products in the admin, filtered, searched and paged, within ${LIMIT_MS} ms`, async () => {
    await seedMany();
    const list = (q: string) => () => manager.call('get', `/${brandA}/catalog/products?${q}`);
    const cases = [
      'page=1&pageSize=50',
      'page=90&pageSize=50',
      'status=PUBLISHED&page=3&pageSize=50',
      'type=SIMPLE&pageSize=100',
      'search=perf-4999',
      'search=Perf%20product%20PERF-250',
    ];
    for (const q of cases) {
      const r = await timed(list(q));
      expect(r.status).toBe(200);
      expect({ q, ms: r.ms < LIMIT_MS }).toEqual({ q, ms: true });
    }
    const first = await timed(list('page=1&pageSize=50'));
    expect(first.body.total ?? first.body.meta?.total).toBe(PRODUCTS);
  }, 120_000);

  it(`serves the public product list for ${PRODUCTS} products within ${LIMIT_MS} ms, cached or not`, async () => {
    await seedMany();
    const host = (q: string) => () =>
      request(app.getHttpServer()).get(`/api/v1/catalog/products?${q}`).set('Host', 'alpha.test');
    for (const q of [
      'limit=24',
      'limit=24&page=100',
      'limit=24&sort=newest&page=50',
      'limit=24&q=PERF-1234',
    ]) {
      const cold = await timed(host(q));
      expect(cold.status).toBe(200);
      expect({ q, ms: cold.ms < LIMIT_MS }).toEqual({ q, ms: true });
      const warm = await timed(host(q));
      expect(warm.status).toBe(200);
      expect(warm.ms).toBeLessThan(LIMIT_MS);
    }
    // Price orders rank every candidate in memory (known limit, see PROGRESS): a looser ceiling.
    const byPrice = await timed(host('limit=24&sort=price_asc'));
    expect(byPrice.status).toBe(200);
    expect(byPrice.ms).toBeLessThan(5000);
    expect(byPrice.body.items).toHaveLength(24);
  }, 120_000);
});
