import { Injectable } from '@nestjs/common';
import type { QuoteLine, QuoteTotals, TranslatedText } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { AppliedPromotion } from '../promotions/promotion-engine';
import { type CouponState, PromotionEvaluator } from '../promotions/promotion-evaluator.service';
import type { Tx } from '../admin/brand-access';
import {
  type AddonGroupDef,
  type BundleItemDef,
  type LineError,
  type OptionGroupDef,
  type PriceDef,
  type PricingInputLine,
  type ProductDef,
  composeTotals,
  priceCart,
} from './pricing-engine';

export interface QuoteContext {
  brandId: string;
  marketId: string;
  /** Must be one of the market's currencies; the cart carries it. */
  currency: string;
  /** The moment prices, sales and publishing windows are judged at. */
  at: Date;
  /** Signed-in customer, for customer-only promotions and per-customer limits. */
  customerId?: string | null;
  /** Coupon code the shopper entered (upper-case). */
  couponCode?: string | null;
  /** Price without promotions (used to validate one line, and to price gifts). */
  skipPromotions?: boolean;
}

export interface Quote {
  marketId: string;
  currency: string;
  at: Date;
  lines: QuoteLine[];
  totals: QuoteTotals;
  promotions: {
    applied: AppliedPromotion[];
    coupon: CouponState | null;
    /** The delivery fee is waived (step 5.6 reads this). */
    freeDelivery: boolean;
  };
}

const texts = <T extends { language: string }>(rows: T[], pick: (r: T) => string): TranslatedText =>
  Object.fromEntries(rows.map((r) => [r.language, pick(r)]));

const priceOf = (
  row:
    | {
        regularMinor: number;
        saleMinor: number | null;
        saleStartsAt: Date | null;
        saleEndsAt: Date | null;
      }
    | undefined,
): PriceDef | null =>
  row
    ? {
        regular: row.regularMinor,
        sale: row.saleMinor,
        saleStartsAt: row.saleStartsAt,
        saleEndsAt: row.saleEndsAt,
      }
    : null;

/**
 * Loads the catalog data a cart needs, inside the caller's brand-scoped transaction (row-level
 * security keeps it to one brand), and prices it with the pure engine. The brand and market come
 * from trusted context, never from the request body; every price comes from the database.
 */
@Injectable()
export class QuoteService {
  constructor(private readonly promotions: PromotionEvaluator) {}

  /** Prices cart lines, or throws 422 `CART_INVALID` listing each problem by line. */
  async price(tx: Tx, ctx: QuoteContext, lines: readonly PricingInputLine[]): Promise<Quote> {
    const { quote, errors } = await this.quote(tx, ctx, lines);
    if (errors.length > 0) {
      throw new ApiException(
        422,
        'CART_INVALID',
        'Some items in the cart cannot be bought as chosen',
        errors.map((e) => ({ path: `lines.${e.index}.${e.field}`, message: e.message })),
      );
    }
    return quote;
  }

  /**
   * Prices what can be priced and reports the rest: a line with any problem is left out of the
   * quote and listed in `errors` by its index. The cart view uses this so a product that was
   * unpublished after it was added shows a notice instead of breaking the whole cart.
   */
  async quote(
    tx: Tx,
    ctx: QuoteContext,
    lines: readonly PricingInputLine[],
  ): Promise<{ quote: Quote; errors: LineError[] }> {
    const definitions = await this.load(tx, ctx, lines);
    const priced = priceCart(definitions, lines, ctx.at);

    let quoteLines: QuoteLine[] = priced.lines;
    let discountMinor = 0;
    let promotions: Quote['promotions'] = { applied: [], coupon: null, freeDelivery: false };
    if (!ctx.skipPromotions) {
      const outcome = await this.promotions.evaluate(
        tx,
        {
          brandId: ctx.brandId,
          marketId: ctx.marketId,
          currency: ctx.currency,
          at: ctx.at,
          customerId: ctx.customerId ?? null,
          couponCode: ctx.couponCode ?? null,
        },
        priced.lines,
        (productId, variationId) => this.priceGift(tx, ctx, productId, variationId),
      );
      quoteLines = [
        ...priced.lines.map((l, i) => {
          const discount = outcome.lineDiscounts[i] ?? 0;
          return { ...l, discountMinor: discount, totalMinor: l.totalMinor - discount };
        }),
        ...outcome.gifts,
      ];
      discountMinor = outcome.lineDiscounts.reduce((a, b) => a + b, 0);
      promotions = {
        applied: outcome.applied,
        coupon: outcome.coupon,
        freeDelivery: outcome.freeDelivery,
      };
    }

    return {
      errors: priced.errors,
      quote: {
        marketId: ctx.marketId,
        currency: ctx.currency,
        at: ctx.at,
        lines: quoteLines,
        // Delivery fee and tax join the totals in step 5.6.
        totals: composeTotals({
          currency: ctx.currency,
          subtotalMinor: priced.subtotalMinor,
          discountMinor,
          deliveryFeeMinor: 0,
          taxMinor: 0,
          taxInclusive: true,
        }),
        promotions,
      },
    };
  }

