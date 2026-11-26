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
describe('catalog add-ons and bundles (rules, prices, permissions)', () => {
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
  const tr = (label: string) => [{ language: 'en', label }];
  const price = (delta: number) => ({ marketId: marketA, currency: 'AED', delta });

  async function newProduct(
    name: string,
    type: 'SIMPLE' | 'VARIABLE' | 'BUNDLE' = 'SIMPLE',
    sku?: string,
  ) {
    const res = await manager.call('post', base(brandA, 'products'), {
      type,
      sku,
      translations: [{ language: 'en', name }],
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }
  async function variableWithVariations(name = 'Cake') {
    const attr = await manager.call('post', base(brandA, 'attributes'), {
      key: 'size',
      translations: tr('Size'),
      values: ['1kg', '2kg'].map((k) => ({ key: k, translations: tr(k) })),
    });
    const p = await newProduct(name, 'VARIABLE');
    await manager.call('put', P(p.id, '/attributes'), {
      attributes: [
        {
          attributeId: attr.body.id,
          drivesVariations: true,
          valueIds: attr.body.values.map((v: { id: string }) => v.id),
        },
      ],
    });
    const gen = await manager.call('post', P(p.id, '/variations/generate'), { skuPrefix: 'CK' });
    return { id: p.id, variations: gen.body as { id: string }[] };
  }

  /** The cake's add-ons: a required box (inline) and optional balloons; plus a product add-on. */
  const cakeAddons = (productAddon?: { productId: string; variationId?: string }) => ({
    groups: [
      {
        key: 'cake-box',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 0,
        translations: tr('Cake box'),
        items: [
          { kind: 'INLINE', key: 'standard-box', translations: tr('Standard box') },
          {
            kind: 'INLINE',
            key: 'premium-box',
            sortOrder: 1,
            translations: tr('Premium box'),
            prices: [price(2500)],
          },
        ],
      },
      {
        key: 'extras',
        sortOrder: 1,
        maxSelect: 1,
        translations: tr('Extras'),
        items: [
          {
            kind: 'INLINE',
            key: 'balloon-bunch',
            maxQuantity: 2,
            translations: tr('Balloon bunch'),
            prices: [price(3500)],
          },
          ...(productAddon ? [{ kind: 'PRODUCT', maxQuantity: 3, ...productAddon }] : []),
        ],
      },
    ],
  });
  const putAddons = (id: string, body: object, who = manager) =>
    who.call('put', P(id, '/addons'), body);
  const putBundle = (id: string, body: object, who = manager) =>
    who.call('put', P(id, '/bundle'), body);

  describe('add-ons', () => {
    it('lets viewers read, needs edit to save and pricing.edit to change prices', async () => {
      const p = await newProduct('Cake');
      expect((await viewer.call('get', P(p.id, '/addons'))).status).toBe(200);
      expect((await putAddons(p.id, cakeAddons(), viewer)).status).toBe(403);
      const editor = await actor('editor', ['products.view', 'products.edit'], { brandId: brandA });
      expect((await putAddons(p.id, cakeAddons(), editor)).status).toBe(403);
      expect((await putAddons(p.id, cakeAddons(), manager)).status).toBe(200);
      const relabel = cakeAddons();
      relabel.groups[0]!.translations = tr('Box');
      expect((await putAddons(p.id, relabel, editor)).status).toBe(200);
      expect((await nobody.call('get', P(p.id, '/addons'))).status).toBe(403);
      expect((await putAddons(p.id, cakeAddons(), marketManager)).status).toBe(403);
      expect((await managerB.call('get', P(p.id, '/addons'))).status).toBe(403);
      expect((await managerB.call('get', base(brandB, `products/${p.id}/addons`))).status).toBe(
        404,
      );
    });

    it('saves required and optional groups with inline and product add-ons', async () => {
      const p = await newProduct('Cake');
      const chocolates = await newProduct('Chocolate Box', 'SIMPLE', 'CHOC-1');
      const res = await putAddons(p.id, cakeAddons({ productId: chocolates.id }));
      expect(res.status).toBe(200);
      const groups = res.body.groups as {
        key: string;
        required: boolean;
        items: {
          kind: string;
          key: string | null;
          productId: string | null;
          maxQuantity: number;
          prices: unknown[];
        }[];
      }[];
      expect(groups.map((g) => g.key)).toEqual(['cake-box', 'extras']);
      expect(groups[0]?.required).toBe(true);
      expect(groups[1]?.items.find((i) => i.kind === 'PRODUCT')).toEqual(
        expect.objectContaining({ productId: chocolates.id, maxQuantity: 3, prices: [] }),
      );
      expect(groups[0]?.items[1]?.prices).toEqual([price(2500)]);
      expect(await auditCount('product.addons.set')).toBe(1);
    });

    it('keeps ids stable and removes what is left out', async () => {
      const p = await newProduct('Cake');
      const first = (await putAddons(p.id, cakeAddons())).body.groups;
      const next = cakeAddons();
      next.groups[0]!.items.pop();
      const second = (await putAddons(p.id, next)).body.groups;
      expect(second[0].id).toBe(first[0].id);
      expect(second[0].items[0].id).toBe(first[0].items[0].id);
      expect(second[0].items).toHaveLength(1);
      const slim = { groups: [next.groups[1]!] };
      const third = await putAddons(p.id, slim);
      expect(third.body.groups).toHaveLength(1);
      const prices = await asPlatform((tx) => tx.addonItemPrice.count());
      expect(prices).toBe(1);
    });

    it('prices variable add-on products per variation and requires the variation', async () => {
      const p = await newProduct('Cake');
      const other = await variableWithVariations('Mini Cake');
      const item = (extra: object) => ({
        groups: [
          {
            key: 'extras',
            translations: tr('Extras'),
            items: [{ kind: 'PRODUCT', productId: other.id, ...extra }],
          },
        ],
      });
      expect((await putAddons(p.id, item({}))).body.code).toBe('VARIATION_REQUIRED');
      const ok = await putAddons(p.id, item({ variationId: other.variations[0]?.id }));
      expect(ok.status).toBe(200);
      const missing = await putAddons(
        p.id,
        item({ variationId: '00000000-0000-4000-8000-000000000000' }),
      );
      expect(missing.body.code).toBe('VARIATION_NOT_FOUND');
      const simple = await newProduct('Candles');
      const withVariation = await putAddons(p.id, {
        groups: [
          {
            key: 'extras',
            translations: tr('Extras'),
            items: [
              { kind: 'PRODUCT', productId: simple.id, variationId: other.variations[0]?.id },
            ],
          },
        ],
      });
      expect(withVariation.body.code).toBe('VARIATION_NOT_ALLOWED');
    });

    it('rejects bad references: itself, bundles, unknown and other-brand products', async () => {
      const p = await newProduct('Cake');
      const item = (productId: string) => ({
        groups: [
          { key: 'extras', translations: tr('Extras'), items: [{ kind: 'PRODUCT', productId }] },
        ],
      });
      expect((await putAddons(p.id, item(p.id))).body.code).toBe('ADDON_SELF');
      const bundle = await newProduct('Set', 'BUNDLE');
      expect((await putAddons(p.id, item(bundle.id))).body.code).toBe('ADDON_PRODUCT_INVALID');
      expect((await putAddons(p.id, item('00000000-0000-4000-8000-000000000000'))).body.code).toBe(
        'ADDON_PRODUCT_NOT_FOUND',
      );
      const foreign = await managerB.call('post', base(brandB, 'products'), {
        type: 'SIMPLE',
        translations: [{ language: 'en', name: 'Foreign' }],
      });
      expect((await putAddons(p.id, item(foreign.body.id))).body.code).toBe(
        'ADDON_PRODUCT_NOT_FOUND',
      );
    });

    it('validates group and item shape, prices and languages', async () => {
      const p = await newProduct('Cake');
      const group = (
        extra: object,
        items: object[] = [{ kind: 'INLINE', key: 'a', translations: tr('A') }],
      ) => ({
        groups: [{ key: 'g', translations: tr('G'), items, ...extra }],
      });
      expect((await putAddons(p.id, group({ required: true }))).body.code).toBe(
        'SELECTION_LIMITS_INVALID',
      );
      expect((await putAddons(p.id, group({ minSelect: 2 }))).body.code).toBe(
        'SELECTION_LIMITS_INVALID',
      );
      expect((await putAddons(p.id, group({ minSelect: 1, maxSelect: 1 }))).status).toBe(200);
      const dup = await putAddons(
        p.id,
        group({}, [
          { kind: 'INLINE', key: 'a', translations: tr('A') },
          { kind: 'INLINE', key: 'a', translations: tr('B') },
        ]),
      );
      expect(dup.body.code).toBe('DUPLICATE_ADDON_ITEM');
      expect(
        (await putAddons(p.id, group({}, [{ kind: 'INLINE', translations: tr('A') }]))).body.code,
      ).toBe('ADDON_ITEM_INVALID');
      const arabic = await putAddons(
        p.id,
        group({}, [{ kind: 'INLINE', key: 'a', translations: [{ language: 'ar', label: 'أ' }] }]),
      );
      expect(arabic.body.code).toBe('ENGLISH_REQUIRED');
      const other = await newProduct('Candles');
      const priced = await putAddons(
        p.id,
        group({}, [{ kind: 'PRODUCT', productId: other.id, prices: [price(100)] }]),
      );
      expect(priced.body.code).toBe('PRICE_NOT_ALLOWED');
      const bad = (delta: number, currency = 'AED') =>
        putAddons(
          p.id,
          group({}, [
            {
              kind: 'INLINE',
              key: 'a',
              translations: tr('A'),
              prices: [{ ...price(delta), currency }],
            },
          ]),
        );
      expect((await bad(1.5)).status).toBe(400);
      expect((await bad(-1)).status).toBe(400);
      expect((await bad(100, 'USD')).body.code).toBe('CURRENCY_NOT_IN_MARKET');
      expect(
        (await putAddons(p.id, { groups: [group({}).groups[0], group({}).groups[0]] })).body.code,
      ).toBe('DUPLICATE_ADDON_KEY');
    });

    it('blocks deleting a product or variation that is an add-on', async () => {
      const p = await newProduct('Cake');
      const candles = await newProduct('Candles');
      const other = await variableWithVariations('Mini Cake');
      await putAddons(p.id, {
        groups: [
          {
            key: 'extras',
            translations: tr('Extras'),
            items: [
              { kind: 'PRODUCT', productId: candles.id },
              { kind: 'PRODUCT', productId: other.id, variationId: other.variations[0]?.id },
            ],
          },
        ],
      });
      expect((await manager.call('delete', base(brandA, `products/${candles.id}`))).body.code).toBe(
        'PRODUCT_IN_USE',
      );
      const del = await manager.call(
        'delete',
        P(other.id, `/variations/${other.variations[0]?.id}`),
      );
      expect(del.body.code).toBe('VARIATION_IN_USE');
    });
  });

  describe('bundles', () => {
    it('saves components with quantities and lists them with names', async () => {
      const bundle = await newProduct('Gift Set', 'BUNDLE');
      const roses = await newProduct('Roses', 'SIMPLE', 'RS-1');
      const cake = await variableWithVariations('Mini Cake');
      const res = await putBundle(bundle.id, {
        items: [
          { productId: roses.id, quantity: 2 },
          { productId: cake.id, variationId: cake.variations[0]?.id, sortOrder: 1 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toEqual(
        expect.objectContaining({ productId: roses.id, quantity: 2, sku: 'RS-1' }),
      );
      expect(res.body.items[1].sku).toBe('CK-1KG');
      expect((await viewer.call('get', P(bundle.id, '/bundle'))).body.items).toHaveLength(2);
      expect(await auditCount('product.bundle.set')).toBe(1);
      const replaced = await putBundle(bundle.id, { items: [{ productId: roses.id }] });
      expect(replaced.body.items).toHaveLength(1);
    });

    it('only works on bundle products with valid, distinct, non-bundle components', async () => {
      const bundle = await newProduct('Gift Set', 'BUNDLE');
      const roses = await newProduct('Roses');
      const simple = await newProduct('Plain');
      expect((await putBundle(simple.id, { items: [] })).body.code).toBe('NOT_BUNDLE');
      expect((await putBundle(bundle.id, { items: [{ productId: bundle.id }] })).body.code).toBe(
        'COMPONENT_SELF',
      );
      const nested = await newProduct('Other Set', 'BUNDLE');
      expect((await putBundle(bundle.id, { items: [{ productId: nested.id }] })).body.code).toBe(
        'COMPONENT_INVALID',
      );
      expect(
        (
          await putBundle(bundle.id, {
            items: [{ productId: '00000000-0000-4000-8000-000000000000' }],
          })
        ).body.code,
      ).toBe('COMPONENT_NOT_FOUND');
      const cake = await variableWithVariations('Mini Cake');
      expect((await putBundle(bundle.id, { items: [{ productId: cake.id }] })).body.code).toBe(
        'VARIATION_REQUIRED',
      );
      const twice = await putBundle(bundle.id, {
        items: [{ productId: roses.id }, { productId: roses.id, quantity: 2 }],
      });
      expect(twice.body.code).toBe('DUPLICATE_COMPONENT');
      expect(
        (await putBundle(bundle.id, { items: [{ productId: roses.id, quantity: 0 }] })).status,
      ).toBe(400);
    });

    it('needs products.edit and isolates brands', async () => {
      const bundle = await newProduct('Gift Set', 'BUNDLE');
      const roses = await newProduct('Roses');
      expect(
        (await putBundle(bundle.id, { items: [{ productId: roses.id }] }, viewer)).status,
      ).toBe(403);
      expect((await managerB.call('get', P(bundle.id, '/bundle'))).status).toBe(403);
      expect((await nobody.call('get', P(bundle.id, '/bundle'))).status).toBe(403);
    });

    it('protects components from deletion and needs one to publish', async () => {
      const bundle = await newProduct('Gift Set', 'BUNDLE');
      const roses = await newProduct('Roses');
      await manager.call('put', P(bundle.id, '/availability'), {
        marketIds: [marketA],
        branchIds: [],
      });
      await manager.call('put', P(bundle.id, '/prices'), {
        prices: [{ marketId: marketA, currency: 'AED', regular: 25000 }],
      });
      const publisher = await actor('publisher', ['products.view', 'products.publish'], {
        brandId: brandA,
      });
      const none = await publisher.call('post', P(bundle.id, '/publish'));
      expect(none.body.code).toBe('NOT_PUBLISHABLE');
      await putBundle(bundle.id, { items: [{ productId: roses.id }] });
      expect((await publisher.call('post', P(bundle.id, '/publish'))).body.status).toBe(
        'PUBLISHED',
      );
      expect((await manager.call('delete', base(brandA, `products/${roses.id}`))).body.code).toBe(
        'PRODUCT_IN_USE',
      );
    });
  });
});
