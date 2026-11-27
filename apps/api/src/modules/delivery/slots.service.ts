import { Injectable } from '@nestjs/common';
import {
  deliveryMethodKindSchema,
  localTimeSchema,
  minutesOfDay,
  weekdaySchema,
  z,
} from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, notFound } from '../admin/admin-common';
import { DeliveryAccess, fromTime, mapDeliveryError, toTime } from './delivery-common';

type Tx = Prisma.TransactionClient;

const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);
const uuid = z.string().uuid();

export const slotListQuery = z.object({
  marketId: uuid.optional(),
  branchId: uuid.optional(),
  zoneId: uuid.optional(),
  weekday: z.coerce.number().int().min(0).max(6).optional(),
});

const slotFields = {
  weekday: weekdaySchema,
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  /** Orders (not units) the slot accepts per date; booked count is tracked per date (step 4.8). */
  capacity: z.number().int().min(1).max(100_000),
  /** Last local time an order can still choose this slot, `cutoffDaysBefore` days before the date. */
  cutoffTime: localTimeSchema,
  cutoffDaysBefore: z.number().int().min(0).max(14),
  methods: z.array(deliveryMethodKindSchema).min(1).max(3),
  status: statusSchema,
};

export const createSlotBody = z.object({
  marketId: uuid,
  branchId: uuid,
  /** Empty means the slot applies to every zone the branch serves. */
  zoneId: uuid.nullish(),
  ...slotFields,
  cutoffDaysBefore: slotFields.cutoffDaysBefore.default(0),
  status: statusSchema.default('ACTIVE'),
});

