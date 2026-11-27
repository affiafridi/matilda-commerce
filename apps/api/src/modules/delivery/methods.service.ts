import { Injectable } from '@nestjs/common';
import { deliveryMethodKindSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, notFound } from '../admin/admin-common';
import {
  assertTranslationSet,
  codeSchema,
  DeliveryAccess,
  mapDeliveryError,
  nameTranslationBody,
  nameTranslationWithLanguage,
  REQUIRED_LANGUAGE,
} from './delivery-common';

type Tx = Prisma.TransactionClient;

const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);
/** Money is whole minor units (fils for AED); the cap keeps every value inside the column. */
const minor = z.number().int().min(0).max(1_000_000_000);

export const methodListQuery = z.object({ marketId: z.string().uuid().optional() });

export const createMethodBody = z.object({
  marketId: z.string().uuid(),
  kind: deliveryMethodKindSchema,
  code: codeSchema,
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  status: statusSchema.default('ACTIVE'),
  translations: z.array(nameTranslationWithLanguage).min(1).max(20),
});

export const updateMethodBody = z
  .object({
    kind: deliveryMethodKindSchema,
    code: codeSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    status: statusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

export { nameTranslationBody as methodTranslationBody };

export const chargeListQuery = z.object({
  zoneId: z.string().uuid().optional(),
  methodId: z.string().uuid().optional(),
});

const chargeFields = {
  feeMinor: minor,
  minimumOrderMinor: minor.default(0),
  /** An order at or above this subtotal ships free; empty means the fee always applies. */
  freeOverMinor: minor.nullish(),
};

export const createChargeBody = z
  .object({
    zoneId: z.string().uuid(),
    methodId: z.string().uuid(),
    currencyCode: z
      .string()
      .length(3)
      .transform((c) => c.toUpperCase()),
    ...chargeFields,
  })
  .refine((v) => v.freeOverMinor == null || v.freeOverMinor >= v.minimumOrderMinor, {
    message: 'The free-delivery threshold cannot be below the minimum order.',
    path: ['freeOverMinor'],
  });

export const updateChargeBody = z
  .object({
    feeMinor: minor,
    minimumOrderMinor: minor,
    freeOverMinor: minor.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

const INCLUDE = {
  translations: { orderBy: { language: 'asc' } },
} satisfies Prisma.DeliveryMethodInclude;
type MethodRow = Prisma.DeliveryMethodGetPayload<{ include: typeof INCLUDE }>;

const methodView = (m: MethodRow) => ({
  id: m.id,
  marketId: m.marketId,
  kind: m.kind,
  code: m.code,
  sortOrder: m.sortOrder,
  status: m.status,
  translations: m.translations.map((t) => ({ language: t.language, name: t.name })),
});

const chargeView = (c: Prisma.ZoneChargeGetPayload<object>) => ({
  id: c.id,
  marketId: c.marketId,
  zoneId: c.zoneId,
  methodId: c.methodId,
  currencyCode: c.currencyCode,
  feeMinor: c.feeMinor,
  minimumOrderMinor: c.minimumOrderMinor,
  freeOverMinor: c.freeOverMinor,
});

/**
 * Delivery methods (same day, next day, scheduled) and what each costs per zone. Fees, minimum
 * orders and free-delivery thresholds are integer minor units in a currency of the market; the
 * checkout will read them from here, never from the client. Charges are sensitive: they need
 * `delivery.manage`, which requires a recent step-up.
 */
@Injectable()
export class MethodsService {
  constructor(private readonly access: DeliveryAccess) {}

  list(actor: AdminActor, brandId: string, query: z.infer<typeof methodListQuery>) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) => {
      const rows = await tx.deliveryMethod.findMany({
        where: query.marketId ? { marketId: query.marketId } : {},
        include: INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      return rows.map(methodView);
    });
  }

  get(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) =>
      methodView(await this.load(tx, id)),
    );
  }

  private async load(tx: Tx, id: string): Promise<MethodRow> {
    const row = await tx.deliveryMethod.findFirst({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Method');
    return row;
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createMethodBody>) {
    assertTranslationSet(input.translations.map((t) => t.language));
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const market = await tx.market.findFirst({ where: { id: input.marketId, brandId } });
        if (!market) throw notFound('Market');
        const created = await tx.deliveryMethod.create({
          data: {
            brandId,
            marketId: input.marketId,
            kind: input.kind,
            code: input.code,
            sortOrder: input.sortOrder,
            status: input.status,
          },
        });
        await tx.deliveryMethodTranslation.createMany({
          data: input.translations.map((t) => ({ methodId: created.id, brandId, ...t })),
        });
        const row = methodView(await this.load(tx, created.id));
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.method.create',
          'delivery_method',
          created.id,
          undefined,
          row,
        );
        return row;
      });
    } catch (err) {
      throw mapDeliveryError(err, 'METHOD_CODE_TAKEN', 'That code is already used in this market');
    }
  }

  async update(
    actor: AdminActor,
    brandId: string,
    id: string,
    patch: z.infer<typeof updateMethodBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const before = methodView(await this.load(tx, id));
        await tx.deliveryMethod.update({ where: { id }, data: patch });
        const after = methodView(await this.load(tx, id));
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.method.update',
          'delivery_method',
          id,
          before,
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapDeliveryError(err, 'METHOD_CODE_TAKEN', 'That code is already used in this market');
    }
  }

  putTranslation(
    actor: AdminActor,
    brandId: string,
    id: string,
    language: string,
    body: z.infer<typeof nameTranslationBody>,
  ) {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      await this.load(tx, id);
      await tx.deliveryMethodTranslation.upsert({
        where: { methodId_language: { methodId: id, language } },
        create: { methodId: id, brandId, language, name: body.name },
        update: { name: body.name },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.method.translation.put',
        'delivery_method',
        id,
        undefined,
        { language, name: body.name },
      );
      return methodView(await this.load(tx, id));
    });
  }

  deleteTranslation(actor: AdminActor, brandId: string, id: string, language: string) {
    if (language === REQUIRED_LANGUAGE) {
      throw new ApiException(422, 'ENGLISH_REQUIRED', 'The English name cannot be removed');
    }
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const method = await this.load(tx, id);
      if (!method.translations.some((t) => t.language === language)) throw notFound('Translation');
      await tx.deliveryMethodTranslation.delete({
        where: { methodId_language: { methodId: id, language } },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.method.translation.delete',
        'delivery_method',
        id,
        { language },
      );
      return methodView(await this.load(tx, id));
    });
  }

  remove(actor: AdminActor, brandId: string, id: string): Promise<void> {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const method = await this.load(tx, id);
      if ((await tx.zoneCharge.count({ where: { methodId: id } })) > 0) {
        throw new ApiException(409, 'METHOD_IN_USE', 'The method has charges; remove those first');
      }
      await tx.deliveryMethod.delete({ where: { id } });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.method.delete',
        'delivery_method',
        id,
        methodView(method),
      );
    });
  }

  listCharges(actor: AdminActor, brandId: string, query: z.infer<typeof chargeListQuery>) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) => {
      const rows = await tx.zoneCharge.findMany({
        where: {
          ...(query.zoneId && { zoneId: query.zoneId }),
          ...(query.methodId && { methodId: query.methodId }),
        },
        orderBy: [{ zoneId: 'asc' }, { methodId: 'asc' }, { currencyCode: 'asc' }],
      });
      return rows.map(chargeView);
    });
  }

  async createCharge(actor: AdminActor, brandId: string, input: z.infer<typeof createChargeBody>) {
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const [zone, method] = await Promise.all([
          tx.deliveryZone.findFirst({ where: { id: input.zoneId } }),
          tx.deliveryMethod.findFirst({ where: { id: input.methodId } }),
        ]);
        if (!zone) throw notFound('Zone');
        if (!method) throw notFound('Method');
        if (zone.marketId !== method.marketId) {
          throw new ApiException(
            422,
            'MARKET_MISMATCH',
            'The zone and the method are in different markets',
          );
        }
        const currency = await tx.marketCurrency.findFirst({
          where: { marketId: zone.marketId, currencyCode: input.currencyCode },
        });
        if (!currency) {
          throw new ApiException(
            422,
            'CURRENCY_NOT_IN_MARKET',
            'The market does not sell in that currency',
          );
        }
        const row = await tx.zoneCharge.create({
          data: {
            brandId,
            marketId: zone.marketId,
            zoneId: input.zoneId,
            methodId: input.methodId,
            currencyCode: input.currencyCode,
            feeMinor: input.feeMinor,
            minimumOrderMinor: input.minimumOrderMinor,
            freeOverMinor: input.freeOverMinor ?? null,
          },
        });
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.charge.create',
          'zone_charge',
          row.id,
          undefined,
          chargeView(row),
        );
        return chargeView(row);
      });
    } catch (err) {
      throw mapDeliveryError(
        err,
        'CHARGE_EXISTS',
        'That zone, method and currency already have a charge',
      );
    }
  }

  updateCharge(
    actor: AdminActor,
    brandId: string,
    id: string,
    patch: z.infer<typeof updateChargeBody>,
  ) {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const current = await tx.zoneCharge.findFirst({ where: { id } });
      if (!current) throw notFound('Charge');
      const minimum = patch.minimumOrderMinor ?? current.minimumOrderMinor;
      const freeOver =
        patch.freeOverMinor === undefined ? current.freeOverMinor : patch.freeOverMinor;
      if (freeOver != null && freeOver < minimum) {
        throw new ApiException(
          422,
          'THRESHOLD_BELOW_MINIMUM',
          'The free-delivery threshold cannot be below the minimum order',
        );
      }
      const row = await tx.zoneCharge.update({ where: { id }, data: patch });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.charge.update',
        'zone_charge',
        id,
        chargeView(current),
        chargeView(row),
      );
      return chargeView(row);
    });
  }

  removeCharge(actor: AdminActor, brandId: string, id: string): Promise<void> {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const current = await tx.zoneCharge.findFirst({ where: { id } });
      if (!current) throw notFound('Charge');
      await tx.zoneCharge.delete({ where: { id } });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.charge.delete',
        'zone_charge',
        id,
        chargeView(current),
      );
    });
  }
}
