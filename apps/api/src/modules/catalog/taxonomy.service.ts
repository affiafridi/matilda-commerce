import { Injectable } from '@nestjs/common';
import { z, slugify, productStatusSchema } from '@matilda/validation';
import type { ProductStatus } from '../../generated/prisma/client';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound, paginate } from '../admin/admin-common';
import {
  CatalogAccess,
  REQUIRED_LANGUAGE,
  type TaxonomyTranslationBody,
  type Tx,
  assertTranslationSet,
  mapCatalogError,
  taxonomyTranslationWithLanguage,
} from './catalog-common';

export const TAXONOMY_KINDS = ['categories', 'collections', 'tags'] as const;
export const taxonomyKindSchema = z.enum(TAXONOMY_KINDS);
export type TaxonomyKind = z.infer<typeof taxonomyKindSchema>;

/** Categories nest at most this deep; the database trigger enforces the same limit. */
export const MAX_CATEGORY_DEPTH = 4;

export const taxonomyListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: productStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const createTaxonomyBody = z.object({
  status: productStatusSchema.default('DRAFT'),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  /** Categories only. */
  parentId: z.string().uuid().nullish(),
  translations: z.array(taxonomyTranslationWithLanguage).min(1).max(20),
});
export const updateTaxonomyBody = z
  .object({
    status: productStatusSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    parentId: z.string().uuid().nullable(),
  })
  .partial();

type CreateBody = z.infer<typeof createTaxonomyBody>;
type UpdateBody = z.infer<typeof updateTaxonomyBody>;

interface TranslationRow {
  language: string;
  name: string;
  description: string | null;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
}
export interface TaxonomyRow {
  id: string;
  brandId: string;
  status: ProductStatus;
  sortOrder: number;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  translations: TranslationRow[];
}

interface Adapter {
  entity: 'category' | 'collection' | 'tag';
  list(tx: Tx, brandId: string): Promise<TaxonomyRow[]>;
  get(tx: Tx, brandId: string, id: string): Promise<TaxonomyRow | null>;
  create(
    tx: Tx,
    brandId: string,
    data: { status: ProductStatus; sortOrder: number; parentId: string | null },
  ): Promise<string>;
  update(
    tx: Tx,
    id: string,
    data: { status?: ProductStatus; sortOrder?: number; parentId?: string | null },
  ): Promise<void>;
  markDeleted(tx: Tx, brandId: string, id: string): Promise<void>;
  insertTranslations(
    tx: Tx,
    brandId: string,
    id: string,
    rows: readonly TranslationRow[],
  ): Promise<void>;
  upsertTranslation(tx: Tx, brandId: string, id: string, row: TranslationRow): Promise<void>;
  removeTranslation(tx: Tx, id: string, language: string): Promise<void>;
  renameSlug(tx: Tx, id: string, language: string, slug: string): Promise<void>;
}

const translationSelect = {
  language: true,
  name: true,
  description: true,
  slug: true,
  seoTitle: true,
  seoDescription: true,
} as const;
const live = { deletedAt: null } as const;
const byOrder = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