export const updateSlotBody = z
  .object(slotFields)
  .partial()
  .extend({ zoneId: uuid.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

type SlotShape = {
  startTime: string;
  endTime: string;
  cutoffTime: string;
  cutoffDaysBefore: number;
  methods: readonly string[];
};

/** Cross-field rules shared by create and update (the database enforces the same checks). */
function assertShape(s: SlotShape): void {
  if (minutesOfDay(s.endTime) <= minutesOfDay(s.startTime)) {
    throw new ApiException(422, 'SLOT_RANGE_INVALID', 'The slot must end after it starts');
  }
  if (s.cutoffDaysBefore === 0 && minutesOfDay(s.cutoffTime) >= minutesOfDay(s.startTime)) {
    throw new ApiException(
      422,
      'SLOT_CUTOFF_INVALID',
      'A same-day cutoff must be before the slot starts',
    );
  }
  if (new Set(s.methods).size !== s.methods.length) {
    throw new ApiException(422, 'DUPLICATE_METHOD_KIND', 'Each method kind can appear only once');
  }
}

const view = (s: Prisma.DeliverySlotGetPayload<object>) => ({
  id: s.id,
  marketId: s.marketId,
  branchId: s.branchId,
  zoneId: s.zoneId,
  weekday: s.weekday,
  startTime: fromTime(s.startTime),
  endTime: fromTime(s.endTime),
  capacity: s.capacity,
  cutoffTime: fromTime(s.cutoffTime),
  cutoffDaysBefore: s.cutoffDaysBefore,
  methods: s.methods,
  status: s.status,
});

/**
 * Delivery slots: a weekly grid per branch (optionally per zone) with a capacity and an order
 * cutoff, all configuration. Times are local to the branch. This step manages the grid; the
 * booked count per date and the transactional booking arrive with reservations (step 4.8) and
 * the availability service (step 4.10) reads the grid.
 */
@Injectable()
export class SlotsService {
  constructor(private readonly access: DeliveryAccess) {}

  list(actor: AdminActor, brandId: string, query: z.infer<typeof slotListQuery>) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) => {
      const rows = await tx.deliverySlot.findMany({
        where: {
          ...(query.marketId && { marketId: query.marketId }),
          ...(query.branchId && { branchId: query.branchId }),
          ...(query.zoneId && { zoneId: query.zoneId }),
          ...(query.weekday !== undefined && { weekday: query.weekday }),
        },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
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
    const row = await tx.deliverySlot.findFirst({ where: { id } });
    if (!row) throw notFound('Slot');
    return row;
  }

  private async assertZone(tx: Tx, zoneId: string | null | undefined, marketId: string) {
    if (!zoneId) return;
    const zone = await tx.deliveryZone.findFirst({ where: { id: zoneId } });
    if (!zone) throw notFound('Zone');
    if (zone.marketId !== marketId) {
      throw new ApiException(422, 'MARKET_MISMATCH', 'The zone is in a different market');
    }
  }

  private async assertUnique(
    tx: Tx,
    s: { branchId: string; zoneId: string | null; weekday: number; startTime: Date; endTime: Date },
    exceptId?: string,
  ) {
    const clash = await tx.deliverySlot.findFirst({
      where: {
        branchId: s.branchId,
        zoneId: s.zoneId,
        weekday: s.weekday,
        startTime: s.startTime,
        endTime: s.endTime,
        ...(exceptId && { id: { not: exceptId } }),
      },
    });
    if (clash) {
      throw new ApiException(
        409,
        'SLOT_EXISTS',
        'That branch, zone, day and time already has a slot',
      );
    }
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createSlotBody>) {
    assertShape(input);
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const market = await tx.market.findFirst({ where: { id: input.marketId, brandId } });
        if (!market) throw notFound('Market');
        if (!(await tx.branch.findFirst({ where: { id: input.branchId } })))
          throw notFound('Branch');
        await this.assertZone(tx, input.zoneId, input.marketId);
        const data = {
          brandId,
          marketId: input.marketId,
          branchId: input.branchId,
          zoneId: input.zoneId ?? null,
          weekday: input.weekday,
          startTime: toTime(input.startTime),
          endTime: toTime(input.endTime),
          capacity: input.capacity,
          cutoffTime: toTime(input.cutoffTime),
          cutoffDaysBefore: input.cutoffDaysBefore,
          methods: input.methods,
          status: input.status,
        };
        await this.assertUnique(tx, data);
        const row = view(await tx.deliverySlot.create({ data }));
        await this.access.recordFor(tx, actor, {
          brandId,
          marketId: input.marketId,
          branchId: input.branchId,
          action: 'delivery.slot.create',
          targetType: 'delivery_slot',
          targetId: row.id,
          after: row,
        });
        return row;
      });
    } catch (err) {
      throw mapDeliveryError(err);
    }
  }

  async update(
    actor: AdminActor,
    brandId: string,
    id: string,
    patch: z.infer<typeof updateSlotBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const current = await this.load(tx, id);
        const before = view(current);
        const merged = { ...before, ...patch };
        assertShape(merged);
        const zoneId = merged.zoneId ?? null;
        await this.assertZone(tx, zoneId, current.marketId);
        const data = {
          weekday: merged.weekday,
          startTime: toTime(merged.startTime),
          endTime: toTime(merged.endTime),
          capacity: merged.capacity,
          cutoffTime: toTime(merged.cutoffTime),
          cutoffDaysBefore: merged.cutoffDaysBefore,
          methods: merged.methods,
          status: merged.status,
          zoneId,
        };
        await this.assertUnique(tx, { branchId: current.branchId, ...data }, id);
        const row = view(await tx.deliverySlot.update({ where: { id }, data }));
        await this.access.recordFor(tx, actor, {
          brandId,
          marketId: current.marketId,
          branchId: current.branchId,
          action: 'delivery.slot.update',
          targetType: 'delivery_slot',
          targetId: id,
          before,
          after: row,
        });
        return row;
      });
    } catch (err) {
      throw mapDeliveryError(err);
    }
  }

  remove(actor: AdminActor, brandId: string, id: string): Promise<void> {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const current = await this.load(tx, id);
      const [days, reservations] = await Promise.all([
        tx.slotDay.count({ where: { slotId: id } }),
        tx.slotReservation.count({ where: { slotId: id } }),
      ]);
      if (days + reservations > 0) {
        throw new ApiException(
          409,
          'SLOT_IN_USE',
          'The slot has bookings on record; set it inactive instead',
        );
      }
      await tx.deliverySlot.delete({ where: { id } });
      await this.access.recordFor(tx, actor, {
        brandId,
        marketId: current.marketId,
        branchId: current.branchId,
        action: 'delivery.slot.delete',
        targetType: 'delivery_slot',
        targetId: id,
        before: view(current),
      });
    });
  }
}
