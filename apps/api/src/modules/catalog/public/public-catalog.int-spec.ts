import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { configureApp } from '../../../app.setup';
import { seed } from '../../../cli/seed';
import { hashToken } from '../../../common/security/tokens';
import { loadEnv } from '../../../config/env';
import { withScope } from '../../../database/scope';
import { PrismaClient } from '../../../generated/prisma/client';
import { TenantResolver } from '../../tenancy/tenant-resolver.service';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../../test-support/test-db';

const ORIGIN = 'http://localhost:3001';
const API = '/api/v1/admin/brands';
const PLATFORM = { brandIds: [], platform: true } as const;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Actor {
  call: (method: Method, path: string, body?: object) => request.Test;
}
describe('public catalog read API (host resolution, visibility, languages)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let counter = 0;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketB = '';
  let mediaDir = '';
  let manager: Actor;
  let managerB: Actor;

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

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    mediaDir = mkdtempSync(path.join(tmpdir(), 'matilda-media-'));
    process.env.MEDIA_LOCAL_DIR = mediaDir;
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
    rmSync(mediaDir, { recursive: true, force: true });
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
    brandB = made.b.id;
    marketA = made.m.id;
    marketB = made.mb.id;
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
    managerB = await actor('managerb', MANAGE, { brandId: brandB });
  });

  const tr = (label: string) => [{ language: 'en', label }];
  const en = (name: string, extra: object = {}) => ({ language: 'en', name, ...extra });
  const aed = (regular: number, extra: object = {}, variationId?: string, marketId = marketA) => ({
    marketId,
    currency: 'AED',
    regular,
    ...(variationId && { variationId }),
    ...extra,
  });
  const P = (id: string, rest = '') => base(brandA, `products/${id}${rest}`);
  const get = (path: string, host = 'alpha.test') =>
    request(app.getHttpServer()).get(`/api/v1/catalog${path}`).set('Host', host);

  /** A product that is published, sold in the Alpha market and priced. */
  async function listed(
    name: string,
    price = 15000,
    extra: { type?: 'SIMPLE' | 'BUNDLE'; priceExtra?: object; who?: Actor; brand?: string } = {},
  ) {
    const who = extra.who ?? manager;
    const brand = extra.brand ?? brandA;
    const market = brand === brandA ? marketA : marketB;
    const created = await who.call('post', base(brand, 'products'), {
      type: extra.type ?? 'SIMPLE',
      translations: [en(name)],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const p = (rest = '') => base(brand, `products/${id}${rest}`);
    await who.call('put', p('/availability'), { marketIds: [market], branchIds: [] });
    const priced = await who.call('put', p('/prices'), {
      prices: [aed(price, extra.priceExtra, undefined, market)],
    });
    expect(priced.status).toBe(200);
    return { id, publish: () => who.call('post', p('/publish')) };
  }
  async function live(name: string, price = 15000, extra: Parameters<typeof listed>[2] = {}) {
    const l = await listed(name, price, extra);
    const res = await l.publish();
    expect(res.status).toBe(200);
    return l.id;
  }
  async function upload(r: number, alt = 'A cake') {
    const file = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r, g: 90, b: 120 } },
    })
      .jpeg()
      .toBuffer();
    const res = await manager
      .call('post', base(brandA, 'media'))
      .attach('file', file, 'x.jpg')
      .field('altText', alt);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('lists only published products of the market resolved from the host', async () => {
    await live('Rose Cake', 15000);
    await listed('Draft Cake', 9000); // never published
    const archived = await live('Old Cake', 8000);
    await manager.call('post', P(archived, '/archive'));
    const scheduled = await live('Later Cake', 8000);
    const expired = await live('Gone Cake', 8000);
    await asPlatform(async (tx) => {
      await tx.product.update({
        where: { id: scheduled },
        data: { publishAt: new Date(Date.now() + 86_400_000) },
      });
      await tx.product.update({
        where: { id: expired },
        data: { unpublishAt: new Date(Date.now() - 1000) },
      });
    });
    const elsewhere = await live('Other Market Cake', 7000);
    await asPlatform((tx) => tx.productMarket.deleteMany({ where: { productId: elsewhere } }));
    const res = await get('/products');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Rose Cake']);
    expect(res.body.items[0]).toMatchObject({
      type: 'SIMPLE',
      slug: 'rose-cake',
      price: { currency: 'AED', amount: 15000, display: '150.00', onSale: false, from: false },
    });
    expect(res.headers['cache-control']).toContain('max-age=30');
    expect(res.headers['content-language']).toBe('en');
  });

  it('answers 404 for unknown hosts and never mixes brands', async () => {
    await live('Alpha Cake');
    await live('Beta Cake', 9000, { who: managerB, brand: brandB });
    expect((await get('/products', 'nobody.test')).status).toBe(404);
    const beta = await get('/products', 'beta.test');
    expect(beta.body.items.map((i: { name: string }) => i.name)).toEqual(['Beta Cake']);
    const alpha = await get('/products', 'alpha.test');
    expect(alpha.body.items.map((i: { name: string }) => i.name)).toEqual(['Alpha Cake']);
    // A client-sent brand or market identifier has no effect.
    const spoof = await get(`/products?brandId=${brandB}&marketId=${marketB}`);
    expect(spoof.body.items.map((i: { name: string }) => i.name)).toEqual(['Alpha Cake']);
    expect((await get('/products/beta-cake')).status).toBe(404);
    expect((await get('/products/beta-cake', 'beta.test')).status).toBe(200);
  });

  it('needs a market on brand-wide domains and checks it belongs to the brand', async () => {
    await live('Alpha Cake');
    const none = await get('/products', 'alpha-all.test');
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('MARKET_REQUIRED');
    const ok = await get('/products?market=ae', 'alpha-all.test');
    expect(ok.body.items).toHaveLength(1);
    expect((await get('/products?market=zz', 'alpha-all.test')).body.code).toBe('MARKET_NOT_FOUND');
    await asPlatform((tx) =>
      tx.market.update({ where: { id: marketA }, data: { status: 'SUSPENDED' } }),
    );
    app.get(TenantResolver).invalidateAll();
    expect((await get('/products?market=ae', 'alpha-all.test')).status).toBe(404);
  });

  it('answers in the requested language with fallback to English', async () => {
    const id = await live('Rose Cake');
    await manager.call('put', P(id, '/translations/ar'), {
      name: 'كعكة الورد',
      slug: 'kaka-alward',
    });
    await live('English Only');
    const ar = await get('/products?language=ar');
    expect(ar.headers['content-language']).toBe('ar');
    expect(ar.body.items.map((i: { name: string }) => i.name).sort()).toEqual(
      ['English Only', 'كعكة الورد'].sort(),
    );
    const detail = await get('/products/kaka-alward?language=ar');
    expect(detail.status).toBe(200);
    expect(detail.body.alternates).toEqual(
      expect.arrayContaining([
        { language: 'en', slug: 'rose-cake' },
        { language: 'ar', slug: 'kaka-alward' },
      ]),
    );
    expect((await get('/products/kaka-alward')).status).toBe(404); // slug belongs to Arabic
    const bad = await get('/products?language=fr');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('UNSUPPORTED_LANGUAGE');
  });

  it('shows the sale price only while the sale runs', async () => {
    await live('Sale Cake', 20000, {
      priceExtra: {
        sale: 15000,
        saleStartsAt: new Date(Date.now() - 3_600_000).toISOString(),
        saleEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    await live('Future Sale', 20000, {
      priceExtra: {
        sale: 10000,
        saleStartsAt: new Date(Date.now() + 3_600_000).toISOString(),
        saleEndsAt: new Date(Date.now() + 7_200_000).toISOString(),
      },
    });
    const res = await get('/products');
    const byName = Object.fromEntries(
      res.body.items.map((i: { name: string; price: object }) => [i.name, i.price]),
    );
    expect(byName['Sale Cake']).toMatchObject({ amount: 15000, regular: 20000, onSale: true });
    expect(byName['Future Sale']).toMatchObject({ amount: 20000, onSale: false });
  });

  it('filters by category (with sub-categories), collection, tag and search, sorts and pages', async () => {
    const cat = await manager.call('post', base(brandA, 'categories'), {
      translations: [en('Cakes')],
      status: 'PUBLISHED',
    });
    const sub = await manager.call('post', base(brandA, 'categories'), {
      translations: [en('Birthday Cakes')],
      parentId: cat.body.id,
      status: 'PUBLISHED',
    });
    const col = await manager.call('post', base(brandA, 'collections'), {
      translations: [en('Summer')],
      status: 'PUBLISHED',
    });
    const tag = await manager.call('post', base(brandA, 'tags'), {
      translations: [en('Vegan')],
      status: 'PUBLISHED',
    });
    const a = await live('Alpha Rose', 30000);
    const b = await live('Beta Lily', 10000);
    const c = await live('Gamma Tulip', 20000);
    await manager.call('put', P(a, '/taxonomy'), {
      primaryCategoryId: null,
      categoryIds: [sub.body.id],
      collectionIds: [col.body.id],
      tagIds: [tag.body.id],
    });
    await manager.call('put', P(b, '/taxonomy'), {
      primaryCategoryId: null,
      categoryIds: [cat.body.id],
      collectionIds: [],
      tagIds: [],
    });
    const names = (r: { body: { items: { name: string }[] } }) => r.body.items.map((i) => i.name);
    expect(names(await get('/products?category=cakes'))).toEqual(['Alpha Rose', 'Beta Lily']);
    expect(names(await get('/products?category=birthday-cakes'))).toEqual(['Alpha Rose']);
    expect(names(await get('/products?collection=summer'))).toEqual(['Alpha Rose']);
    expect(names(await get('/products?tag=vegan'))).toEqual(['Alpha Rose']);
    expect(names(await get('/products?q=tulip'))).toEqual(['Gamma Tulip']);
    expect(names(await get('/products?sort=price_asc'))).toEqual([
      'Beta Lily',
      'Gamma Tulip',
      'Alpha Rose',
    ]);
    expect(names(await get('/products?sort=price_desc&limit=2&page=2'))).toEqual(['Beta Lily']);
    expect((await get('/products?sort=price_desc&limit=2')).body.total).toBe(3);
    expect((await get('/products?category=nope')).body.code).toBe('CATEGORY_NOT_FOUND');
    expect(c).toBeTruthy();
    const tree = await get('/categories');
    expect(tree.body.categories).toMatchObject([
      { slug: 'cakes', children: [{ slug: 'birthday-cakes', children: [] }] },
    ]);
    expect((await get('/collections')).body.collections).toMatchObject([{ slug: 'summer' }]);
  });

  it('describes a product with gallery, options, add-ons and no internal fields', async () => {
    const id = await live('Rose Cake', 15000);
    const asset = await upload(5);
    await manager.call('put', P(id, '/media'), { items: [{ mediaAssetId: asset.id }] });
    await manager.call('put', P(id, '/options'), {
      groups: [
        {
          key: 'message-colour',
          type: 'SELECT',
          required: true,
          translations: tr('Message colour'),
          choices: [
            { key: 'white', translations: tr('White') },
            {
              key: 'gold',
              sortOrder: 1,
              translations: tr('Gold'),
              prices: [{ marketId: marketA, currency: 'AED', delta: 1500 }],
            },
          ],
        },
      ],
    });
    const box = await live('Gift Box', 2500);
    await manager.call('put', P(id, '/addons'), {
      groups: [
        {
          key: 'extras',
          required: false,
          minSelect: 0,
          maxSelect: 2,
          translations: tr('Extras'),
          items: [
            {
              kind: 'INLINE',
              key: 'balloons',
              translations: tr('Balloons'),
              prices: [{ marketId: marketA, currency: 'AED', delta: 3500 }],
            },
            { kind: 'INLINE', key: 'unpriced-here', translations: tr('Unpriced'), prices: [] },
            { kind: 'PRODUCT', productId: box, translations: tr('Gift Box') },
          ],
        },
      ],
    });
    const res = await get('/products/rose-cake');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      name: 'Rose Cake',
      images: [{ alt: 'A cake', isPrimary: true }],
      options: [
        {
          key: 'message-colour',
          required: true,
          choices: [
            { key: 'white', price: null },
            { key: 'gold', price: { amount: 1500, display: '15.00' } },
          ],
        },
      ],
    });
    const urls = res.body.images[0].urls as Record<string, string>;
    expect(Object.keys(urls).sort()).toEqual(['large', 'medium', 'thumbnail']);
    const items = res.body.addons[0].items as { label: string; price: { amount: number } }[];
    expect(items.map((i) => [i.label, i.price.amount])).toEqual([
      ['Balloons', 3500],
      ['Gift Box', 2500],
    ]);
    const text = JSON.stringify(res.body);
    for (const secret of [
      '"sku"',
      '"status"',
      '"brandId"',
      '"deletedAt"',
      '"createdAt"',
      '"publishAt"',
    ]) {
      expect(text).not.toContain(secret);
    }
    const image = await request(app.getHttpServer()).get(urls.medium ?? '');
    expect(image.status).toBe(200);
  });

  it('prices variable products per variation and hides unpriced ones', async () => {
    const attr = await manager.call('post', base(brandA, 'attributes'), {
      key: 'size',
      translations: tr('Size'),
      values: ['1kg', '2kg', '3kg'].map((k) => ({ key: k, translations: tr(k) })),
    });
    const created = await manager.call('post', base(brandA, 'products'), {
      type: 'VARIABLE',
      translations: [en('Cake')],
    });
    const id = created.body.id as string;
    await manager.call('put', P(id, '/attributes'), {
      attributes: [
        {
          attributeId: attr.body.id,
          drivesVariations: true,
          valueIds: attr.body.values.map((v: { id: string }) => v.id),
        },
      ],
    });
    const gen = await manager.call('post', P(id, '/variations/generate'), { skuPrefix: 'CK' });
    const ids = gen.body.map((v: { id: string }) => v.id) as string[];
    await manager.call('put', P(id, '/availability'), { marketIds: [marketA], branchIds: [] });
    await manager.call('put', P(id, '/prices'), {
      prices: ids.map((v, i) => aed(10000 + i * 5000, {}, v)),
    });
    expect((await manager.call('post', P(id, '/publish'))).status).toBe(200);
    const list = await get('/products');
    expect(list.body.items[0].price).toMatchObject({ amount: 10000, from: true });
    const detail = await get('/products/cake');
    expect(detail.body.variations).toHaveLength(3);
    expect(detail.body.variations[0].choices[0]).toMatchObject({
      attribute: 'size',
      attributeLabel: 'Size',
    });
    expect(
      detail.body.variations.map((v: { price: { amount: number } }) => v.price.amount).sort(),
    ).toEqual([10000, 15000, 20000]);
    expect(JSON.stringify(detail.body)).not.toContain('CK');
  });

  it('shows bundle components', async () => {
    const rose = await live('Rose', 5000);
    const gift = await listed('Gift Set', 12000, { type: 'BUNDLE' });
    await manager.call('put', P(gift.id, '/bundle'), { items: [{ productId: rose, quantity: 2 }] });
    expect((await gift.publish()).status).toBe(200);
    const detail = await get('/products/gift-set');
    expect(detail.body.bundle).toEqual([{ name: 'Rose', quantity: 2 }]);
  });
});
