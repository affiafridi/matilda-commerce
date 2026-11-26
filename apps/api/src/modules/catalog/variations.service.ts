import { Injectable } from '@nestjs/common';
import {
  MAX_VARIATIONS_PER_PRODUCT,
  generateVariationCombinations,
  skuSchema,
  variationKey,
  z,
} from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound } from '../admin/admin-common';
import { CatalogAccess, type Tx, mapCatalogError } from './catalog-common';

export const productAttributesBody = z.object({
  attributes: z
    .array(
      z.object({
        attributeId: z.string().uuid(),
        /** Each chosen value becomes an option of a variation (variable products only). */
        drivesVariations: z.boolean().default(false),
        /** Shown to shoppers as a specification. */
        visible: z.boolean().default(true),
        sortOrder: z.number().int().min(0).max(1000).default(0),
        valueIds: z.array(z.string().uuid()).min(1).max(200),
      }),
    )
    .max(30),
});

export const generateVariationsBody = z.object({
  /** Each SKU is the prefix plus the upper-cased value keys, e.g. CK-CLASSIC-CHOCOLATE-1KG. */
  skuPrefix: skuSchema,
});

export const createVariationBody = z.object({
  sku: skuSchema,
  /** One value per variation-driving attribute: attributeId to valueId. */
  values: z.record(z.string().uuid(), z.string().uuid()),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
});

const editFields = {
  sku: skuSchema.optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
};
export const updateVariationBody = z.object(editFields);
export const bulkUpdateVariationsBody = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), ...editFields }))
    .min(1)
    .max(MAX_VARIATIONS_PER_PRODUCT),
});

type AttributesBody = z.infer<typeof productAttributesBody>;
type CreateVariation = z.infer<typeof createVariationBody>;
type UpdateVariation = z.infer<typeof updateVariationBody>;

const live = { deletedAt: null } as const;
const pairKey = (attributeId: string, valueId: string) => `${attributeId}:${valueId}`;

@Injectable()
export class VariationsService {
  constructor(private readonly access: CatalogAccess) {}

