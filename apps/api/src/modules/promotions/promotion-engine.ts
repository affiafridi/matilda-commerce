import { type QuoteLine, type TranslatedText, percentOfMinor } from '@matilda/validation';

/**
 * Promotion engine (Phase 5 step 5.5, D5-11, D5-12): a pure function from priced cart lines and the
 * promotions that may apply to the lines' discounts, free delivery and free gifts. No database, no
 * clock: the caller has already filtered promotions by status, schedule, market, audience and
 * usage limits.
 *
 * Order and combining (D5-11): automatic promotions apply by priority (lower number first, then
 * code), then at most one coupon. A promotion that cannot combine applies only while nothing else
 * has applied, and once it applies nothing after it does. Every discount is taken from what is
 * left after the earlier ones and never exceeds it.
 */

export type PromotionKindName = 'PERCENT_OFF' | 'FIXED_OFF' | 'FREE_DELIVERY' | 'FREE_GIFT';
export type PromotionScopeName = 'ORDER' | 'PRODUCT' | 'CATEGORY' | 'COLLECTION';

export interface PromotionDef {
  id: string;
  code: string;
  name: TranslatedText;
  kind: PromotionKindName;
  scope: PromotionScopeName;
  percentBps: number | null;
  fixedMinor: number | null;
  currency: string | null;
  maxDiscountMinor: number | null;
  minSubtotalMinor: number;
  priority: number;
  combinable: boolean;
  /** Set when this promotion is applied through a coupon. */
  couponId: string | null;
  targets: {
    productIds: ReadonlySet<string>;
    categoryIds: ReadonlySet<string>;
    collectionIds: ReadonlySet<string>;
  };
  /** The ready-made zero-price line for a free gift, or null when the gift cannot be sold now. */
  giftLine: QuoteLine | null;
}

export interface ProductMembership {
  categoryIds: ReadonlySet<string>;
  collectionIds: ReadonlySet<string>;
}

export interface AppliedPromotion {
  promotionId: string;
  couponId: string | null;
  code: string;
  name: TranslatedText;
  kind: PromotionKindName;
  /** Total taken off the lines (0 for free delivery and gifts). */
  discountMinor: number;
}

export type SkipReason =
  | 'NOT_COMBINABLE'
  | 'NOT_APPLICABLE'
  | 'BELOW_MINIMUM'
  | 'CURRENCY_MISMATCH'
  | 'GIFT_UNAVAILABLE'
  | 'NO_DISCOUNT';

export interface SkippedPromotion {
  promotionId: string;
  code: string;
  couponId: string | null;
  reason: SkipReason;
}

export interface PromotionOutcome {
  /** Discount per quote line, same indexes as the input lines. */
  lineDiscounts: number[];
  applied: AppliedPromotion[];
  skipped: SkippedPromotion[];
  freeDelivery: boolean;
  gifts: QuoteLine[];
}

export interface PromotionInput {
  lines: readonly QuoteLine[];
  currency: string;
  /** Eligible automatic promotions, in any order. */
  automatic: readonly PromotionDef[];
  /** The one coupon promotion, if the shopper entered a valid code. */
  coupon: PromotionDef | null;
  /** Category and collection membership of the products in the cart. */
  membership: ReadonlyMap<string, ProductMembership>;
}

const grossOf = (l: QuoteLine): number => l.unitMinor * l.quantity;

/**
 * Splits `total` over `weights` in proportion, in whole minor units, so the parts add up to the
 * total exactly (largest remainder; ties go to the earlier line).
 */
