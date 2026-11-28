import { Injectable } from '@nestjs/common';
import type { QuoteLine } from '@matilda/validation';
import type { Tx } from '../admin/brand-access';
import {
  type ProductMembership,
  type PromotionDef,
  type PromotionOutcome,
  type SkipReason,
  applyPromotions,
} from './promotion-engine';

export interface PromotionContext {
  brandId: string;
  marketId: string;
  currency: string;
  /** The moment schedules are judged at. */
  at: Date;
  /** Signed-in customer, for customer-only and first-order promotions and per-customer limits. */
  customerId: string | null;
  /** Coupon code the shopper entered (already upper-case), if any. */
  couponCode: string | null;
}

export type CouponReason = 'NOT_FOUND' | 'EXHAUSTED' | 'NOT_ACTIVE' | SkipReason;

export type CouponState =
  { code: string; status: 'APPLIED' } | { code: string; status: 'REJECTED'; reason: CouponReason };

export interface PromotionEvaluation extends PromotionOutcome {
  coupon: CouponState | null;
}

/** Prices a gift product as a ready-made zero-price line, or returns null when it cannot be sold. */
export type GiftPricer = (
  productId: string,
  variationId: string | null,
) => Promise<QuoteLine | null>;

const NOTHING: PromotionOutcome = {
  lineDiscounts: [],
  applied: [],
  skipped: [],
  freeDelivery: false,
  gifts: [],
};

const texts = (rows: { language: string; name: string }[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.language, r.name]));

/**
 * Finds the promotions that may apply to a cart right now and hands them to the pure engine
 * (D5-11): active, inside their schedule, sold in the cart's market, not used up, open to this
 * audience and under the per-customer limit. Reading never changes a counter: usage is claimed
 * atomically when the order is created (step 5.8), so a shown discount is only a quote.
 */
