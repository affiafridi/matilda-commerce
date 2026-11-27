import { Injectable } from '@nestjs/common';
import { dayHoursSchema, localDateSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, notFound } from '../admin/admin-common';
import { can } from '../iam/authorization/scope';
import { DeliveryAccess, fromTime, mapDeliveryError, toTime } from './delivery-common';

type Tx = Prisma.TransactionClient;

const VIEW = ['delivery.view', 'delivery.manage', 'branches.calendar'] as const;
/** A branch's own calendar can be kept by whoever holds `branches.calendar` for that branch. */
const EDIT_BRANCH = ['branches.calendar', 'delivery.manage'] as const;

export const weeklyHoursBody = z
  .object({ days: z.array(dayHoursSchema).max(7) })
  .refine((v) => new Set(v.days.map((d) => d.weekday)).size === v.days.length, {
    message: 'Each weekday can appear only once.',
    path: ['days'],
  });

export const closureListQuery = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  marketId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

/** A closure covers the whole brand, one market, or one branch; never a market and a branch. */
export const createClosureBody = z
  .object({
    closedOn: localDateSchema,
    marketId: z.string().uuid().nullish(),
    branchId: z.string().uuid().nullish(),
    reason: z.string().trim().max(200).nullish(),
  })
  .refine((v) => !(v.marketId && v.branchId), {
    message: 'Choose a market or a branch, not both.',
    path: ['branchId'],
  });

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);

const closureView = (c: Prisma.DeliveryClosureGetPayload<object>) => ({
  id: c.id,
  closedOn: fromDate(c.closedOn),
  marketId: c.marketId,
  branchId: c.branchId,
  reason: c.reason,
});

/**
 * Opening hours and closed dates. Hours belong to one branch for one brand (a shared branch can
 * keep different hours for each brand it serves) and are local times in the branch time zone.
 * Closures cover the brand, a market, or a branch. Availability (step 4.10) reads both.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly access: DeliveryAccess) {}

  private async branchOf(tx: Tx, branchId: string) {
    const branch = await tx.branch.findFirst({ where: { id: branchId } });
    if (!branch) throw notFound('Branch');
    return branch;
  }

  private async weekOf(tx: Tx, branchId: string) {
    const rows = await tx.branchHours.findMany({
      where: { branchId },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
    return Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      ranges: rows
        .filter((r) => r.weekday === weekday)
        .map((r) => ({ start: fromTime(r.startTime), end: fromTime(r.endTime) })),
    }));
  }

  getHours(actor: AdminActor, brandId: string, branchId: string) {
    return this.access.runAt(actor, { brandId, branchId }, VIEW, async (tx) => {
      const branch = await this.branchOf(tx, branchId);
      return { branchId, timezone: branch.timezone, days: await this.weekOf(tx, branchId) };
    });
  }

  /** Replaces the whole week; a weekday that is not sent (or sent empty) is closed. */
  async putHours(
    actor: AdminActor,
    brandId: string,
    branchId: string,
    body: z.infer<typeof weeklyHoursBody>,
  ) {
    try {
      return await this.access.runAt(actor, { brandId, branchId }, EDIT_BRANCH, async (tx) => {
        const branch = await this.branchOf(tx, branchId);
        const before = await this.weekOf(tx, branchId);
        await tx.branchHours.deleteMany({ where: { branchId, brandId } });
        await tx.branchHours.createMany({
          data: body.days.flatMap((d) =>
            d.ranges.map((r) => ({
              brandId,
              branchId,
              weekday: d.weekday,
              startTime: toTime(r.start),
              endTime: toTime(r.end),
            })),
          ),
        });
        const days = await this.weekOf(tx, branchId);
        await this.access.recordFor(tx, actor, {
          brandId,
          branchId,
          action: 'delivery.hours.put',
          targetType: 'branch',
          targetId: branchId,
          before: { days: before },
          after: { days },
        });
        return { branchId, timezone: branch.timezone, days };
      });
    } catch (err) {
      throw mapDeliveryError(err);
    }
  }

  list(actor: AdminActor, brandId: string, query: z.infer<typeof closureListQuery>) {
    this.access.assertReaches(actor, brandId, VIEW);
    return this.access.runPublic(brandId, async (tx) => {
      const rows = await tx.deliveryClosure.findMany({
        where: {
          ...(query.marketId && { marketId: query.marketId }),
          ...(query.branchId && { branchId: query.branchId }),
          ...((query.from || query.to) && {
            closedOn: {
              ...(query.from && { gte: toDate(query.from) }),
              ...(query.to && { lte: toDate(query.to) }),
            },
          }),
        },
        orderBy: [{ closedOn: 'asc' }, { id: 'asc' }],
      });
      return rows
        .filter((c) =>
          VIEW.some((p) =>
            can(actor.grants, p, {
              brandId,
              marketId: c.marketId,
              branchId: c.branchId,
            }),
          ),
        )
        .map(closureView);
    });
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createClosureBody>) {
    const target = { brandId, marketId: input.marketId ?? null, branchId: input.branchId ?? null };
    try {
      return await this.access.runAt(
        actor,
        target,
        input.branchId ? EDIT_BRANCH : ['delivery.manage'],
        async (tx) => {
          if (input.marketId) {
            const market = await tx.market.findFirst({ where: { id: input.marketId, brandId } });
            if (!market) throw notFound('Market');
          }
          if (input.branchId) await this.branchOf(tx, input.branchId);
          const row = await tx.deliveryClosure.create({
            data: {
              brandId,
              marketId: input.marketId ?? null,
              branchId: input.branchId ?? null,
              closedOn: toDate(input.closedOn),
              reason: input.reason ?? null,
            },
          });
          await this.access.recordFor(tx, actor, {
            brandId,
            marketId: row.marketId,
            branchId: row.branchId,
            action: 'delivery.closure.create',
            targetType: 'delivery_closure',
            targetId: row.id,
            after: closureView(row),
          });
          return closureView(row);
        },
      );
    } catch (err) {
      throw mapDeliveryError(err);
    }
  }

  remove(actor: AdminActor, brandId: string, id: string): Promise<void> {
    this.access.assertReaches(actor, brandId, VIEW);
    return this.access.runPublic(brandId, async (tx) => {
      const row = await tx.deliveryClosure.findFirst({ where: { id } });
      if (!row) throw notFound('Closure');
      const needed = row.branchId ? EDIT_BRANCH : (['delivery.manage'] as const);
      const target = { brandId, marketId: row.marketId, branchId: row.branchId };
      if (!needed.some((p) => can(actor.grants, p, target))) {
        throw new ApiException(
          403,
          'FORBIDDEN',
          'You do not have permission to perform this action',
        );
      }
      await tx.deliveryClosure.delete({ where: { id } });
      await this.access.recordFor(tx, actor, {
        brandId,
        marketId: row.marketId,
        branchId: row.branchId,
        action: 'delivery.closure.delete',
        targetType: 'delivery_closure',
        targetId: id,
        before: closureView(row),
      });
    });
  }
}
