import { Injectable } from '@nestjs/common';
import { localDateSchema, quantitySchema, weekdayOfLocalDate, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Tx } from '../admin/brand-access';
import { type AdminActor, assertCan, notFound } from '../admin/admin-common';
import { InventoryAccess } from './inventory-common';

const uuid = z.string().uuid();
const MINUTE = 60_000;

/**
 * What a checkout holds while the shopper pays: stock lines (rows chosen by branch assignment),
 * and optionally one delivery slot on a date. Made-to-order carts hold only the slot; carts of
 * ready stock may hold no slot.
 */
export const holdInput = z
  .object({
    brandId: uuid,
    marketId: uuid,
    /** The checkout's own id; the same id later confirms, releases or extends the hold. */
    checkoutRef: z.string().trim().min(1).max(120),
    lines: z
      .array(z.object({ stockLevelId: uuid, quantity: quantitySchema }))
      .max(100)
      .default([]),
    slot: z
      .object({ slotId: uuid, date: localDateSchema, units: quantitySchema.default(1) })
      .optional(),
  })
  .refine((v) => v.lines.length > 0 || v.slot, { message: 'Hold stock, a slot, or both.' })
  .refine((v) => new Set(v.lines.map((l) => l.stockLevelId)).size === v.lines.length, {
    message: 'Each stock row can appear once.',
    path: ['lines'],
  });
export type HoldInput = z.input<typeof holdInput>;