const adapters: Record<TaxonomyKind, Adapter> = {
  categories: {
    entity: 'category',
    list: (tx, brandId) =>
      tx.category.findMany({
        where: { brandId, ...live },
        include: { translations: { select: translationSelect } },
        orderBy: byOrder,
      }),
    get: (tx, brandId, id) =>
      tx.category.findFirst({
        where: { id, brandId, ...live },
        include: { translations: { select: translationSelect } },
      }),
    create: async (tx, brandId, data) =>
      (await tx.category.create({ data: { brandId, ...data }, select: { id: true } })).id,
    update: async (tx, id, data) => {
      await tx.category.update({ where: { id }, data });
    },
    markDeleted: async (tx, _brandId, id) => {
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
    },
    insertTranslations: async (tx, brandId, id, rows) => {
      await tx.categoryTranslation.createMany({
        data: rows.map((r) => ({ ...r, brandId, categoryId: id })),
      });
    },
    upsertTranslation: async (tx, brandId, id, row) => {
      await tx.categoryTranslation.upsert({
        where: { categoryId_language: { categoryId: id, language: row.language } },
        create: { ...row, brandId, categoryId: id },
        update: row,
      });
    },
    removeTranslation: async (tx, id, language) => {
      await tx.categoryTranslation.deleteMany({ where: { categoryId: id, language } });
    },
    renameSlug: async (tx, id, language, slug) => {
      await tx.categoryTranslation.update({
        where: { categoryId_language: { categoryId: id, language } },
        data: { slug },
      });
    },
  },
  collections: {
    entity: 'collection',
    list: async (tx, brandId) =>
      (
        await tx.collection.findMany({
          where: { brandId, ...live },
          include: { translations: { select: translationSelect } },
          orderBy: byOrder,
        })
      ).map((r) => ({ ...r, parentId: null })),
    get: async (tx, brandId, id) => {
      const row = await tx.collection.findFirst({
        where: { id, brandId, ...live },
        include: { translations: { select: translationSelect } },
      });
      return row && { ...row, parentId: null };
    },
    create: async (tx, brandId, { status, sortOrder }) =>
      (await tx.collection.create({ data: { brandId, status, sortOrder }, select: { id: true } }))
        .id,
    update: async (tx, id, { status, sortOrder }) => {
      await tx.collection.update({ where: { id }, data: { status, sortOrder } });
    },
    markDeleted: async (tx, brandId, id) => {
      await tx.productCollection.deleteMany({ where: { collectionId: id, brandId } });
      await tx.collection.update({ where: { id }, data: { deletedAt: new Date() } });
    },
    insertTranslations: async (tx, brandId, id, rows) => {
      await tx.collectionTranslation.createMany({
        data: rows.map((r) => ({ ...r, brandId, collectionId: id })),
      });
    },
    upsertTranslation: async (tx, brandId, id, row) => {
      await tx.collectionTranslation.upsert({
        where: { collectionId_language: { collectionId: id, language: row.language } },
        create: { ...row, brandId, collectionId: id },
        update: row,
      });
    },
    removeTranslation: async (tx, id, language) => {
      await tx.collectionTranslation.deleteMany({ where: { collectionId: id, language } });
    },
    renameSlug: async (tx, id, language, slug) => {
      await tx.collectionTranslation.update({
        where: { collectionId_language: { collectionId: id, language } },
        data: { slug },
      });
    },
  },
  tags: {
    entity: 'tag',
    list: async (tx, brandId) =>
      (
        await tx.tag.findMany({
          where: { brandId, ...live },
          include: { translations: { select: translationSelect } },
          orderBy: byOrder,
        })
      ).map((r) => ({ ...r, parentId: null })),
    get: async (tx, brandId, id) => {
      const row = await tx.tag.findFirst({
        where: { id, brandId, ...live },
        include: { translations: { select: translationSelect } },
      });
      return row && { ...row, parentId: null };
    },
    create: async (tx, brandId, { status, sortOrder }) =>
      (await tx.tag.create({ data: { brandId, status, sortOrder }, select: { id: true } })).id,
    update: async (tx, id, { status, sortOrder }) => {
      await tx.tag.update({ where: { id }, data: { status, sortOrder } });
    },
    markDeleted: async (tx, brandId, id) => {
      await tx.productTag.deleteMany({ where: { tagId: id, brandId } });
      await tx.tag.update({ where: { id }, data: { deletedAt: new Date() } });
    },
    insertTranslations: async (tx, brandId, id, rows) => {
      await tx.tagTranslation.createMany({
        data: rows.map((r) => ({ ...r, brandId, tagId: id })),
      });
    },
    upsertTranslation: async (tx, brandId, id, row) => {
      await tx.tagTranslation.upsert({
        where: { tagId_language: { tagId: id, language: row.language } },
        create: { ...row, brandId, tagId: id },
        update: row,
      });
    },
    removeTranslation: async (tx, id, language) => {
      await tx.tagTranslation.deleteMany({ where: { tagId: id, language } });
    },
    renameSlug: async (tx, id, language, slug) => {
      await tx.tagTranslation.update({
        where: { tagId_language: { tagId: id, language } },
        data: { slug },
      });
    },
  },
};

function toRow(language: string, body: TaxonomyTranslationBody): TranslationRow {
  const slug = body.slug ?? slugify(body.name);
  if (!slug) {
    throw new ApiException(422, 'SLUG_REQUIRED', 'Enter a slug: the name has no usable characters');
  }
  return {
    language,
    name: body.name,
    description: body.description ?? null,
    slug,
    seoTitle: body.seoTitle ?? null,
    seoDescription: body.seoDescription ?? null,
  };
}

const summary = (r: TaxonomyRow) => ({
  status: r.status,
  sortOrder: r.sortOrder,
  parentId: r.parentId,
  names: Object.fromEntries(r.translations.map((t) => [t.language, t.name])),
});

