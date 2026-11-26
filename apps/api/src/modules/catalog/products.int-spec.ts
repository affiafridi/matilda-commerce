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
interface Named {
  id: string;
  translations: { language: string; name?: string; slug?: string; label?: string }[];
  parentId?: string | null;
}

describe('catalog products (permission, scope, rules, audit)', () => {
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
  let publisher: Actor;

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

  const en = (name: string, extra: object = {}) => ({ language: 'en', name, ...extra });
  const base = (brandId: string, rest: string) => `/${brandId}/catalog/${rest}`;

  async function make(kind: string, name: string, extra: object = {}, who = manager) {
    const res = await who.call('post', base(brandA, kind), { translations: [en(name)], ...extra });
    expect(res.status).toBe(201);
    return res.body as Named;
  }

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
    publisher = await actor('publisher', [...MANAGE, 'products.publish'], { brandId: brandA });
    marketManager = await actor('marketmanager', MANAGE, { brandId: brandA, marketId: marketA });
    nobody = await actor('nobody', [], null);
  });

  const P = (rest = '') => base(brandA, `products${rest}`);
  const newProduct = async (name = 'Rose Bouquet', extra: object = {}) => {
    const res = await manager.call('post', P(), {
      type: 'SIMPLE',
      translations: [en(name)],
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body as {
      id: string;
      status: string;
      visibility: string;
      sku: string | null;
      translations: { slug: string }[];
      marketIds: string[];
    };
  };
  const publishable = async (name = 'Rose Bouquet') => {
    const p = await newProduct(name);
    const res = await manager.call('put', P(`/${p.id}/availability`), {
      marketIds: [marketA],
      branchIds: [],
    });
    expect(res.status).toBe(200);
    const priced = await manager.call('put', P(`/${p.id}/prices`), {
      prices: [{ marketId: marketA, currency: 'AED', regular: 15000 }],
    });
    expect(priced.status).toBe(200);
    return p;
  };

  describe('permission and scope', () => {
    it('requires a session and the right permission for each action', async () => {
      expect((await request(app.getHttpServer()).get(`${API}${P()}`)).status).toBe(401);
      expect((await nobody.call('get', P())).status).toBe(403);
      expect((await viewer.call('get', P())).status).toBe(200);
      const create = await viewer.call('post', P(), { type: 'SIMPLE', translations: [en('X')] });
      expect(create.status).toBe(403);
      const p = await newProduct();
      expect((await viewer.call('patch', P(`/${p.id}`), { sortOrder: 1 })).status).toBe(403);
      expect((await viewer.call('delete', P(`/${p.id}`))).status).toBe(403);
      expect((await manager.call('post', P(`/${p.id}/publish`))).status).toBe(403);
    });

    it('isolates brands and market-scoped grants', async () => {
      const p = await newProduct();
      expect((await managerB.call('get', P())).status).toBe(403);
      expect((await managerB.call('get', P(`/${p.id}`))).status).toBe(403);
      expect((await managerB.call('get', base(brandB, `products/${p.id}`))).status).toBe(404);
      const scoped = await marketManager.call('post', P(), {
        type: 'SIMPLE',
        translations: [en('X')],
      });
      expect(scoped.status).toBe(403);
    });

    it('needs products.publish to schedule, not just products.edit', async () => {
      const p = await newProduct();
      const at = new Date(Date.now() + 86_400_000).toISOString();
      expect((await manager.call('patch', P(`/${p.id}`), { publishAt: at })).status).toBe(403);
      expect((await publisher.call('patch', P(`/${p.id}`), { publishAt: at })).status).toBe(200);
      expect((await manager.call('patch', P(`/${p.id}`), { sortOrder: 3 })).status).toBe(200);
    });
  });

  describe('create, read and edit', () => {
    it('creates a draft with a generated slug and audits it', async () => {
      const p = await newProduct('Rose Bouquet', { sku: 'FL-ROSE', status: 'PUBLISHED' });
      expect(p.status).toBe('DRAFT');
      expect(p.visibility).toBe('draft');
      expect(p.translations[0]?.slug).toBe('rose-bouquet');
      expect(p.sku).toBe('FL-ROSE');
      expect(await auditCount('product.create')).toBe(1);
    });

    it('validates translations, SKU and quantities', async () => {
      const noEn = await manager.call('post', P(), {
        type: 'SIMPLE',
        translations: [{ language: 'ar', name: 'ورد' }],
      });
      expect(noEn.body.code).toBe('ENGLISH_REQUIRED');
      const badSku = await manager.call('post', P(), {
        type: 'SIMPLE',
        sku: 'bad sku',
        translations: [en('X')],
      });
      expect(badSku.status).toBe(400);
      const variableSku = await manager.call('post', P(), {
        type: 'VARIABLE',
        sku: 'AB',
        translations: [en('X')],
      });
      expect(variableSku.body.code).toBe('SKU_NOT_ALLOWED');
      const qty = await manager.call('post', P(), {
        type: 'SIMPLE',
        minQuantity: 5,
        maxQuantity: 2,
        translations: [en('X')],
      });
      expect(qty.body.code).toBe('QUANTITY_INVALID');
    });

    it('keeps SKUs and slugs unique per brand', async () => {
      await newProduct('Rose Bouquet', { sku: 'FL-ROSE' });
      const sku = await manager.call('post', P(), {
        type: 'SIMPLE',
        sku: 'FL-ROSE',
        translations: [en('Other')],
      });
      expect(sku.status).toBe(409);
      expect(sku.body.code).toBe('SKU_TAKEN');
      const slug = await manager.call('post', P(), {
        type: 'SIMPLE',
        translations: [en('Rose Bouquet')],
      });
      expect(slug.status).toBe(409);
      expect(slug.body.code).toBe('SLUG_TAKEN');
      const other = await managerB.call('post', base(brandB, 'products'), {
        type: 'SIMPLE',
        sku: 'FL-ROSE',
        translations: [en('Rose Bouquet')],
      });
      expect(other.status).toBe(201);
    });

    it('lists with search, status and type filters and paginates', async () => {
      await newProduct('Rose Bouquet', { sku: 'FL-ROSE' });
      await newProduct('Birthday Cake', { type: 'VARIABLE' });
      expect((await viewer.call('get', P())).body.total).toBe(2);
      expect((await viewer.call('get', P('?search=cake'))).body.items).toHaveLength(1);
      expect((await viewer.call('get', P('?search=fl-rose'))).body.items).toHaveLength(1);
      expect((await viewer.call('get', P('?type=VARIABLE'))).body.items).toHaveLength(1);
      expect((await viewer.call('get', P('?status=PUBLISHED'))).body.items).toHaveLength(0);
      const paged = await viewer.call('get', P('?pageSize=1&page=2'));
      expect(paged.body.items).toHaveLength(1);
      expect(paged.body.total).toBe(2);
    });

    it('edits operational fields and handles type and SKU together', async () => {
      const p = await newProduct('Cake', { sku: 'CK-1' });
      const res = await manager.call('patch', P(`/${p.id}`), {
        madeToOrder: true,
        prepTimeMinutes: 120,
        leadTimeMinutes: 1440,
        minQuantity: 1,
        maxQuantity: 5,
      });
      expect(res.body).toEqual(
        expect.objectContaining({ madeToOrder: true, prepTimeMinutes: 120, maxQuantity: 5 }),
      );
      const variable = await manager.call('patch', P(`/${p.id}`), { type: 'VARIABLE' });
      expect(variable.body).toEqual(expect.objectContaining({ type: 'VARIABLE', sku: null }));
      expect((await manager.call('patch', P(`/${p.id}`), { maxQuantity: 0 })).status).toBe(400);
      const sku = await manager.call('patch', P(`/${p.id}`), { sku: 'X1' });
      expect(sku.body.code).toBe('SKU_NOT_ALLOWED');
      expect(await auditCount('product.update')).toBe(2);
    });

    it('sets, changes and removes translations with slug history', async () => {
      const p = await newProduct();
      const ar = await manager.call('put', P(`/${p.id}/translations/ar`), { name: 'باقة ورد' });
      expect(ar.body.translations).toHaveLength(2);
      await manager.call('put', P(`/${p.id}/translations/en`), {
        name: 'Rose Bouquet',
        slug: 'signature-roses',
      });
      const history = await owner.query(
        `SELECT slug FROM catalog_slug_history WHERE entity_id = $1`,
        [p.id],
      );
      expect(history.rows).toEqual([{ slug: 'rose-bouquet' }]);
      const en404 = await manager.call('delete', P(`/${p.id}/translations/en`));
      expect(en404.body.code).toBe('ENGLISH_REQUIRED');
      const removed = await manager.call('delete', P(`/${p.id}/translations/ar`));
      expect(removed.body.translations).toHaveLength(1);
    });
  });

  describe('taxonomy links and availability', () => {
    it('replaces categories, collections, tags and the primary category', async () => {
      const p = await newProduct();
      const cat = await make('categories', 'Cakes');
      const cat2 = await make('categories', 'Gifts');
      const col = await make('collections', 'Eid');
      const tag = await make('tags', 'Birthday');
      const res = await manager.call('put', P(`/${p.id}/taxonomy`), {
        primaryCategoryId: cat.id,
        categoryIds: [cat2.id],
        collectionIds: [col.id],
        tagIds: [tag.id],
      });
      expect(res.status).toBe(200);
      expect(res.body.primaryCategoryId).toBe(cat.id);
      expect([...res.body.categoryIds].sort()).toEqual([cat.id, cat2.id].sort());
      expect(res.body.tagIds).toEqual([tag.id]);
      const cleared = await manager.call('put', P(`/${p.id}/taxonomy`), {
        primaryCategoryId: null,
        categoryIds: [],
        collectionIds: [],
        tagIds: [],
      });
      expect(cleared.body.categoryIds).toEqual([]);
      expect(await auditCount('product.taxonomy.set')).toBe(2);
    });

    it('rejects taxonomy from another brand or that does not exist', async () => {
      const p = await newProduct();
      const foreign = await managerB.call('post', base(brandB, 'tags'), {
        translations: [en('Gift')],
      });
      const res = await manager.call('put', P(`/${p.id}/taxonomy`), {
        primaryCategoryId: null,
        categoryIds: [],
        collectionIds: [],
        tagIds: [(foreign.body as Named).id],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TAG_NOT_FOUND');
    });

    it('sets markets and branches and rejects ones outside the brand', async () => {
      const p = await newProduct();
      const { own, foreign } = await asPlatform(async (tx) => {
        const ae = await tx.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
        const mb = await tx.market.create({
          data: { brandId: brandB, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
        });
        const own = await tx.branch.create({
          data: {
            code: 'a1',
            name: 'A1',
            countryId: ae.id,
            timezone: 'Asia/Dubai',
            markets: { create: [{ marketId: marketA }] },
          },
        });
        const other = await tx.branch.create({
          data: {
            code: 'b1',
            name: 'B1',
            countryId: ae.id,
            timezone: 'Asia/Dubai',
            markets: { create: [{ marketId: mb.id }] },
          },
        });
        return { own: own.id, foreign: { branch: other.id, market: mb.id } };
      });
      const ok = await manager.call('put', P(`/${p.id}/availability`), {
        marketIds: [marketA],
        branchIds: [own],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.marketIds).toEqual([marketA]);
      expect(ok.body.branchIds).toEqual([own]);
      const badMarket = await manager.call('put', P(`/${p.id}/availability`), {
        marketIds: [foreign.market],
        branchIds: [],
      });
      expect(badMarket.body.code).toBe('MARKET_NOT_FOUND');
      const badBranch = await manager.call('put', P(`/${p.id}/availability`), {
        marketIds: [marketA],
        branchIds: [foreign.branch],
      });
      expect(badBranch.body.code).toBe('BRANCH_NOT_AVAILABLE');
      expect((await manager.call('get', P(`/${p.id}`))).body.branchIds).toEqual([own]);
    });
  });

  describe('publishing', () => {
    it('publishes only with an English name and a market, then unpublishes and archives', async () => {
      const bare = await newProduct('Bare Product');
      const blocked = await publisher.call('post', P(`/${bare.id}/publish`));
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('NOT_PUBLISHABLE');
      const p = await publishable();
      const live = await publisher.call('post', P(`/${p.id}/publish`));
      expect(live.body).toEqual(
        expect.objectContaining({ status: 'PUBLISHED', visibility: 'live' }),
      );
      expect((await publisher.call('post', P(`/${p.id}/unpublish`))).body.status).toBe('DRAFT');
      expect((await publisher.call('post', P(`/${p.id}/archive`))).body.visibility).toBe(
        'archived',
      );
      expect(await auditCount('product.publish')).toBe(1);
    });

    it('derives scheduled and expired visibility and checks the schedule order', async () => {
      const p = await publishable();
      const later = new Date(Date.now() + 86_400_000).toISOString();
      const earlier = new Date(Date.now() - 86_400_000).toISOString();
      await publisher.call('patch', P(`/${p.id}`), { publishAt: later });
      const scheduled = await publisher.call('post', P(`/${p.id}/publish`));
      expect(scheduled.body.visibility).toBe('scheduled');
      await publisher.call('patch', P(`/${p.id}`), { publishAt: null, unpublishAt: earlier });
      expect((await publisher.call('get', P(`/${p.id}`))).body.visibility).toBe('expired');
      const bad = await publisher.call('patch', P(`/${p.id}`), {
        publishAt: later,
        unpublishAt: earlier,
      });
      expect(bad.body.code).toBe('SCHEDULE_INVALID');
    });
  });

  describe('delete', () => {
    it('soft deletes, frees the SKU and slug, and keeps redirect history', async () => {
      const p = await newProduct('Rose Bouquet', { sku: 'FL-ROSE' });
      expect((await manager.call('delete', P(`/${p.id}`))).status).toBe(204);
      expect((await manager.call('get', P(`/${p.id}`))).status).toBe(404);
      const history = await owner.query(
        `SELECT slug FROM catalog_slug_history WHERE entity_id = $1`,
        [p.id],
      );
      expect(history.rows).toEqual([{ slug: 'rose-bouquet' }]);
      await newProduct('Rose Bouquet', { sku: 'FL-ROSE' });
      expect(await auditCount('product.delete')).toBe(1);
    });

    it('does not delete a product that is a bundle component', async () => {
      const bundle = await newProduct('Gift Set', { type: 'BUNDLE' });
      const part = await newProduct('Chocolate Box');
      await asPlatform((tx) =>
        tx.bundleItem.create({
          data: {
            brandId: brandA,
            bundleProductId: bundle.id,
            componentProductId: part.id,
            quantity: 1,
          },
        }),
      );
      const res = await manager.call('delete', P(`/${part.id}`));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRODUCT_IN_USE');
    });
  });
});
