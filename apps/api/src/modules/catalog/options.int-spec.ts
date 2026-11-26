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
describe('catalog customization options (rules, prices, permissions)', () => {
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

  async function newProduct(name = 'Classic Cake') {
    const res = await manager.call('post', base(brandA, 'products'), {
      type: 'SIMPLE',
      translations: [{ language: 'en', name }],
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }
  const price = (delta: number) => ({ marketId: marketA, currency: 'AED', delta });

  /** The cake from the owner's description: message, colour shown only with a message, image, candles. */
  const cakeOptions = (priced = true, messageLength = 40) => ({
    groups: [
      {
        key: 'cake-message',
        type: 'TEXT',
        maxLength: messageLength,
        sortOrder: 0,
        translations: tr('Message'),
      },
      {
        key: 'message-colour',
        type: 'SELECT',
        required: true,
        sortOrder: 1,
        translations: tr('Message colour'),
        choices: [
          { key: 'white', translations: tr('White') },
          {
            key: 'gold',
            sortOrder: 1,
            translations: tr('Gold'),
            prices: priced ? [price(1500)] : [],
          },
        ],
        showWhen: [{ groupKey: 'cake-message', operator: 'FILLED' }],
      },
      {
        key: 'reference-image',
        type: 'FILE',
        sortOrder: 2,
        translations: tr('Reference image'),
        prices: priced ? [price(2500)] : [],
      },
      {
        key: 'candles',
        type: 'CHECKBOX',
        sortOrder: 3,
        translations: tr('Candles'),
        prices: priced ? [price(500)] : [],
      },
    ],
  });
  const put = (id: string, body: object, who = manager) => who.call('put', P(id, '/options'), body);

  describe('permission and scope', () => {
    it('lets viewers read, requires edit to write and pricing.edit to change prices', async () => {
      const p = await newProduct();
      expect((await viewer.call('get', P(p.id, '/options'))).status).toBe(200);
      expect((await put(p.id, cakeOptions(), viewer)).status).toBe(403);
      const editor = await actor('editor', ['products.view', 'products.edit'], { brandId: brandA });
      const priced = await put(p.id, cakeOptions(), editor);
      expect(priced.status).toBe(403);
      expect((await put(p.id, cakeOptions(false), editor)).status).toBe(200);
      expect((await put(p.id, cakeOptions(), manager)).status).toBe(200);
      // Editing text without touching prices needs only products.edit.
      expect((await put(p.id, cakeOptions(true, 60), editor)).status).toBe(200);
      expect((await nobody.call('get', P(p.id, '/options'))).status).toBe(403);
      expect((await put(p.id, cakeOptions(), marketManager)).status).toBe(403);
    });

    it('isolates brands', async () => {
      const p = await newProduct();
      expect((await managerB.call('get', P(p.id, '/options'))).status).toBe(403);
      const own = await managerB.call('get', base(brandB, `products/${p.id}/options`));
      expect(own.status).toBe(404);
    });
  });

  describe('saving options', () => {
    it('saves the cake options, reads them back with rules and prices, and audits', async () => {
      const p = await newProduct();
      const res = await put(p.id, cakeOptions());
      expect(res.status).toBe(200);
      const groups = res.body.groups as {
        key: string;
        type: string;
        maxLength: number | null;
        prices: { delta: number }[];
        choices: { key: string; prices: { delta: number }[] }[];
        showWhen: { groupKey: string; operator: string }[];
      }[];
      expect(groups.map((g) => g.key)).toEqual([
        'cake-message',
        'message-colour',
        'reference-image',
        'candles',
      ]);
      expect(groups[0]?.maxLength).toBe(40);
      expect(groups[1]?.showWhen).toEqual([{ groupKey: 'cake-message', operator: 'FILLED' }]);
      expect(groups[1]?.choices.find((c) => c.key === 'gold')?.prices).toEqual([price(1500)]);
      expect(groups[2]?.prices).toEqual([price(2500)]);
      expect((await viewer.call('get', P(p.id, '/options'))).body.groups).toHaveLength(4);
      expect(await auditCount('product.options.set')).toBe(1);
    });

    it('keeps ids stable for options and choices that keep their key', async () => {
      const p = await newProduct();
      const first = (await put(p.id, cakeOptions())).body.groups;
      const next = { groups: cakeOptions().groups.map((g) => ({ ...g })) };
      next.groups.forEach((g) => {
        if (g.key === 'message-colour') Object.assign(g, { required: false });
      });
      const second = (await put(p.id, next)).body.groups;
      expect(second[1].id).toBe(first[1].id);
      expect(second[1].choices[0].id).toBe(first[1].choices[0].id);
      expect(second[1].required).toBe(false);
    });

    it('removes options and choices that are left out, with their rules and prices', async () => {
      const p = await newProduct();
      await put(p.id, cakeOptions());
      const slim = { groups: [{ ...cakeOptions().groups[1], showWhen: [] }] };
      const res = await put(p.id, slim);
      expect(res.body.groups).toHaveLength(1);
      const left = await asPlatform(async (tx) => ({
        groups: await tx.optionGroup.count({ where: { productId: p.id } }),
        rules: await tx.optionRule.count({ where: { productId: p.id } }),
        prices: await tx.optionPrice.count(),
      }));
      expect(left).toEqual({ groups: 1, rules: 0, prices: 1 });
    });

    it('requires English labels and unique keys', async () => {
      const p = await newProduct();
      const arabicOnly = await put(p.id, {
        groups: [
          { key: 'note', type: 'TEXT', translations: [{ language: 'ar', label: 'ملاحظة' }] },
        ],
      });
      expect(arabicOnly.body.code).toBe('ENGLISH_REQUIRED');
      const dup = await put(p.id, {
        groups: [
          { key: 'note', type: 'TEXT', translations: tr('A') },
          { key: 'note', type: 'TEXT', translations: tr('B') },
        ],
      });
      expect(dup.body.code).toBe('DUPLICATE_OPTION_KEY');
      const dupChoice = await put(p.id, {
        groups: [
          {
            key: 'size',
            type: 'SELECT',
            translations: tr('Size'),
            choices: [
              { key: 'a', translations: tr('A') },
              { key: 'a', translations: tr('B') },
            ],
          },
        ],
      });
      expect(dupChoice.body.code).toBe('DUPLICATE_CHOICE_KEY');
      expect(
        (await put(p.id, { groups: [{ key: 'Bad Key', type: 'TEXT', translations: tr('X') }] }))
          .status,
      ).toBe(400);
    });

    it('checks the shape each option type allows', async () => {
      const p = await newProduct();
      const group = (extra: object) => ({
        groups: [{ key: 'opt', translations: tr('Option'), ...extra }],
      });
      expect((await put(p.id, group({ type: 'SELECT' }))).body.code).toBe('CHOICES_REQUIRED');
      const textChoices = group({ type: 'TEXT', choices: [{ key: 'a', translations: tr('A') }] });
      expect((await put(p.id, textChoices)).body.code).toBe('CHOICES_NOT_ALLOWED');
      expect((await put(p.id, group({ type: 'FILE', maxLength: 10 }))).body.code).toBe(
        'MAX_LENGTH_NOT_ALLOWED',
      );
      expect((await put(p.id, group({ type: 'DATE', minSelect: 1 }))).body.code).toBe(
        'SELECTION_LIMITS_INVALID',
      );
      const multi = (min: number, max: number | null) =>
        group({
          type: 'CHECKBOX',
          minSelect: min,
          maxSelect: max,
          choices: [
            { key: 'a', translations: tr('A') },
            { key: 'b', translations: tr('B') },
          ],
        });
      expect((await put(p.id, multi(1, 2))).status).toBe(200);
      expect((await put(p.id, multi(2, 1))).body.code).toBe('SELECTION_LIMITS_INVALID');
      expect((await put(p.id, multi(0, 3))).body.code).toBe('SELECTION_LIMITS_INVALID');
    });
  });

  describe('conditional rules', () => {
    const two = (rules: object[], second: object = {}) => ({
      groups: [
        {
          key: 'style',
          type: 'SELECT',
          translations: tr('Style'),
          choices: [
            { key: 'plain', translations: tr('Plain') },
            { key: 'custom', translations: tr('Custom') },
          ],
        },
        {
          key: 'note',
          type: 'TEXT',
          sortOrder: 1,
          translations: tr('Note'),
          showWhen: rules,
          ...second,
        },
      ],
    });

    it('accepts equals and not-equals rules that name a real choice', async () => {
      const p = await newProduct();
      const ok = await put(
        p.id,
        two([{ groupKey: 'style', operator: 'EQUALS', choiceKey: 'custom' }]),
      );
      expect(ok.status).toBe(200);
      expect(ok.body.groups[1].showWhen).toEqual([
        { groupKey: 'style', operator: 'EQUALS', choiceKey: 'custom' },
      ]);
      const neq = await put(
        p.id,
        two([{ groupKey: 'style', operator: 'NOT_EQUALS', choiceKey: 'plain' }]),
      );
      expect(neq.status).toBe(200);
    });

    it('rejects unknown options, wrong choices, self references and loops', async () => {
      const p = await newProduct();
      expect((await put(p.id, two([{ groupKey: 'ghost', operator: 'FILLED' }]))).body.code).toBe(
        'RULE_TARGET_NOT_FOUND',
      );
      expect((await put(p.id, two([{ groupKey: 'style', operator: 'EQUALS' }]))).body.code).toBe(
        'RULE_INVALID',
      );
      const wrong = await put(
        p.id,
        two([{ groupKey: 'style', operator: 'EQUALS', choiceKey: 'nope' }]),
      );
      expect(wrong.body.code).toBe('RULE_INVALID');
      const filledWithChoice = await put(
        p.id,
        two([{ groupKey: 'style', operator: 'FILLED', choiceKey: 'plain' }]),
      );
      expect(filledWithChoice.body.code).toBe('RULE_INVALID');
      const self = await put(p.id, two([{ groupKey: 'note', operator: 'FILLED' }]));
      expect(self.body.code).toBe('RULE_CYCLE');
      const loop = await put(p.id, {
        groups: [
          {
            key: 'a',
            type: 'TEXT',
            translations: tr('A'),
            showWhen: [{ groupKey: 'b', operator: 'FILLED' }],
          },
          {
            key: 'b',
            type: 'TEXT',
            translations: tr('B'),
            showWhen: [{ groupKey: 'a', operator: 'FILLED' }],
          },
        ],
      });
      expect(loop.body.code).toBe('RULE_CYCLE');
    });
  });

  describe('option prices', () => {
    it('rejects floats, negatives, wrong targets, bad currencies and duplicates', async () => {
      const p = await newProduct();
      const withPrices = (prices: object[], choicePrices: object[] = []) => ({
        groups: [
          {
            key: 'opt',
            type: choicePrices.length > 0 ? 'SELECT' : 'TEXT',
            translations: tr('Option'),
            prices,
            choices:
              choicePrices.length > 0
                ? [{ key: 'a', translations: tr('A'), prices: choicePrices }]
                : [],
          },
        ],
      });
      expect((await put(p.id, withPrices([price(5.5)]))).status).toBe(400);
      expect((await put(p.id, withPrices([price(-5)]))).status).toBe(400);
      expect((await put(p.id, withPrices([{ ...price(5), currency: 'USD' }]))).body.code).toBe(
        'CURRENCY_NOT_IN_MARKET',
      );
      expect((await put(p.id, withPrices([price(5), price(6)]))).body.code).toBe('DUPLICATE_PRICE');
      expect((await put(p.id, withPrices([price(5)], [price(7)]))).body.code).toBe(
        'PRICE_TARGET_INVALID',
      );
      const foreign = await asPlatform(async (tx) => {
        const ae = await tx.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
        return tx.market.create({
          data: { brandId: brandB, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
        });
      });
      expect((await put(p.id, withPrices([{ ...price(5), marketId: foreign.id }]))).body.code).toBe(
        'MARKET_NOT_FOUND',
      );
    });

    it('never touches SKU or stock-bearing data', async () => {
      const p = await newProduct();
      await put(p.id, cakeOptions());
      const after = await manager.call('get', base(brandA, `products/${p.id}`));
      expect(after.body.sku).toBeNull();
      const variations = await asPlatform((tx) =>
        tx.variation.count({ where: { productId: p.id } }),
      );
      expect(variations).toBe(0);
    });
  });
});
