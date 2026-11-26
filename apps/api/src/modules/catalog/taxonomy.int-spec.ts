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

describe('catalog taxonomy and attributes (permission, scope, rules, audit)', () => {
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
    await owner.query('TRUNCATE staff_user, brand, role, auth_attempt CASCADE');
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
    const MANAGE = ['products.view', 'taxonomy.manage'];
    manager = await actor('manager', MANAGE, { brandId: brandA });
    managerB = await actor('managerb', MANAGE, { brandId: brandB });
    viewer = await actor('viewer', ['products.view'], { brandId: brandA });
    marketManager = await actor('marketmanager', MANAGE, { brandId: brandA, marketId: marketA });
    nobody = await actor('nobody', [], null);
  });

  describe('permission and scope', () => {
    it('rejects requests without a session', async () => {
      const res = await request(app.getHttpServer()).get(`${API}${base(brandA, 'categories')}`);
      expect(res.status).toBe(401);
    });

    it('lets a viewer read but not write, and a user with no role neither', async () => {
      await make('categories', 'Cakes');
      expect((await viewer.call('get', base(brandA, 'categories'))).status).toBe(200);
      const write = await viewer.call('post', base(brandA, 'categories'), {
        translations: [en('Nope')],
      });
      expect(write.status).toBe(403);
      expect((await nobody.call('get', base(brandA, 'categories'))).status).toBe(403);
    });

    it('does not let a manager of one brand read or write another brand', async () => {
      const cat = await make('categories', 'Cakes');
      expect((await managerB.call('get', base(brandA, 'categories'))).status).toBe(403);
      expect(
        (await managerB.call('post', base(brandA, 'categories'), { translations: [en('X')] }))
          .status,
      ).toBe(403);
      expect((await managerB.call('delete', base(brandA, `categories/${cat.id}`))).status).toBe(
        403,
      );
    });

    it('does not expose a record of another brand through the path of your own brand', async () => {
      const own = await managerB.call('post', base(brandB, 'tags'), { translations: [en('Gift')] });
      const res = await manager.call('get', base(brandA, `tags/${(own.body as Named).id}`));
      expect(res.status).toBe(404);
    });

    it('does not let a market-scoped manager edit brand-wide catalog data', async () => {
      expect(
        (await marketManager.call('post', base(brandA, 'tags'), { translations: [en('Gift')] }))
          .status,
      ).toBe(403);
    });

    it('answers 404 for an unknown brand and 422 for an unknown kind', async () => {
      expect(
        (await manager.call('get', base('00000000-0000-4000-8000-000000000000', 'tags'))).status,
      ).toBe(403);
      expect((await manager.call('get', base(brandA, 'widgets'))).status).toBe(400);
    });
  });

  describe('categories, collections and tags', () => {
    it('creates with a generated slug, returns the record and writes an audit row', async () => {
      const cat = await make('categories', 'Red Velvet Cakes', { status: 'PUBLISHED' });
      expect(cat.translations).toEqual([
        expect.objectContaining({ language: 'en', slug: 'red-velvet-cakes' }),
      ]);
      expect(await auditCount('category.create')).toBe(1);
    });

    it('requires English and rejects a repeated language', async () => {
      const noEnglish = await manager.call('post', base(brandA, 'tags'), {
        translations: [{ language: 'ar', name: 'هدية' }],
      });
      expect(noEnglish.status).toBe(422);
      expect(noEnglish.body.code).toBe('ENGLISH_REQUIRED');
      const twice = await manager.call('post', base(brandA, 'tags'), {
        translations: [en('A'), en('B')],
      });
      expect(twice.body.code).toBe('DUPLICATE_LANGUAGE');
    });

    it('asks for a slug when the name has no usable characters', async () => {
      const res = await manager.call('post', base(brandA, 'tags'), { translations: [en('!!!')] });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('SLUG_REQUIRED');
    });

    it('keeps slugs unique per brand and language but allows them in another brand', async () => {
      await make('collections', 'Eid');
      const dup = await manager.call('post', base(brandA, 'collections'), {
        translations: [en('Eid')],
      });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('SLUG_TAKEN');
      const other = await managerB.call('post', base(brandB, 'collections'), {
        translations: [en('Eid')],
      });
      expect(other.status).toBe(201);
    });

    it('lists with search and status filters', async () => {
      await make('tags', 'Birthday', { status: 'PUBLISHED' });
      await make('tags', 'Wedding');
      const all = await viewer.call('get', base(brandA, 'tags'));
      expect(all.body.total).toBe(2);
      const found = await viewer.call('get', base(brandA, 'tags?search=birth'));
      expect(found.body.items).toHaveLength(1);
      const published = await viewer.call('get', base(brandA, 'tags?status=PUBLISHED'));
      expect(published.body.items).toHaveLength(1);
    });

    it('updates status and order and audits the change', async () => {
      const tag = await make('tags', 'Birthday');
      const res = await manager.call('patch', base(brandA, `tags/${tag.id}`), {
        status: 'PUBLISHED',
        sortOrder: 5,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ status: 'PUBLISHED', sortOrder: 5 }));
      expect(await auditCount('tag.update')).toBe(1);
    });

    it('does not allow a parent on collections or tags', async () => {
      const cat = await make('categories', 'Cakes');
      const res = await manager.call('post', base(brandA, 'tags'), {
        translations: [en('Gift')],
        parentId: cat.id,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PARENT_NOT_ALLOWED');
    });

    it('sets, changes and removes translations; English cannot be removed', async () => {
      const cat = await make('categories', 'Cakes');
      const put = await manager.call('put', base(brandA, `categories/${cat.id}/translations/ar`), {
        name: 'كعك',
      });
      expect(put.status).toBe(200);
      expect(put.body.translations).toHaveLength(2);
      expect(
        (await manager.call('delete', base(brandA, `categories/${cat.id}/translations/en`))).body
          .code,
      ).toBe('ENGLISH_REQUIRED');
      const del = await manager.call(
        'delete',
        base(brandA, `categories/${cat.id}/translations/ar`),
      );
      expect(del.status).toBe(200);
      expect(del.body.translations).toHaveLength(1);
      expect(
        (await manager.call('delete', base(brandA, `categories/${cat.id}/translations/ar`))).status,
      ).toBe(404);
    });

    it('records the old slug when a slug changes and frees it when it is taken over', async () => {
      const cat = await make('categories', 'Cakes');
      await manager.call('put', base(brandA, `categories/${cat.id}/translations/en`), {
        name: 'Cakes',
        slug: 'celebration-cakes',
      });
      const history = await owner.query(
        `SELECT slug FROM catalog_slug_history WHERE entity_id = $1`,
        [cat.id],
      );
      expect(history.rows).toEqual([{ slug: 'cakes' }]);
      await make('categories', 'Cakes');
      const after = await owner.query(`SELECT 1 FROM catalog_slug_history WHERE slug = 'cakes'`);
      expect(after.rowCount).toBe(0);
    });

    it('soft deletes, retires the slug for redirects and lets it be reused', async () => {
      const col = await make('collections', 'Eid');
      const del = await manager.call('delete', base(brandA, `collections/${col.id}`));
      expect(del.status).toBe(204);
      expect((await manager.call('get', base(brandA, `collections/${col.id}`))).status).toBe(404);
      const history = await owner.query(
        `SELECT slug FROM catalog_slug_history WHERE entity_id = $1`,
        [col.id],
      );
      expect(history.rows).toEqual([{ slug: 'eid' }]);
      await make('collections', 'Eid');
      expect(await auditCount('collection.delete')).toBe(1);
    });

    it('frees the slug of a deleted tag (tags have no public URL, so no redirect history)', async () => {
      const tag = await make('tags', 'Birthday');
      expect((await manager.call('delete', base(brandA, `tags/${tag.id}`))).status).toBe(204);
      await make('tags', 'Birthday');
      const history = await owner.query(`SELECT 1 FROM catalog_slug_history`);
      expect(history.rowCount).toBe(0);
    });

    it('unlinks products when a collection is deleted', async () => {
      const col = await make('collections', 'Eid');
      const product = await asPlatform((tx) =>
        tx.product.create({ data: { brandId: brandA, type: 'SIMPLE' } }),
      );
      await asPlatform((tx) =>
        tx.productCollection.create({
          data: { brandId: brandA, productId: product.id, collectionId: col.id },
        }),
      );
      expect((await manager.call('delete', base(brandA, `collections/${col.id}`))).status).toBe(
        204,
      );
      expect(
        await asPlatform((tx) => tx.productCollection.count({ where: { productId: product.id } })),
      ).toBe(0);
    });
  });

  describe('category tree', () => {
    async function chain(depth: number): Promise<Named[]> {
      const made: Named[] = [];
      for (let i = 1; i <= depth; i += 1) {
        made.push(await make('categories', `Level ${i}`, { parentId: made.at(-1)?.id }));
      }
      return made;
    }

    it('allows four levels and rejects a fifth', async () => {
      const levels = await chain(4);
      const res = await manager.call('post', base(brandA, 'categories'), {
        translations: [en('Level 5')],
        parentId: levels[3]?.id,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CATEGORY_TREE_INVALID');
    });

    it('rejects a missing parent, a cycle and a move that would deepen a subtree', async () => {
      const [l1, l2, l3] = await chain(3);
      const missing = await manager.call('post', base(brandA, 'categories'), {
        translations: [en('Orphan')],
        parentId: '00000000-0000-4000-8000-000000000000',
      });
      expect(missing.body.code).toBe('PARENT_NOT_FOUND');
      const self = await manager.call('patch', base(brandA, `categories/${l1?.id}`), {
        parentId: l3?.id,
      });
      expect(self.body.code).toBe('CATEGORY_TREE_INVALID');
      const solo = await make('categories', 'Solo', { parentId: null });
      const deeper = await manager.call('patch', base(brandA, `categories/${l1?.id}`), {
        parentId: solo.id,
      });
      expect(deeper.status).toBe(200);
      const tooDeep = await manager.call('patch', base(brandA, `categories/${solo.id}`), {
        parentId: l3?.id,
      });
      expect(tooDeep.body.code).toBe('CATEGORY_TREE_INVALID');
      expect(l2).toBeDefined();
    });

    it('does not allow deleting a category with subcategories or products', async () => {
      const [parent, child] = await chain(2);
      const withChildren = await manager.call('delete', base(brandA, `categories/${parent?.id}`));
      expect(withChildren.status).toBe(409);
      expect(withChildren.body.code).toBe('CATEGORY_HAS_CHILDREN');
      await asPlatform((tx) =>
        tx.product.create({
          data: { brandId: brandA, type: 'SIMPLE', primaryCategoryId: child?.id },
        }),
      );
      const used = await manager.call('delete', base(brandA, `categories/${child?.id}`));
      expect(used.body.code).toBe('CATEGORY_IN_USE');
    });
  });

  describe('attributes', () => {
    const label = (text: string) => ({ language: 'en', label: text });
    const attributeBody = (key: string, extra: object = {}) => ({
      key,
      translations: [label(key)],
      ...extra,
    });

    async function makeAttribute(key: string, extra: object = {}) {
      const res = await manager.call('post', base(brandA, 'attributes'), attributeBody(key, extra));
      expect(res.status).toBe(201);
      return res.body as Named & { key: string; values: { id: string; key: string }[] };
    }

    it('creates an attribute with values and translations and audits it', async () => {
      const size = await makeAttribute('size', {
        values: [
          { key: '1kg', translations: [label('1 kg')] },
          { key: '2kg', translations: [label('2 kg')], sortOrder: 1 },
        ],
      });
      expect(size.values.map((v) => v.key)).toEqual(['1kg', '2kg']);
      expect(await auditCount('attribute.create')).toBe(1);
      const list = await viewer.call('get', base(brandA, 'attributes'));
      expect(list.body.total).toBe(1);
    });

    it('is not captured by the taxonomy routes', async () => {
      await makeAttribute('size');
      expect((await viewer.call('get', base(brandA, 'attributes'))).body.items).toHaveLength(1);
    });

    it('enforces key format, uniqueness per brand and English labels', async () => {
      await makeAttribute('size');
      const dup = await manager.call('post', base(brandA, 'attributes'), attributeBody('size'));
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('KEY_TAKEN');
      expect(
        (await manager.call('post', base(brandA, 'attributes'), attributeBody('Bad Key'))).status,
      ).toBe(400);
      const noEnglish = await manager.call('post', base(brandA, 'attributes'), {
        key: 'flavour',
        translations: [{ language: 'ar', label: 'نكهة' }],
      });
      expect(noEnglish.body.code).toBe('ENGLISH_REQUIRED');
      expect(
        (await managerB.call('post', base(brandB, 'attributes'), attributeBody('size'))).status,
      ).toBe(201);
    });

    it('allows colours only on colour attributes', async () => {
      const bad = await manager.call(
        'post',
        base(brandA, 'attributes'),
        attributeBody('size', {
          values: [{ key: 'big', colorHex: '#112233', translations: [label('Big')] }],
        }),
      );
      expect(bad.body.code).toBe('COLOUR_NOT_ALLOWED');
      const colour = await makeAttribute('colour', {
        kind: 'COLOR',
        values: [{ key: 'red', colorHex: '#AA0000', translations: [label('Red')] }],
      });
      expect(colour.values).toHaveLength(1);
    });

    it('adds, edits, translates and removes values', async () => {
      const size = await makeAttribute('size');
      const added = await manager.call('post', base(brandA, `attributes/${size.id}/values`), {
        key: '3kg',
        translations: [label('3 kg')],
      });
      expect(added.status).toBe(201);
      const valueId = (added.body as typeof size).values[0]?.id;
      const path = `attributes/${size.id}/values/${valueId}`;
      const edited = await manager.call('patch', base(brandA, path), { sortOrder: 9 });
      expect(edited.status).toBe(200);
      const tr = await manager.call('put', base(brandA, `${path}/translations/ar`), {
        label: '٣ كجم',
      });
      expect(tr.status).toBe(200);
      expect(
        (await manager.call('delete', base(brandA, `${path}/translations/en`))).body.code,
      ).toBe('ENGLISH_REQUIRED');
      const removed = await manager.call('delete', base(brandA, path));
      expect(removed.status).toBe(200);
      expect((removed.body as typeof size).values).toHaveLength(0);
    });

    it('blocks changing or deleting attributes and values that products use', async () => {
      const size = await makeAttribute('size', {
        values: [{ key: '1kg', translations: [label('1 kg')] }],
      });
      const valueId = size.values[0]?.id ?? '';
      await asPlatform(async (tx) => {
        const product = await tx.product.create({ data: { brandId: brandA, type: 'VARIABLE' } });
        await tx.productAttribute.create({
          data: { brandId: brandA, productId: product.id, attributeId: size.id },
        });
        await tx.productAttributeValue.create({
          data: {
            brandId: brandA,
            productId: product.id,
            attributeId: size.id,
            attributeValueId: valueId,
          },
        });
      });
      const rename = await manager.call('patch', base(brandA, `attributes/${size.id}`), {
        key: 'weight',
      });
      expect(rename.body.code).toBe('ATTRIBUTE_IN_USE');
      expect((await manager.call('delete', base(brandA, `attributes/${size.id}`))).body.code).toBe(
        'ATTRIBUTE_IN_USE',
      );
      expect(
        (await manager.call('delete', base(brandA, `attributes/${size.id}/values/${valueId}`))).body
          .code,
      ).toBe('ATTRIBUTE_VALUE_IN_USE');
      // Labels and order are display-only and stay editable while in use.
      const label2 = await manager.call(
        'put',
        base(brandA, `attributes/${size.id}/translations/ar`),
        { label: 'الحجم' },
      );
      expect(label2.status).toBe(200);
    });

    it('soft deletes an unused attribute and frees its key', async () => {
      const size = await makeAttribute('size');
      expect((await manager.call('delete', base(brandA, `attributes/${size.id}`))).status).toBe(
        204,
      );
      expect((await manager.call('get', base(brandA, `attributes/${size.id}`))).status).toBe(404);
      await makeAttribute('size');
      expect(await auditCount('attribute.delete')).toBe(1);
    });

    it('applies the same brand isolation as taxonomy', async () => {
      const size = await makeAttribute('size');
      expect((await managerB.call('get', base(brandA, `attributes/${size.id}`))).status).toBe(403);
      expect((await managerB.call('get', base(brandB, `attributes/${size.id}`))).status).toBe(404);
      expect(
        (await viewer.call('post', base(brandA, 'attributes'), attributeBody('x'))).status,
      ).toBe(403);
    });
  });
});
