import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound } from '../admin/admin-common';
import { CatalogAccess, type Tx, mapCatalogError } from './catalog-common';

export const putBundleBody = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        /** Required when the component is a variable product: the exact variation that ships. */
        variationId: z.string().uuid().optional(),
        quantity: z.number().int().min(1).max(1000).default(1),
        sortOrder: z.number().int().min(0).max(100_000).default(0),
      }),
    )
    .max(50),
});
type PutBody = z.infer<typeof putBundleBody>;

const invalid = (code: string, message: string) => new ApiException(422, code, message);

/**
 * A bundle is sold at one fixed price per market (set with the prices of the bundle product); its
 * components are listed so that stock is deducted from each of them in Phase 4 (D3-07).
 */
@Injectable()
export class BundlesService {
  constructor(private readonly access: CatalogAccess) {}

  get(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      await this.mustGetBundle(tx, brandId, productId);
      return this.describe(tx, productId);
    });
  }

  async put(actor: AdminActor, brandId: string, productId: string, body: PutBody) {
    const ids = body.items.map((i) => `${i.productId}:${i.variationId ?? ''}`);
    if (new Set(ids).size !== ids.length) {
      throw invalid('DUPLICATE_COMPONENT', 'Each component can be listed once');
    }
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        await this.mustGetBundle(tx, brandId, productId);
        for (const item of body.items) {
          if (item.productId === productId) {
            throw invalid('COMPONENT_SELF', 'A bundle cannot contain itself');
          }
          const component = await tx.product.findFirst({
            where: { id: item.productId, brandId, deletedAt: null },
            select: { type: true },
          });
          if (!component)
            throw invalid('COMPONENT_NOT_FOUND', 'A component does not exist in this brand');
          if (component.type === 'BUNDLE') {
            throw invalid('COMPONENT_INVALID', 'A bundle cannot contain another bundle');
          }
          if (component.type === 'VARIABLE') {
            if (!item.variationId) {
              throw invalid('VARIATION_REQUIRED', 'Choose the variation of a variable component');
            }
            const variation = await tx.variation.findFirst({
              where: { id: item.variationId, productId: item.productId, deletedAt: null },
              select: { id: true },
            });
            if (!variation)
              throw invalid(
                'VARIATION_NOT_FOUND',
                'The variation does not belong to the component',
              );
          } else if (item.variationId) {
            throw invalid('VARIATION_NOT_ALLOWED', 'Only variable products have variations');
          }
        }
        const before = await this.describe(tx, productId);
        await tx.bundleItem.deleteMany({ where: { bundleProductId: productId } });
        await tx.bundleItem.createMany({
          data: body.items.map((i) => ({
            brandId,
            bundleProductId: productId,
            componentProductId: i.productId,
            componentVariationId: i.variationId ?? null,
            quantity: i.quantity,
            sortOrder: i.sortOrder,
          })),
        });
        const after = await this.describe(tx, productId);
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.bundle.set',
          'product',
          productId,
          before,
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapCatalogError(err, 'COMPONENT_CONFLICT', 'That component is already listed');
    }
  }

  private async mustGetBundle(tx: Tx, brandId: string, id: string) {
    const p = await tx.product.findFirst({
      where: { id, brandId, deletedAt: null },
      select: { id: true, type: true },
    });
    if (!p) throw notFound('Product');
    if (p.type !== 'BUNDLE') throw invalid('NOT_BUNDLE', 'Only bundle products have components');
    return p;
  }

  private async describe(tx: Tx, productId: string) {
    const rows = await tx.bundleItem.findMany({
      where: { bundleProductId: productId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        componentProduct: {
          select: { sku: true, translations: { select: { language: true, name: true } } },
        },
        componentVariation: { select: { sku: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        productId: r.componentProductId,
        variationId: r.componentVariationId,
        quantity: r.quantity,
        sortOrder: r.sortOrder,
        sku: r.componentVariation?.sku ?? r.componentProduct.sku,
        names: r.componentProduct.translations,
      })),
    };
  }
}