@Injectable()
export class PromotionEvaluator {
  async evaluate(
    tx: Tx,
    ctx: PromotionContext,
    lines: readonly QuoteLine[],
    priceGift: GiftPricer,
  ): Promise<PromotionEvaluation> {
    const couponCode = ctx.couponCode;
    const empty = lines.every((l) => l.kind === 'GIFT');
    if (empty) {
      return {
        ...NOTHING,
        lineDiscounts: lines.map(() => 0),
        coupon: couponCode
          ? { code: couponCode, status: 'REJECTED', reason: 'NOT_APPLICABLE' }
          : null,
      };
    }

    const candidates = await tx.promotion.findMany({
      where: {
        brandId: ctx.brandId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: ctx.at } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: ctx.at } }] },
          { OR: [{ markets: { none: {} } }, { markets: { some: { marketId: ctx.marketId } } }] },
        ],
      },
      include: { translations: true, targets: true },
    });

    const fresh = candidates.filter((p) => p.usageLimit === null || p.usedCount < p.usageLimit);
    const eligible = await this.filterByCustomer(tx, ctx, fresh);

    let couponRow: { id: string; promotionId: string; code: string } | null = null;
    let couponReason: CouponReason | null = null;
    if (couponCode) {
      const coupon = await tx.coupon.findFirst({
        where: { brandId: ctx.brandId, code: couponCode },
      });
      if (!coupon) couponReason = 'NOT_FOUND';
      else if (coupon.status !== 'ACTIVE') couponReason = 'NOT_ACTIVE';
      else if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        couponReason = 'EXHAUSTED';
      } else if (!eligible.some((p) => p.id === coupon.promotionId))
        couponReason = 'NOT_APPLICABLE';
      else couponRow = coupon;
    }

    const couponPromotion = couponRow
      ? eligible.find((p) => p.id === couponRow.promotionId)
      : undefined;
    const automaticRows = eligible.filter((p) => !p.requiresCoupon && p.id !== couponPromotion?.id);

    const rows = [...automaticRows, ...(couponPromotion ? [couponPromotion] : [])];
    const membership = await this.membership(tx, ctx.brandId, lines, rows);

    const toDef = async (
      p: (typeof rows)[number],
      couponId: string | null,
    ): Promise<PromotionDef> => ({
      id: p.id,
      code: p.code,
      name: texts(p.translations),
      kind: p.kind,
      scope: p.scope,
      percentBps: p.percentBps,
      fixedMinor: p.fixedMinor,
      currency: p.currencyCode,
      maxDiscountMinor: p.maxDiscountMinor,
      minSubtotalMinor: p.minSubtotalMinor,
      priority: p.priority,
      combinable: p.combinable,
      couponId,
      targets: {
        productIds: new Set(p.targets.flatMap((t) => (t.productId ? [t.productId] : []))),
        categoryIds: new Set(p.targets.flatMap((t) => (t.categoryId ? [t.categoryId] : []))),
        collectionIds: new Set(p.targets.flatMap((t) => (t.collectionId ? [t.collectionId] : []))),
      },
      giftLine:
        p.kind === 'FREE_GIFT' && p.giftProductId
          ? await priceGift(p.giftProductId, p.giftVariationId)
          : null,
    });

    const automatic = await Promise.all(automaticRows.map((p) => toDef(p, null)));
    const coupon = couponPromotion && couponRow ? await toDef(couponPromotion, couponRow.id) : null;
    const outcome = applyPromotions({
      lines,
      currency: ctx.currency,
      automatic,
      coupon,
      membership,
    });

    let state: CouponState | null = null;
    if (couponCode) {
      const skippedCoupon = outcome.skipped.find((s) => s.couponId !== null);
      state = outcome.applied.some((a) => a.couponId !== null)
        ? { code: couponCode, status: 'APPLIED' }
        : {
            code: couponCode,
            status: 'REJECTED',
            reason: couponReason ?? skippedCoupon?.reason ?? 'NOT_APPLICABLE',
          };
    }
    return { ...outcome, coupon: state };
  }

  /** Audience rules and per-customer limits; guests only qualify for promotions open to everyone. */
  private async filterByCustomer<
    P extends { id: string; audience: string; perCustomerLimit: number | null },
  >(tx: Tx, ctx: PromotionContext, promotions: P[]): Promise<P[]> {
    const needsHistory = promotions.some((p) => p.audience === 'FIRST_ORDER');
    const firstOrder =
      ctx.customerId && needsHistory
        ? (await tx.customerOrder.count({
            where: {
              brandId: ctx.brandId,
              customerId: ctx.customerId,
              status: { notIn: ['DRAFT', 'CANCELLED'] },
            },
          })) === 0
        : false;

    const limited = promotions.filter((p) => p.perCustomerLimit !== null).map((p) => p.id);
    const used = new Map<string, number>();
    if (ctx.customerId && limited.length > 0) {
      const rows = await tx.promotionUsage.groupBy({
        by: ['promotionId'],
        where: { brandId: ctx.brandId, customerId: ctx.customerId, promotionId: { in: limited } },
        _count: { _all: true },
      });
      for (const r of rows) used.set(r.promotionId, r._count._all);
    }

    return promotions.filter((p) => {
      if (p.audience !== 'EVERYONE' && !ctx.customerId) return false;
      if (p.audience === 'FIRST_ORDER' && !firstOrder) return false;
      if (p.perCustomerLimit !== null && (used.get(p.id) ?? 0) >= p.perCustomerLimit) return false;
      return true;
    });
  }

  /** Category and collection membership, loaded only when some promotion targets them. */
  private async membership(
    tx: Tx,
    brandId: string,
    lines: readonly QuoteLine[],
    promotions: { scope: string }[],
  ): Promise<Map<string, ProductMembership>> {
    const wantsCategories = promotions.some((p) => p.scope === 'CATEGORY');
    const wantsCollections = promotions.some((p) => p.scope === 'COLLECTION');
    const out = new Map<string, { categoryIds: Set<string>; collectionIds: Set<string> }>();
    if (!wantsCategories && !wantsCollections) return out;
    const productIds = [
      ...new Set(lines.flatMap((l) => (l.kind === 'PRODUCT' && l.productId ? [l.productId] : []))),
    ];
    const entry = (id: string) => {
      let e = out.get(id);
      if (!e) out.set(id, (e = { categoryIds: new Set(), collectionIds: new Set() }));
      return e;
    };
    if (wantsCategories) {
      const rows = await tx.productCategory.findMany({
        where: { brandId, productId: { in: productIds } },
        select: { productId: true, categoryId: true },
      });
      for (const r of rows) entry(r.productId).categoryIds.add(r.categoryId);
    }
    if (wantsCollections) {
      const rows = await tx.productCollection.findMany({
        where: { brandId, productId: { in: productIds } },
        select: { productId: true, collectionId: true },
      });
      for (const r of rows) entry(r.productId).collectionIds.add(r.collectionId);
    }
    return out;
  }
}