  /** A free gift as a zero-price line, or null when the product cannot be sold as it is right now. */
  private async priceGift(
    tx: Tx,
    ctx: QuoteContext,
    productId: string,
    variationId: string | null,
  ): Promise<QuoteLine | null> {
    const { quote, errors } = await this.quote(tx, { ...ctx, skipPromotions: true }, [
      {
        productId,
        variationId: variationId ?? undefined,
        quantity: 1,
        options: [],
        addOns: [],
        bundleChoices: [],
      },
    ]);
    const line = quote.lines.find((l) => l.kind === 'PRODUCT');
    if (errors.length > 0 || !line) return null;
    return {
      ...line,
      kind: 'GIFT',
      cartLineId: null,
      unitMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
    };
  }

  private async load(
    tx: Tx,
    ctx: QuoteContext,
    lines: readonly PricingInputLine[],
  ): Promise<Map<string, ProductDef>> {
    const ids = [...new Set(lines.map((l) => l.productId))];
    if (ids.length === 0) return new Map();
    const money = { marketId: ctx.marketId, currencyCode: ctx.currency };

    // Published, inside its schedule, sold in this market, and not deleted.
    const products = await tx.product.findMany({
      where: {
        id: { in: ids },
        brandId: ctx.brandId,
        deletedAt: null,
        status: 'PUBLISHED',
        AND: [
          { OR: [{ publishAt: null }, { publishAt: { lte: ctx.at } }] },
          { OR: [{ unpublishAt: null }, { unpublishAt: { gt: ctx.at } }] },
          { ProductMarketProductRel0: { some: { marketId: ctx.marketId } } },
        ],
      },
      select: {
        id: true,
        type: true,
        sku: true,
        minQuantity: true,
        maxQuantity: true,
        translations: { select: { language: true, name: true } },
        variations: {
          where: { deletedAt: null },
          select: { id: true, sku: true, active: true },
        },
        OptionGroupProductRel0: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            key: true,
            type: true,
            required: true,
            minSelect: true,
            maxSelect: true,
            maxLength: true,
            translations: { select: { language: true, label: true } },
            rules: {
              select: { dependsOnGroupId: true, operator: true, dependsOnChoiceId: true },
            },
            choices: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                key: true,
                translations: { select: { language: true, label: true } },
              },
            },
          },
        },
        AddonGroupProductRel0: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            key: true,
            required: true,
            minSelect: true,
            maxSelect: true,
            items: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                key: true,
                kind: true,
                maxQuantity: true,
                addonProductId: true,
                translations: { select: { language: true, label: true } },
                prices: { where: money, select: { deltaMinor: true } },
              },
            },
          },
        },
        BundleItemBundleProductRel0: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            componentProductId: true,
            componentVariationId: true,
            quantity: true,
          },
        },
      },
    });

    const simpleOrBundle = products.filter((p) => p.type !== 'VARIABLE').map((p) => p.id);
    const variationIds = products.flatMap((p) => p.variations.map((v) => v.id));
    const groupIds = products.flatMap((p) => p.OptionGroupProductRel0.map((g) => g.id));
    const choiceIds = products.flatMap((p) =>
      p.OptionGroupProductRel0.flatMap((g) => g.choices.map((c) => c.id)),
    );
    const componentIds = [
      ...new Set(
        products.flatMap((p) => p.BundleItemBundleProductRel0.map((b) => b.componentProductId)),
      ),
    ];

    const [prices, optionPrices, components] = await Promise.all([
      tx.marketPrice.findMany({
        where: {
          ...money,
          brandId: ctx.brandId,
          OR: [{ productId: { in: simpleOrBundle } }, { variationId: { in: variationIds } }],
        },
      }),
      tx.optionPrice.findMany({
        where: {
          ...money,
          brandId: ctx.brandId,
          OR: [{ optionGroupId: { in: groupIds } }, { optionChoiceId: { in: choiceIds } }],
        },
        select: { optionGroupId: true, optionChoiceId: true, deltaMinor: true },
      }),
      componentIds.length === 0
        ? Promise.resolve([])
        : tx.product.findMany({
            where: { id: { in: componentIds }, brandId: ctx.brandId, deletedAt: null },
            select: {
              id: true,
              type: true,
              variations: { where: { deletedAt: null, active: true }, select: { id: true } },
            },
          }),
    ]);

    const productPrice = new Map(
      prices.filter((p) => p.productId).map((p) => [p.productId as string, p]),
    );
    const variationPrice = new Map(
      prices.filter((p) => p.variationId).map((p) => [p.variationId as string, p]),
    );
    const groupDelta = new Map(
      optionPrices
        .filter((p) => p.optionGroupId)
        .map((p) => [p.optionGroupId as string, p.deltaMinor]),
    );
    const choiceDelta = new Map(
      optionPrices
        .filter((p) => p.optionChoiceId)
        .map((p) => [p.optionChoiceId as string, p.deltaMinor]),
    );
    const componentById = new Map(components.map((c) => [c.id, c]));

    const out = new Map<string, ProductDef>();
    for (const p of products) {
      const options: OptionGroupDef[] = p.OptionGroupProductRel0.map((g) => ({
        id: g.id,
        key: g.key,
        type: g.type,
        label: texts(g.translations, (t) => t.label),
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        maxLength: g.maxLength,
        groupDeltaMinor: groupDelta.get(g.id) ?? 0,
        rules: g.rules,
        choices: g.choices.map((c) => ({
          id: c.id,
          key: c.key,
          label: texts(c.translations, (t) => t.label),
          deltaMinor: choiceDelta.get(c.id) ?? 0,
        })),
      }));
      const addonGroups: AddonGroupDef[] = p.AddonGroupProductRel0.map((g) => ({
        id: g.id,
        key: g.key,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        items: g.items.map((i) => ({
          id: i.id,
          key: i.key,
          kind: i.kind,
          label: texts(i.translations, (t) => t.label),
          maxQuantity: i.maxQuantity,
          unitMinor: i.prices[0]?.deltaMinor ?? null,
          productId: i.addonProductId,
        })),
      }));
      const bundleItems: BundleItemDef[] = p.BundleItemBundleProductRel0.map((b) => {
        const component = componentById.get(b.componentProductId);
        return {
          id: b.id,
          componentProductId: b.componentProductId,
          fixedVariationId: b.componentVariationId,
          choosableVariationIds:
            !b.componentVariationId && component?.type === 'VARIABLE'
              ? component.variations.map((v) => v.id)
              : [],
          quantity: b.quantity,
        };
      });
      out.set(p.id, {
        id: p.id,
        type: p.type,
        name: texts(p.translations, (t) => t.name),
        sku: p.sku,
        minQuantity: p.minQuantity,
        maxQuantity: p.maxQuantity,
        price: p.type === 'VARIABLE' ? null : priceOf(productPrice.get(p.id)),
        variations: p.variations.map((v) => ({
          id: v.id,
          sku: v.sku,
          active: v.active,
          price: priceOf(variationPrice.get(v.id)),
        })),
        options,
        addonGroups,
        bundleItems,
      });
    }
    return out;
  }
}