/** Categories, collections and tags share one workflow; kind picks the tables (D3 taxonomy). */
@Injectable()
export class TaxonomyService {
  constructor(private readonly access: CatalogAccess) {}

  list(
    actor: AdminActor,
    brandId: string,
    kind: TaxonomyKind,
    query: z.infer<typeof taxonomyListQuery>,
  ) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      const needle = query.search?.toLowerCase();
      const all = (await adapters[kind].list(tx, brandId)).filter(
        (r) =>
          (!query.status || r.status === query.status) &&
          (!needle ||
            r.translations.some(
              (t) => t.name.toLowerCase().includes(needle) || t.slug.includes(needle),
            )),
      );
      return paginate(all, query.page, query.pageSize);
    });
  }

  get(actor: AdminActor, brandId: string, kind: TaxonomyKind, id: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) =>
      this.mustGet(tx, brandId, kind, id),
    );
  }

  async create(actor: AdminActor, brandId: string, kind: TaxonomyKind, body: CreateBody) {
    const adapter = adapters[kind];
    if (kind !== 'categories' && body.parentId) {
      throw new ApiException(422, 'PARENT_NOT_ALLOWED', 'Only categories can have a parent');
    }
    assertTranslationSet(body.translations.map((t) => t.language));
    const rows = body.translations.map(({ language, ...rest }) => toRow(language, rest));
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        if (body.parentId) await this.assertParentFits(tx, brandId, null, body.parentId);
        const id = await adapter.create(tx, brandId, {
          status: body.status,
          sortOrder: body.sortOrder,
          parentId: body.parentId ?? null,
        });
        await this.releaseHistory(tx, brandId, adapter.entity, rows);
        await adapter.insertTranslations(tx, brandId, id, rows);
        const created = await this.mustGet(tx, brandId, kind, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          `${adapter.entity}.create`,
          adapter.entity,
          id,
          undefined,
          summary(created),
        );
        return created;
      });
    } catch (err) {
      throw mapCatalogError(err, 'SLUG_TAKEN', 'That slug is already used in this language');
    }
  }

  async update(
    actor: AdminActor,
    brandId: string,
    kind: TaxonomyKind,
    id: string,
    body: UpdateBody,
  ) {
    const adapter = adapters[kind];
    if (kind !== 'categories' && body.parentId !== undefined) {
      throw new ApiException(422, 'PARENT_NOT_ALLOWED', 'Only categories can have a parent');
    }
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        const before = await this.mustGet(tx, brandId, kind, id);
        if (body.parentId !== undefined && body.parentId !== before.parentId) {
          if (body.parentId) await this.assertParentFits(tx, brandId, id, body.parentId);
        }
        await adapter.update(tx, id, body);
        const after = await this.mustGet(tx, brandId, kind, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          `${adapter.entity}.update`,
          adapter.entity,
          id,
          summary(before),
          summary(after),
        );
        return after;
      });
    } catch (err) {
      throw mapCatalogError(err);
    }
  }

  async putTranslation(
    actor: AdminActor,
    brandId: string,
    kind: TaxonomyKind,
    id: string,
    language: string,
    body: TaxonomyTranslationBody,
  ) {
    const adapter = adapters[kind];
    const row = toRow(language, body);
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        const before = await this.mustGet(tx, brandId, kind, id);
        const previous = before.translations.find((t) => t.language === language);
        if (previous && previous.slug !== row.slug) {
          await this.retire(tx, brandId, adapter.entity, id, language, previous.slug);
        }
        await this.releaseHistory(tx, brandId, adapter.entity, [row]);
        await adapter.upsertTranslation(tx, brandId, id, row);
        const after = await this.mustGet(tx, brandId, kind, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          `${adapter.entity}.translation.set`,
          adapter.entity,
          id,
          summary(before),
          summary(after),
        );
        return after;
      });
    } catch (err) {
      throw mapCatalogError(err, 'SLUG_TAKEN', 'That slug is already used in this language');
    }
  }

  deleteTranslation(
    actor: AdminActor,
    brandId: string,
    kind: TaxonomyKind,
    id: string,
    language: string,
  ) {
    const adapter = adapters[kind];
    if (language === REQUIRED_LANGUAGE) {
      throw new ApiException(422, 'ENGLISH_REQUIRED', 'The English translation cannot be removed');
    }
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      const before = await this.mustGet(tx, brandId, kind, id);
      const previous = before.translations.find((t) => t.language === language);
      if (!previous) throw notFound('Translation');
      await this.retire(tx, brandId, adapter.entity, id, language, previous.slug);
      await adapter.removeTranslation(tx, id, language);
      const after = await this.mustGet(tx, brandId, kind, id);
      await this.access.record(
        tx,
        actor,
        brandId,
        `${adapter.entity}.translation.delete`,
        adapter.entity,
        id,
        summary(before),
        summary(after),
      );
      return after;
    });
  }

  remove(actor: AdminActor, brandId: string, kind: TaxonomyKind, id: string) {
    const adapter = adapters[kind];
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      const before = await this.mustGet(tx, brandId, kind, id);
      if (kind === 'categories') await this.assertCategoryUnused(tx, brandId, id);
      // Retire every slug (redirect history) and free it for reuse by renaming the dead row.
      const suffix = `-x${id.slice(0, 8)}`;
      for (const t of before.translations) {
        await this.retire(tx, brandId, adapter.entity, id, t.language, t.slug);
        await adapter.renameSlug(tx, id, t.language, `${t.slug.slice(0, 100)}${suffix}`);
      }
      await adapter.markDeleted(tx, brandId, id);
      await this.access.record(
        tx,
        actor,
        brandId,
        `${adapter.entity}.delete`,
        adapter.entity,
        id,
        summary(before),
      );
    });
  }

  private async mustGet(tx: Tx, brandId: string, kind: TaxonomyKind, id: string) {
    const row = await adapters[kind].get(tx, brandId, id);
    if (!row)
      throw notFound(
        adapters[kind].entity === 'tag'
          ? 'Tag'
          : adapters[kind].entity === 'category'
            ? 'Category'
            : 'Collection',
      );
    return row;
  }

  /** Remembers a retired slug for redirects. Tags have no public URL, so only the others keep history. */
  private async retire(
    tx: Tx,
    brandId: string,
    entityType: string,
    entityId: string,
    language: string,
    slug: string,
  ): Promise<void> {
    if (entityType === 'tag') return;
    await tx.catalogSlugHistory.createMany({
      data: [{ brandId, entityType, entityId, language, slug }],
      skipDuplicates: true,
    });
  }

  /** A slug that is taken over by a live record is no longer a redirect source. */
  private async releaseHistory(
    tx: Tx,
    brandId: string,
    entityType: string,
    rows: readonly TranslationRow[],
  ): Promise<void> {
    if (entityType === 'tag') return;
    for (const r of rows) {
      await tx.catalogSlugHistory.deleteMany({
        where: { brandId, entityType, language: r.language, slug: r.slug },
      });
    }
  }

  /** Parent must be a live category of the brand; no cycles; whole subtree stays within the depth limit. */
  private async assertParentFits(
    tx: Tx,
    brandId: string,
    id: string | null,
    parentId: string,
  ): Promise<void> {
    const rows = await tx.category.findMany({
      where: { brandId, ...live },
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
    if (!parentOf.has(parentId)) {
      throw new ApiException(422, 'PARENT_NOT_FOUND', 'The parent category does not exist');
    }
    let depth = 0;
    for (let cursor: string | null = parentId; cursor; cursor = parentOf.get(cursor) ?? null) {
      if (cursor === id) {
        throw new ApiException(
          422,
          'CATEGORY_TREE_INVALID',
          'A category cannot be placed under itself or one of its own subcategories',
        );
      }
      depth += 1;
      if (depth > rows.length) break;
    }
    let height = 1;
    if (id) {
      const children = new Map<string, string[]>();
      for (const r of rows) {
        if (r.parentId) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
      }
      const measure = (node: string): number =>
        1 + Math.max(0, ...(children.get(node) ?? []).map(measure));
      height = measure(id);
    }
    if (depth + height > MAX_CATEGORY_DEPTH) {
      throw new ApiException(
        422,
        'CATEGORY_TREE_INVALID',
        `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
      );
    }
  }

  private async assertCategoryUnused(tx: Tx, brandId: string, id: string): Promise<void> {
    const children = await tx.category.count({ where: { parentId: id, brandId, ...live } });
    if (children > 0) {
      throw new ApiException(
        409,
        'CATEGORY_HAS_CHILDREN',
        'Move or delete the subcategories of this category first',
      );
    }
    const products = await tx.product.count({
      where: {
        brandId,
        ...live,
        OR: [{ primaryCategoryId: id }, { categoryLinks: { some: { categoryId: id } } }],
      },
    });
    if (products > 0) {
      throw new ApiException(
        409,
        'CATEGORY_IN_USE',
        'Products still use this category. Move them to another category first',
      );
    }
  }
}