  getAttributes(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      return this.describeAttributes(tx, productId);
    });
  }

  /**
   * Replaces the attributes of a product and the values chosen for each. Choices that live
   * variations rely on cannot be removed, and the variation-driving flag cannot change under them.
   */
  putAttributes(actor: AdminActor, brandId: string, productId: string, body: AttributesBody) {
    return this.access.run(actor, brandId, 'products.edit', async (tx) => {
      const product = await this.mustGetProduct(tx, brandId, productId);
      const ids = body.attributes.map((a) => a.attributeId);
      if (new Set(ids).size !== ids.length) {
        throw new ApiException(422, 'DUPLICATE_ATTRIBUTE', 'Each attribute can be listed once');
      }
      if (product.type !== 'VARIABLE' && body.attributes.some((a) => a.drivesVariations)) {
        throw new ApiException(
          422,
          'NOT_VARIABLE',
          'Only variable products can have variation attributes',
        );
      }
      const attributes = await tx.attribute.findMany({
        where: { brandId, productId: null, ...live, id: { in: ids } },
        select: { id: true },
      });
      if (attributes.length !== ids.length) {
        throw new ApiException(
          422,
          'ATTRIBUTE_NOT_FOUND',
          'An attribute does not exist in this brand',
        );
      }
      const wanted = new Map<string, Set<string>>();
      for (const a of body.attributes) {
        const valueIds = new Set(a.valueIds);
        const found = await tx.attributeValue.count({
          where: { brandId, attributeId: a.attributeId, id: { in: [...valueIds] } },
        });
        if (found !== valueIds.size) {
          throw new ApiException(
            422,
            'VALUE_NOT_FOUND',
            'A value does not belong to its attribute',
          );
        }
        wanted.set(a.attributeId, valueIds);
      }

      const inUse = await tx.variationValue.findMany({
        where: { productId, variation: { deletedAt: null } },
        select: { attributeId: true, attributeValueId: true },
      });
      const drivers = new Map(body.attributes.map((a) => [a.attributeId, a.drivesVariations]));
      for (const used of inUse) {
        if (drivers.get(used.attributeId) !== true) {
          throw new ApiException(
            409,
            'ATTRIBUTE_IN_USE_BY_VARIATIONS',
            'Variations use this attribute. Delete the variations first',
          );
        }
        if (!wanted.get(used.attributeId)?.has(used.attributeValueId)) {
          throw new ApiException(
            409,
            'VALUE_IN_USE_BY_VARIATIONS',
            'Variations use a value you removed. Delete those variations first',
          );
        }
      }

      const existing = await tx.productAttributeValue.findMany({
        where: { productId },
        select: { attributeId: true, attributeValueId: true },
      });
      const keep = new Set(
        body.attributes.flatMap((a) => a.valueIds.map((v) => pairKey(a.attributeId, v))),
      );
      for (const e of existing) {
        if (!keep.has(pairKey(e.attributeId, e.attributeValueId))) {
          await tx.productAttributeValue.deleteMany({
            where: { productId, attributeId: e.attributeId, attributeValueId: e.attributeValueId },
          });
        }
      }
      await tx.productAttribute.deleteMany({
        where: { productId, attributeId: { notIn: ids } },
      });
      for (const a of body.attributes) {
        await tx.productAttribute.upsert({
          where: { productId_attributeId: { productId, attributeId: a.attributeId } },
          create: {
            brandId,
            productId,
            attributeId: a.attributeId,
            drivesVariations: a.drivesVariations,
            visible: a.visible,
            sortOrder: a.sortOrder,
          },
          update: {
            drivesVariations: a.drivesVariations,
            visible: a.visible,
            sortOrder: a.sortOrder,
          },
        });
      }
      const have = new Set(existing.map((e) => pairKey(e.attributeId, e.attributeValueId)));
      await tx.productAttributeValue.createMany({
        data: body.attributes.flatMap((a) =>
          [...new Set(a.valueIds)]
            .filter((v) => !have.has(pairKey(a.attributeId, v)))
            .map((attributeValueId) => ({
              brandId,
              productId,
              attributeId: a.attributeId,
              attributeValueId,
            })),
        ),
      });
      const after = await this.describeAttributes(tx, productId);
      await this.access.record(
        tx,
        actor,
        brandId,
        'product.attributes.set',
        'product',
        productId,
        undefined,
        {
          attributes: after.map((a) => ({
            key: a.key,
            drivesVariations: a.drivesVariations,
            values: a.values.map((v) => v.key),
          })),
        },
      );
      return after;
    });
  }

  list(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      return this.describeAll(tx, productId);
    });
  }

  /** Creates every missing combination of the variation-driving attributes (safe to repeat). */
  async generate(
    actor: AdminActor,
    brandId: string,
    productId: string,
    body: z.infer<typeof generateVariationsBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        const product = await this.mustGetProduct(tx, brandId, productId);
        this.assertVariable(product.type);
        const drivers = await this.drivers(tx, productId);
        if (drivers.length === 0) {
          throw new ApiException(
            422,
            'NO_VARIATION_ATTRIBUTES',
            'Choose the attributes that drive variations first',
          );
        }
        let combos;
        try {
          combos = generateVariationCombinations(
            drivers.map((d) => ({ key: d.key, values: d.values.map((v) => v.key) })),
          );
        } catch (err) {
          throw new ApiException(
            422,
            'TOO_MANY_VARIATIONS',
            err instanceof RangeError ? err.message : 'Cannot generate variations',
          );
        }
        const existing = await tx.variation.findMany({
          where: { productId, ...live },
          select: { combinationKey: true },
        });
        const known = new Set(existing.map((e) => e.combinationKey));
        const missing = combos.filter((c) => !known.has(variationKey(c)));
        if (existing.length + missing.length > MAX_VARIATIONS_PER_PRODUCT) {
          throw new ApiException(
            422,
            'TOO_MANY_VARIATIONS',
            `A product can have at most ${MAX_VARIATIONS_PER_PRODUCT} variations`,
          );
        }
        let order = existing.length;
        for (const combo of missing) {
          const sku = [
            body.skuPrefix,
            ...drivers.map((d) => (combo[d.key] ?? '').toUpperCase()),
          ].join('-');
          if (!skuSchema.safeParse(sku).success) {
            throw new ApiException(422, 'SKU_INVALID', `The generated SKU ${sku} is not valid`);
          }
          const { id } = await tx.variation.create({
            data: {
              brandId,
              productId,
              sku,
              combinationKey: variationKey(combo),
              sortOrder: order++,
            },
            select: { id: true },
          });
          await tx.variationValue.createMany({
            data: drivers.map((d) => ({
              brandId,
              variationId: id,
              productId,
              attributeId: d.attributeId,
              attributeValueId: d.values.find((v) => v.key === combo[d.key])?.id ?? '',
            })),
          });
        }
        await this.access.record(
          tx,
          actor,
          brandId,
          'variation.generate',
          'product',
          productId,
          undefined,
          {
            created: missing.length,
            total: existing.length + missing.length,
          },
        );
        return this.describeAll(tx, productId);
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async create(actor: AdminActor, brandId: string, productId: string, body: CreateVariation) {
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        const product = await this.mustGetProduct(tx, brandId, productId);
        this.assertVariable(product.type);
        const drivers = await this.drivers(tx, productId);
        const chosen = new Map<string, string>();
        for (const d of drivers) {
          const valueId = body.values[d.attributeId];
          if (!valueId || !d.values.some((v) => v.id === valueId)) {
            throw new ApiException(
              422,
              'COMBINATION_INVALID',
              "Choose one of the product's values for every variation attribute",
            );
          }
          chosen.set(d.attributeId, valueId);
        }
        if (Object.keys(body.values).length !== drivers.length || drivers.length === 0) {
          throw new ApiException(
            422,
            'COMBINATION_INVALID',
            'Choose exactly the variation attributes',
          );
        }
        const key = variationKey(
          Object.fromEntries(
            drivers.map((d) => [
              d.key,
              d.values.find((v) => v.id === chosen.get(d.attributeId))?.key ?? '',
            ]),
          ),
        );
        const { id } = await tx.variation.create({
          data: {
            brandId,
            productId,
            sku: body.sku,
            combinationKey: key,
            active: body.active,
            sortOrder: body.sortOrder,
          },
          select: { id: true },
        });
        await tx.variationValue.createMany({
          data: drivers.map((d) => ({
            brandId,
            variationId: id,
            productId,
            attributeId: d.attributeId,
            attributeValueId: chosen.get(d.attributeId) ?? '',
          })),
        });
        await this.access.record(
          tx,
          actor,
          brandId,
          'variation.create',
          'product',
          productId,
          undefined,
          {
            variationId: id,
            sku: body.sku,
            combination: key,
          },
        );
        return (await this.describeAll(tx, productId)).find((v) => v.id === id);
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async update(
    actor: AdminActor,
    brandId: string,
    productId: string,
    id: string,
    body: UpdateVariation,
  ) {
    return this.bulkUpdate(actor, brandId, productId, [{ id, ...body }]).then((all) =>
      all.find((v) => v.id === id),
    );
  }

  /** Edits SKU, active flag and order of several variations atomically. The combination never changes. */
  async bulkUpdate(
    actor: AdminActor,
    brandId: string,
    productId: string,
    items: readonly ({ id: string } & UpdateVariation)[],
  ) {
    if (new Set(items.map((i) => i.id)).size !== items.length) {
      throw new ApiException(422, 'DUPLICATE_VARIATION', 'Each variation can be listed once');
    }
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        await this.mustGetProduct(tx, brandId, productId);
        const before = await this.describeAll(tx, productId);
        for (const item of items) {
          if (!before.some((v) => v.id === item.id)) throw notFound('Variation');
        }
        // Two-step SKU swap safe: unique index is checked per statement, so clear clashes first.
        const renamed = items.filter((i) => i.sku !== undefined);
        for (const item of renamed) {
          const current = before.find((v) => v.id === item.id);
          if (current && current.sku !== item.sku) {
            await tx.variation.update({
              where: { id: item.id },
              data: { sku: `TMP-${item.id.replace(/-/g, '').toUpperCase()}`.slice(0, 64) },
            });
          }
        }
        for (const { id, ...data } of items) {
          await tx.variation.update({ where: { id }, data });
        }
        const after = await this.describeAll(tx, productId);
        await this.access.record(
          tx,
          actor,
          brandId,
          'variation.update',
          'product',
          productId,
          items
            .map((i) => before.find((v) => v.id === i.id))
            .map((v) => v && { id: v.id, sku: v.sku, active: v.active, sortOrder: v.sortOrder }),
          items
            .map((i) => after.find((v) => v.id === i.id))
            .map((v) => v && { id: v.id, sku: v.sku, active: v.active, sortOrder: v.sortOrder }),
        );
        return after;
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  remove(actor: AdminActor, brandId: string, productId: string, id: string) {
    return this.access.run(actor, brandId, 'products.edit', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      const row = await tx.variation.findFirst({ where: { id, productId, brandId, ...live } });
      if (!row) throw notFound('Variation');
      const used =
        (await tx.bundleItem.count({ where: { componentVariationId: id } })) +
        (await tx.addonItem.count({ where: { addonVariationId: id } }));
      if (used > 0) {
        throw new ApiException(
          409,
          'VARIATION_IN_USE',
          'This variation is a bundle component or an add-on. Remove it there first',
        );
      }
      // Frees the SKU and the combination for reuse; the originals stay in the audit record.
      const tag = id.replace(/-/g, '').slice(0, 12).toUpperCase();
      await tx.variationValue.deleteMany({ where: { variationId: id } });
      await tx.marketPrice.deleteMany({ where: { variationId: id } });
      await tx.variation.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          active: false,
          sku: `${row.sku.slice(0, 48)}-X${tag}`.slice(0, 64),
          combinationKey: `${row.combinationKey}#deleted-${tag}`,
        },
      });
      await this.access.record(tx, actor, brandId, 'variation.delete', 'product', productId, {
        variationId: id,
        sku: row.sku,
        combination: row.combinationKey,
      });
    });
  }

  private assertVariable(type: string) {
    if (type !== 'VARIABLE') {
      throw new ApiException(422, 'NOT_VARIABLE', 'Only variable products have variations');
    }
  }

  private async mustGetProduct(tx: Tx, brandId: string, id: string) {
    const p = await tx.product.findFirst({
      where: { id, brandId, ...live },
      select: { id: true, type: true },
    });
    if (!p) throw notFound('Product');
    return p;
  }

  /** Variation-driving attributes of a product with the values chosen for each, in display order. */
  private async drivers(tx: Tx, productId: string) {
    const all = await this.describeAttributes(tx, productId);
    return all
      .filter((a) => a.drivesVariations)
      .map((a) => ({ attributeId: a.attributeId, key: a.key, values: a.values }));
  }

  private async describeAttributes(tx: Tx, productId: string) {
    const links = await tx.productAttribute.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const chosen = await tx.productAttributeValue.findMany({ where: { productId } });
    const attributes = await tx.attribute.findMany({
      where: { id: { in: links.map((l) => l.attributeId) } },
      include: {
        values: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
      },
    });
    return links.map((l) => {
      const attribute = attributes.find((a) => a.id === l.attributeId);
      const picked = new Set(
        chosen.filter((c) => c.attributeId === l.attributeId).map((c) => c.attributeValueId),
      );
      return {
        attributeId: l.attributeId,
        key: attribute?.key ?? '',
        drivesVariations: l.drivesVariations,
        visible: l.visible,
        sortOrder: l.sortOrder,
        values: (attribute?.values ?? [])
          .filter((v) => picked.has(v.id))
          .map((v) => ({ id: v.id, key: v.key })),
      };
    });
  }

  private async describeAll(tx: Tx, productId: string) {
    const rows = await tx.variation.findMany({
      where: { productId, ...live },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const values = await tx.variationValue.findMany({
      where: { variationId: { in: rows.map((r) => r.id) } },
    });
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      active: r.active,
      sortOrder: r.sortOrder,
      combinationKey: r.combinationKey,
      values: values
        .filter((v) => v.variationId === r.id)
        .map((v) => ({ attributeId: v.attributeId, attributeValueId: v.attributeValueId })),
    }));
  }

  private mapError(err: unknown): Error {
    const message = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
    if (
      /already used by a product|variation_brand_id_sku|product_brand_id_sku|\bsku\b/i.test(
        message,
      ) &&
      /unique|duplicate|already|23505/i.test(message)
    ) {
      return new ApiException(409, 'SKU_TAKEN', 'That SKU is already used in this brand');
    }
    if (/at most 100 variations/i.test(message)) {
      return new ApiException(
        422,
        'TOO_MANY_VARIATIONS',
        `A product can have at most ${MAX_VARIATIONS_PER_PRODUCT} variations`,
      );
    }
    return mapCatalogError(err, 'COMBINATION_EXISTS', 'That combination already exists');
  }
}
