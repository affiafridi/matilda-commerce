import { Injectable } from '@nestjs/common';
import {
  languageCodeSchema,
  productStatusSchema,
  productTypeSchema,
  skuSchema,
  slugSchema,
  slugify,
  z,
} from '@matilda/validation';
import type { Prisma } from '../../generated/prisma/client';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound } from '../admin/admin-common';
import {
  CatalogAccess,
  REQUIRED_LANGUAGE,
  type Tx,
  assertTranslationSet,
  mapCatalogError,
} from './catalog-common';

const text = (max: number) => z.string().trim().max(max).nullish();

export const productTranslationBody = z.object({
  name: z.string().trim().min(1).max(200),
  shortDescription: text(500),
  description: text(20_000),
  slug: slugSchema.optional(),
  seoTitle: text(200),
  seoDescription: text(500),
});
type TranslationBody = z.infer<typeof productTranslationBody>;

const minutes = z.number().int().min(0).max(525_600);
const quantity = z.number().int().min(1).max(10_000);

export const createProductBody = z.object({
  type: productTypeSchema,
  /** Simple and bundle products only; a variable product has one SKU per variation instead. */
  sku: skuSchema.nullish(),
  translations: z
    .array(productTranslationBody.extend({ language: languageCodeSchema }))
    .min(1)
    .max(20),
  madeToOrder: z.boolean().optional(),
  prepTimeMinutes: minutes.nullish(),
  leadTimeMinutes: minutes.nullish(),
  minQuantity: quantity.optional(),
  maxQuantity: quantity.nullish(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export const updateProductBody = z
  .object({
    type: productTypeSchema,
    sku: skuSchema.nullable(),
    madeToOrder: z.boolean(),
    prepTimeMinutes: minutes.nullable(),
    leadTimeMinutes: minutes.nullable(),
    minQuantity: quantity,
    maxQuantity: quantity.nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    /** Scheduling is publishing: it needs `products.publish`. */
    publishAt: z.coerce.date().nullable(),
    unpublishAt: z.coerce.date().nullable(),
  })
  .partial();

export const productTaxonomyBody = z.object({
  primaryCategoryId: z.string().uuid().nullable(),
  categoryIds: z.array(z.string().uuid()).max(50),
  collectionIds: z.array(z.string().uuid()).max(50),
  tagIds: z.array(z.string().uuid()).max(100),
});

export const productAvailabilityBody = z.object({
  marketIds: z.array(z.string().uuid()).max(50),
  branchIds: z.array(z.string().uuid()).max(200),
});

export const productListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: productStatusSchema.optional(),
  type: productTypeSchema.optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

type CreateBody = z.infer<typeof createProductBody>;
type UpdateBody = z.infer<typeof updateProductBody>;
type TaxonomyBody = z.infer<typeof productTaxonomyBody>;
type AvailabilityBody = z.infer<typeof productAvailabilityBody>;

const include = {
  translations: {
    select: {
      language: true,
      name: true,
      shortDescription: true,
      description: true,
      slug: true,
      seoTitle: true,
      seoDescription: true,
    },
  },
  categoryLinks: { select: { categoryId: true } },
  collectionLinks: { select: { collectionId: true } },
  tagLinks: { select: { tagId: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof include }>;

/**
 * What a shopper would see right now, derived from status and schedule (no background job needed:
 * the public API in step 3.10 applies the same rule per request).
 */
export function visibilityOf(
  p: { status: string; publishAt: Date | null; unpublishAt: Date | null },
  now: Date = new Date(),
): 'draft' | 'archived' | 'scheduled' | 'live' | 'expired' {
  if (p.status === 'DRAFT') return 'draft';
  if (p.status === 'ARCHIVED') return 'archived';
  if (p.publishAt && p.publishAt > now) return 'scheduled';
  if (p.unpublishAt && p.unpublishAt <= now) return 'expired';
  return 'live';
}

async function describe(tx: Tx, p: ProductRow) {
  const [markets, branches] = await Promise.all([
    tx.productMarket.findMany({ where: { productId: p.id }, select: { marketId: true } }),
    tx.productBranch.findMany({ where: { productId: p.id }, select: { branchId: true } }),
  ]);
  const { categoryLinks, collectionLinks, tagLinks, ...rest } = p;
  return {
    ...rest,
    visibility: visibilityOf(p),
    categoryIds: categoryLinks.map((l) => l.categoryId),
    collectionIds: collectionLinks.map((l) => l.collectionId),
    tagIds: tagLinks.map((l) => l.tagId),
    marketIds: markets.map((m) => m.marketId),
    branchIds: branches.map((b) => b.branchId),
  };
}

const live = { deletedAt: null } as const;
const summary = (p: ProductRow) => ({
  type: p.type,
  status: p.status,
  sku: p.sku,
  publishAt: p.publishAt,
  unpublishAt: p.unpublishAt,
  names: Object.fromEntries(p.translations.map((t) => [t.language, t.name])),
});

function toRow(language: string, body: TranslationBody) {
  const slug = body.slug ?? slugify(body.name);
  if (!slug) {
    throw new ApiException(422, 'SLUG_REQUIRED', 'Enter a slug: the name has no usable characters');
  }
  return {
    language,
    name: body.name,
    shortDescription: body.shortDescription ?? null,
    description: body.description ?? null,
    slug,
    seoTitle: body.seoTitle ?? null,
    seoDescription: body.seoDescription ?? null,
  };
}

const dedupe = (ids: readonly string[]) => [...new Set(ids)];

@Injectable()
export class ProductsService {
  constructor(private readonly access: CatalogAccess) {}

  list(actor: AdminActor, brandId: string, q: z.infer<typeof productListQuery>) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      const needle = q.search?.trim();
      const where: Prisma.ProductWhereInput = {
        brandId,
        ...live,
        ...(q.status && { status: q.status }),
        ...(q.type && { type: q.type }),
        ...(q.categoryId && {
          OR: [
            { primaryCategoryId: q.categoryId },
            { categoryLinks: { some: { categoryId: q.categoryId } } },
          ],
        }),
        ...(needle && {
          AND: [
            {
              OR: [
                { sku: { contains: needle.toUpperCase() } },
                { translations: { some: { name: { contains: needle, mode: 'insensitive' } } } },
                { translations: { some: { slug: { contains: slugify(needle) || needle } } } },
              ],
            },
          ],
        }),
      };
      const [total, rows] = await Promise.all([
        tx.product.count({ where }),
        tx.product.findMany({
          where,
          include,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const items = await Promise.all(rows.map((r) => describe(tx, r)));
      return { items, page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) =>
      describe(tx, await this.mustGet(tx, brandId, id)),
    );
  }

  async create(actor: AdminActor, brandId: string, body: CreateBody) {
    assertTranslationSet(body.translations.map((t) => t.language));
    if (body.type === 'VARIABLE' && body.sku) {
      throw new ApiException(422, 'SKU_NOT_ALLOWED', 'A variable product has a SKU per variation');
    }
    this.assertQuantities(body.minQuantity ?? 1, body.maxQuantity ?? null);
    const rows = body.translations.map(({ language, ...rest }) => toRow(language, rest));
    try {
      return await this.access.run(actor, brandId, 'products.create', async (tx) => {
        const { id } = await tx.product.create({
          data: {
            brandId,
            type: body.type,
            status: 'DRAFT',
            sku: body.sku ?? null,
            madeToOrder: body.madeToOrder ?? false,
            prepTimeMinutes: body.prepTimeMinutes ?? null,
            leadTimeMinutes: body.leadTimeMinutes ?? null,
            minQuantity: body.minQuantity ?? 1,
            maxQuantity: body.maxQuantity ?? null,
            sortOrder: body.sortOrder ?? 0,
          },
          select: { id: true },
        });
        await this.releaseHistory(tx, brandId, rows);
        await tx.productTranslation.createMany({
          data: rows.map((r) => ({ ...r, brandId, productId: id })),
        });
        const created = await this.mustGet(tx, brandId, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.create',
          'product',
          id,
          undefined,
          summary(created),
        );
        return describe(tx, created);
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async update(actor: AdminActor, brandId: string, id: string, body: UpdateBody) {
    const scheduling = body.publishAt !== undefined || body.unpublishAt !== undefined;
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        if (scheduling) this.access.require(actor, brandId, 'products.publish');
        const before = await this.mustGet(tx, brandId, id);
        const type = body.type ?? before.type;
        const sku = type === 'VARIABLE' ? null : body.sku === undefined ? before.sku : body.sku;
        if (type === 'VARIABLE' && body.sku) {
          throw new ApiException(
            422,
            'SKU_NOT_ALLOWED',
            'A variable product has a SKU per variation',
          );
        }
        this.assertQuantities(
          body.minQuantity ?? before.minQuantity,
          body.maxQuantity === undefined ? before.maxQuantity : body.maxQuantity,
        );
        const publishAt = body.publishAt === undefined ? before.publishAt : body.publishAt;
        const unpublishAt = body.unpublishAt === undefined ? before.unpublishAt : body.unpublishAt;
        if (publishAt && unpublishAt && unpublishAt <= publishAt) {
          throw new ApiException(
            422,
            'SCHEDULE_INVALID',
            'The product must unpublish after it publishes',
          );
        }
        if (type === 'VARIABLE' && before.type !== 'VARIABLE') {
          await tx.marketPrice.deleteMany({ where: { productId: id } });
        }
        await tx.product.update({ where: { id }, data: { ...body, type, sku } });
        const after = await this.mustGet(tx, brandId, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.update',
          'product',
          id,
          summary(before),
          summary(after),
        );
        return describe(tx, after);
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async putTranslation(
    actor: AdminActor,
    brandId: string,
    id: string,
    language: string,
    body: TranslationBody,
  ) {
    const row = toRow(language, body);
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        const before = await this.mustGet(tx, brandId, id);
        const previous = before.translations.find((t) => t.language === language);
        if (previous && previous.slug !== row.slug) {
          await this.retire(tx, brandId, id, language, previous.slug);
        }
        await this.releaseHistory(tx, brandId, [row]);
        await tx.productTranslation.upsert({
          where: { productId_language: { productId: id, language } },
          create: { ...row, brandId, productId: id },
          update: row,
        });
        const after = await this.mustGet(tx, brandId, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.translation.set',
          'product',
          id,
          summary(before),
          summary(after),
        );
        return describe(tx, after);
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  deleteTranslation(actor: AdminActor, brandId: string, id: string, language: string) {
    if (language === REQUIRED_LANGUAGE) {
      throw new ApiException(422, 'ENGLISH_REQUIRED', 'The English translation cannot be removed');
    }
    return this.access.run(actor, brandId, 'products.edit', async (tx) => {
      const before = await this.mustGet(tx, brandId, id);
      const previous = before.translations.find((t) => t.language === language);
      if (!previous) throw notFound('Translation');
      await this.retire(tx, brandId, id, language, previous.slug);
      await tx.productTranslation.deleteMany({ where: { productId: id, language } });
      const after = await this.mustGet(tx, brandId, id);
      await this.access.record(
        tx,
        actor,
        brandId,
        'product.translation.delete',
        'product',
        id,
        summary(before),
        summary(after),
      );
      return describe(tx, after);
    });
  }

  /** Replaces the product's categories, collections, tags and primary category. */
  putTaxonomy(actor: AdminActor, brandId: string, id: string, body: TaxonomyBody) {
    return this.access.run(actor, brandId, 'products.edit', async (tx) => {
      const before = await this.mustGet(tx, brandId, id);
      const categoryIds = dedupe(body.categoryIds);
      const collectionIds = dedupe(body.collectionIds);
      const tagIds = dedupe(body.tagIds);
      const primary = body.primaryCategoryId;
      if (primary && !categoryIds.includes(primary)) categoryIds.push(primary);
      await this.assertAllLive(tx, 'category', brandId, categoryIds);
      await this.assertAllLive(tx, 'collection', brandId, collectionIds);
      await this.assertAllLive(tx, 'tag', brandId, tagIds);
      await tx.productCategory.deleteMany({ where: { productId: id } });
      await tx.productCollection.deleteMany({ where: { productId: id } });
      await tx.productTag.deleteMany({ where: { productId: id } });
      await tx.productCategory.createMany({
        data: categoryIds.map((categoryId, sortOrder) => ({
          brandId,
          productId: id,
          categoryId,
          sortOrder,
        })),
      });
      await tx.productCollection.createMany({
        data: collectionIds.map((collectionId, sortOrder) => ({
          brandId,
          productId: id,
          collectionId,
          sortOrder,
        })),
      });
      await tx.productTag.createMany({
        data: tagIds.map((tagId, sortOrder) => ({ brandId, productId: id, tagId, sortOrder })),
      });
      await tx.product.update({ where: { id }, data: { primaryCategoryId: primary } });
      const after = await this.mustGet(tx, brandId, id);
      await this.access.record(
        tx,
        actor,
        brandId,
        'product.taxonomy.set',
        'product',
        id,
        {
          primaryCategoryId: before.primaryCategoryId,
          categoryIds: before.categoryLinks.map((l) => l.categoryId),
          collectionIds: before.collectionLinks.map((l) => l.collectionId),
          tagIds: before.tagLinks.map((l) => l.tagId),
        },
        { primaryCategoryId: primary, categoryIds, collectionIds, tagIds },
      );
      return describe(tx, after);
    });
  }

  /**
   * Replaces the markets and branches the product may be sold in. A product with no market is sold
   * nowhere (and cannot be published). Stock and delivery rules arrive in Phase 4.
   */
  async putAvailability(actor: AdminActor, brandId: string, id: string, body: AvailabilityBody) {
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        const before = await this.mustGet(tx, brandId, id);
        const marketIds = dedupe(body.marketIds);
        const branchIds = dedupe(body.branchIds);
        const markets = await tx.market.count({ where: { brandId, id: { in: marketIds } } });
        if (markets !== marketIds.length) {
          throw new ApiException(422, 'MARKET_NOT_FOUND', 'A market does not belong to this brand');
        }
        const priorMarkets = (await describe(tx, before)).marketIds;
        const priorBranches = (await describe(tx, before)).branchIds;
        await tx.productMarket.deleteMany({ where: { productId: id } });
        await tx.productBranch.deleteMany({ where: { productId: id } });
        await tx.productMarket.createMany({
          data: marketIds.map((marketId) => ({ brandId, productId: id, marketId })),
        });
        await tx.productBranch.createMany({
          data: branchIds.map((branchId) => ({ brandId, productId: id, branchId })),
        });
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.availability.set',
          'product',
          id,
          { marketIds: priorMarkets, branchIds: priorBranches },
          { marketIds, branchIds },
        );
        return describe(tx, await this.mustGet(tx, brandId, id));
      });
    } catch (err) {
      if (
        err instanceof Error &&
        /does not serve this brand/i.test(err.message + String(err.cause ?? ''))
      ) {
        throw new ApiException(422, 'BRANCH_NOT_AVAILABLE', 'A branch does not serve this brand');
      }
      throw this.mapError(err);
    }
  }

  /** Status changes: publish (needs English name, slug and a market), unpublish to draft, archive. */
  setStatus(
    actor: AdminActor,
    brandId: string,
    id: string,
    action: 'publish' | 'unpublish' | 'archive',
  ) {
    return this.access.run(actor, brandId, 'products.publish', async (tx) => {
      const before = await this.mustGet(tx, brandId, id);
      const status =
        action === 'publish' ? 'PUBLISHED' : action === 'archive' ? 'ARCHIVED' : 'DRAFT';
      if (action === 'publish') {
        if (!before.translations.some((t) => t.language === REQUIRED_LANGUAGE)) {
          throw new ApiException(422, 'NOT_PUBLISHABLE', 'Add the English name before publishing');
        }
        if (before.type === 'VARIABLE') {
          const variations = await tx.variation.count({
            where: { productId: id, deletedAt: null, active: true },
          });
          if (variations === 0) {
            throw new ApiException(
              422,
              'NOT_PUBLISHABLE',
              'Add at least one active variation before publishing',
            );
          }
        }
        if (before.type === 'BUNDLE') {
          const components = await tx.bundleItem.count({ where: { bundleProductId: id } });
          if (components === 0) {
            throw new ApiException(
              422,
              'NOT_PUBLISHABLE',
              'Add at least one component to the bundle before publishing',
            );
          }
        }
        const markets = await tx.productMarket.findMany({
          where: { productId: id },
          select: { marketId: true },
        });
        if (markets.length === 0) {
          throw new ApiException(
            422,
            'NOT_PUBLISHABLE',
            'Choose at least one market before publishing',
          );
        }
        await this.assertPriced(
          tx,
          before,
          markets.map((m) => m.marketId),
        );
      }
      await tx.product.update({ where: { id }, data: { status } });
      const after = await this.mustGet(tx, brandId, id);
      await this.access.record(
        tx,
        actor,
        brandId,
        `product.${action}`,
        'product',
        id,
        summary(before),
        summary(after),
      );
      return describe(tx, after);
    });
  }

  remove(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'products.delete', async (tx) => {
      const before = await this.mustGet(tx, brandId, id);
      const used =
        (await tx.bundleItem.count({
          where: { componentProductId: id, bundleProduct: { deletedAt: null } },
        })) + (await tx.addonItem.count({ where: { addonProductId: id } }));
      if (used > 0) {
        throw new ApiException(
          409,
          'PRODUCT_IN_USE',
          'This product is a bundle component or an add-on. Remove it there first',
        );
      }
      const suffix = `-x${id.slice(0, 8)}`;
      for (const t of before.translations) {
        await this.retire(tx, brandId, id, t.language, t.slug);
        await tx.productTranslation.update({
          where: { productId_language: { productId: id, language: t.language } },
          data: { slug: `${t.slug.slice(0, 100)}${suffix}` },
        });
      }
      // The SKU is released for reuse; it stays in the audit record.
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), sku: null, status: 'ARCHIVED' },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'product.delete',
        'product',
        id,
        summary(before),
      );
    });
  }

  private async mustGet(tx: Tx, brandId: string, id: string): Promise<ProductRow> {
    const row = await tx.product.findFirst({ where: { id, brandId, ...live }, include });
    if (!row) throw notFound('Product');
    return row;
  }

  /** Every sellable item (the product, or each active variation) needs a price in every market it is sold in. */
  private async assertPriced(tx: Tx, product: ProductRow, marketIds: readonly string[]) {
    const variable = product.type === 'VARIABLE';
    const targets = variable
      ? (
          await tx.variation.findMany({
            where: { productId: product.id, deletedAt: null, active: true },
            select: { id: true },
          })
        ).map((v) => v.id)
      : [product.id];
    const prices = await tx.marketPrice.findMany({
      where: variable ? { variationId: { in: targets } } : { productId: product.id },
      select: { marketId: true, productId: true, variationId: true },
    });
    const have = new Set(prices.map((p) => `${p.marketId}:${p.variationId ?? p.productId}`));
    for (const marketId of marketIds) {
      for (const target of targets) {
        if (!have.has(`${marketId}:${target}`)) {
          throw new ApiException(
            422,
            'NOT_PUBLISHABLE',
            'Add a price for every item in every market the product is sold in',
          );
        }
      }
    }
  }

  private assertQuantities(min: number, max: number | null) {
    if (max !== null && max < min) {
      throw new ApiException(
        422,
        'QUANTITY_INVALID',
        'The maximum quantity cannot be below the minimum',
      );
    }
  }

  private mapError(err: unknown): Error {
    const message = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
    if (/sku/i.test(message) && /unique|duplicate|already used|23505/i.test(message)) {
      return new ApiException(409, 'SKU_TAKEN', 'That SKU is already used in this brand');
    }
    if (/must stay (variable|a bundle)/i.test(message)) {
      return new ApiException(
        422,
        'TYPE_LOCKED',
        'This product has variations or components, so its type cannot change',
      );
    }
    return mapCatalogError(err, 'SLUG_TAKEN', 'That slug or SKU is already in use');
  }

  private async retire(tx: Tx, brandId: string, entityId: string, language: string, slug: string) {
    await tx.catalogSlugHistory.createMany({
      data: [{ brandId, entityType: 'product', entityId, language, slug }],
      skipDuplicates: true,
    });
  }

  private async releaseHistory(
    tx: Tx,
    brandId: string,
    rows: readonly { language: string; slug: string }[],
  ) {
    for (const r of rows) {
      await tx.catalogSlugHistory.deleteMany({
        where: { brandId, entityType: 'product', language: r.language, slug: r.slug },
      });
    }
  }

  private async assertAllLive(
    tx: Tx,
    kind: 'category' | 'collection' | 'tag',
    brandId: string,
    ids: readonly string[],
  ) {
    if (ids.length === 0) return;
    const where = { brandId, ...live, id: { in: [...ids] } };
    const found =
      kind === 'category'
        ? await tx.category.count({ where })
        : kind === 'collection'
          ? await tx.collection.count({ where })
          : await tx.tag.count({ where });
    if (found !== ids.length) {
      throw new ApiException(
        422,
        `${kind.toUpperCase()}_NOT_FOUND`,
        `A ${kind} does not exist in this brand`,
      );
    }
  }
}
