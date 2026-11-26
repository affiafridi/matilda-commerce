import { Injectable } from '@nestjs/common';
import { effectivePrice, formatMinorUnits, languageCodeSchema, z } from '@matilda/validation';
import { ApiException } from '../../../common/errors/api-exception';
import type { ResolvedTenant } from '../../tenancy/tenant-resolver.service';
import { CatalogAccess, REQUIRED_LANGUAGE, type Tx } from '../catalog-common';
import { PublicCatalogCache, catalogCacheKey } from './public-catalog.cache';

export const publicContextQuery = z.object({
  /** Language of the response; must be one the market offers. Defaults to the domain's language. */
  language: languageCodeSchema.optional(),
  /** Only for brand-wide domains that are not tied to one market. */
  market: z.string().trim().min(1).max(40).optional(),
});

export const publicProductListQuery = publicContextQuery.extend({
  category: z.string().trim().min(1).max(160).optional(),
  collection: z.string().trim().min(1).max(160).optional(),
  tag: z.string().trim().min(1).max(160).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc']).default('featured'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
type ListQuery = z.infer<typeof publicProductListQuery>;
type ContextQuery = z.infer<typeof publicContextQuery>;

interface Ctx {
  brandId: string;
  marketId: string;
  marketCode: string;
  language: string;
  languages: string[];
  currency: string;
  digits: number;
  now: Date;
}

interface Named {
  language: string;
}
const pick = <T extends Named>(rows: T[], language: string): T | undefined =>
  rows.find((r) => r.language === language) ?? rows.find((r) => r.language === REQUIRED_LANGUAGE);

const notFound = (code: string, message: string) => new ApiException(404, code, message);

interface PriceRow {
  productId: string | null;
  variationId: string | null;
  regularMinor: number;
  saleMinor: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

interface AddonItemOut {
  key: string | null;
  kind: string;
  label: string;
  maxQuantity: number;
  productId?: string;
  variationId?: string | null;
  price: { currency: string; amount: number; display: string };
}

/** Read-only catalog for the storefront: published, in-market data only, no internal fields. */
@Injectable()
export class PublicCatalogService {
  private readonly cache = new PublicCatalogCache();

  constructor(private readonly access: CatalogAccess) {}

  categories(tenant: ResolvedTenant, query: ContextQuery) {
    return this.cached(tenant, query, 'categories', {}, async (tx, ctx) => {
      const rows = await tx.category.findMany({
        where: { brandId: ctx.brandId, deletedAt: null, status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { translations: true },
      });
      const images = await this.images(
        tx,
        ctx,
        rows.flatMap((r) => (r.mediaAssetId ? [r.mediaAssetId] : [])),
      );
      type Node = {
        slug: string;
        name: string;
        description: string | null;
        seoTitle: string | null;
        seoDescription: string | null;
        image: unknown;
        children: Node[];
      };
      const byParent = new Map<string | null, typeof rows>();
      for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
      const build = (parentId: string | null): Node[] =>
        (byParent.get(parentId) ?? []).flatMap((r) => {
          const t = pick(r.translations, ctx.language);
          if (!t) return [];
          return [
            {
              slug: t.slug,
              name: t.name,
              description: t.description,
              seoTitle: t.seoTitle,
              seoDescription: t.seoDescription,
              image: r.mediaAssetId ? (images.get(r.mediaAssetId) ?? null) : null,
              children: build(r.id),
            },
          ];
        });
      return { language: ctx.language, categories: build(null) };
    });
  }

  collections(tenant: ResolvedTenant, query: ContextQuery) {
    return this.cached(tenant, query, 'collections', {}, async (tx, ctx) => {
      const rows = await tx.collection.findMany({
        where: { brandId: ctx.brandId, deletedAt: null, status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { translations: true },
      });
      return {
        language: ctx.language,
        collections: rows.flatMap((r) => {
          const t = pick(r.translations, ctx.language);
          return t
            ? [
                {
                  slug: t.slug,
                  name: t.name,
                  description: t.description,
                  seoTitle: t.seoTitle,
                  seoDescription: t.seoDescription,
                },
              ]
            : [];
        }),
      };
    });
  }

  products(tenant: ResolvedTenant, query: ListQuery) {
    const { language: _l, market: _m, page, limit, ...filters } = query;
    return this.cached(tenant, query, 'products', { ...filters, page, limit }, async (tx, ctx) => {
      const and: object[] = [];
      if (query.category) {
        const ids = await this.categoryIds(tx, ctx, query.category);
        and.push({ categoryLinks: { some: { categoryId: { in: ids } } } });
      }
      if (query.collection) {
        const found = await tx.collectionTranslation.findFirst({
          where: {
            brandId: ctx.brandId,
            language: ctx.language,
            slug: query.collection,
            collection: { status: 'PUBLISHED', deletedAt: null },
          },
          select: { collectionId: true },
        });
        if (!found) throw notFound('COLLECTION_NOT_FOUND', 'Collection not found');
        and.push({ collectionLinks: { some: { collectionId: found.collectionId } } });
      }
      if (query.tag) {
        const found = await tx.tagTranslation.findFirst({
          where: {
            brandId: ctx.brandId,
            language: ctx.language,
            slug: query.tag,
            tag: { status: 'PUBLISHED', deletedAt: null },
          },
          select: { tagId: true },
        });
        if (!found) throw notFound('TAG_NOT_FOUND', 'Tag not found');
        and.push({ tagLinks: { some: { tagId: found.tagId } } });
      }
      if (query.q) {
        and.push({
          translations: {
            some: {
              language: { in: [ctx.language, REQUIRED_LANGUAGE] },
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { shortDescription: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          },
        });
      }
      const where = this.liveWhere(ctx, and);
      const byPrice = query.sort === 'price_asc' || query.sort === 'price_desc';
      if (!byPrice) {
        // Featured and newest are plain column orders: the database pages, and only the products on
        // this page are priced and decorated (a large catalog never loads whole into memory).
        const [total, rows] = await Promise.all([
          tx.product.count({ where }),
          tx.product.findMany({
            where,
            orderBy:
              query.sort === 'newest'
                ? [{ createdAt: 'desc' }, { id: 'asc' }]
                : [{ sortOrder: 'asc' }, { id: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
            include: { translations: true },
          }),
        ]);
        return {
          language: ctx.language,
          total,
          page,
          limit,
          items: await this.cards(tx, ctx, rows),
        };
      }
      // Price orders need every candidate's effective price, so they still rank in memory.
      const rows = await tx.product.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { translations: true },
      });
      const cards = await this.cards(tx, ctx, rows);
      const sorted = cards.slice();
      const dir = query.sort === 'price_asc' ? 1 : -1;
      sorted.sort((a, b) => dir * (a.price.amount - b.price.amount));
      const start = (page - 1) * limit;
      return {
        language: ctx.language,
        total: sorted.length,
        page,
        limit,
        items: sorted.slice(start, start + limit),
      };
    });
  }

  product(tenant: ResolvedTenant, slug: string, query: ContextQuery) {
    return this.cached(tenant, query, 'product', { slug }, async (tx, ctx) => {
      const found = await tx.productTranslation.findFirst({
        where: { brandId: ctx.brandId, language: ctx.language, slug },
        select: { productId: true },
      });
      const product = found
        ? await tx.product.findFirst({
            where: { id: found.productId, ...this.liveWhere(ctx) },
            include: {
              translations: true,
              categoryLinks: { orderBy: { sortOrder: 'asc' } },
              tagLinks: { orderBy: { sortOrder: 'asc' } },
            },
          })
        : null;
      if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
      const t = pick(product.translations, ctx.language);
      if (!t) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

      const [card] = await this.cards(tx, ctx, [product]);
      if (!card) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
      const [gallery, taxonomy, attributes, variations, options, addons, bundle] =
        await Promise.all([
          this.gallery(tx, ctx, product.id),
          this.taxonomy(
            tx,
            ctx,
            product.categoryLinks.map((l) => l.categoryId),
            product.tagLinks.map((l) => l.tagId),
          ),
          this.attributes(tx, ctx, product.id),
          product.type === 'VARIABLE' ? this.variations(tx, ctx, product.id) : [],
          this.options(tx, ctx, product.id),
          this.addons(tx, ctx, product.id),
          product.type === 'BUNDLE' ? this.bundle(tx, ctx, product.id) : [],
        ]);
      return {
        language: ctx.language,
        ...card,
        description: t.description,
        seoTitle: t.seoTitle,
        seoDescription: t.seoDescription,
        minQuantity: product.minQuantity,
        maxQuantity: product.maxQuantity,
        // Slugs of the other languages of this market, for hreflang and the language switcher.
        alternates: product.translations
          .filter((x) => ctx.languages.includes(x.language))
          .map((x) => ({ language: x.language, slug: x.slug })),
        images: gallery,
        ...taxonomy,
        attributes,
        variations,
        options,
        addons,
        bundle,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------

  /** Context resolution, cache lookup and the scoped read in one place. */
  private cached<T>(
    tenant: ResolvedTenant,
    query: ContextQuery,
    resource: string,
    params: Record<string, unknown>,
    load: (tx: Tx, ctx: Ctx) => Promise<T>,
  ): Promise<T> {
    return this.access.runPublic(tenant.brand.id, async (tx) => {
      const ctx = await this.context(tx, tenant, query);
      const key = catalogCacheKey(ctx, resource, params);
      // The load runs in its own transaction so a cache fill never outlives the request's scope.
      return this.cache.get(key, () =>
        this.access.runPublic(ctx.brandId, (inner) => load(inner, ctx)),
      );
    });
  }

  /**
   * Brand comes from the trusted host; the market from the host, or for brand-wide domains from a
   * market code that must be one of the brand's active markets; the language from the market's
   * own list. Nothing the client sends can reach another brand's data.
   */
  private async context(tx: Tx, tenant: ResolvedTenant, query: ContextQuery): Promise<Ctx> {
    const brandId = tenant.brand.id;
    const market = await tx.market.findFirst({
      where: {
        brandId,
        status: 'ACTIVE',
        ...(tenant.market ? { id: tenant.market.id } : { code: query.market ?? '' }),
      },
      select: {
        id: true,
        code: true,
        currencies: {
          select: { isDefault: true, currency: true },
          orderBy: { currencyCode: 'asc' },
        },
        languages: { select: { isDefault: true, language: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!market) {
      throw new ApiException(
        404,
        tenant.market || query.market ? 'MARKET_NOT_FOUND' : 'MARKET_REQUIRED',
        tenant.market || query.market
          ? 'This market is not available'
          : 'Choose a market with the "market" parameter',
      );
    }
    const languages = market.languages.map((l) => l.language.code);
    if (query.language && !languages.includes(query.language)) {
      throw new ApiException(
        400,
        'UNSUPPORTED_LANGUAGE',
        'This market does not offer that language',
      );
    }
    const fallback = market.languages.find((l) => l.isDefault)?.language.code ?? REQUIRED_LANGUAGE;
    const language =
      query.language ??
      (tenant.language && languages.includes(tenant.language) ? tenant.language : fallback);
    const currency = market.currencies.find((c) => c.isDefault) ?? market.currencies[0];
    if (!currency) throw notFound('MARKET_NOT_FOUND', 'This market is not available');
    return {
      brandId,
      marketId: market.id,
      marketCode: market.code,
      language,
      languages,
      currency: currency.currency.code,
      digits: currency.currency.minorUnitDigits,
      now: new Date(),
    };
  }

  /** Published, not scheduled for later, not expired, and sold in this market. */
  private liveWhere(ctx: Ctx, extra: object[] = []) {
    return {
      brandId: ctx.brandId,
      deletedAt: null,
      status: 'PUBLISHED' as const,
      AND: [
        { OR: [{ publishAt: null }, { publishAt: { lte: ctx.now } }] },
        { OR: [{ unpublishAt: null }, { unpublishAt: { gt: ctx.now } }] },
        { ProductMarketProductRel0: { some: { marketId: ctx.marketId } } },
        ...extra,
      ],
    };
  }

  private money(ctx: Ctx, row: PriceRow) {
    const now = effectivePrice(
      {
        regular: row.regularMinor,
        sale: row.saleMinor,
        saleStartsAt: row.saleStartsAt,
        saleEndsAt: row.saleEndsAt,
      },
      ctx.now,
    );
    return {
      currency: ctx.currency,
      amount: now.amount,
      regular: row.regularMinor,
      onSale: now.onSale,
      display: formatMinorUnits(now.amount, ctx.digits),
    };
  }

  private priceRows(tx: Tx, ctx: Ctx, productIds: string[], variationIds: string[]) {
    return tx.marketPrice.findMany({
      where: {
        brandId: ctx.brandId,
        marketId: ctx.marketId,
        currencyCode: ctx.currency,
        OR: [{ productId: { in: productIds } }, { variationId: { in: variationIds } }],
      },
      select: {
        productId: true,
        variationId: true,
        regularMinor: true,
        saleMinor: true,
        saleStartsAt: true,
        saleEndsAt: true,
      },
    });
  }

  /** Product cards with their price (from-price for variable products) and main picture. */
  private async cards(
    tx: Tx,
    ctx: Ctx,
    products: {
      id: string;
      type: string;
      madeToOrder: boolean;
      translations: {
        language: string;
        name: string;
        slug: string;
        shortDescription: string | null;
      }[];
    }[],
  ) {
    if (products.length === 0) return [];
    const ids = products.map((p) => p.id);
    const variations = await tx.variation.findMany({
      where: { productId: { in: ids }, active: true, deletedAt: null },
      select: { id: true, productId: true },
    });
    const prices = await this.priceRows(
      tx,
      ctx,
      ids,
      variations.map((v) => v.id),
    );
    const media = await tx.productMedia.findMany({
      where: { productId: { in: ids } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      select: { productId: true, mediaAssetId: true },
    });
    const images = await this.images(
      tx,
      ctx,
      media.map((m) => m.mediaAssetId),
    );
    return products.flatMap((p) => {
      const t = pick(p.translations, ctx.language);
      const own =
        p.type === 'VARIABLE'
          ? variations
              .filter((v) => v.productId === p.id)
              .flatMap((v) => prices.filter((r) => r.variationId === v.id))
          : prices.filter((r) => r.productId === p.id);
      if (!t || own.length === 0) return []; // nothing to sell in this market yet
      const money = own.map((r) => this.money(ctx, r));
      const lowest = money.reduce((a, b) => (b.amount < a.amount ? b : a));
      const mainAsset = media.find((m) => m.productId === p.id)?.mediaAssetId;
      return [
        {
          id: p.id,
          type: p.type,
          slug: t.slug,
          name: t.name,
          shortDescription: t.shortDescription,
          madeToOrder: p.madeToOrder,
          price: { ...lowest, from: p.type === 'VARIABLE' && money.length > 1 },
          image: (mainAsset && images.get(mainAsset)) || null,
        },
      ];
    });
  }

  private async images(tx: Tx, ctx: Ctx, assetIds: string[]) {
    const unique = [...new Set(assetIds)];
    const out = new Map<
      string,
      {
        width: number | null;
        height: number | null;
        alt: string;
        urls: Record<string, string>;
      }
    >();
    if (unique.length === 0) return out;
    const rows = await tx.mediaAsset.findMany({
      where: { id: { in: unique }, brandId: ctx.brandId, status: 'READY' },
      select: {
        id: true,
        width: true,
        height: true,
        translations: { select: { language: true, altText: true } },
        variants: { select: { kind: true } },
      },
    });
    for (const r of rows) {
      out.set(r.id, {
        width: r.width,
        height: r.height,
        alt: pick(r.translations, ctx.language)?.altText ?? '',
        urls: Object.fromEntries(
          r.variants.map((v) => [
            v.kind.toLowerCase(),
            `/api/v1/media/${ctx.brandId}/${r.id}/${v.kind.toLowerCase()}`,
          ]),
        ),
      });
    }
    return out;
  }

  private async gallery(tx: Tx, ctx: Ctx, productId: string) {
    const rows = await tx.productMedia.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { mediaAssetId: 'asc' }],
      select: { mediaAssetId: true, isPrimary: true },
    });
    const images = await this.images(
      tx,
      ctx,
      rows.map((r) => r.mediaAssetId),
    );
    return rows.flatMap((r) => {
      const image = images.get(r.mediaAssetId);
      return image ? [{ ...image, isPrimary: r.isPrimary }] : [];
    });
  }

  /** Category and its descendants (a category page lists the products of its sub-categories too). */
  private async categoryIds(tx: Tx, ctx: Ctx, slug: string): Promise<string[]> {
    const found = await tx.categoryTranslation.findFirst({
      where: {
        brandId: ctx.brandId,
        language: ctx.language,
        slug,
        category: { status: 'PUBLISHED', deletedAt: null },
      },
      select: { categoryId: true },
    });
    if (!found) throw notFound('CATEGORY_NOT_FOUND', 'Category not found');
    const all = await tx.category.findMany({
      where: { brandId: ctx.brandId, deletedAt: null, status: 'PUBLISHED' },
      select: { id: true, parentId: true },
    });
    const ids = [found.categoryId];
    for (let i = 0; i < ids.length; i++) {
      for (const c of all) if (c.parentId === ids[i]) ids.push(c.id);
    }
    return ids;
  }

  private async taxonomy(tx: Tx, ctx: Ctx, categoryIds: string[], tagIds: string[]) {
    const [categories, tags] = await Promise.all([
      tx.category.findMany({
        where: {
          id: { in: categoryIds },
          brandId: ctx.brandId,
          deletedAt: null,
          status: 'PUBLISHED',
        },
        include: { translations: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      tx.tag.findMany({
        where: { id: { in: tagIds }, brandId: ctx.brandId, deletedAt: null, status: 'PUBLISHED' },
        include: { translations: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const shape = (rows: { translations: { language: string; name: string; slug: string }[] }[]) =>
      rows.flatMap((r) => {
        const t = pick(r.translations, ctx.language);
        return t ? [{ slug: t.slug, name: t.name }] : [];
      });
    return { categories: shape(categories), tags: shape(tags) };
  }

  /** Visible attributes with the values chosen for this product (specifications). */
  private async attributes(tx: Tx, ctx: Ctx, productId: string) {
    const links = await tx.productAttribute.findMany({
      where: { productId, visible: true },
      orderBy: [{ sortOrder: 'asc' }, { attributeId: 'asc' }],
    });
    if (links.length === 0) return [];
    const [defs, chosen] = await Promise.all([
      tx.attribute.findMany({
        where: { id: { in: links.map((l) => l.attributeId) }, deletedAt: null },
        include: { translations: true },
      }),
      tx.productAttributeValue.findMany({ where: { productId } }),
    ]);
    const values = await tx.attributeValue.findMany({
      where: { id: { in: chosen.map((c) => c.attributeValueId) } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { translations: true },
    });
    return links.flatMap((l) => {
      const def = defs.find((d) => d.id === l.attributeId);
      const label = def && pick(def.translations, ctx.language)?.label;
      if (!def || !label) return [];
      const chosenIds = new Set(
        chosen.filter((c) => c.attributeId === l.attributeId).map((c) => c.attributeValueId),
      );
      return [
        {
          key: def.key,
          label,
          values: values
            .filter((v) => chosenIds.has(v.id))
            .map((v) => ({
              key: v.key,
              label: pick(v.translations, ctx.language)?.label ?? v.key,
              colorHex: v.colorHex,
            })),
        },
      ];
    });
  }

  private async variations(tx: Tx, ctx: Ctx, productId: string) {
    const rows = await tx.variation.findMany({
      where: { productId, active: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const [prices, vv] = await Promise.all([
      this.priceRows(
        tx,
        ctx,
        [],
        rows.map((r) => r.id),
      ),
      tx.variationValue.findMany({ where: { productId } }),
    ]);
    const [attrs, vals, images] = await Promise.all([
      tx.attribute.findMany({
        where: { id: { in: [...new Set(vv.map((x) => x.attributeId))] } },
        include: { translations: true },
      }),
      tx.attributeValue.findMany({
        where: { id: { in: [...new Set(vv.map((x) => x.attributeValueId))] } },
        include: { translations: true },
      }),
      this.images(
        tx,
        ctx,
        rows.flatMap((r) => (r.mediaAssetId ? [r.mediaAssetId] : [])),
      ),
    ]);
    return rows.flatMap((r) => {
      const price = prices.find((p) => p.variationId === r.id);
      if (!price) return []; // not sold in this market
      return [
        {
          id: r.id,
          price: this.money(ctx, price),
          image: (r.mediaAssetId && images.get(r.mediaAssetId)) || null,
          choices: vv
            .filter((x) => x.variationId === r.id)
            .map((x) => {
              const a = attrs.find((y) => y.id === x.attributeId);
              const v = vals.find((y) => y.id === x.attributeValueId);
              return {
                attribute: a?.key ?? '',
                attributeLabel: (a && pick(a.translations, ctx.language)?.label) ?? a?.key ?? '',
                value: v?.key ?? '',
                valueLabel: (v && pick(v.translations, ctx.language)?.label) ?? v?.key ?? '',
                colorHex: v?.colorHex ?? null,
              };
            }),
        },
      ];
    });
  }

  private async options(tx: Tx, ctx: Ctx, productId: string) {
    const groups = await tx.optionGroup.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      include: {
        translations: true,
        choices: {
          orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
          include: { translations: true },
        },
        rules: true,
      },
    });
    if (groups.length === 0) return [];
    const groupKey = new Map(groups.map((g) => [g.id, g.key]));
    const choiceKey = new Map(groups.flatMap((g) => g.choices.map((c) => [c.id, c.key] as const)));
    const prices = await tx.optionPrice.findMany({
      where: {
        brandId: ctx.brandId,
        marketId: ctx.marketId,
        currencyCode: ctx.currency,
        OR: [
          { optionGroupId: { in: groups.map((g) => g.id) } },
          { optionChoiceId: { in: [...choiceKey.keys()] } },
        ],
      },
    });
    const delta = (where: { group?: string; choice?: string }) => {
      const row = prices.find((p) =>
        where.group ? p.optionGroupId === where.group : p.optionChoiceId === where.choice,
      );
      return row
        ? {
            currency: ctx.currency,
            amount: row.deltaMinor,
            display: formatMinorUnits(row.deltaMinor, ctx.digits),
          }
        : null;
    };
    return groups.flatMap((g) => {
      const t = pick(g.translations, ctx.language);
      if (!t) return [];
      return [
        {
          key: g.key,
          type: g.type,
          label: t.label,
          helpText: t.helpText,
          required: g.required,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          maxLength: g.maxLength,
          price: delta({ group: g.id }),
          choices: g.choices.map((c) => ({
            key: c.key,
            label: pick(c.translations, ctx.language)?.label ?? c.key,
            price: delta({ choice: c.id }),
          })),
          showWhen: g.rules.map((r) => ({
            groupKey: groupKey.get(r.dependsOnGroupId) ?? '',
            operator: r.operator,
            choiceKey: r.dependsOnChoiceId ? choiceKey.get(r.dependsOnChoiceId) : undefined,
          })),
        },
      ];
    });
  }

  private async addons(tx: Tx, ctx: Ctx, productId: string) {
    const groups = await tx.addonGroup.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      include: {
        translations: true,
        items: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            translations: true,
            prices: { where: { marketId: ctx.marketId, currencyCode: ctx.currency } },
          },
        },
      },
    });
    if (groups.length === 0) return [];
    // Add-ons that are products: sold at that product's own price, only while it is live here.
    const linkedProductIds = [
      ...new Set(
        groups.flatMap((g) => g.items.flatMap((i) => (i.addonProductId ? [i.addonProductId] : []))),
      ),
    ];
    const linked = linkedProductIds.length
      ? await tx.product.findMany({
          where: { id: { in: linkedProductIds }, ...this.liveWhere(ctx) },
          include: { translations: true },
        })
      : [];
    const linkedVariationIds = groups.flatMap((g) =>
      g.items.flatMap((i) => (i.addonVariationId ? [i.addonVariationId] : [])),
    );
    const linkedPrices = linked.length
      ? await this.priceRows(tx, ctx, linkedProductIds, linkedVariationIds)
      : [];
    return groups.flatMap((g) => {
      const t = pick(g.translations, ctx.language);
      if (!t) return [];
      const items = g.items.flatMap((i): AddonItemOut[] => {
        if (i.kind === 'INLINE') {
          const price = i.prices[0];
          const label = pick(i.translations, ctx.language)?.label;
          if (!price || !label) return []; // an add-on with no price here is not offered here
          return [
            {
              key: i.key,
              kind: i.kind,
              label,
              maxQuantity: i.maxQuantity,
              price: {
                currency: ctx.currency,
                amount: price.deltaMinor,
                display: formatMinorUnits(price.deltaMinor, ctx.digits),
              },
            },
          ];
        }
        const product = linked.find((p) => p.id === i.addonProductId);
        const row = linkedPrices.find((p) =>
          i.addonVariationId
            ? p.variationId === i.addonVariationId
            : p.productId === i.addonProductId,
        );
        const name = product && pick(product.translations, ctx.language)?.name;
        if (!product || !row || !name) return [];
        const money = this.money(ctx, row);
        return [
          {
            key: null,
            kind: i.kind,
            label: name,
            maxQuantity: i.maxQuantity,
            productId: product.id,
            variationId: i.addonVariationId,
            price: { currency: money.currency, amount: money.amount, display: money.display },
          },
        ];
      });
      return [
        {
          key: g.key,
          label: t.label,
          required: g.required,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          items,
        },
      ];
    });
  }

  private async bundle(tx: Tx, ctx: Ctx, productId: string) {
    const rows = await tx.bundleItem.findMany({
      where: { bundleProductId: productId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { componentProduct: { select: { translations: true } } },
    });
    return rows.flatMap((r) => {
      const name = pick(r.componentProduct.translations, ctx.language)?.name;
      return name ? [{ name, quantity: r.quantity }] : [];
    });
  }
}
