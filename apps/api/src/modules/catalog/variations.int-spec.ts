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
describe('catalog variations (attributes, generation, SKUs, rules)', () => {
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
    publisher = await actor('publisher', [...MANAGE, 'products.publish'], { brandId: brandA });
    marketManager = await actor('marketmanager', MANAGE, { brandId: brandA, marketId: marketA });
    nobody = await actor('nobody', [], null);
  });

  const P = (id: string, rest = '') => base(brandA, `products/${id}${rest}`);
  const label = (text: string) => ({ language: 'en', label: text });

  interface Attr {
    id: string;
    key: string;
    values: { id: string; key: string }[];
  }
  async function attr(key: string, valueKeys: string[], who = manager, brand = brandA) {
    const res = await who.call('post', base(brand, 'attributes'), {
      key,
      translations: [label(key)],
      values: valueKeys.map((k, i) => ({ key: k, sortOrder: i, translations: [label(k)] })),
    });
    expect(res.status).toBe(201);
    return res.body as Attr;
  }
  async function product(type: 'SIMPLE' | 'VARIABLE' | 'BUNDLE' = 'VARIABLE', name = 'Cake') {
    const res = await manager.call('post', base(brandA, 'products'), {
      type,
      translations: [{ language: 'en', name }],
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }
  const choose = (a: Attr, drives = true, valueKeys?: string[]) => ({
    attributeId: a.id,
    drivesVariations: drives,
    valueIds: a.values.filter((v) => !valueKeys || valueKeys.includes(v.key)).map((v) => v.id),
  });
  async function cake() {
    const flavour = await attr('flavour', ['chocolate', 'vanilla', 'red-velvet']);
    const size = await attr('size', ['1kg', '2kg', '3kg']);
    const p = await product();
    const set = await manager.call('put', P(p.id, '/attributes'), {
      attributes: [choose(flavour), choose(size)],
    });
    expect(set.status).toBe(200);
    return { p, flavour, size };
  }
  const generate = (id: string, skuPrefix = 'CK-CLASSIC', who = manager) =>
    who.call('post', P(id, '/variations/generate'), { skuPrefix });

  describe('permission and scope', () => {
    it('lets viewers read and blocks everything else without the right permission', async () => {
      const { p } = await cake();
      expect((await viewer.call('get', P(p.id, '/variations'))).status).toBe(200);
      expect((await viewer.call('get', P(p.id, '/attributes'))).status).toBe(200);
      expect((await generate(p.id, 'CK', viewer)).status).toBe(403);
      expect((await viewer.call('put', P(p.id, '/attributes'), { attributes: [] })).status).toBe(
        403,
      );
      expect((await nobody.call('get', P(p.id, '/variations'))).status).toBe(403);
      expect((await generate(p.id, 'CK', marketManager)).status).toBe(403);
    });

    it('isolates brands', async () => {
      const { p } = await cake();
      expect((await managerB.call('get', P(p.id, '/variations'))).status).toBe(403);
      const viaOwnBrand = await managerB.call('get', base(brandB, `products/${p.id}/variations`));
      expect(viaOwnBrand.status).toBe(404);
      const foreign = await attr('colour', ['red'], managerB, brandB);
      const p2 = await product('VARIABLE', 'Other Cake');
      const res = await manager.call('put', P(p2.id, '/attributes'), {
        attributes: [choose(foreign)],
      });
      expect(res.body.code).toBe('ATTRIBUTE_NOT_FOUND');
    });
  });

  describe('product attributes', () => {
    it('sets attributes with chosen values and reads them back', async () => {
      const { p, flavour } = await cake();
      const res = await manager.call('get', P(p.id, '/attributes'));
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual(
        expect.objectContaining({ key: expect.any(String), drivesVariations: true }),
      );
      const partial = await manager.call('put', P(p.id, '/attributes'), {
        attributes: [choose(flavour, true, ['chocolate'])],
      });
      expect(partial.body).toHaveLength(1);
      expect(partial.body[0].values.map((v: { key: string }) => v.key)).toEqual(['chocolate']);
      expect(await auditCount('product.attributes.set')).toBe(2);
    });

    it('only lets variable products drive variations and rejects bad references', async () => {
      const flavour = await attr('flavour', ['chocolate']);
      const simple = await product('SIMPLE', 'Rose');
      const drives = await manager.call('put', P(simple.id, '/attributes'), {
        attributes: [choose(flavour, true)],
      });
      expect(drives.body.code).toBe('NOT_VARIABLE');
      const descriptive = await manager.call('put', P(simple.id, '/attributes'), {
        attributes: [choose(flavour, false)],
      });
      expect(descriptive.status).toBe(200);
      const size = await attr('size', ['1kg']);
      const wrong = await manager.call('put', P(simple.id, '/attributes'), {
        attributes: [{ attributeId: flavour.id, valueIds: [size.values[0]?.id] }],
      });
      expect(wrong.body.code).toBe('VALUE_NOT_FOUND');
      const twice = await manager.call('put', P(simple.id, '/attributes'), {
        attributes: [choose(flavour, false), choose(flavour, false)],
      });
      expect(twice.body.code).toBe('DUPLICATE_ATTRIBUTE');
    });
  });

  describe('generating variations', () => {
    it('creates every flavour and size combination with SKUs and is safe to repeat', async () => {
      const { p } = await cake();
      const res = await generate(p.id);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(9);
      const skus = (res.body as { sku: string }[]).map((v) => v.sku);
      expect(skus).toContain('CK-CLASSIC-CHOCOLATE-1KG');
      expect(skus).toContain('CK-CLASSIC-RED-VELVET-3KG');
      expect(new Set(skus).size).toBe(9);
      const keys = (res.body as { combinationKey: string }[]).map((v) => v.combinationKey);
      expect(keys).toContain('flavour=vanilla|size=2kg');
      expect((await generate(p.id)).body).toHaveLength(9);
      expect(await auditCount('variation.generate')).toBe(2);
    });

    it('adds only the missing combinations when a value is added', async () => {
      const flavour = await attr('flavour', ['chocolate', 'vanilla']);
      const p = await product();
      await manager.call('put', P(p.id, '/attributes'), {
        attributes: [choose(flavour, true, ['chocolate'])],
      });
      expect((await generate(p.id, 'CK')).body).toHaveLength(1);
      await manager.call('put', P(p.id, '/attributes'), { attributes: [choose(flavour)] });
      const res = await generate(p.id, 'CK');
      expect(res.body).toHaveLength(2);
    });

    it('rejects simple products, products with no variation attributes and oversized sets', async () => {
      const simple = await product('SIMPLE', 'Rose');
      expect((await generate(simple.id)).body.code).toBe('NOT_VARIABLE');
      const bare = await product('VARIABLE', 'Bare');
      expect((await generate(bare.id)).body.code).toBe('NO_VARIATION_ATTRIBUTES');
      const many = await attr(
        'many',
        Array.from({ length: 11 }, (_, i) => `a${i}`),
      );
      const other = await attr(
        'other',
        Array.from({ length: 10 }, (_, i) => `b${i}`),
      );
      const big = await product('VARIABLE', 'Big');
      await manager.call('put', P(big.id, '/attributes'), {
        attributes: [choose(many), choose(other)],
      });
      const res = await generate(big.id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TOO_MANY_VARIATIONS');
    });

    it('rolls back completely when a generated SKU is already used', async () => {
      const { p } = await cake();
      await manager.call('post', base(brandA, 'products'), {
        type: 'SIMPLE',
        sku: 'CK-CLASSIC-VANILLA-2KG',
        translations: [{ language: 'en', name: 'Taken' }],
      });
      const res = await generate(p.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SKU_TAKEN');
      expect((await manager.call('get', P(p.id, '/variations'))).body).toHaveLength(0);
    });
  });

  describe('editing variations', () => {
    it('creates one variation by hand and rejects incomplete or repeated combinations', async () => {
      const { p, flavour, size } = await cake();
      const values = { [flavour.id]: flavour.values[0]?.id, [size.id]: size.values[0]?.id };
      const ok = await manager.call('post', P(p.id, '/variations'), { sku: 'CK-MANUAL', values });
      expect(ok.status).toBe(201);
      expect(ok.body.combinationKey).toBe('flavour=chocolate|size=1kg');
      const incomplete = await manager.call('post', P(p.id, '/variations'), {
        sku: 'CK-2',
        values: { [flavour.id]: flavour.values[0]?.id },
      });
      expect(incomplete.body.code).toBe('COMBINATION_INVALID');
      const repeated = await manager.call('post', P(p.id, '/variations'), {
        sku: 'CK-3',
        values,
      });
      expect(repeated.status).toBe(409);
      expect(repeated.body.code).toBe('COMBINATION_EXISTS');
      const sku = await manager.call('post', P(p.id, '/variations'), {
        sku: 'CK-MANUAL',
        values: { [flavour.id]: flavour.values[1]?.id, [size.id]: size.values[0]?.id },
      });
      expect(sku.body.code).toBe('SKU_TAKEN');
      expect(await auditCount('variation.create')).toBe(1);
    });

    it('bulk edits SKU, active flag and order, including swapping two SKUs', async () => {
      const { p } = await cake();
      const all = (await generate(p.id)).body as { id: string; sku: string }[];
      const [a, b] = all;
      const res = await manager.call('patch', P(p.id, '/variations'), {
        items: [
          { id: a?.id, sku: b?.sku, active: false },
          { id: b?.id, sku: a?.sku, sortOrder: 50 },
        ],
      });
      expect(res.status).toBe(200);
      const after = res.body as { id: string; sku: string; active: boolean; sortOrder: number }[];
      expect(after.find((v) => v.id === a?.id)).toEqual(
        expect.objectContaining({ sku: b?.sku, active: false }),
      );
      expect(after.find((v) => v.id === b?.id)).toEqual(
        expect.objectContaining({ sku: a?.sku, sortOrder: 50 }),
      );
      expect(await auditCount('variation.update')).toBe(1);
    });

    it('is atomic: a clash or an unknown id changes nothing', async () => {
      const { p } = await cake();
      const all = (await generate(p.id)).body as { id: string; sku: string }[];
      const [a, b, c] = all;
      const clash = await manager.call('patch', P(p.id, '/variations'), {
        items: [
          { id: a?.id, active: false },
          { id: b?.id, sku: c?.sku },
        ],
      });
      expect(clash.status).toBe(409);
      const unknown = await manager.call('patch', P(p.id, '/variations'), {
        items: [{ id: '00000000-0000-4000-8000-000000000000', active: false }],
      });
      expect(unknown.status).toBe(404);
      const after = (await manager.call('get', P(p.id, '/variations'))).body as {
        id: string;
        sku: string;
        active: boolean;
      }[];
      expect(after.every((v) => v.active)).toBe(true);
      expect(after.find((v) => v.id === b?.id)?.sku).toBe(b?.sku);
    });

    it('edits one variation', async () => {
      const { p } = await cake();
      const [a] = (await generate(p.id)).body as { id: string }[];
      const res = await manager.call('patch', P(p.id, `/variations/${a?.id}`), {
        sku: 'CK-RENAMED',
      });
      expect(res.body).toEqual(expect.objectContaining({ id: a?.id, sku: 'CK-RENAMED' }));
      expect(
        (await manager.call('patch', P(p.id, `/variations/${a?.id}`), { sku: 'lower' })).status,
      ).toBe(400);
    });
  });

  describe('protecting variations', () => {
    it('does not let attributes or values that variations use be removed or unflagged', async () => {
      const { p, flavour, size } = await cake();
      await generate(p.id);
      const dropValue = await manager.call('put', P(p.id, '/attributes'), {
        attributes: [choose(flavour, true, ['chocolate', 'vanilla']), choose(size)],
      });
      expect(dropValue.body.code).toBe('VALUE_IN_USE_BY_VARIATIONS');
      const unflag = await manager.call('put', P(p.id, '/attributes'), {
        attributes: [choose(flavour, false), choose(size)],
      });
      expect(unflag.body.code).toBe('ATTRIBUTE_IN_USE_BY_VARIATIONS');
      const dropAttr = await manager.call('put', P(p.id, '/attributes'), {
        attributes: [choose(flavour)],
      });
      expect(dropAttr.body.code).toBe('ATTRIBUTE_IN_USE_BY_VARIATIONS');
    });

    it('soft deletes a variation, frees its SKU and combination, and allows regeneration', async () => {
      const { p } = await cake();
      const all = (await generate(p.id)).body as { id: string; sku: string }[];
      const [a] = all;
      expect((await manager.call('delete', P(p.id, `/variations/${a?.id}`))).status).toBe(204);
      expect((await manager.call('get', P(p.id, '/variations'))).body).toHaveLength(8);
      const again = await generate(p.id);
      expect(again.body).toHaveLength(9);
      expect((again.body as { sku: string }[]).map((v) => v.sku)).toContain(a?.sku);
      expect(await auditCount('variation.delete')).toBe(1);
    });

    it('lets a used value be removed once its variation is deleted', async () => {
      const flavour = await attr('flavour', ['chocolate', 'vanilla']);
      const p = await product();
      await manager.call('put', P(p.id, '/attributes'), { attributes: [choose(flavour)] });
      const [a] = (await generate(p.id, 'CK')).body as { id: string; combinationKey: string }[];
      await manager.call('delete', P(p.id, `/variations/${a?.id}`));
      const res = await manager.call('put', P(p.id, '/attributes'), {
        attributes: [choose(flavour, true, ['vanilla'])],
      });
      expect(res.status).toBe(200);
    });

    it('does not delete a variation that is a bundle component', async () => {
      const { p } = await cake();
      const [a] = (await generate(p.id)).body as { id: string }[];
      const bundle = await product('BUNDLE', 'Set');
      await asPlatform((tx) =>
        tx.bundleItem.create({
          data: {
            brandId: brandA,
            bundleProductId: bundle.id,
            componentProductId: p.id,
            componentVariationId: a?.id,
            quantity: 1,
          },
        }),
      );
      const res = await manager.call('delete', P(p.id, `/variations/${a?.id}`));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('VARIATION_IN_USE');
    });
  });

  describe('publishing a variable product', () => {
    it('needs at least one active variation as well as a market', async () => {
      const { p } = await cake();
      await manager.call('put', P(p.id, '/availability'), { marketIds: [marketA], branchIds: [] });
      const none = await publisher.call('post', P(p.id, '/publish'));
      expect(none.body.code).toBe('NOT_PUBLISHABLE');
      const made = (await generate(p.id)).body as { id: string }[];
      const unpriced = await publisher.call('post', P(p.id, '/publish'));
      expect(unpriced.body.code).toBe('NOT_PUBLISHABLE');
      await manager.call('put', P(p.id, '/prices'), {
        prices: made.map((v) => ({
          marketId: marketA,
          currency: 'AED',
          variationId: v.id,
          regular: 18000,
        })),
      });
      const ok = await publisher.call('post', P(p.id, '/publish'));
      expect(ok.body.status).toBe('PUBLISHED');
    });
  });
});