export function allocateMinor(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const parts = weights.map((w, i) => {
    const scaled = BigInt(total) * BigInt(w);
    return { i, floor: Number(scaled / BigInt(sum)), rest: Number(scaled % BigInt(sum)) };
  });
  let left = total - parts.reduce((a, p) => a + p.floor, 0);
  const byRest = [...parts].sort((a, b) => b.rest - a.rest || a.i - b.i);
  const out = parts.map((p) => p.floor);
  for (const p of byRest) {
    if (left <= 0) break;
    if (weights[p.i] === 0) continue;
    out[p.i] = (out[p.i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

export function applyPromotions(input: PromotionInput): PromotionOutcome {
  const { lines } = input;
  // An add-on belongs to its product line, so it is eligible for whatever its product is.
  const productOfCartLine = new Map<string, string>();
  for (const l of lines) {
    if (l.kind === 'PRODUCT' && l.cartLineId && l.productId) {
      productOfCartLine.set(l.cartLineId, l.productId);
    }
  }
  const productOf = (l: QuoteLine): string | null =>
    l.kind === 'PRODUCT'
      ? l.productId
      : l.cartLineId
        ? (productOfCartLine.get(l.cartLineId) ?? null)
        : null;

  const remaining = lines.map((l) => (l.kind === 'GIFT' ? 0 : grossOf(l)));
  const lineDiscounts = lines.map(() => 0);
  const applied: AppliedPromotion[] = [];
  const skipped: SkippedPromotion[] = [];
  const gifts: QuoteLine[] = [];
  let freeDelivery = false;
  let blocked = false;

  const ordered = [
    ...[...input.automatic].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code)),
    ...(input.coupon ? [input.coupon] : []),
  ];

  const matches = (promo: PromotionDef, productId: string | null): boolean => {
    if (promo.scope === 'ORDER') return true;
    if (!productId) return false;
    if (promo.scope === 'PRODUCT') return promo.targets.productIds.has(productId);
    const m = input.membership.get(productId);
    if (!m) return false;
    const ids =
      promo.scope === 'CATEGORY' ? promo.targets.categoryIds : promo.targets.collectionIds;
    const own = promo.scope === 'CATEGORY' ? m.categoryIds : m.collectionIds;
    return [...ids].some((id) => own.has(id));
  };

  for (const promo of ordered) {
    const skip = (reason: SkipReason) =>
      skipped.push({ promotionId: promo.id, code: promo.code, couponId: promo.couponId, reason });

    if (blocked || (!promo.combinable && applied.length > 0)) {
      skip('NOT_COMBINABLE');
      continue;
    }
    const eligible = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.kind !== 'GIFT' && matches(promo, productOf(l)))
      .map(({ i }) => i);
    const base = eligible.reduce((a, i) => a + (remaining[i] ?? 0), 0);
    if (eligible.length === 0 || base <= 0) {
      skip('NOT_APPLICABLE');
      continue;
    }
    if (base < promo.minSubtotalMinor) {
      skip('BELOW_MINIMUM');
      continue;
    }

    let discount = 0;
    if (promo.kind === 'PERCENT_OFF') {
      discount = percentOfMinor(base, promo.percentBps ?? 0);
      if (promo.maxDiscountMinor !== null) discount = Math.min(discount, promo.maxDiscountMinor);
    } else if (promo.kind === 'FIXED_OFF') {
      if (promo.currency !== input.currency) {
        skip('CURRENCY_MISMATCH');
        continue;
      }
      discount = promo.fixedMinor ?? 0;
    } else if (promo.kind === 'FREE_GIFT') {
      if (!promo.giftLine) {
        skip('GIFT_UNAVAILABLE');
        continue;
      }
      gifts.push(promo.giftLine);
    } else {
      freeDelivery = true;
    }

    discount = Math.min(discount, base);
    if ((promo.kind === 'PERCENT_OFF' || promo.kind === 'FIXED_OFF') && discount <= 0) {
      skip('NO_DISCOUNT');
      continue;
    }
    if (discount > 0) {
      const shares = allocateMinor(
        discount,
        eligible.map((i) => remaining[i] ?? 0),
      );
      eligible.forEach((lineIndex, k) => {
        const share = shares[k] ?? 0;
        remaining[lineIndex] = (remaining[lineIndex] ?? 0) - share;
        lineDiscounts[lineIndex] = (lineDiscounts[lineIndex] ?? 0) + share;
      });
    }
    applied.push({
      promotionId: promo.id,
      couponId: promo.couponId,
      code: promo.code,
      name: promo.name,
      kind: promo.kind,
      discountMinor: discount,
    });
    if (!promo.combinable) blocked = true;
  }

  return { lineDiscounts, applied, skipped, freeDelivery, gifts };
}
