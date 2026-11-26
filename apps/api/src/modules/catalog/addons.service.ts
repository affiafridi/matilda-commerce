import { Injectable } from '@nestjs/common';
import { currencyCodeSchema, languageCodeSchema, minorUnitsSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound } from '../admin/admin-common';
import { CatalogAccess, REQUIRED_LANGUAGE, type Tx, mapCatalogError } from './catalog-common';

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens');

const label = z.object({ language: languageCodeSchema, label: z.string().trim().min(1).max(200) });

/** Extra charge for one unit of the add-on in a market and currency, in minor units. */
const priceSchema = z.object({
  marketId: z.string().uuid(),
  currency: currencyCodeSchema,
  delta: minorUnitsSchema,
});

const itemSchema = z.object({
  kind: z.enum(['INLINE', 'PRODUCT']),
  /** Inline add-ons (a card, balloons) have a key and their own price. */
  key: keySchema.optional(),
  /** Product add-ons point at a simple product, or one variation of a variable product. */
  productId: z.string().uuid().optional(),
  variationId: z.string().uuid().optional(),
  maxQuantity: z.number().int().min(1).max(100).default(1),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  translations: z.array(label).max(20).default([]),
  prices: z.array(priceSchema).max(100).default([]),
});

const groupSchema = z.object({
  key: keySchema,
  required: z.boolean().default(false),
  minSelect: z.number().int().min(0).max(200).default(0),
  maxSelect: z.number().int().min(1).max(200).nullable().default(null),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  translations: z.array(label).min(1).max(20),
  items: z.array(itemSchema).min(1).max(100),
});

export const putAddonsBody = z.object({ groups: z.array(groupSchema).max(20) });
type PutBody = z.infer<typeof putAddonsBody>;
type ItemBody = z.infer<typeof itemSchema>;

const invalid = (code: string, message: string) => new ApiException(422, code, message);
const identity = (i: ItemBody) =>
  i.kind === 'INLINE' ? `i:${i.key}` : `p:${i.productId}:${i.variationId ?? ''}`;

/** Shape rules that need no database. */
export function validateAddons(body: PutBody): void {
  const keys = body.groups.map((g) => g.key);
  if (new Set(keys).size !== keys.length) {
    throw invalid('DUPLICATE_ADDON_KEY', 'Each add-on group key can appear only once');
  }
  for (const g of body.groups) {
    const langs = g.translations.map((t) => t.language);
    if (!langs.includes(REQUIRED_LANGUAGE) || new Set(langs).size !== langs.length) {
      throw invalid(
        'ENGLISH_REQUIRED',
        `Group ${g.key} needs one English label and at most one per language`,
      );
    }
    if (g.required && g.minSelect < 1) {
      throw invalid(
        'SELECTION_LIMITS_INVALID',
        `A required group must allow at least one selection (${g.key})`,
      );
    }
    if (g.maxSelect !== null && g.maxSelect < g.minSelect) {
      throw invalid('SELECTION_LIMITS_INVALID', `The maximum is below the minimum (${g.key})`);
    }
    if (g.minSelect > g.items.length || (g.maxSelect ?? 0) > g.items.length) {
      throw invalid(
        'SELECTION_LIMITS_INVALID',
        `Selection limits exceed the number of items (${g.key})`,
      );
    }
    const ids = g.items.map(identity);
    if (new Set(ids).size !== ids.length) {
      throw invalid('DUPLICATE_ADDON_ITEM', `Group ${g.key} lists an add-on twice`);
    }
    for (const item of g.items) {
      const tl = item.translations.map((t) => t.language);
      if (new Set(tl).size !== tl.length)
        throw invalid('DUPLICATE_LANGUAGE', 'Each language can appear once');
      if (item.kind === 'INLINE') {
        if (!item.key || item.productId || item.variationId) {
          throw invalid('ADDON_ITEM_INVALID', 'An inline add-on has a key and no product');
        }
        if (!tl.includes(REQUIRED_LANGUAGE)) {
          throw invalid('ENGLISH_REQUIRED', `Add-on ${item.key} needs an English label`);
        }
      } else {
        if (!item.productId || item.key) {
          throw invalid('ADDON_ITEM_INVALID', 'A product add-on names a product and has no key');
        }
        if (item.prices.length > 0) {
          throw invalid(
            'PRICE_NOT_ALLOWED',
            'A product add-on is charged its own product price; only inline add-ons have a price here',
          );
        }
      }
      const priceKeys = item.prices.map((p) => `${p.marketId}:${p.currency}`);
      if (new Set(priceKeys).size !== priceKeys.length) {
        throw invalid('DUPLICATE_PRICE', 'Each market and currency can be priced once per add-on');
      }
    }
  }
}

