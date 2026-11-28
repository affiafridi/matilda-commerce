import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import { uuidv7 } from '../../common/ids/uuid7';
import { ApiException } from '../../common/errors/api-exception';
import { withScope } from '../../database/scope';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { PromotionEvaluator } from '../promotions/promotion-evaluator.service';
import { QuoteService } from './quote.service';
import type { PricingInputLine } from './pricing-engine';

/**
 * The quote service against a real database (Phase 5 step 5.3): it loads catalog data under
 * row-level security and prices carts with the pure engine. Modelled products only (D3-14).
 */

const platform = { brandIds: [], platform: true } as const;

describe('QuoteService (database)', () => {
  let owner: Pool;
  let admin: PrismaClient;
  let app: PrismaClient;
  const service = new QuoteService(new PromotionEvaluator());

  const ids = {
    ae: uuidv7(),
    sa: uuidv7(),
    brandA: uuidv7(),
    brandB: uuidv7(),
    marketA: uuidv7(),
    marketA2: uuidv7(),
    marketB: uuidv7(),
  };
  const at = new Date('2026-12-01T10:00:00Z');

  interface Catalog {
    rose: string;
    cake: string;
    cakeSmall: string;
    cakeLarge: string;
    cakeOff: string;
    sizeGroup: string;
    sizeSmall: string;
    sizeBig: string;
    messageGroup: string;
    topping: string;
    candle: string;
    card: string;
    hamper: string;
    cookies: string;
    cookiesBox: string;
    cookiesBoxL: string;
    hamperComponentItem: string;
    hamperComponentVarItem: string;
    draft: string;
    scheduled: string;
    expired: string;
    otherMarket: string;
    deleted: string;
    unpriced: string;
    foreign: string;
  }
  let c: Catalog;

  const inBrandA = <T>(fn: Parameters<typeof withScope<T>>[2]) =>
    withScope(app, { brandIds: [ids.brandA] }, fn);
  const ctxA = { brandId: ids.brandA, marketId: ids.marketA, currency: 'AED', at };
  const price = (lines: PricingInputLine[], over: Partial<typeof ctxA> = {}) =>
    inBrandA((tx) => service.price(tx, { ...ctxA, ...over }, lines));
  const line = (over: Partial<PricingInputLine> & { productId: string }): PricingInputLine => ({
    quantity: 1,
    options: [],
    addOns: [],
    bundleChoices: [],
    ...over,
  });
  const invalid = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).code).toBe('CART_INVALID');
    return (err as ApiException).errors ?? [];
  };

  beforeAll(async () => {
    owner = createPool(testOwnerUrl());
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: testOwnerUrl() }) });
    app = new PrismaClient({ adapter: new PrismaPg({ connectionString: testAppUrl() }) });
    const q = await owner.connect();
    await q.query('BEGIN');
    await q.query("SELECT set_config('app.platform', 'on', true)");
    await q.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await q.query(`INSERT INTO currency (code, name, symbol, minor_unit_digits) VALUES
      ('AED','UAE Dirham','AED',2), ('USD','US Dollar','$',2) ON CONFLICT DO NOTHING`);
    await q.query(`INSERT INTO language (code, name, native_name, direction) VALUES
      ('en','English','English','LTR'), ('ar','Arabic','Arabic','RTL') ON CONFLICT DO NOTHING`);
    await q.query(`DELETE FROM country WHERE iso2 IN ('AE','SA')`);
    await q.query(
      `INSERT INTO country (id, iso2, iso3, name) VALUES ($1,'AE','ARE','United Arab Emirates'), ($2,'SA','SAU','Saudi Arabia')`,
      [ids.ae, ids.sa],
    );
    await q.query(
      `INSERT INTO brand (id, slug, name, status, updated_at) VALUES
        ($1,'quote-a','Quote A','ACTIVE', now()), ($2,'quote-b','Quote B','ACTIVE', now())`,
      [ids.brandA, ids.brandB],
    );
    await q.query(
      `INSERT INTO market (id, brand_id, country_id, code, status, timezone, updated_at) VALUES
        ($1,$2,$3,'ae','ACTIVE','Asia/Dubai', now()), ($4,$2,$7,'aex','ACTIVE','Asia/Dubai', now()),
        ($5,$6,$3,'ae','ACTIVE','Asia/Dubai', now())`,
      [ids.marketA, ids.brandA, ids.ae, ids.marketA2, ids.marketB, ids.brandB, ids.sa],
    );
    await q.query(
      `INSERT INTO market_currency (market_id, currency_code, is_default) VALUES
        ($1,'AED',true), ($1,'USD',false), ($2,'AED',true), ($3,'AED',true)`,
      [ids.marketA, ids.marketA2, ids.marketB],
    );
    await q.query('COMMIT');
    q.release();
    c = await withScope(admin, platform, (tx) => seedCatalog(tx));
  });

  afterAll(async () => {
    await owner.query('TRUNCATE brand, branch, delivery_area CASCADE');
    await Promise.all([owner.end(), admin.$disconnect(), app.$disconnect()]);
  });

  type Tx = Parameters<Parameters<typeof withScope>[2]>[0];

  async function seedCatalog(tx: Tx): Promise<Catalog> {
    const brandId = ids.brandA;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- filled in below, field by field
    const out = {} as Catalog;
    const product = async (
      key: string,
      type: 'SIMPLE' | 'VARIABLE' | 'BUNDLE',
      names: { en: string; ar?: string },
      extra: Record<string, unknown> = {},
      markets = [ids.marketA],
      brand = brandId,
    ) => {
      const p = await tx.product.create({
        data: {
          brandId: brand,
          type,
          status: 'PUBLISHED',
          sku: type === 'VARIABLE' ? null : `Q-${key.toUpperCase()}`,
          translations: {
            create: Object.entries(names).map(([language, name]) => ({
              language,
              name,
              slug: `${key}-${language}`,
            })),
          },
          ...extra,
        },
      });
      for (const marketId of markets) {
        await tx.productMarket.create({ data: { brandId: brand, productId: p.id, marketId } });
      }
      return p.id;
    };
    const money = (
      productId: string | null,
      variationId: string | null,
      regularMinor: number,
      extra: Record<string, unknown> = {},
      marketId = ids.marketA,
      brand = brandId,
    ) =>
      tx.marketPrice.create({
        data: {
          brandId: brand,
          marketId,
          currencyCode: 'AED',
          productId,
          variationId,
          regularMinor,
          ...extra,
        },
      });

    out.rose = await product('rose', 'SIMPLE', { en: 'Rose Bouquet', ar: 'باقة ورد' });
    await money(out.rose, null, 25000, {
      saleMinor: 20000,
      saleStartsAt: new Date('2026-12-01T00:00:00Z'),
      saleEndsAt: new Date('2026-12-02T00:00:00Z'),
    });

    // A variable cake with options and add-ons.
    out.cake = await product(
      'cake',
      'VARIABLE',
      { en: 'Celebration Cake' },
      { minQuantity: 1, maxQuantity: 3 },
    );
    const variation = async (sku: string, active: boolean, regular: number) => {
      const v = await tx.variation.create({
        data: { brandId, productId: out.cake, sku, combinationKey: sku.toLowerCase(), active },
      });
      await money(null, v.id, regular);
      return v.id;
    };
    out.cakeSmall = await variation('Q-CAKE-S', true, 18000);
    out.cakeLarge = await variation('Q-CAKE-L', true, 32000);
    out.cakeOff = await variation('Q-CAKE-X', false, 1000);

    const sizeGroup = await tx.optionGroup.create({
      data: {
        brandId,
        productId: out.cake,
        key: 'size-note',
        type: 'RADIO',
        required: true,
        translations: { create: [{ language: 'en', label: 'Flavour' }] },
        choices: {
          create: [
            { key: 'vanilla', translations: { create: [{ language: 'en', label: 'Vanilla' }] } },
            { key: 'truffle', translations: { create: [{ language: 'en', label: 'Truffle' }] } },
          ],
        },
      },
      include: { choices: true },
    });
    out.sizeGroup = sizeGroup.id;
    out.sizeSmall = sizeGroup.choices.find((x) => x.key === 'vanilla')!.id;
    out.sizeBig = sizeGroup.choices.find((x) => x.key === 'truffle')!.id;
    await tx.optionPrice.create({
      data: {
        brandId,
        marketId: ids.marketA,
        currencyCode: 'AED',
        optionChoiceId: out.sizeBig,
        deltaMinor: 2500,
      },
    });
    const message = await tx.optionGroup.create({
      data: {
        brandId,
        productId: out.cake,
        key: 'message',
        type: 'TEXT',
        maxLength: 30,
        translations: { create: [{ language: 'en', label: 'Message on cake' }] },
      },
    });
    out.messageGroup = message.id;
    await tx.optionPrice.create({
      data: {
        brandId,
        marketId: ids.marketA,
        currencyCode: 'AED',
        optionGroupId: message.id,
        deltaMinor: 1500,
      },
    });
    // Toppings only for the truffle flavour.
    const topping = await tx.optionGroup.create({
      data: {
        brandId,
        productId: out.cake,
        key: 'topping',
        type: 'CHECKBOX',
        translations: { create: [{ language: 'en', label: 'Topping' }] },
        choices: {
          create: [
            { key: 'berries', translations: { create: [{ language: 'en', label: 'Berries' }] } },
          ],
        },
      },
    });
    out.topping = topping.id;
    await tx.optionRule.create({
      data: {
        brandId,
        productId: out.cake,
        optionGroupId: topping.id,
        dependsOnGroupId: sizeGroup.id,
        operator: 'EQUALS',
        dependsOnChoiceId: out.sizeBig,
      },
    });
    const addons = await tx.addonGroup.create({
      data: { brandId, productId: out.cake, key: 'extras' },
    });
    const addonItem = async (key: string, maxQuantity: number, delta: number | null) => {
      const item = await tx.addonItem.create({
        data: {
          brandId,
          addonGroupId: addons.id,
          kind: 'INLINE',
          key,
          maxQuantity,
          translations: { create: [{ language: 'en', label: key }] },
        },
      });
      if (delta !== null) {
        await tx.addonItemPrice.create({
          data: {
            brandId,
            addonItemId: item.id,
            marketId: ids.marketA,
            currencyCode: 'AED',
            deltaMinor: delta,
          },
        });
      }
      return item.id;
    };
    out.candle = await addonItem('candles', 5, 300);
    out.card = await addonItem('card', 1, null);

    // A hamper bundle: a simple component, and a variable one the shopper picks a size of.
    out.cookies = await product('cookies', 'VARIABLE', { en: 'Cookie Box' });
    const cv = async (sku: string, regular: number) => {
      const v = await tx.variation.create({
        data: {
          brandId,
          productId: out.cookies,
          sku,
          combinationKey: sku.toLowerCase(),
          active: true,
        },
      });
      await money(null, v.id, regular);
      return v.id;
    };
    out.cookiesBox = await cv('Q-COOKIE-6', 6000);
    out.cookiesBoxL = await cv('Q-COOKIE-12', 11000);
    out.hamper = await product('hamper', 'BUNDLE', { en: 'Gift Hamper' });
    await money(out.hamper, null, 45000);
    const flowers = await tx.bundleItem.create({
      data: { brandId, bundleProductId: out.hamper, componentProductId: out.rose, quantity: 2 },
    });
    const box = await tx.bundleItem.create({
      data: { brandId, bundleProductId: out.hamper, componentProductId: out.cookies, quantity: 1 },
    });
    out.hamperComponentItem = flowers.id;
    out.hamperComponentVarItem = box.id;

    // Products that must not be buyable, each for a different reason.
    out.draft = await product('draft', 'SIMPLE', { en: 'Draft' }, { status: 'DRAFT' });
    await money(out.draft, null, 100);
    out.scheduled = await product(
      'sched',
      'SIMPLE',
      { en: 'Scheduled' },
      { publishAt: new Date('2027-01-01T00:00:00Z') },
    );
    await money(out.scheduled, null, 100);
    out.expired = await product(
      'expired',
      'SIMPLE',
      { en: 'Expired' },
      { unpublishAt: new Date('2026-11-01T00:00:00Z') },
    );
    await money(out.expired, null, 100);
    out.otherMarket = await product('other-market', 'SIMPLE', { en: 'Other market' }, {}, [
      ids.marketA2,
    ]);
    await money(out.otherMarket, null, 100, {}, ids.marketA2);
    out.deleted = await product(
      'deleted',
      'SIMPLE',
      { en: 'Deleted' },
      { deletedAt: new Date('2026-11-20T00:00:00Z') },
    );
    await money(out.deleted, null, 100);
    out.unpriced = await product('unpriced', 'SIMPLE', { en: 'Unpriced' });
    out.foreign = await product(
      'foreign',
      'SIMPLE',
      { en: 'Brand B product' },
      {},
      [ids.marketB],
      ids.brandB,
    );
    await money(out.foreign, null, 100, {}, ids.marketB, ids.brandB);
    return out;
  }

  it('prices a simple product from the database and ignores anything the client claims', async () => {
    const sneaky: PricingInputLine = Object.assign(line({ productId: c.rose, quantity: 2 }), {
      unitMinor: 1,
    });
    const quote = await price([sneaky], { at: new Date('2026-11-30T12:00:00Z') });
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({
      kind: 'PRODUCT',
      unitMinor: 25000,
      quantity: 2,
      totalMinor: 50000,
      sku: 'Q-ROSE',
    });
    expect(quote.totals).toMatchObject({
      currency: 'AED',
      subtotalMinor: 50000,
      discountMinor: 0,
      deliveryFeeMinor: 0,
      taxMinor: 0,
      totalMinor: 50000,
    });
  });

  it('applies a scheduled sale only inside its window', async () => {
    const unit = async (when: string) =>
      (await price([line({ productId: c.rose })], { at: new Date(when) })).lines[0]!.unitMinor;
    expect(await unit('2026-11-30T23:59:59Z')).toBe(25000);
    expect(await unit('2026-12-01T00:00:00Z')).toBe(20000);
    expect(await unit('2026-12-02T00:00:00Z')).toBe(25000);
  });

  it('snapshots names in every language the catalog holds', async () => {
    const quote = await price([line({ productId: c.rose })]);
    expect(quote.lines[0]!.name).toEqual({ en: 'Rose Bouquet', ar: 'باقة ورد' });
  });

  it('prices a customized cake with variation, options, a conditional group and add-ons', async () => {
    const quote = await price([
      line({
        id: 'line-1',
        productId: c.cake,
        variationId: c.cakeLarge,
        quantity: 2,
        options: [
          { optionId: c.sizeGroup, valueIds: [c.sizeBig] },
          { optionId: c.messageGroup, valueIds: [], text: 'Happy birthday Sara' },
        ],
        addOns: [{ addOnId: c.candle, quantity: 2 }],
      }),
    ]);
    // 32000 base + 2500 truffle + 1500 message surcharge = 36000 each
    const cake = quote.lines.find((l) => l.kind === 'PRODUCT')!;
    expect(cake).toMatchObject({
      unitMinor: 36000,
      totalMinor: 72000,
      sku: 'Q-CAKE-L',
      variationId: c.cakeLarge,
    });
    expect(
      cake.options
        .map((o) => [o.optionKey, o.choiceKey, o.text, o.deltaMinor])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['message', null, 'Happy birthday Sara', 1500],
      ['size-note', 'truffle', null, 2500],
    ]);
    const candles = quote.lines.find((l) => l.kind === 'ADD_ON')!;
    expect(candles).toMatchObject({
      addonItemId: c.candle,
      quantity: 4,
      unitMinor: 300,
      totalMinor: 1200,
      cartLineId: 'line-1',
    });
    expect(quote.totals.subtotalMinor).toBe(73200);
    expect(quote.totals.totalMinor).toBe(73200);
  });

  it('requires the cake variation and flavour, and applies the conditional topping rule', async () => {
    const errors = await invalid(price([line({ productId: c.cake })]));
    expect(errors.map((e) => e.path)).toEqual(['lines.0.variation', 'lines.0.options']);
    const vanilla = [{ optionId: c.sizeGroup, valueIds: [c.sizeSmall] }];
    const withTopping = [
      ...vanilla,
      { optionId: c.topping, valueIds: [] as string[], text: undefined },
    ];
    expect(
      (await price([line({ productId: c.cake, variationId: c.cakeSmall, options: vanilla })]))
        .lines,
    ).toHaveLength(1);
    // The topping group only applies to truffle; sending a topping for vanilla is refused.
    const berries = (
      await withScope(admin, platform, (tx) =>
        tx.optionChoice.findFirstOrThrow({ where: { optionGroupId: c.topping } }),
      )
    ).id;
    const bad = await invalid(
      price([
        line({
          productId: c.cake,
          variationId: c.cakeSmall,
          options: [...vanilla, { optionId: c.topping, valueIds: [berries] }],
        }),
      ]),
    );
    expect(bad).toHaveLength(1);
    expect(withTopping).toHaveLength(2);
    const ok = await price([
      line({
        productId: c.cake,
        variationId: c.cakeSmall,
        options: [
          { optionId: c.sizeGroup, valueIds: [c.sizeBig] },
          { optionId: c.topping, valueIds: [berries] },
        ],
      }),
    ]);
    expect(ok.lines[0]!.unitMinor).toBe(18000 + 2500);
  });

  it('enforces product quantity limits, inactive variations and add-ons not sold in the market', async () => {
    const flavour = [{ optionId: c.sizeGroup, valueIds: [c.sizeSmall] }];
    expect(
      (
        await invalid(
          price([
            line({ productId: c.cake, variationId: c.cakeSmall, options: flavour, quantity: 4 }),
          ]),
        )
      )[0]!.path,
    ).toBe('lines.0.quantity');
    expect(
      (
        await invalid(
          price([line({ productId: c.cake, variationId: c.cakeOff, options: flavour })]),
        )
      )[0]!.path,
    ).toBe('lines.0.variation');
    expect(
      (
        await invalid(
          price([
            line({
              productId: c.cake,
              variationId: c.cakeSmall,
              options: flavour,
              addOns: [{ addOnId: c.card, quantity: 1 }],
            }),
          ]),
        )
      )[0]!.path,
    ).toBe('lines.0.addOns');
  });

  it('prices a bundle at its own price and needs the shopper to choose component variations', async () => {
    const errors = await invalid(price([line({ productId: c.hamper })]));
    expect(errors.map((e) => e.path)).toEqual(['lines.0.bundleChoices']);
    const quote = await price([
      line({
        productId: c.hamper,
        bundleChoices: [{ bundleItemId: c.hamperComponentVarItem, variationId: c.cookiesBoxL }],
      }),
    ]);
    expect(quote.lines[0]).toMatchObject({ unitMinor: 45000, totalMinor: 45000 });
    expect(quote.lines[0]!.bundleItems).toEqual([
      { bundleItemId: c.hamperComponentItem, productId: c.rose, variationId: null, quantity: 2 },
      {
        bundleItemId: c.hamperComponentVarItem,
        productId: c.cookies,
        variationId: c.cookiesBoxL,
        quantity: 1,
      },
    ]);
  });

  it.each([
    ['a draft product', () => c.draft],
    ['a product scheduled for later', () => c.scheduled],
    ['an expired product', () => c.expired],
    ['a product not sold in this market', () => c.otherMarket],
    ['a deleted product', () => c.deleted],
    ["another brand's product", () => c.foreign],
    ['an unknown product', () => uuidv7()],
  ])('refuses %s as unavailable', async (_name, productId) => {
    const errors = await invalid(price([line({ productId: productId() })]));
    expect(errors).toEqual([{ path: 'lines.0.product', message: 'This product is not available' }]);
  });

  it('refuses a product with no price in the cart currency', async () => {
    expect((await invalid(price([line({ productId: c.unpriced })])))[0]!.path).toBe(
      'lines.0.price',
    );
    expect(
      (await invalid(price([line({ productId: c.rose })], { currency: 'USD' })))[0]!.path,
    ).toBe('lines.0.price');
  });

  it('lists every problem of every line at once', async () => {
    const errors = await invalid(
      price([
        line({ productId: c.draft }),
        line({ productId: c.rose }),
        line({ productId: c.unpriced }),
      ]),
    );
    expect(errors.map((e) => e.path)).toEqual(['lines.0.product', 'lines.2.price']);
  });

  it("another brand's context can never price this brand's products", async () => {
    const errors = await invalid(
      withScope(app, { brandIds: [ids.brandB] }, (tx) =>
        service.price(tx, { brandId: ids.brandB, marketId: ids.marketB, currency: 'AED', at }, [
          line({ productId: c.rose }),
        ]),
      ),
    );
    expect(errors[0]!.path).toBe('lines.0.product');
    // Even with brand A's id in the context, row-level security of brand B's scope hides everything.
    const sneaky = await invalid(
      withScope(app, { brandIds: [ids.brandB] }, (tx) =>
        service.price(tx, { brandId: ids.brandA, marketId: ids.marketA, currency: 'AED', at }, [
          line({ productId: c.rose }),
        ]),
      ),
    );
    expect(sneaky[0]!.path).toBe('lines.0.product');
  });

  it('prices an empty cart as zero', async () => {
    const quote = await price([]);
    expect(quote.lines).toEqual([]);
    expect(quote.totals.totalMinor).toBe(0);
  });

  describe('delivery fee and tax (step 5.6)', () => {
    const rose = (quantity = 1) => [line({ productId: c.rose, quantity })];
    let areaId: string;
    let zoneId: string;
    let methodId: string;
    let bareMethodId: string;
    let chargeId: string;
    const priced = (
      quantity: number,
      delivery: { areaId: string | null; methodId: string | null } | null,
      over: Partial<{ brandId: string; marketId: string }> = {},
    ) =>
      inBrandA((tx) =>
        service.price(
          tx,
          { ...ctxA, at: new Date('2026-11-30T12:00:00Z'), ...over, delivery },
          rose(quantity),
        ),
      );
    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withScope(admin, platform, fn);
    const choice = () => ({ areaId, methodId });

    beforeAll(async () => {
      await asAdmin(async (tx) => {
        const area = await tx.deliveryArea.create({
          data: { countryId: ids.ae, level: 'EMIRATE', code: 'q56-dubai' },
        });
        areaId = area.id;
        const zone = await tx.deliveryZone.create({
          data: { brandId: ids.brandA, marketId: ids.marketA, code: 'q56-zone' },
        });
        zoneId = zone.id;
        await tx.deliveryZoneArea.create({
          data: { zoneId, brandId: ids.brandA, marketId: ids.marketA, areaId },
        });
        const method = await tx.deliveryMethod.create({
          data: { brandId: ids.brandA, marketId: ids.marketA, kind: 'SCHEDULED', code: 'q56-std' },
        });
        methodId = method.id;
        const bare = await tx.deliveryMethod.create({
          data: { brandId: ids.brandA, marketId: ids.marketA, kind: 'SAME_DAY', code: 'q56-bare' },
        });
        bareMethodId = bare.id;
        const charge = await tx.zoneCharge.create({
          data: {
            brandId: ids.brandA,
            marketId: ids.marketA,
            zoneId,
            methodId,
            currencyCode: 'AED',
            feeMinor: 3000,
            freeOverMinor: 40000,
          },
        });
        chargeId = charge.id;
      });
    });

    afterEach(async () => {
      await asAdmin(async (tx) => {
        await tx.market.update({
          where: { id: ids.marketA },
          data: { taxRateBps: 0, taxInclusive: true },
        });
        await tx.deliveryZone.update({ where: { id: zoneId }, data: { status: 'ACTIVE' } });
        await tx.zoneCharge.update({ where: { id: chargeId }, data: { minimumOrderMinor: 0 } });
      });
    });

    it('quotes no delivery until an area and a method are both chosen', async () => {
      for (const d of [null, { areaId, methodId: null }, { areaId: null, methodId }]) {
        const q = await priced(1, d);
        expect(q.delivery).toBeNull();
        expect(q.totals.deliveryFeeMinor).toBe(0);
        expect(q.totals.totalMinor).toBe(25000);
      }
    });

    it("adds the zone's fee, and waives it over the free threshold on goods", async () => {
      const one = await priced(1, choice());
      expect(one.delivery).toMatchObject({ zoneId, feeMinor: 3000, waivedBy: null, problem: null });
      expect(one.totals).toMatchObject({ deliveryFeeMinor: 3000, totalMinor: 28000 });
      const two = await priced(2, choice());
      expect(two.delivery).toMatchObject({
        baseFeeMinor: 3000,
        feeMinor: 0,
        waivedBy: 'THRESHOLD',
      });
      expect(two.totals.totalMinor).toBe(50000);
    });

    it('reports a minimum order the basket does not reach', async () => {
      await asAdmin((tx) =>
        tx.zoneCharge.update({ where: { id: chargeId }, data: { minimumOrderMinor: 30000 } }),
      );
      const q = await priced(1, choice());
      expect(q.delivery).toMatchObject({ problem: 'BELOW_MINIMUM', minimumOrderMinor: 30000 });
      expect(q.totals.deliveryFeeMinor).toBe(3000);
    });

    it('is not serviceable for an unknown area, a method without a charge or a paused zone', async () => {
      const unknown = await priced(1, { areaId: uuidv7(), methodId });
      expect(unknown.delivery).toMatchObject({
        problem: 'NOT_SERVICEABLE',
        feeMinor: 0,
        zoneId: null,
      });
      const bare = await priced(1, { areaId, methodId: bareMethodId });
      expect(bare.delivery).toMatchObject({ problem: 'NOT_SERVICEABLE', feeMinor: 0 });
      await asAdmin((tx) =>
        tx.deliveryZone.update({ where: { id: zoneId }, data: { status: 'INACTIVE' } }),
      );
      const paused = await priced(1, choice());
      expect(paused.delivery).toMatchObject({ problem: 'NOT_SERVICEABLE', zoneId: null });
    });

    it("never resolves another brand's or market's zone", async () => {
      const q = await withScope(app, { brandIds: [ids.brandB] }, (tx) =>
        service.price(
          tx,
          { brandId: ids.brandB, marketId: ids.marketB, currency: 'AED', at, delivery: choice() },
          [],
        ),
      );
      expect(q.delivery).toMatchObject({ problem: 'NOT_SERVICEABLE', zoneId: null });
      const otherMarket = await inBrandA((tx) =>
        service.price(tx, { ...ctxA, marketId: ids.marketA2, delivery: choice() }, []),
      );
      expect(otherMarket.delivery).toMatchObject({ problem: 'NOT_SERVICEABLE', zoneId: null });
    });

    it('finds the tax inside inclusive prices without changing the total', async () => {
      await asAdmin((tx) =>
        tx.market.update({
          where: { id: ids.marketA },
          data: { taxRateBps: 500, taxInclusive: true },
        }),
      );
      const q = await priced(1, choice());
      expect(q.tax).toEqual({ rateBps: 500, inclusive: true });
      expect(q.lines[0]!.taxMinor).toBe(1190);
      expect(q.totals).toMatchObject({ taxMinor: 1333, taxInclusive: true, totalMinor: 28000 });
    });

    it('adds tax on top of exclusive prices, on goods and delivery', async () => {
      await asAdmin((tx) =>
        tx.market.update({
          where: { id: ids.marketA },
          data: { taxRateBps: 500, taxInclusive: false },
        }),
      );
      const q = await priced(1, choice());
      expect(q.lines[0]!.taxMinor).toBe(1250);
      expect(q.totals).toMatchObject({ taxMinor: 1400, taxInclusive: false, totalMinor: 29400 });
    });

    it('charges no tax while the market rate is zero', async () => {
      const q = await priced(1, choice());
      expect(q.totals.taxMinor).toBe(0);
    });
  });
});
