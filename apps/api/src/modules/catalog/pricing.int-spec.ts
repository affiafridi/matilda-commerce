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
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

const ORIGIN = 'http://localhost:3001';
const API = '/api/v1/admin/brands';
const PLATFORM = { brandIds: [], platform: true } as const;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Actor {
  call: (method: Method, path: string, body?: object) => request.Test;
}
describe('catalog pricing (market prices, sales, preview)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let counter = 0;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let manager: Actor;
  let managerB: Actor;
  let viewer: Actor;
  let marketManager: Actor;
  let nobody: Actor;

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

  const base = (brandId: string, rest: string) => `/${brandId}/catalog/${rest}`;

  async function auditCount(action: string): Promise<number> {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const res = await client.query('SELECT 1 FROM audit_log WHERE action = $1', [action]);
      return res.rowCount ?? 0;
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
    await owner.query('TRUNCATE staff_user, brand, branch, role, auth_attempt CASCADE');
    await resetAuditLog(owner);
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const { a, b, m } = await asPlatform(async (tx) => {
      const a = await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } });
      const b = await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } });
      const m = await tx.market.create({
        data: { brandId: a.id, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
      });
      return { a, b, m };
    });
    brandA = a.id;
    brandB = b.id;
    marketA = m.id;
    await asPlatform((tx) =>
      tx.marketCurrency.create({
        data: { marketId: m.id, currencyCode: 'AED', isDefault: true },
      }),
    );
    const MANAGE = [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'taxonomy.manage',
      'pricing.edit',
    ];
    manager = await actor('manager', MANAGE, { brandId: brandA });
    managerB = await actor('managerb', MANAGE, { brandId: brandB });
    viewer = await actor('viewer', ['products.view'], { brandId: brandA });
    marketManager = await actor('marketmanager', MANAGE, { brandId: brandA, marketId: marketA });
    nobody = await actor('nobody', [], null);
  });

  const P = (id: string, rest = '') => base(brandA, `products/${id}${rest}`);
  const label = (text: string) => ({ language: 'en', label: text });
  const day = 86_400_000;
  const inDays = (n: number) => new Date(Date.now() + n * day).toISOString();

  async function simple(name = 'Rose Bouquet', type: 'SIMPLE' | 'BUNDLE' = 'SIMPLE') {
    const res = await manager.call('post', base(brandA, 'products'), {
      type,
      translations: [{ language: 'en', name }],
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }
  async function variable() {
    const size = await manager.call('post', base(brandA, 'attributes'), {
      key: 'size',
      translations: [label('Size')],
      values: ['1kg', '2kg'].map((k) => ({ key: k, translations: [label(k)] })),
    });
    const attrId = size.body.id as string;
    const p = await manager.call('post', base(brandA, 'products'), {
      type: 'VARIABLE',
      translations: [{ language: 'en', name: 'Cake' }],
    });
    await manager.call('put', P(p.body.id, '/attributes'), {
      attributes: [
        {
          attributeId: attrId,
          drivesVariations: true,
          valueIds: size.body.values.map((v: { id: string }) => v.id),
        },
      ],
    });
    const gen = await manager.call('post', P(p.body.id, '/variations/generate'), {
      skuPrefix: 'CK',
    });
    return { id: p.body.id as string, variations: gen.body as { id: string; sku: string }[] };
  }
  const aed = (regular: number, extra: object = {}, variationId?: string) => ({
    marketId: marketA,
    currency: 'AED',
    regular,
    ...(variationId && { variationId }),
    ...extra,
  });

  describe('permission and scope', () => {
    it('needs pricing.edit to change prices, products.view to read them', async () => {
      const p = await simple();
      const body = { prices: [aed(15000)] };
      expect((await viewer.call('put', P(p.id, '/prices'), body)).status).toBe(403);
      const editor = await actor('editor', ['products.view', 'products.edit'], { brandId: brandA });
      expect((await editor.call('put', P(p.id, '/prices'), body)).status).toBe(403);
      expect((await manager.call('put', P(p.id, '/prices'), body)).status).toBe(200);
      expect((await viewer.call('get', P(p.id, '/prices'))).body).toHaveLength(1);
      expect((await nobody.call('get', P(p.id, '/prices'))).status).toBe(403);
      expect((await marketManager.call('put', P(p.id, '/prices'), body)).status).toBe(403);
    });

    it('isolates brands', async () => {
      const p = await simple();
      await manager.call('put', P(p.id, '/prices'), { prices: [aed(15000)] });
      expect((await managerB.call('get', P(p.id, '/prices'))).status).toBe(403);
      const own = await managerB.call('get', base(brandB, `products/${p.id}/prices`));
      expect(own.status).toBe(404);
    });
  });

  describe('setting prices', () => {
    it('sets a simple product price in integer minor units and audits it', async () => {
      const p = await simple();
      const res = await manager.call('put', P(p.id, '/prices'), {
        prices: [aed(15050, { sale: 12000, saleStartsAt: inDays(1), saleEndsAt: inDays(5) })],
      });
      expect(res.status).toBe(200);
      expect(res.body[0]).toEqual(
        expect.objectContaining({
          marketId: marketA,
          currency: 'AED',
          regular: 15050,
          sale: 12000,
          variationId: null,
        }),
      );
      expect(await auditCount('price.set')).toBe(1);
    });

    it('replaces the whole set and removes one price', async () => {
      const p = await simple();
      await manager.call('put', P(p.id, '/prices'), { prices: [aed(15000)] });
      const replaced = await manager.call('put', P(p.id, '/prices'), { prices: [aed(16000)] });
      expect(replaced.body).toHaveLength(1);
      expect(replaced.body[0].regular).toBe(16000);
      const gone = await manager.call('delete', P(p.id, `/prices/${replaced.body[0].id}`));
      expect(gone.status).toBe(200);
      expect(gone.body).toEqual([]);
      expect(await auditCount('price.delete')).toBe(1);
      const missing = await manager.call('delete', P(p.id, `/prices/${replaced.body[0].id}`));
      expect(missing.status).toBe(404);
    });

    it('rejects floats, negatives, bad sales and bad dates', async () => {
      const p = await simple();
      const put = (price: object) => manager.call('put', P(p.id, '/prices'), { prices: [price] });
      expect((await put(aed(150.5))).status).toBe(400);
      expect((await put(aed(-1))).status).toBe(400);
      expect((await put(aed(1000, { sale: 1000 }))).status).toBe(400);
      expect((await put(aed(1000, { saleStartsAt: inDays(1) }))).status).toBe(400);
      const backwards = await put(
        aed(1000, { sale: 500, saleStartsAt: inDays(5), saleEndsAt: inDays(1) }),
      );
      expect(backwards.status).toBe(400);
    });

    it('rejects a currency the market does not use, a foreign market and duplicates', async () => {
      const p = await simple();
      const put = (prices: object[]) => manager.call('put', P(p.id, '/prices'), { prices });
      expect((await put([{ ...aed(1000), currency: 'USD' }])).body.code).toBe(
        'CURRENCY_NOT_IN_MARKET',
      );
      const foreign = await asPlatform(async (tx) => {
        const ae = await tx.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
        return tx.market.create({
          data: { brandId: brandB, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
        });
      });
      expect((await put([{ ...aed(1000), marketId: foreign.id }])).body.code).toBe(
        'MARKET_NOT_FOUND',
      );
      expect((await put([aed(1000), aed(2000)])).body.code).toBe('DUPLICATE_PRICE');
    });

    it('prices variable products per variation and simple products on the product', async () => {
      const cake = await variable();
      const [a, b] = cake.variations;
      const onProduct = await manager.call('put', P(cake.id, '/prices'), { prices: [aed(1000)] });
      expect(onProduct.body.code).toBe('VARIATION_REQUIRED');
      const ok = await manager.call('put', P(cake.id, '/prices'), {
        prices: [aed(18000, {}, a?.id), aed(32000, {}, b?.id)],
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toHaveLength(2);
      const rose = await simple('Roses');
      const withVariation = await manager.call('put', P(rose.id, '/prices'), {
        prices: [aed(1000, {}, a?.id)],
      });
      expect(withVariation.body.code).toBe('VARIATION_NOT_ALLOWED');
      const foreignVariation = await manager.call('put', P(cake.id, '/prices'), {
        prices: [aed(1000, {}, '00000000-0000-4000-8000-000000000000')],
      });
      expect(foreignVariation.body.code).toBe('VARIATION_NOT_FOUND');
    });

    it('prices bundles on the bundle itself', async () => {
      const bundle = await simple('Gift Set', 'BUNDLE');
      const res = await manager.call('put', P(bundle.id, '/prices'), { prices: [aed(25000)] });
      expect(res.status).toBe(200);
    });

    it("drops a deleted variation's prices and a variable switch drops product prices", async () => {
      const cake = await variable();
      const [a, b] = cake.variations;
      await manager.call('put', P(cake.id, '/prices'), {
        prices: [aed(18000, {}, a?.id), aed(32000, {}, b?.id)],
      });
      await manager.call('delete', P(cake.id, `/variations/${a?.id}`));
      expect((await manager.call('get', P(cake.id, '/prices'))).body).toHaveLength(1);
      const p = await simple('Switcher');
      await manager.call('put', P(p.id, '/prices'), { prices: [aed(1000)] });
      await manager.call('patch', P(p.id), { type: 'VARIABLE' });
      const left = await asPlatform((tx) => tx.marketPrice.count({ where: { productId: p.id } }));
      expect(left).toBe(0);
    });
  });

  describe('price preview', () => {
    it('shows regular, sale and the effective price at a chosen moment', async () => {
      const p = await simple();
      await manager.call('put', P(p.id, '/prices'), {
        prices: [aed(20000, { sale: 15050, saleStartsAt: inDays(2), saleEndsAt: inDays(4) })],
      });
      const preview = (at?: string) =>
        viewer.call('get', P(p.id, `/price-preview?marketId=${marketA}${at ? `&at=${at}` : ''}`));
      const now = await preview();
      expect(now.body.items[0].prices[0]).toEqual(
        expect.objectContaining({
          regular: 20000,
          effective: 20000,
          onSale: false,
          display: '200.00',
        }),
      );
      const during = await preview(inDays(3));
      expect(during.body.items[0].prices[0]).toEqual(
        expect.objectContaining({ effective: 15050, onSale: true, display: '150.50' }),
      );
      const after = await preview(inDays(4));
      expect(after.body.items[0].prices[0].onSale).toBe(false);
    });

    it('lists every variation of a variable product and rejects a foreign market', async () => {
      const cake = await variable();
      const [a] = cake.variations;
      await manager.call('put', P(cake.id, '/prices'), { prices: [aed(18000, {}, a?.id)] });
      const res = await viewer.call('get', P(cake.id, `/price-preview?marketId=${marketA}`));
      expect(res.body.items).toHaveLength(2);
      const priced = res.body.items.find((i: { variationId: string }) => i.variationId === a?.id);
      expect(priced.prices[0].effective).toBe(18000);
      expect(
        res.body.items.filter((i: { prices: unknown[] }) => i.prices.length === 0),
      ).toHaveLength(1);
      const foreign = await viewer.call(
        'get',
        P(cake.id, '/price-preview?marketId=00000000-0000-4000-8000-000000000000'),
      );
      expect(foreign.status).toBe(404);
    });
  });
});