const include = {
  translations: { select: { language: true, label: true } },
  items: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    include: {
      translations: { select: { language: true, label: true } },
      prices: { orderBy: [{ marketId: 'asc' as const }, { currencyCode: 'asc' as const }] },
    },
  },
};

@Injectable()
export class AddonsService {
  constructor(private readonly access: CatalogAccess) {}

  get(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      return this.describe(tx, productId);
    });
  }

  /**
   * Replaces the add-on groups of a product, matching groups by key and items by key (inline) or by
   * product and variation, so ids stay stable. Product add-ons use the add-on product's own price and
   * consume its own stock (Phase 4); inline add-ons carry their price here. Price changes need `pricing.edit`.
   */
  async put(actor: AdminActor, brandId: string, productId: string, body: PutBody) {
    validateAddons(body);
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        await this.mustGetProduct(tx, brandId, productId);
        await this.assertReferences(tx, brandId, productId, body);
        const before = await this.describe(tx, productId);
        const fingerprint = (
          rows: { key: string; prices: { marketId: string; currency: string; delta: number }[] }[],
        ) =>
          rows
            .flatMap((r) => r.prices.map((p) => `${r.key}|${p.marketId}|${p.currency}|${p.delta}`))
            .sort()
            .join(';');
        const incoming = body.groups.flatMap((g) =>
          g.items.map((i) => ({ key: `${g.key}/${identity(i)}`, prices: i.prices })),
        );
        const current = before.groups.flatMap((g) =>
          g.items.map((i) => ({ key: `${g.key}/${i.identity}`, prices: i.prices })),
        );
        if (fingerprint(incoming) !== fingerprint(current)) {
          this.access.require(actor, brandId, 'pricing.edit');
        }
        await this.sync(tx, brandId, productId, body);
        const after = await this.describe(tx, productId);
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.addons.set',
          'product',
          productId,
          before,
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapCatalogError(err, 'ADDON_CONFLICT', 'An add-on key is already used');
    }
  }

  private async assertReferences(tx: Tx, brandId: string, productId: string, body: PutBody) {
    const items = body.groups.flatMap((g) => g.items);
    for (const item of items) {
      if (item.kind !== 'PRODUCT' || !item.productId) continue;
      if (item.productId === productId) {
        throw invalid('ADDON_SELF', 'A product cannot be its own add-on');
      }
      const product = await tx.product.findFirst({
        where: { id: item.productId, brandId, deletedAt: null },
        select: { type: true },
      });
      if (!product)
        throw invalid('ADDON_PRODUCT_NOT_FOUND', 'An add-on product does not exist in this brand');
      if (product.type === 'BUNDLE') {
        throw invalid('ADDON_PRODUCT_INVALID', 'A bundle cannot be an add-on');
      }
      if (product.type === 'VARIABLE') {
        if (!item.variationId) {
          throw invalid('VARIATION_REQUIRED', 'Choose the variation of a variable add-on product');
        }
        const variation = await tx.variation.findFirst({
          where: { id: item.variationId, productId: item.productId, deletedAt: null },
          select: { id: true },
        });
        if (!variation)
          throw invalid(
            'VARIATION_NOT_FOUND',
            'The variation does not belong to the add-on product',
          );
      } else if (item.variationId) {
        throw invalid('VARIATION_NOT_ALLOWED', 'Only variable products have variations');
      }
    }
    const prices = items.flatMap((i) => i.prices);
    const marketIds = [...new Set(prices.map((p) => p.marketId))];
    if (marketIds.length === 0) return;
    const markets = await tx.market.count({ where: { brandId, id: { in: marketIds } } });
    if (markets !== marketIds.length)
      throw invalid('MARKET_NOT_FOUND', 'A market does not belong to this brand');
    const currencies = await tx.marketCurrency.findMany({ where: { marketId: { in: marketIds } } });
    for (const p of prices) {
      if (!currencies.some((c) => c.marketId === p.marketId && c.currencyCode === p.currency)) {
        throw invalid('CURRENCY_NOT_IN_MARKET', `${p.currency} is not a currency of that market`);
      }
    }
  }

  private async sync(tx: Tx, brandId: string, productId: string, body: PutBody) {
    const existing = await tx.addonGroup.findMany({
      where: { productId },
      include: { items: true },
    });
    await tx.addonGroup.deleteMany({
      where: { productId, key: { notIn: body.groups.map((g) => g.key) } },
    });
    for (const g of body.groups) {
      const data = {
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
      };
      const found = existing.find((e) => e.key === g.key);
      const groupId = found
        ? (await tx.addonGroup.update({ where: { id: found.id }, data, select: { id: true } })).id
        : (
            await tx.addonGroup.create({
              data: { ...data, brandId, productId, key: g.key },
              select: { id: true },
            })
          ).id;
      await tx.addonGroupTranslation.deleteMany({ where: { addonGroupId: groupId } });
      await tx.addonGroupTranslation.createMany({
        data: g.translations.map((t) => ({ ...t, brandId, addonGroupId: groupId })),
      });

      const wanted = new Set(g.items.map(identity));
      const rowIdentity = (r: {
        kind: string;
        key: string | null;
        addonProductId: string | null;
        addonVariationId: string | null;
      }) =>
        r.kind === 'INLINE' ? `i:${r.key}` : `p:${r.addonProductId}:${r.addonVariationId ?? ''}`;
      const stale = (found?.items ?? [])
        .filter((r) => !wanted.has(rowIdentity(r)))
        .map((r) => r.id);
      if (stale.length > 0) await tx.addonItem.deleteMany({ where: { id: { in: stale } } });
      for (const item of g.items) {
        const row = {
          maxQuantity: item.maxQuantity,
          sortOrder: item.sortOrder,
        };
        const current = found?.items.find((r) => rowIdentity(r) === identity(item));
        const itemId = current
          ? (
              await tx.addonItem.update({
                where: { id: current.id },
                data: row,
                select: { id: true },
              })
            ).id
          : (
              await tx.addonItem.create({
                data: {
                  ...row,
                  brandId,
                  addonGroupId: groupId,
                  kind: item.kind,
                  key: item.kind === 'INLINE' ? (item.key ?? null) : null,
                  addonProductId: item.kind === 'PRODUCT' ? (item.productId ?? null) : null,
                  addonVariationId: item.kind === 'PRODUCT' ? (item.variationId ?? null) : null,
                },
                select: { id: true },
              })
            ).id;
        await tx.addonItemTranslation.deleteMany({ where: { addonItemId: itemId } });
        await tx.addonItemTranslation.createMany({
          data: item.translations.map((t) => ({ ...t, brandId, addonItemId: itemId })),
        });
        await tx.addonItemPrice.deleteMany({ where: { addonItemId: itemId } });
        await tx.addonItemPrice.createMany({
          data: item.prices.map((p) => ({
            brandId,
            addonItemId: itemId,
            marketId: p.marketId,
            currencyCode: p.currency,
            deltaMinor: p.delta,
          })),
        });
      }
    }
  }

  private async mustGetProduct(tx: Tx, brandId: string, id: string) {
    const p = await tx.product.findFirst({
      where: { id, brandId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw notFound('Product');
    return p;
  }

  private async describe(tx: Tx, productId: string) {
    const groups = await tx.addonGroup.findMany({
      where: { productId },
      include,
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    return {
      groups: groups.map((g) => ({
        id: g.id,
        key: g.key,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        translations: g.translations,
        items: g.items.map((i) => ({
          id: i.id,
          identity:
            i.kind === 'INLINE'
              ? `i:${i.key}`
              : `p:${i.addonProductId}:${i.addonVariationId ?? ''}`,
          kind: i.kind,
          key: i.key,
          productId: i.addonProductId,
          variationId: i.addonVariationId,
          maxQuantity: i.maxQuantity,
          sortOrder: i.sortOrder,
          translations: i.translations,
          prices: i.prices.map((p) => ({
            marketId: p.marketId,
            currency: p.currencyCode,
            delta: p.deltaMinor,
          })),
        })),
      })),
    };
  }
}
