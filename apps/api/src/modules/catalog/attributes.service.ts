import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound, paginate } from '../admin/admin-common';
import {
  CatalogAccess,
  REQUIRED_LANGUAGE,
  type Tx,
  assertTranslationSet,
  labelTranslationBody,
  labelTranslationWithLanguage,
  mapCatalogError,
} from './catalog-common';

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens');
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour such as #C8A2C8');
const kindSchema = z.enum(['TEXT', 'COLOR', 'NUMBER']);

const valueFields = z.object({
  key: keySchema,
  colorHex: colorSchema.nullish(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  translations: z.array(labelTranslationWithLanguage).min(1).max(20),
});

export const attributeListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const createAttributeBody = z.object({
  key: keySchema,
  kind: kindSchema.default('TEXT'),
  translations: z.array(labelTranslationWithLanguage).min(1).max(20),
  values: z.array(valueFields).max(200).default([]),
});
export const updateAttributeBody = z.object({ key: keySchema, kind: kindSchema }).partial();
export const createValueBody = valueFields;
export const updateValueBody = z
  .object({
    key: keySchema,
    colorHex: colorSchema.nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .partial();
export { labelTranslationBody as attributeTranslationBody };

type CreateAttribute = z.infer<typeof createAttributeBody>;
type UpdateAttribute = z.infer<typeof updateAttributeBody>;
type CreateValue = z.infer<typeof createValueBody>;
type UpdateValue = z.infer<typeof updateValueBody>;

const include = {
  translations: { select: { language: true, label: true } },
  values: {
    select: {
      id: true,
      key: true,
      colorHex: true,
      sortOrder: true,
      translations: { select: { language: true, label: true } },
    },
    orderBy: [{ sortOrder: 'asc' as const }, { key: 'asc' as const }],
  },
};

const shared = (brandId: string) => ({ brandId, productId: null, deletedAt: null });

@Injectable()
export class AttributesService {
  constructor(private readonly access: CatalogAccess) {}

  list(actor: AdminActor, brandId: string, query: z.infer<typeof attributeListQuery>) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      const needle = query.search?.toLowerCase();
      const all = (
        await tx.attribute.findMany({
          where: shared(brandId),
          include,
          orderBy: { key: 'asc' },
        })
      ).filter(
        (a) =>
          !needle ||
          a.key.includes(needle) ||
          a.translations.some((t) => t.label.toLowerCase().includes(needle)),
      );
      return paginate(all, query.page, query.pageSize);
    });
  }

  get(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'products.view', (tx) => this.mustGet(tx, brandId, id));
  }

  async create(actor: AdminActor, brandId: string, body: CreateAttribute) {
    assertTranslationSet(body.translations.map((t) => t.language));
    body.values.forEach((v) => {
      assertTranslationSet(v.translations.map((t) => t.language));
      this.assertColor(body.kind, v.colorHex);
    });
    if (new Set(body.values.map((v) => v.key)).size !== body.values.length) {
      throw new ApiException(422, 'DUPLICATE_VALUE_KEY', 'Each value key can appear only once');
    }
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        const { id } = await tx.attribute.create({
          data: { brandId, key: body.key, kind: body.kind },
          select: { id: true },
        });
        await tx.attributeTranslation.createMany({
          data: body.translations.map((t) => ({ ...t, brandId, attributeId: id })),
        });
        for (const v of body.values) await this.insertValue(tx, brandId, id, v);
        const created = await this.mustGet(tx, brandId, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          'attribute.create',
          'attribute',
          id,
          undefined,
          {
            key: created.key,
            kind: created.kind,
            values: created.values.map((v) => v.key),
          },
        );
        return created;
      });
    } catch (err) {
      throw mapCatalogError(err, 'KEY_TAKEN', 'That key is already used');
    }
  }

  async update(actor: AdminActor, brandId: string, id: string, body: UpdateAttribute) {
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        const before = await this.mustGet(tx, brandId, id);
        const changesIdentity =
          (body.key !== undefined && body.key !== before.key) ||
          (body.kind !== undefined && body.kind !== before.kind);
        if (changesIdentity) await this.assertUnused(tx, id, 'change');
        if (body.kind && body.kind !== 'COLOR' && before.values.some((v) => v.colorHex)) {
          throw new ApiException(
            422,
            'ATTRIBUTE_HAS_COLOURS',
            'Remove the colours of the values before changing the type',
          );
        }
        await tx.attribute.update({ where: { id }, data: body });
        const after = await this.mustGet(tx, brandId, id);
        await this.access.record(
          tx,
          actor,
          brandId,
          'attribute.update',
          'attribute',
          id,
          { key: before.key, kind: before.kind },
          { key: after.key, kind: after.kind },
        );
        return after;
      });
    } catch (err) {
      throw mapCatalogError(err, 'KEY_TAKEN', 'That key is already used');
    }
  }

  putTranslation(
    actor: AdminActor,
    brandId: string,
    id: string,
    language: string,
    body: { label: string },
  ) {
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      await this.mustGet(tx, brandId, id);
      await tx.attributeTranslation.upsert({
        where: { attributeId_language: { attributeId: id, language } },
        create: { brandId, attributeId: id, language, label: body.label },
        update: { label: body.label },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'attribute.translation.set',
        'attribute',
        id,
        undefined,
        {
          language,
          label: body.label,
        },
      );
      return this.mustGet(tx, brandId, id);
    });
  }

  deleteTranslation(actor: AdminActor, brandId: string, id: string, language: string) {
    this.assertNotRequiredLanguage(language);
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      await this.mustGet(tx, brandId, id);
      const { count } = await tx.attributeTranslation.deleteMany({
        where: { attributeId: id, language },
      });
      if (count === 0) throw notFound('Translation');
      await this.access.record(
        tx,
        actor,
        brandId,
        'attribute.translation.delete',
        'attribute',
        id,
        {
          language,
        },
      );
      return this.mustGet(tx, brandId, id);
    });
  }

  remove(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      const before = await this.mustGet(tx, brandId, id);
      await this.assertUnused(tx, id, 'delete');
      // The key is released for reuse by the partial unique index once deleted_at is set.
      await tx.attribute.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.access.record(tx, actor, brandId, 'attribute.delete', 'attribute', id, {
        key: before.key,
        kind: before.kind,
      });
    });
  }

  async addValue(actor: AdminActor, brandId: string, id: string, body: CreateValue) {
    assertTranslationSet(body.translations.map((t) => t.language));
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        const attribute = await this.mustGet(tx, brandId, id);
        this.assertColor(attribute.kind, body.colorHex);
        const valueId = await this.insertValue(tx, brandId, id, body);
        await this.access.record(
          tx,
          actor,
          brandId,
          'attribute.value.create',
          'attribute',
          id,
          undefined,
          {
            valueId,
            key: body.key,
          },
        );
        return this.mustGet(tx, brandId, id);
      });
    } catch (err) {
      throw mapCatalogError(err, 'KEY_TAKEN', 'That value key is already used for this attribute');
    }
  }

  async updateValue(
    actor: AdminActor,
    brandId: string,
    id: string,
    valueId: string,
    body: UpdateValue,
  ) {
    try {
      return await this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
        const attribute = await this.mustGet(tx, brandId, id);
        const value = attribute.values.find((v) => v.id === valueId);
        if (!value) throw notFound('Attribute value');
        if (body.key !== undefined && body.key !== value.key) {
          await this.assertValueUnused(tx, valueId, 'change');
        }
        if (body.colorHex !== undefined) this.assertColor(attribute.kind, body.colorHex);
        await tx.attributeValue.update({ where: { id: valueId }, data: body });
        await this.access.record(
          tx,
          actor,
          brandId,
          'attribute.value.update',
          'attribute',
          id,
          { valueId, key: value.key, colorHex: value.colorHex, sortOrder: value.sortOrder },
          { valueId, ...body },
        );
        return this.mustGet(tx, brandId, id);
      });
    } catch (err) {
      throw mapCatalogError(err, 'KEY_TAKEN', 'That value key is already used for this attribute');
    }
  }

  putValueTranslation(
    actor: AdminActor,
    brandId: string,
    id: string,
    valueId: string,
    language: string,
    body: { label: string },
  ) {
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      const attribute = await this.mustGet(tx, brandId, id);
      if (!attribute.values.some((v) => v.id === valueId)) throw notFound('Attribute value');
      await tx.attributeValueTranslation.upsert({
        where: { attributeValueId_language: { attributeValueId: valueId, language } },
        create: { brandId, attributeValueId: valueId, language, label: body.label },
        update: { label: body.label },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'attribute.value.translation.set',
        'attribute',
        id,
        undefined,
        {
          valueId,
          language,
          label: body.label,
        },
      );
      return this.mustGet(tx, brandId, id);
    });
  }

  deleteValueTranslation(
    actor: AdminActor,
    brandId: string,
    id: string,
    valueId: string,
    language: string,
  ) {
    this.assertNotRequiredLanguage(language);
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      const attribute = await this.mustGet(tx, brandId, id);
      if (!attribute.values.some((v) => v.id === valueId)) throw notFound('Attribute value');
      const { count } = await tx.attributeValueTranslation.deleteMany({
        where: { attributeValueId: valueId, language },
      });
      if (count === 0) throw notFound('Translation');
      await this.access.record(
        tx,
        actor,
        brandId,
        'attribute.value.translation.delete',
        'attribute',
        id,
        {
          valueId,
          language,
        },
      );
      return this.mustGet(tx, brandId, id);
    });
  }

  removeValue(actor: AdminActor, brandId: string, id: string, valueId: string) {
    return this.access.run(actor, brandId, 'taxonomy.manage', async (tx) => {
      const attribute = await this.mustGet(tx, brandId, id);
      const value = attribute.values.find((v) => v.id === valueId);
      if (!value) throw notFound('Attribute value');
      await this.assertValueUnused(tx, valueId, 'delete');
      await tx.attributeValue.delete({ where: { id: valueId } });
      await this.access.record(tx, actor, brandId, 'attribute.value.delete', 'attribute', id, {
        valueId,
        key: value.key,
      });
      return this.mustGet(tx, brandId, id);
    });
  }

  private async mustGet(tx: Tx, brandId: string, id: string) {
    const row = await tx.attribute.findFirst({ where: { id, ...shared(brandId) }, include });
    if (!row) throw notFound('Attribute');
    return row;
  }

  private async insertValue(
    tx: Tx,
    brandId: string,
    attributeId: string,
    v: CreateValue,
  ): Promise<string> {
    const { id } = await tx.attributeValue.create({
      data: {
        brandId,
        attributeId,
        key: v.key,
        colorHex: v.colorHex ?? null,
        sortOrder: v.sortOrder,
      },
      select: { id: true },
    });
    await tx.attributeValueTranslation.createMany({
      data: v.translations.map((t) => ({ ...t, brandId, attributeValueId: id })),
    });
    return id;
  }

  private assertColor(kind: string, colorHex: string | null | undefined): void {
    if (colorHex && kind !== 'COLOR') {
      throw new ApiException(
        422,
        'COLOUR_NOT_ALLOWED',
        'Colours can only be set on attributes of the colour type',
      );
    }
  }

  private assertNotRequiredLanguage(language: string): void {
    if (language === REQUIRED_LANGUAGE) {
      throw new ApiException(422, 'ENGLISH_REQUIRED', 'The English translation cannot be removed');
    }
  }

  private async assertUnused(tx: Tx, attributeId: string, verb: string): Promise<void> {
    const uses = await tx.productAttribute.count({ where: { attributeId } });
    if (uses > 0) {
      throw new ApiException(
        409,
        'ATTRIBUTE_IN_USE',
        `Products use this attribute, so it cannot be ${verb === 'delete' ? 'deleted' : 'changed'}`,
      );
    }
  }

  private async assertValueUnused(tx: Tx, valueId: string, verb: string): Promise<void> {
    const uses = await tx.productAttributeValue.count({ where: { attributeValueId: valueId } });
    if (uses > 0) {
      throw new ApiException(
        409,
        'ATTRIBUTE_VALUE_IN_USE',
        `Products use this value, so it cannot be ${verb === 'delete' ? 'deleted' : 'changed'}`,
      );
    }
  }
}
