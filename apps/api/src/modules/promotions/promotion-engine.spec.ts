import type { QuoteLine } from '@matilda/validation';
import {
  type ProductMembership,
  type PromotionDef,
  allocateMinor,
  applyPromotions,
} from './promotion-engine';

const ROSE = 'p-rose';
const CAKE = 'p-cake';

const line = (over: Partial<QuoteLine> & { productId: string; unitMinor: number }): QuoteLine => ({
  kind: 'PRODUCT',
  cartLineId: over.cartLineId ?? `cl-${over.productId}`,
  variationId: null,
  addonItemId: null,
  name: { en: over.productId },
  sku: null,
  options: [],
  bundleItems: [],
  quantity: 1,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: over.unitMinor * (over.quantity ?? 1),
  ...over,
});

const promo = (over: Partial<PromotionDef> & { code: string }): PromotionDef => ({
  id: `id-${over.code}`,
  name: { en: over.code },
  kind: 'PERCENT_OFF',
  scope: 'ORDER',
  percentBps: 1000,
  fixedMinor: null,
  currency: null,
  maxDiscountMinor: null,
  minSubtotalMinor: 0,
  priority: 100,
  combinable: true,
  couponId: null,
  targets: { productIds: new Set(), categoryIds: new Set(), collectionIds: new Set() },
  giftLine: null,
  ...over,
});

const run = (
  lines: QuoteLine[],
  automatic: PromotionDef[],
  coupon: PromotionDef | null = null,
  membership: Map<string, ProductMembership> = new Map(),
) => applyPromotions({ lines, currency: 'AED', automatic, coupon, membership });

const cart = () => [
  line({ productId: ROSE, unitMinor: 25000 }),
  line({ productId: CAKE, unitMinor: 18000, quantity: 2 }),
];
// subtotal 25000 + 36000 = 61000

