import { Injectable } from '@nestjs/common';
import {
  RESTRICTION_CONDITIONS,
  deliveryMethodKindSchema,
  localDateSchema,
  restrictionConditionSchema,
  restrictionTargetSchema,
  weekdaySchema,
  z,
} from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, notFound } from '../admin/admin-common';
import { DeliveryAccess, mapDeliveryError } from './delivery-common';

type Tx = Prisma.TransactionClient;

const uuid = z.string().uuid();
const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);
const note = z.string().trim().max(500).nullish();

export const restrictionListQuery = z.object({
  marketId: uuid.optional(),
  target: restrictionTargetSchema.optional(),
  targetId: uuid.optional(),
  condition: restrictionConditionSchema.optional(),
  status: statusSchema.optional(),
});

const base = {
  marketId: uuid,
  /** What is held back: one product, every product of a category, or of a collection. */
  target: restrictionTargetSchema,
  targetId: uuid,
  note,
  status: statusSchema.default('ACTIVE'),
};

/**
 * A restriction says: the target cannot be delivered when the condition matches. Exactly one
 * condition per row (a small fixed set, never a rule language); combine rows for "and/or" needs.
 */
export const createRestrictionBody = z.discriminatedUnion('condition', [
  z.object({ ...base, condition: z.literal('AREA'), areaId: uuid }),
  z.object({ ...base, condition: z.literal('ZONE'), zoneId: uuid }),
  z
    .object({
      ...base,
      condition: z.literal('DATE_RANGE'),
      dateFrom: localDateSchema,
      dateTo: localDateSchema,
    })
    .refine((v) => v.dateTo >= v.dateFrom, {
      message: 'The end date cannot be before the start date.',
      path: ['dateTo'],
    }),
  z.object({ ...base, condition: z.literal('WEEKDAY'), weekday: weekdaySchema }),
  z.object({ ...base, condition: z.literal('METHOD'), methodKind: deliveryMethodKindSchema }),
]);
export type CreateRestriction = z.infer<typeof createRestrictionBody>;

/** Only the note and the status change; to change what a rule does, delete it and add another. */
export const updateRestrictionBody = z
  .object({ note, status: statusSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

if (RESTRICTION_CONDITIONS.length !== 5) {
  throw new Error('Restriction conditions changed: update createRestrictionBody.');
}

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const view = (r: Prisma.DeliveryRestrictionGetPayload<object>) => ({
  id: r.id,
  marketId: r.marketId,
  target: r.target,
  targetId: r.productId ?? r.categoryId ?? r.collectionId,
  condition: r.condition,
  areaId: r.areaId,
  zoneId: r.zoneId,
  dateFrom: fromDate(r.dateFrom),
  dateTo: fromDate(r.dateTo),
  weekday: r.weekday,
  methodKind: r.methodKind,
  note: r.note,
  status: r.status,
});

/**
 * Delivery restrictions: data rows that hold a product, category or collection back from an area,
 * zone, date range, weekday or method. The availability service (step 4.10) applies them; this
 * step only manages the rows. Sensitive (they can switch off sales), so `delivery.manage`.
 */
@Injectable()
export class RestrictionsService {
  constructor(private readonly access: DeliveryAccess) {}

  list(actor: AdminActor, brandId: string, query: z.infer<typeof restrictionListQuery>) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) => {
      const rows = await tx.deliveryRestriction.findMany({
        where: {
          ...(query.marketId && { marketId: query.marketId }),
          ...(query.target && { target: query.target }),
          ...(query.condition && { condition: query.condition }),
          ...(query.status && { status: query.status }),
          ...(query.targetId && {
            OR: [
              { productId: query.targetId },
              { categoryId: query.targetId },
              { collectionId: query.targetId },
            ],
          }),
        },
        orderBy: [{ id: 'asc' }],
      });
      return rows.map(view);
    });
  }

  get(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) =>
      view(await this.load(tx, id)),
    );
  }

  private async load(tx: Tx, id: string) {
    const row = await tx.deliveryRestriction.findFirst({ where: { id } });
    if (!row) throw notFound('Restriction');
    return row;
  }

  private async assertTarget(tx: Tx, target: CreateRestriction['target'], id: string) {
    const found =
      target === 'PRODUCT'
        ? await tx.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
        : target === 'CATEGORY'
          ? await tx.category.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
          : await tx.collection.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw notFound(target.charAt(0) + target.slice(1).toLowerCase());
  }

  async create(actor: AdminActor, brandId: string, input: CreateRestriction) {
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const market = await tx.market.findFirst({ where: { id: input.marketId, brandId } });
        if (!market) throw notFound('Market');
        await this.assertTarget(tx, input.target, input.targetId);
        if (input.condition === 'ZONE') {
          const zone = await tx.deliveryZone.findFirst({ where: { id: input.zoneId } });
          if (!zone) throw notFound('Zone');
          if (zone.marketId !== input.marketId) {
            throw new ApiException(422, 'MARKET_MISMATCH', 'The zone is in a different market');
          }
        }
        if (input.condition === 'AREA') {
          const area = await tx.deliveryArea.findFirst({ where: { id: input.areaId } });
          if (!area) throw notFound('Area');
          if (area.countryId !== market.countryId) {
            throw new ApiException(
              422,
              'AREA_COUNTRY_MISMATCH',
              "The area is not in the market's country",
            );
          }
        }
        const row = await tx.deliveryRestriction.create({
          data: {
            brandId,
            marketId: input.marketId,
            target: input.target,
            productId: input.target === 'PRODUCT' ? input.targetId : null,
            categoryId: input.target === 'CATEGORY' ? input.targetId : null,
            collectionId: input.target === 'COLLECTION' ? input.targetId : null,
            condition: input.condition,
            areaId: input.condition === 'AREA' ? input.areaId : null,
            zoneId: input.condition === 'ZONE' ? input.zoneId : null,
            dateFrom: input.condition === 'DATE_RANGE' ? toDate(input.dateFrom) : null,
            dateTo: input.condition === 'DATE_RANGE' ? toDate(input.dateTo) : null,
            weekday: input.condition === 'WEEKDAY' ? input.weekday : null,
            methodKind: input.condition === 'METHOD' ? input.methodKind : null,
            note: input.note ?? null,
            status: input.status,
          },
        });
        const out = view(row);
        await this.access.recordFor(tx, actor, {
          brandId,
          marketId: input.marketId,
          action: 'delivery.restriction.create',
          targetType: 'delivery_restriction',
          targetId: row.id,
          after: out,
        });
        return out;
      });
    } catch (err) {
      throw mapDeliveryError(err);
    }
  }

  update(
    actor: AdminActor,
    brandId: string,
    id: string,
    patch: z.infer<typeof updateRestrictionBody>,
  ) {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const before = view(await this.load(tx, id));
      const row = view(await tx.deliveryRestriction.update({ where: { id }, data: patch }));
      await this.access.recordFor(tx, actor, {
        brandId,
        marketId: row.marketId,
        action: 'delivery.restriction.update',
        targetType: 'delivery_restriction',
        targetId: id,
        before,
        after: row,
      });
      return row;
    });
  }

  remove(actor: AdminActor, brandId: string, id: string): Promise<void> {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const current = view(await this.load(tx, id));
      await tx.deliveryRestriction.delete({ where: { id } });
      await this.access.recordFor(tx, actor, {
        brandId,
        marketId: current.marketId,
        action: 'delivery.restriction.delete',
        targetType: 'delivery_restriction',
        targetId: id,
        before: current,
      });
    });
  }
}