export const reservationListQuery = z.object({
  status: z.enum(['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED']).default('ACTIVE'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

type Why = 'RELEASED' | 'EXPIRED';

/**
 * Stock and slot reservations. Every change is one transaction of atomic conditional updates:
 * a stock hold only succeeds while `on_hand - reserved >= quantity` (or the row allows backorder),
 * a slot hold only while `booked + units <= capacity`, and a hold changes state once, from ACTIVE.
 * Two checkouts racing for the last unit or the last place cannot both win. Reserving and
 * releasing move `reserved`/`booked`; confirming turns a stock hold into a SALE ledger movement.
 * Called by checkout (Phase 5) and by the expiry sweep; staff can list and release holds.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InventoryAccess,
  ) {}

  private scoped<T>(brandId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withScope(this.prisma.client, { brandIds: [brandId] }, fn);
  }

  private async windowOf(tx: Tx, brandId: string) {
    const s = await tx.inventorySetting.findFirst({ where: { brandId } });
    return { minutes: s?.reservationMinutes ?? 15, maxExtensions: s?.maxExtensions ?? 1 };
  }

  // Hold -------------------------------------------------------------------------------------

  async hold(raw: HoldInput, now = new Date()) {
    const input = holdInput.parse(raw);
    return this.scoped(input.brandId, async (tx) => {
      // One checkout, one hold: serialise concurrent calls with the same ref, then refuse a repeat.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.checkoutRef}))`;
      const open =
        (await tx.stockReservation.count({
          where: { checkoutRef: input.checkoutRef, status: 'ACTIVE' },
        })) +
        (await tx.slotReservation.count({
          where: { checkoutRef: input.checkoutRef, status: 'ACTIVE' },
        }));
      if (open > 0) {
        throw new ApiException(
          409,
          'RESERVATION_EXISTS',
          'This checkout already holds a reservation',
        );
      }
      const market = await tx.market.findFirst({
        where: { id: input.marketId, brandId: input.brandId },
      });
      if (!market) throw notFound('Market');
      const { minutes } = await this.windowOf(tx, input.brandId);
      const expiresAt = new Date(now.getTime() + minutes * MINUTE);

      let stock: {
        reservationId: string;
        lines: { stockLevelId: string; quantity: number }[];
      } | null = null;
      if (input.lines.length > 0) {
        const reservation = await tx.stockReservation.create({
          data: {
            brandId: input.brandId,
            marketId: input.marketId,
            checkoutRef: input.checkoutRef,
            expiresAt,
            createdAt: now,
          },
        });
        // Lock rows in a fixed order so two checkouts holding the same items cannot deadlock.
        const lines = [...input.lines].sort((a, b) => a.stockLevelId.localeCompare(b.stockLevelId));
        for (const line of lines) {
          const exists = await tx.stockLevel.findFirst({ where: { id: line.stockLevelId } });
          if (!exists) throw notFound('Stock');
          const changed = await tx.$executeRaw`
            UPDATE stock_level SET reserved = reserved + ${line.quantity}, updated_at = now()
             WHERE id = ${line.stockLevelId}::uuid AND brand_id = ${input.brandId}::uuid
               AND (on_hand - reserved >= ${line.quantity} OR out_of_stock = 'ALLOW_BACKORDER')`;
          if (changed !== 1) {
            throw new ApiException(409, 'INSUFFICIENT_STOCK', 'Not enough stock is available');
          }
        }
        await tx.stockReservationLine.createMany({
          data: lines.map((l) => ({
            reservationId: reservation.id,
            brandId: input.brandId,
            stockLevelId: l.stockLevelId,
            quantity: l.quantity,
          })),
        });
        stock = { reservationId: reservation.id, lines };
      }

      let slot: { reservationId: string; slotId: string; date: string; units: number } | null =
        null;
      if (input.slot) {
        const { slotId, date, units } = input.slot;
        const row = await tx.deliverySlot.findFirst({
          where: { id: slotId, marketId: input.marketId, status: 'ACTIVE' },
        });
        if (!row) throw notFound('Slot');
        if (row.weekday !== weekdayOfLocalDate(date)) {
          throw new ApiException(
            422,
            'SLOT_DATE_MISMATCH',
            'The slot does not run on that weekday',
          );
        }
        await tx.$executeRaw`
          INSERT INTO slot_day (brand_id, slot_id, delivery_date, booked)
          VALUES (${input.brandId}::uuid, ${slotId}::uuid, ${date}::date, 0)
          ON CONFLICT (slot_id, delivery_date) DO NOTHING`;
        const changed = await tx.$executeRaw`
          UPDATE slot_day SET booked = booked + ${units}
           WHERE slot_id = ${slotId}::uuid AND delivery_date = ${date}::date
             AND booked + ${units} <= ${row.capacity}`;
        if (changed !== 1) {
          throw new ApiException(409, 'SLOT_FULL', 'That delivery slot is full');
        }
        const created = await tx.slotReservation.create({
          data: {
            brandId: input.brandId,
            slotId,
            deliveryDate: new Date(`${date}T00:00:00.000Z`),
            units,
            checkoutRef: input.checkoutRef,
            expiresAt,
            createdAt: now,
          },
        });
        slot = { reservationId: created.id, slotId, date, units };
      }
      return { checkoutRef: input.checkoutRef, expiresAt: expiresAt.toISOString(), stock, slot };
    });
  }

  // Extend -----------------------------------------------------------------------------------

  /**
   * Gives an open hold another window from now, up to the brand's limit: the whole life of a hold
   * cannot exceed `(extensions + 1)` windows. Used when payment begins.
   */
  async extend(brandId: string, checkoutRef: string, now = new Date()) {
    return this.scoped(brandId, async (tx) => {
      const { minutes, maxExtensions } = await this.windowOf(tx, brandId);
      const stock = await tx.stockReservation.findMany({
        where: { checkoutRef, status: 'ACTIVE', expiresAt: { gt: now } },
      });
      const slots = await tx.slotReservation.findMany({
        where: { checkoutRef, status: 'ACTIVE', expiresAt: { gt: now } },
      });
      if (stock.length + slots.length === 0) throw notFound('Reservation');
      const next = (createdAt: Date, expiresAt: Date) => {
        const ceiling = createdAt.getTime() + minutes * MINUTE * (maxExtensions + 1);
        const target = Math.min(now.getTime() + minutes * MINUTE, ceiling);
        return target > expiresAt.getTime() ? new Date(target) : null;
      };
      const plan = [
        ...stock.map((r) => ({
          kind: 'stock' as const,
          id: r.id,
          to: next(r.createdAt, r.expiresAt),
        })),
        ...slots.map((r) => ({
          kind: 'slot' as const,
          id: r.id,
          to: next(r.createdAt, r.expiresAt),
        })),
      ];
      if (plan.some((p) => !p.to)) {
        throw new ApiException(409, 'EXTENSION_LIMIT', 'This reservation cannot be extended again');
      }
      for (const p of plan) {
        const to = p.to as Date;
        if (p.kind === 'stock') {
          await tx.$executeRaw`UPDATE stock_reservation SET expires_at = ${to}, extended_count = extended_count + 1
                                WHERE id = ${p.id}::uuid AND status = 'ACTIVE'`;
        } else {
          await tx.$executeRaw`UPDATE slot_reservation SET expires_at = ${to}
                                WHERE id = ${p.id}::uuid AND status = 'ACTIVE'`;
        }
      }
      return {
        checkoutRef,
        expiresAt: plan
          .map((p) => p.to as Date)
          .sort((a, b) => a.getTime() - b.getTime())[0]!
          .toISOString(),
      };
    });
  }

  // Confirm ----------------------------------------------------------------------------------

  /**
   * Turns the hold into a sale once payment is confirmed: stock moves out through a SALE movement
   * (on-hand and reserved both fall) and the slot place stays booked. Repeating the call for a
   * checkout that is already confirmed does nothing.
   */
  async confirm(brandId: string, checkoutRef: string, orderRef: string, now = new Date()) {
    return this.scoped(brandId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${checkoutRef}))`;
      const stock = await tx.stockReservation.findMany({
        where: { checkoutRef, status: 'ACTIVE' },
        include: { lines: true },
      });
      const slots = await tx.slotReservation.findMany({ where: { checkoutRef, status: 'ACTIVE' } });
      if (stock.length + slots.length === 0) {
        const done =
          (await tx.stockReservation.count({ where: { checkoutRef, status: 'COMMITTED' } })) +
          (await tx.slotReservation.count({ where: { checkoutRef, status: 'COMMITTED' } }));
        if (done > 0) return { checkoutRef, alreadyConfirmed: true };
        throw notFound('Reservation');
      }
      if ([...stock, ...slots].some((r) => r.expiresAt <= now)) {
        throw new ApiException(409, 'RESERVATION_EXPIRED', 'The reservation has expired');
      }
      for (const r of stock) {
        const moved =
          await tx.$executeRaw`UPDATE stock_reservation SET status = 'COMMITTED', committed_at = ${now}
                                             WHERE id = ${r.id}::uuid AND status = 'ACTIVE'`;
        if (moved !== 1)
          throw new ApiException(409, 'RESERVATION_CHANGED', 'The reservation changed');
        for (const line of [...r.lines].sort((a, b) =>
          a.stockLevelId.localeCompare(b.stockLevelId),
        )) {
          const locked = await tx.$queryRaw<{ on_hand: number; reserved: number }[]>`
            SELECT on_hand, reserved FROM stock_level
             WHERE id = ${line.stockLevelId}::uuid FOR UPDATE`;
          const row = locked[0];
          if (!row || row.reserved < line.quantity) {
            throw new ApiException(409, 'RESERVATION_CHANGED', 'The stock row changed');
          }
          // A backorder line can be larger than what is on hand; only real units leave the shelf.
          const removed = Math.min(line.quantity, row.on_hand);
          const level = await tx.stockLevel.update({
            where: { id: line.stockLevelId },
            data: { onHand: row.on_hand - removed, reserved: row.reserved - line.quantity },
          });
          if (removed > 0) {
            await tx.stockMovement.create({
              data: {
                brandId,
                stockLevelId: line.stockLevelId,
                type: 'SALE',
                quantity: removed,
                onHandAfter: level.onHand,
                reservedAfter: level.reserved,
                referenceType: 'order',
                referenceId: orderRef,
              },
            });
          }
        }
      }
      for (const r of slots) {
        await tx.$executeRaw`UPDATE slot_reservation SET status = 'COMMITTED' WHERE id = ${r.id}::uuid AND status = 'ACTIVE'`;
      }
      return { checkoutRef, alreadyConfirmed: false };
    });
  }

  // Release and expire -----------------------------------------------------------------------

  private async close(tx: Tx, checkoutRef: string, why: Why, now: Date, onlyDue: boolean) {
    let released = 0;
    const stock = await tx.stockReservation.findMany({
      where: { checkoutRef, status: 'ACTIVE', ...(onlyDue && { expiresAt: { lte: now } }) },
      include: { lines: true },
    });
    for (const r of stock) {
      const moved =
        await tx.$executeRaw`UPDATE stock_reservation SET status = ${why}::"ReservationStatus", released_at = ${now}
                                           WHERE id = ${r.id}::uuid AND status = 'ACTIVE'`;
      if (moved !== 1) continue;
      for (const line of [...r.lines].sort((a, b) =>
        a.stockLevelId.localeCompare(b.stockLevelId),
      )) {
        await tx.$executeRaw`UPDATE stock_level SET reserved = GREATEST(reserved - ${line.quantity}, 0), updated_at = now()
                              WHERE id = ${line.stockLevelId}::uuid`;
      }
      released++;
    }
    const slots = await tx.slotReservation.findMany({
      where: { checkoutRef, status: 'ACTIVE', ...(onlyDue && { expiresAt: { lte: now } }) },
    });
    for (const r of slots) {
      const moved =
        await tx.$executeRaw`UPDATE slot_reservation SET status = ${why}::"ReservationStatus"
                                           WHERE id = ${r.id}::uuid AND status = 'ACTIVE'`;
      if (moved !== 1) continue;
      await tx.$executeRaw`UPDATE slot_day SET booked = GREATEST(booked - ${r.units}, 0)
                            WHERE slot_id = ${r.slotId}::uuid AND delivery_date = ${r.deliveryDate.toISOString().slice(0, 10)}::date`;
      released++;
    }
    return released;
  }

  /** Frees everything a checkout holds (cancelled or failed payment). Safe to repeat. */
  release(brandId: string, checkoutRef: string, now = new Date()) {
    return this.scoped(brandId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${checkoutRef}))`;
      return { checkoutRef, released: await this.close(tx, checkoutRef, 'RELEASED', now, false) };
    });
  }

  /**
   * Expires every hold whose time is up, in every brand. Run by the background job; safe to run
   * at any time and from several workers (each hold changes state once). Returns how many it freed.
   */
  async expireDue(now = new Date(), batch = 200): Promise<number> {
    const due = await withScope(
      this.prisma.client,
      { brandIds: [], platform: true },
      async (tx) => {
        const stock = await tx.stockReservation.findMany({
          where: { status: 'ACTIVE', expiresAt: { lte: now } },
          select: { brandId: true, checkoutRef: true },
          take: batch,
        });
        const slots = await tx.slotReservation.findMany({
          where: { status: 'ACTIVE', expiresAt: { lte: now } },
          select: { brandId: true, checkoutRef: true },
          take: batch,
        });
        const seen = new Map<string, { brandId: string; checkoutRef: string }>();
        for (const r of [...stock, ...slots]) seen.set(`${r.brandId}:${r.checkoutRef}`, r);
        return [...seen.values()];
      },
    );
    let freed = 0;
    for (const { brandId, checkoutRef } of due) {
      freed += await this.scoped(brandId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${checkoutRef}))`;
        return this.close(tx, checkoutRef, 'EXPIRED', now, true);
      });
    }
    return freed;
  }

  // Staff ------------------------------------------------------------------------------------

  /** Open (or filtered) holds of the brand, for staff to spot leaks. Brand-wide permission. */
  async list(actor: AdminActor, brandId: string, query: z.infer<typeof reservationListQuery>) {
    return this.access.run(actor, brandId, 'inventory.view', async (tx) => {
      const [stock, slots] = await Promise.all([
        tx.stockReservation.findMany({
          where: { status: query.status },
          include: { lines: true },
          orderBy: { expiresAt: 'asc' },
          take: query.limit,
        }),
        tx.slotReservation.findMany({
          where: { status: query.status },
          orderBy: { expiresAt: 'asc' },
          take: query.limit,
        }),
      ]);
      return {
        stock: stock.map((r) => ({
          id: r.id,
          marketId: r.marketId,
          status: r.status,
          checkoutRef: r.checkoutRef,
          expiresAt: r.expiresAt.toISOString(),
          extendedCount: r.extendedCount,
          lines: r.lines.map((l) => ({ stockLevelId: l.stockLevelId, quantity: l.quantity })),
        })),
        slots: slots.map((r) => ({
          id: r.id,
          status: r.status,
          checkoutRef: r.checkoutRef,
          slotId: r.slotId,
          date: r.deliveryDate.toISOString().slice(0, 10),
          units: r.units,
          expiresAt: r.expiresAt.toISOString(),
        })),
      };
    });
  }

  /** Staff release of a stuck hold. Needs inventory.adjust over the whole brand. */
  async releaseByStaff(actor: AdminActor, brandId: string, checkoutRef: string) {
    assertCan(actor.grants, 'inventory.adjust', { brandId });
    const result = await this.release(brandId, checkoutRef);
    if (result.released === 0) throw notFound('Reservation');
    await this.scoped(brandId, (tx) =>
      this.access.recordFor(tx, actor, {
        brandId,
        action: 'inventory.reservation.release',
        targetType: 'reservation',
        targetId: checkoutRef,
        after: { released: result.released },
      }),
    );
    return result;
  }
}
