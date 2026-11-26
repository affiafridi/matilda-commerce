import { Injectable } from '@nestjs/common';
import { effectivePrice, formatMinorUnits, marketPriceSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound } from '../admin/admin-common';
import { CatalogAccess, type Tx } from './catalog-common';

const priceItem = marketPriceSchema.and(
  z.object({
    /** Required for variable products (priced per variation); omitted for simple and bundle products. */
    variationId: z.string().uuid().optional(),
  }),
);

export const putPricesBody = z.object({ prices: z.array(priceItem).max(2000) });

export const pricePreviewQuery = z.object({
  marketId: z.string().uuid(),
  /** Moment to evaluate (ISO date-time); defaults to now. Lets you check a sale before it starts. */
  at: z.coerce.date().optional(),
});

type PutBody = z.infer<typeof putPricesBody>;

const live = { deletedAt: null } as const;

interface PriceRow {
  id: string;
  marketId: string;
  currency: string;
  variationId: string | null;
  regular: number;
  sale: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

function toRow(r: {
  id: string;
  marketId: string;
  currencyCode: string;
  variationId: string | null;
  regularMinor: number;
  saleMinor: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}): PriceRow {
  return {
    id: r.id,
    marketId: r.marketId,
    currency: r.currencyCode,
    variationId: r.variationId,
    regular: r.regularMinor,
    sale: r.saleMinor,
    saleStartsAt: r.saleStartsAt,
    saleEndsAt: r.saleEndsAt,
  };
}

/** Prices are per market and currency, in integer minor units, never on the product record itself. */
@Injectable()
export class PricingService {
  constructor(private readonly access: CatalogAccess) {}

