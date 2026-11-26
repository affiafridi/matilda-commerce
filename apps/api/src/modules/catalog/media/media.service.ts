import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { languageCodeSchema, z } from '@matilda/validation';
import { APP_ENV, type Env } from '../../../config/env';
import { ApiException } from '../../../common/errors/api-exception';
import { type AdminActor, notFound } from '../../admin/admin-common';
import {
  CatalogAccess,
  REQUIRED_LANGUAGE,
  type Tx,
  assertTranslationSet,
  mapCatalogError,
} from '../catalog-common';
import { type VariantKind, processImage } from './image';
import { MEDIA_STORAGE, type MediaStorage } from './storage';

export const mediaListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const putAltBody = z.object({
  translations: z
    .array(
      z.object({
        language: languageCodeSchema,
        altText: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(20),
});

export const putGalleryBody = z.object({
  items: z
    .array(
      z.object({
        mediaAssetId: z.string().uuid(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .max(30),
});

export const putVariationImageBody = z.object({ mediaAssetId: z.string().uuid().nullable() });

const invalid = (code: string, message: string) => new ApiException(422, code, message);

const SAFE_NAME = /[^\p{L}\p{N}._ -]+/gu;

@Injectable()
export class MediaService {
  constructor(
    private readonly access: CatalogAccess,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async upload(
    actor: AdminActor,
    brandId: string,
    file: { buffer: Buffer; originalname: string } | undefined,
    altText: string | undefined,
  ) {
    this.access.require(actor, brandId, 'media.manage');
    if (!file || file.buffer.length === 0) {
      throw new ApiException(400, 'FILE_REQUIRED', 'Send the picture in the "file" field');
    }
    if (file.buffer.length > this.env.MEDIA_MAX_UPLOAD_BYTES) {
      throw new ApiException(413, 'FILE_TOO_LARGE', 'The picture is larger than the upload limit');
    }
    const alt = altText?.trim();
    if (alt && alt.length > 300)
      throw invalid('ALT_TOO_LONG', 'Alt text is at most 300 characters');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const image = await processImage(file.buffer);
    const id = randomUUID();
    const base = `${brandId}/${id}`;
    const originalKey = `${base}/original.${image.ext}`;
    const variantKeys = image.variants.map((v) => ({
      ...v,
      key: `${base}/${v.kind.toLowerCase()}.webp`,
    }));
    const written: string[] = [];
    const filename = file.originalname.replace(SAFE_NAME, '_').slice(0, 200) || 'image';
    try {
      return await this.access.run(actor, brandId, 'media.manage', async (tx) => {
        const duplicate = await tx.mediaAsset.findFirst({
          where: { brandId, sha256 },
          select: { id: true },
        });
        if (duplicate) {
          throw new ApiException(
            409,
            'DUPLICATE_MEDIA',
            `This picture is already in the library (${duplicate.id})`,
          );
        }
        await this.storage.put(originalKey, image.original);
        written.push(originalKey);
        for (const v of variantKeys) {
          await this.storage.put(v.key, v.data);
          written.push(v.key);
        }
        await tx.mediaAsset.create({
          data: {
            id,
            brandId,
            storageKey: originalKey,
            originalFilename: filename,
            contentType: image.contentType,
            byteSize: image.original.length,
            width: image.width,
            height: image.height,
            sha256,
            status: 'READY',
            createdById: actor.staffId,
          },
        });
        await tx.mediaVariant.createMany({
          data: variantKeys.map((v) => ({
            brandId,
            mediaAssetId: id,
            kind: v.kind,
            storageKey: v.key,
            width: v.width,
            height: v.height,
            contentType: 'image/webp',
          })),
        });
        if (alt) {
          await tx.mediaAssetTranslation.create({
            data: { brandId, mediaAssetId: id, language: REQUIRED_LANGUAGE, altText: alt },
          });
        }
        const created = await this.describe(tx, brandId, id);
        await this.access.record(tx, actor, brandId, 'media.upload', 'media', id, undefined, {
          filename,
          contentType: image.contentType,
          byteSize: image.original.length,
        });
        return created;
      });
    } catch (err) {
      await Promise.all(written.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw mapCatalogError(err, 'DUPLICATE_MEDIA', 'This picture is already in the library');
    }
  }

  list(actor: AdminActor, brandId: string, q: z.infer<typeof mediaListQuery>) {
    return this.access.run(actor, brandId, 'media.manage', async (tx) => {
      const [total, rows] = await Promise.all([
        tx.mediaAsset.count({ where: { brandId } }),
        tx.mediaAsset.findMany({
          where: { brandId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: q.limit,
          skip: q.offset,
          include: { translations: true, variants: true },
        }),
      ]);
      return { total, items: rows.map((r) => this.shape(r)) };
    });
  }

  get(actor: AdminActor, brandId: string, assetId: string) {
    return this.access.run(actor, brandId, 'media.manage', (tx) =>
      this.describe(tx, brandId, assetId),
    );
  }

  putAlt(actor: AdminActor, brandId: string, assetId: string, body: z.infer<typeof putAltBody>) {
    assertTranslationSet(body.translations.map((t) => t.language));
    return this.access.run(actor, brandId, 'media.manage', async (tx) => {
      const before = await this.describe(tx, brandId, assetId);
      await tx.mediaAssetTranslation.deleteMany({ where: { mediaAssetId: assetId } });
      await tx.mediaAssetTranslation.createMany({
        data: body.translations.map((t) => ({
          brandId,
          mediaAssetId: assetId,
          language: t.language,
          altText: t.altText,
        })),
      });
      const after = await this.describe(tx, brandId, assetId);
      await this.access.record(
        tx,
        actor,
        brandId,
        'media.alt.set',
        'media',
        assetId,
        before,
        after,
      );
      return after;
    });
  }

  async remove(actor: AdminActor, brandId: string, assetId: string): Promise<void> {
    const keys = await this.access.run(actor, brandId, 'media.manage', async (tx) => {
      const asset = await this.describe(tx, brandId, assetId);
      const [products, variations, categories] = await Promise.all([
        tx.productMedia.count({ where: { mediaAssetId: assetId } }),
        tx.variation.count({ where: { mediaAssetId: assetId, deletedAt: null } }),
        tx.category.count({ where: { mediaAssetId: assetId, deletedAt: null } }),
      ]);
      if (products + variations + categories > 0) {
        throw new ApiException(409, 'MEDIA_IN_USE', 'This picture is used by the catalog');
      }
      const rows = await tx.mediaAsset.findFirstOrThrow({
        where: { id: assetId, brandId },
        include: { variants: { select: { storageKey: true } } },
      });
      try {
        await tx.mediaAsset.delete({ where: { id: assetId } });
      } catch {
        throw new ApiException(409, 'MEDIA_IN_USE', 'This picture is used by the catalog');
      }
      await this.access.record(tx, actor, brandId, 'media.delete', 'media', assetId, asset);
      return [rows.storageKey, ...rows.variants.map((v) => v.storageKey)];
    });
    await Promise.all(keys.map((k) => this.storage.delete(k).catch(() => undefined)));
  }

  getGallery(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'media.manage', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      return this.describeGallery(tx, productId);
    });
  }

  putGallery(
    actor: AdminActor,
    brandId: string,
    productId: string,
    body: z.infer<typeof putGalleryBody>,
  ) {
    const ids = body.items.map((i) => i.mediaAssetId);
    if (new Set(ids).size !== ids.length) {
      throw invalid('DUPLICATE_MEDIA_ITEM', 'Each picture can be listed once');
    }
    if (body.items.filter((i) => i.isPrimary).length > 1) {
      throw invalid('PRIMARY_MEDIA_CONFLICT', 'Only one picture can be the main picture');
    }
    return this.access.run(actor, brandId, 'media.manage', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      await this.assertAttachable(tx, brandId, ids);
      const before = await this.describeGallery(tx, productId);
      await tx.productMedia.deleteMany({ where: { productId } });
      const hasPrimary = body.items.some((i) => i.isPrimary);
      await tx.productMedia.createMany({
        data: body.items.map((item, index) => ({
          brandId,
          productId,
          mediaAssetId: item.mediaAssetId,
          sortOrder: index,
          isPrimary: hasPrimary ? item.isPrimary : index === 0,
        })),
      });
      const after = await this.describeGallery(tx, productId);
      await this.access.record(
        tx,
        actor,
        brandId,
        'product.media.set',
        'product',
        productId,
        before,
        after,
      );
      return after;
    });
  }

  putVariationImage(
    actor: AdminActor,
    brandId: string,
    productId: string,
    variationId: string,
    body: z.infer<typeof putVariationImageBody>,
  ) {
    return this.access.run(actor, brandId, 'media.manage', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      const variation = await tx.variation.findFirst({
        where: { id: variationId, productId, deletedAt: null },
        select: { id: true, mediaAssetId: true },
      });
      if (!variation) throw notFound('Variation');
      if (body.mediaAssetId) await this.assertAttachable(tx, brandId, [body.mediaAssetId]);
      await tx.variation.update({
        where: { id: variationId },
        data: { mediaAssetId: body.mediaAssetId },
      });
      const after = { variationId, mediaAssetId: body.mediaAssetId };
      await this.access.record(
        tx,
        actor,
        brandId,
        'variation.media.set',
        'variation',
        variationId,
        { mediaAssetId: variation.mediaAssetId },
        after,
      );
      return after;
    });
  }

  /** Bytes of a public variant, or null. Only processed variants are ever served, never originals. */
  async readVariant(brandId: string, assetId: string, kind: VariantKind) {
    const found = await this.access.runPublic(brandId, async (tx) =>
      tx.mediaVariant.findFirst({
        where: { brandId, mediaAssetId: assetId, kind, mediaAsset: { status: 'READY' } },
        select: { storageKey: true, contentType: true },
      }),
    );
    if (!found) return null;
    const data = await this.storage.get(found.storageKey);
    return data ? { data, contentType: found.contentType } : null;
  }

  private async mustGetProduct(tx: Tx, brandId: string, id: string) {
    const p = await tx.product.findFirst({
      where: { id, brandId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw notFound('Product');
  }

  /** Pictures must be ready, of this brand, and carry English alt text (accessibility). */
  private async assertAttachable(tx: Tx, brandId: string, ids: string[]) {
    if (ids.length === 0) return;
    const assets = await tx.mediaAsset.findMany({
      where: { id: { in: ids }, brandId },
      select: {
        id: true,
        status: true,
        translations: { where: { language: REQUIRED_LANGUAGE }, select: { altText: true } },
      },
    });
    if (assets.length !== new Set(ids).size) {
      throw invalid('MEDIA_NOT_FOUND', 'A picture does not exist in this brand');
    }
    for (const a of assets) {
      if (a.status !== 'READY') throw invalid('MEDIA_NOT_READY', 'A picture is not ready to use');
      if (a.translations.length === 0) {
        throw invalid('ALT_REQUIRED', 'Add English alt text to a picture before using it');
      }
    }
  }

  private async describeGallery(tx: Tx, productId: string) {
    const rows = await tx.productMedia.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { mediaAssetId: 'asc' }],
      include: { mediaAsset: { include: { translations: true, variants: true } } },
    });
    return {
      items: rows.map((r) => ({
        sortOrder: r.sortOrder,
        isPrimary: r.isPrimary,
        ...this.shape(r.mediaAsset),
      })),
    };
  }

  private async describe(tx: Tx, brandId: string, assetId: string) {
    const row = await tx.mediaAsset.findFirst({
      where: { id: assetId, brandId },
      include: { translations: true, variants: true },
    });
    if (!row) throw notFound('Media');
    return this.shape(row);
  }

  private shape(row: {
    id: string;
    originalFilename: string;
    contentType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    status: string;
    createdAt: Date;
    translations: { language: string; altText: string }[];
    variants: { kind: string; width: number; height: number }[];
  }) {
    return {
      id: row.id,
      filename: row.originalFilename,
      contentType: row.contentType,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      status: row.status,
      createdAt: row.createdAt,
      alt: row.translations.map((t) => ({ language: t.language, altText: t.altText })),
      variants: row.variants.map((v) => ({ kind: v.kind, width: v.width, height: v.height })),
    };
  }
}