describe('allocateMinor', () => {
  it('splits in proportion and always adds up exactly', () => {
    expect(allocateMinor(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateMinor(10, [3, 0, 7])).toEqual([3, 0, 7]);
    for (const total of [1, 7, 99, 1001]) {
      const parts = allocateMinor(total, [3333, 3333, 3334, 17]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('gives nothing to lines of zero weight and handles nothing to split', () => {
    expect(allocateMinor(5, [0, 0])).toEqual([0, 0]);
    expect(allocateMinor(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('applyPromotions', () => {
  it('takes a percentage off the whole order, spread over the lines', () => {
    const r = run(cart(), [promo({ code: 'TEN', percentBps: 1000 })]);
    expect(r.applied).toEqual([expect.objectContaining({ code: 'TEN', discountMinor: 6100 })]);
    expect(r.lineDiscounts.reduce((a, b) => a + b, 0)).toBe(6100);
    expect(r.lineDiscounts).toEqual([2500, 3600]);
  });

  it('caps a percentage at the maximum discount', () => {
    const r = run(cart(), [promo({ code: 'BIG', percentBps: 5000, maxDiscountMinor: 5000 })]);
    expect(r.applied[0]?.discountMinor).toBe(5000);
  });

  it('takes a fixed amount in the cart currency and never more than the cart is worth', () => {
    const fixed = promo({
      code: 'FIX',
      kind: 'FIXED_OFF',
      percentBps: null,
      fixedMinor: 1500,
      currency: 'AED',
    });
    expect(run(cart(), [fixed]).applied[0]?.discountMinor).toBe(1500);
    const huge = promo({
      code: 'HUGE',
      kind: 'FIXED_OFF',
      percentBps: null,
      fixedMinor: 999999,
      currency: 'AED',
    });
    const r = run(cart(), [huge]);
    expect(r.applied[0]?.discountMinor).toBe(61000);
    expect(r.lineDiscounts).toEqual([25000, 36000]);
  });

  it('skips a fixed amount in another currency', () => {
    const usd = promo({
      code: 'USD',
      kind: 'FIXED_OFF',
      percentBps: null,
      fixedMinor: 500,
      currency: 'USD',
    });
    const r = run(cart(), [usd]);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([
      expect.objectContaining({ code: 'USD', reason: 'CURRENCY_MISMATCH' }),
    ]);
  });

  it('applies only at or above the minimum subtotal', () => {
    const min = promo({ code: 'MIN', minSubtotalMinor: 61001 });
    expect(run(cart(), [min]).skipped[0]?.reason).toBe('BELOW_MINIMUM');
    expect(run(cart(), [promo({ code: 'OK', minSubtotalMinor: 61000 })]).applied).toHaveLength(1);
  });

  it('limits a product promotion to its products and their add-ons', () => {
    const lines: QuoteLine[] = [
      line({ productId: ROSE, unitMinor: 25000 }),
      line({ productId: CAKE, unitMinor: 18000 }),
      {
        ...line({ productId: CAKE, unitMinor: 300, quantity: 2 }),
        kind: 'ADD_ON',
        productId: null,
        addonItemId: 'candle',
        cartLineId: `cl-${CAKE}`,
      },
    ];
    const cakes = promo({
      code: 'CAKES',
      scope: 'PRODUCT',
      percentBps: 5000,
      targets: { productIds: new Set([CAKE]), categoryIds: new Set(), collectionIds: new Set() },
    });
    const r = run(lines, [cakes]);
    expect(r.lineDiscounts).toEqual([0, 9000, 300]);
    expect(r.applied[0]?.discountMinor).toBe(9300);
  });

  it('matches categories and collections through product membership', () => {
    const membership = new Map<string, ProductMembership>([
      [ROSE, { categoryIds: new Set(['flowers']), collectionIds: new Set(['spring']) }],
      [CAKE, { categoryIds: new Set(['cakes']), collectionIds: new Set() }],
    ]);
    const flowers = promo({
      code: 'FLOWERS',
      scope: 'CATEGORY',
      percentBps: 1000,
      targets: {
        productIds: new Set(),
        categoryIds: new Set(['flowers']),
        collectionIds: new Set(),
      },
    });
    expect(run(cart(), [flowers], null, membership).lineDiscounts).toEqual([2500, 0]);
    const spring = promo({
      code: 'SPRING',
      scope: 'COLLECTION',
      percentBps: 1000,
      targets: {
        productIds: new Set(),
        categoryIds: new Set(),
        collectionIds: new Set(['spring']),
      },
    });
    expect(run(cart(), [spring], null, membership).lineDiscounts).toEqual([2500, 0]);
    expect(run(cart(), [flowers])).toMatchObject({
      applied: [],
      skipped: [{ reason: 'NOT_APPLICABLE' }],
    });
  });

  it('applies automatic promotions by priority, each on what is left', () => {
    const first = promo({ code: 'A', priority: 10, percentBps: 1000 });
    const second = promo({
      code: 'B',
      priority: 20,
      kind: 'FIXED_OFF',
      percentBps: null,
      fixedMinor: 1000,
      currency: 'AED',
    });
    const r = run(cart(), [second, first]);
    expect(r.applied.map((a) => a.code)).toEqual(['A', 'B']);
    expect(r.applied.map((a) => a.discountMinor)).toEqual([6100, 1000]);
    expect(r.lineDiscounts.reduce((a, b) => a + b, 0)).toBe(7100);
  });

  it('a promotion that cannot combine applies alone and blocks the rest', () => {
    const solo = promo({ code: 'SOLO', priority: 10, combinable: false, percentBps: 2000 });
    const other = promo({ code: 'OTHER', priority: 20 });
    const r = run(cart(), [other, solo]);
    expect(r.applied.map((a) => a.code)).toEqual(['SOLO']);
    expect(r.skipped).toEqual([
      expect.objectContaining({ code: 'OTHER', reason: 'NOT_COMBINABLE' }),
    ]);
  });

  it('a non-combinable promotion after another one is skipped', () => {
    const early = promo({ code: 'EARLY', priority: 10 });
    const solo = promo({ code: 'SOLO', priority: 20, combinable: false });
    const r = run(cart(), [early, solo]);
    expect(r.applied.map((a) => a.code)).toEqual(['EARLY']);
    expect(r.skipped[0]).toMatchObject({ code: 'SOLO', reason: 'NOT_COMBINABLE' });
  });

  it('applies the coupon after the automatic promotions', () => {
    const auto = promo({ code: 'AUTO', percentBps: 1000 });
    const coupon = promo({
      code: 'WELCOME',
      couponId: 'c1',
      kind: 'FIXED_OFF',
      percentBps: null,
      fixedMinor: 2000,
      currency: 'AED',
    });
    const r = run(cart(), [auto], coupon);
    expect(r.applied.map((a) => [a.code, a.couponId, a.discountMinor])).toEqual([
      ['AUTO', null, 6100],
      ['WELCOME', 'c1', 2000],
    ]);
  });

  it('refuses a non-combinable coupon after an automatic promotion and reports why', () => {
    const auto = promo({ code: 'AUTO' });
    const coupon = promo({ code: 'ONLY', couponId: 'c1', combinable: false });
    const r = run(cart(), [auto], coupon);
    expect(r.applied.map((a) => a.code)).toEqual(['AUTO']);
    expect(r.skipped).toEqual([
      expect.objectContaining({ code: 'ONLY', couponId: 'c1', reason: 'NOT_COMBINABLE' }),
    ]);
  });

  it('free delivery sets the flag without touching the lines', () => {
    const r = run(cart(), [
      promo({ code: 'SHIP', kind: 'FREE_DELIVERY', percentBps: null, minSubtotalMinor: 50000 }),
    ]);
    expect(r.freeDelivery).toBe(true);
    expect(r.lineDiscounts).toEqual([0, 0]);
    expect(r.applied[0]).toMatchObject({ kind: 'FREE_DELIVERY', discountMinor: 0 });
    expect(
      run(cart(), [
        promo({ code: 'SHIP2', kind: 'FREE_DELIVERY', percentBps: null, minSubtotalMinor: 70000 }),
      ]).freeDelivery,
    ).toBe(false);
  });

  it('adds a free gift line when the condition holds and skips it when the gift cannot be sold', () => {
    const gift: QuoteLine = {
      ...line({ productId: 'p-card', unitMinor: 0 }),
      kind: 'GIFT',
      cartLineId: null,
    };
    const withGift = promo({
      code: 'GIFT',
      kind: 'FREE_GIFT',
      percentBps: null,
      minSubtotalMinor: 50000,
      giftLine: gift,
    });
    const r = run(cart(), [withGift]);
    expect(r.gifts).toEqual([gift]);
    expect(r.applied[0]).toMatchObject({ kind: 'FREE_GIFT', discountMinor: 0 });
    expect(run([line({ productId: ROSE, unitMinor: 1000 })], [withGift]).gifts).toEqual([]);
    const noGift = promo({ code: 'NOGIFT', kind: 'FREE_GIFT', percentBps: null, giftLine: null });
    expect(run(cart(), [noGift]).skipped[0]?.reason).toBe('GIFT_UNAVAILABLE');
  });

  it('never discounts a gift line or an empty cart', () => {
    const gift: QuoteLine = {
      ...line({ productId: 'p-card', unitMinor: 500 }),
      kind: 'GIFT',
      cartLineId: null,
    };
    const r = run([gift], [promo({ code: 'TEN' })]);
    expect(r.applied).toEqual([]);
    expect(run([], [promo({ code: 'TEN' })]).applied).toEqual([]);
  });

  it('skips a percentage that rounds to nothing', () => {
    const r = run(
      [line({ productId: ROSE, unitMinor: 1 })],
      [promo({ code: 'TINY', percentBps: 1 })],
    );
    expect(r.skipped[0]?.reason).toBe('NO_DISCOUNT');
  });

  it('rounds half away from zero and keeps every minor unit accounted for', () => {
    const lines = [
      line({ productId: 'a', unitMinor: 333 }),
      line({ productId: 'b', unitMinor: 333 }),
      line({ productId: 'c', unitMinor: 334 }),
    ];
    const r = run(lines, [promo({ code: 'P', percentBps: 3333 })]);
    expect(r.lineDiscounts.reduce((a, b) => a + b, 0)).toBe(r.applied[0]?.discountMinor);
    expect(r.applied[0]?.discountMinor).toBe(333);
  });
});