  list(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      const product = await this.mustGetProduct(tx, brandId, productId);
      return this.describe(tx, productId, product.type);
    });
  }

  /**
   * Replaces every price of the product. Variable products are priced per variation, other products
   * on the product itself. Each currency must be one of the market's currencies.
   */
  put(actor: AdminActor, brandId: string, productId: string, body: PutBody) {
    return this.access.run(actor, brandId, 'pricing.edit', async (tx) => {
      const product = await this.mustGetProduct(tx, brandId, productId);
      const variable = product.type === 'VARIABLE';
      const variations = variable
        ? new Set(
            (
              await tx.variation.findMany({
                where: { productId, ...live },
                select: { id: true },
              })
            ).map((v) => v.id),
          )
        : new Set<string>();
      const seen = new Set<string>();
      for (const p of body.prices) {
        if (variable ? !p.variationId : p.variationId) {
          throw new ApiException(
            422,
            variable ? 'VARIATION_REQUIRED' : 'VARIATION_NOT_ALLOWED',
            variable
              ? 'Variable products are priced per variation'
              : 'Only variable products are priced per variation',
          );
        }
        if (p.variationId && !variations.has(p.variationId)) {
          throw new ApiException(
            422,
            'VARIATION_NOT_FOUND',
            'A variation does not belong to this product',
          );
        }
        const key = `${p.marketId}:${p.currency}:${p.variationId ?? ''}`;
        if (seen.has(key)) {
          throw new ApiException(
            422,
            'DUPLICATE_PRICE',
            'Each market, currency and variation can be priced once',
          );
        }
        seen.add(key);
      }
      const marketIds = [...new Set(body.prices.map((p) => p.marketId))];
      const markets = await tx.market.count({ where: { brandId, id: { in: marketIds } } });
      if (markets !== marketIds.length) {
        throw new ApiException(422, 'MARKET_NOT_FOUND', 'A market does not belong to this brand');
      }
      const currencies = await tx.marketCurrency.findMany({
        where: { marketId: { in: marketIds } },
      });
      for (const p of body.prices) {
        if (!currencies.some((c) => c.marketId === p.marketId && c.currencyCode === p.currency)) {
          throw new ApiException(
            422,
            'CURRENCY_NOT_IN_MARKET',
            `${p.currency} is not a currency of that market`,
          );
        }
      }

      const before = await this.describe(tx, productId, product.type);
      await tx.marketPrice.deleteMany({
        where: variable ? { variationId: { in: [...variations] } } : { productId },
      });
      await tx.marketPrice.createMany({
        data: body.prices.map((p) => ({
          brandId,
          marketId: p.marketId,
          currencyCode: p.currency,
          productId: variable ? null : productId,
          variationId: p.variationId ?? null,
          regularMinor: p.regular,
          saleMinor: p.sale ?? null,
          saleStartsAt: p.saleStartsAt ?? null,
          saleEndsAt: p.saleEndsAt ?? null,
        })),
      });
      const after = await this.describe(tx, productId, product.type);
      await this.access.record(
        tx,
        actor,
        brandId,
        'price.set',
        'product',
        productId,
        before,
        after,
      );
      return after;
    });
  }

  remove(actor: AdminActor, brandId: string, productId: string, priceId: string) {
    return this.access.run(actor, brandId, 'pricing.edit', async (tx) => {
      const product = await this.mustGetProduct(tx, brandId, productId);
      const row = await tx.marketPrice.findFirst({
        where: {
          id: priceId,
          brandId,
          OR: [{ productId }, { variation: { productId } }],
        },
      });
      if (!row) throw notFound('Price');
      await tx.marketPrice.delete({ where: { id: priceId } });
      await this.access.record(
        tx,
        actor,
        brandId,
        'price.delete',
        'product',
        productId,
        toRow(row),
      );
      return this.describe(tx, productId, product.type);
    });
  }

  /**
   * Read-only preview of the base price a shopper would pay in a market at a moment in time. It
   * uses the same pure function as checkout will; options, add-ons, promotions and tax are not
   * included (they join the calculation in later phases).
   */
  preview(
    actor: AdminActor,
    brandId: string,
    productId: string,
    query: z.infer<typeof pricePreviewQuery>,
  ) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      const product = await this.mustGetProduct(tx, brandId, productId);
      const market = await tx.market.findFirst({
        where: { id: query.marketId, brandId },
        select: { id: true },
      });
      if (!market) throw notFound('Market');
      const at = query.at ?? new Date();
      const prices = (await this.describe(tx, productId, product.type)).filter(
        (p) => p.marketId === query.marketId,
      );
      const currencies = await tx.currency.findMany({
        where: { code: { in: [...new Set(prices.map((p) => p.currency))] } },
      });
      const variations =
        product.type === 'VARIABLE'
          ? await tx.variation.findMany({
              where: { productId, ...live },
              select: { id: true, sku: true, active: true },
            })
          : [];
      const targets =
        product.type === 'VARIABLE'
          ? variations.map((v) => ({
              variationId: v.id as string | null,
              sku: v.sku,
              active: v.active,
            }))
          : [{ variationId: null, sku: null as string | null, active: true }];
      return {
        at,
        marketId: query.marketId,
        items: targets.map((t) => ({
          ...t,
          prices: prices
            .filter((p) => p.variationId === t.variationId)
            .map((p) => {
              const digits = currencies.find((c) => c.code === p.currency)?.minorUnitDigits ?? 2;
              const now = effectivePrice(p, at);
              return {
                currency: p.currency,
                regular: p.regular,
                sale: p.sale,
                effective: now.amount,
                onSale: now.onSale,
                display: formatMinorUnits(now.amount, digits),
              };
            }),
        })),
      };
    });
  }

  private async mustGetProduct(tx: Tx, brandId: string, id: string) {
    const p = await tx.product.findFirst({
      where: { id, brandId, ...live },
      select: { id: true, type: true },
    });
    if (!p) throw notFound('Product');
    return p;
  }

  private async describe(tx: Tx, productId: string, type: string): Promise<PriceRow[]> {
    const rows = await tx.marketPrice.findMany({
      where: type === 'VARIABLE' ? { variation: { productId, ...live } } : { productId },
      orderBy: [{ marketId: 'asc' }, { currencyCode: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRow);
  }
}
