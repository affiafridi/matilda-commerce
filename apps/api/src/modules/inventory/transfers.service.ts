import { Injectable } from '@nestjs/common';
import { MAX_STOCK_QUANTITY, quantitySchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, notFound, paginate, pageQuery, uuid } from '../admin/admin-common';
import type { Tx } from '../admin/brand-access';
import { can } from '../iam/authorization/scope';
import { InventoryAccess, mapInventoryError } from './inventory-common';

const TRANSFER = ['inventory.transfer'] as const;
const VIEW = ['inventory.view', 'inventory.transfer'] as const;

const itemKey = (productId: string, variationId: string | null | undefined) =>
  `${productId}:${variationId ?? ''}`;

export const createTransferBody = z
  .object({
    fromBranchId: uuid,
    toBranchId: uuid,
    note: z.string().trim().min(1).max(500).optional(),
    lines: z
      .array(
        z.object({
          productId: uuid,
          variationId: uuid.optional(),
          quantity: quantitySchema,
        }),
      )
      .min(1)
      .max(100),
  })
  .refine((b) => b.fromBranchId !== b.toBranchId, {
    message: 'A transfer needs two different branches',
    path: ['toBranchId'],
  })
  .refine(
    (b) => new Set(b.lines.map((l) => itemKey(l.productId, l.variationId))).size === b.lines.length,
    {
      message: 'An item can appear on a transfer only once',
      path: ['lines'],
    },
  );

/** Quantities actually put on the vehicle; lines left out are shipped as requested. */
export const shipTransferBody = z.object({
  lines: z
    .array(z.object({ lineId: uuid, quantity: z.number().int().min(0).max(MAX_STOCK_QUANTITY) }))
    .max(100)
    .default([]),
});

/** Quantities counted at the destination; lines left out are received as shipped. */
export const receiveTransferBody = z.object({
  lines: z
    .array(
      z.object({
        lineId: uuid,
        quantity: z.number().int().min(0).max(MAX_STOCK_QUANTITY),
        note: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .max(100)
    .default([]),
});

export const cancelTransferBody = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const transferListQuery = pageQuery.extend({
  status: z.enum(['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).optional(),
  branchId: uuid.optional(),
  discrepancy: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

type TransferRow = Prisma.StockTransferGetPayload<{ include: { lines: true } }>;

const transferView = (t: TransferRow) => {
  const lines = [...t.lines]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((l) => {
      const discrepancy =
        l.quantityShipped != null &&
        l.quantityReceived != null &&
        l.quantityShipped !== l.quantityReceived;
      return {
        id: l.id,
        productId: l.productId,
        variationId: l.variationId,
        quantityRequested: l.quantityRequested,
        quantityShipped: l.quantityShipped,
        quantityReceived: l.quantityReceived,
        discrepancy,
        difference: discrepancy ? (l.quantityReceived ?? 0) - (l.quantityShipped ?? 0) : 0,
        discrepancyNote: l.discrepancyNote,
      };
    });
  return {
    id: t.id,
    fromBranchId: t.fromBranchId,
    toBranchId: t.toBranchId,
    status: t.status,
    note: t.note,
    requestedById: t.requestedById,
    shippedAt: t.shippedAt?.toISOString() ?? null,
    receivedAt: t.receivedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    hasDiscrepancy: lines.some((l) => l.discrepancy),
    lines,
  };
};

/**
 * Stock transfers between two branches of a brand (D4-16): requested, in transit, received (or
 * cancelled before it ships). Nothing moves at the request. Shipping takes the shipped quantity out
 * of the sending branch (ledger `TRANSFER_OUT`); receiving adds the counted quantity to the
 * receiving branch (`TRANSFER_IN`, creating its stock row when it has none). A difference between
 * what was shipped and what arrived is kept on the line with a required note and is visible in the
 * list (`discrepancy=true`); the ledger shows both sides, so stock is never created or lost
 * silently. A transfer is locked while it changes state, so a repeated or parallel call changes
 * nothing twice.
 */
@Injectable()
export class TransfersService {
  constructor(private readonly access: InventoryAccess) {}

  private canAt(
    actor: AdminActor,
    brandId: string,
    branchId: string,
    permissions: readonly string[],
  ) {
    return permissions.some((p) => can(actor.grants, p, { brandId, branchId }));
  }

  private requireAt(
    actor: AdminActor,
    brandId: string,
    branchIds: readonly string[],
    permissions: readonly string[],
  ): void {
    if (!branchIds.some((b) => this.canAt(actor, brandId, b, permissions))) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
  }

  private async load(tx: Tx, id: string, lock: boolean): Promise<TransferRow> {
    if (lock) {
      await tx.$queryRaw`SELECT id FROM stock_transfer WHERE id = ${id}::uuid FOR UPDATE`;
    }
    const row = await tx.stockTransfer.findFirst({ where: { id }, include: { lines: true } });
    if (!row) throw notFound('Transfer');
    return row;
  }

  private async audit(
    tx: Tx,
    actor: AdminActor,
    t: { id: string; brandId: string; fromBranchId: string; toBranchId: string },
    action: string,
    before: unknown,
    after: unknown,
  ) {
    await this.access.recordFor(tx, actor, {
      brandId: t.brandId,
      branchId: t.fromBranchId,
      action: `inventory.transfer.${action}`,
      targetType: 'stock_transfer',
      targetId: t.id,
      before,
      after,
    });
  }

  async list(actor: AdminActor, brandId: string, query: z.infer<typeof transferListQuery>) {
    this.access.assertReaches(actor, brandId, VIEW);
    return this.access.runPublic(brandId, async (tx) => {
      const rows = await tx.stockTransfer.findMany({
        where: {
          ...(query.status && { status: query.status }),
          ...(query.branchId && {
            OR: [{ fromBranchId: query.branchId }, { toBranchId: query.branchId }],
          }),
        },
        include: { lines: true },
        orderBy: { id: 'desc' },
      });
      const visible = rows
        .filter(
          (t) =>
            this.canAt(actor, brandId, t.fromBranchId, VIEW) ||
            this.canAt(actor, brandId, t.toBranchId, VIEW),
        )
        .map(transferView)
        .filter((t) => query.discrepancy === undefined || t.hasDiscrepancy === query.discrepancy);
      return paginate(visible, query.page, query.pageSize);
    });
  }

  async get(actor: AdminActor, brandId: string, id: string) {
    this.access.assertReaches(actor, brandId, VIEW);
    return this.access.runPublic(brandId, async (tx) => {
      const t = await this.load(tx, id, false);
      this.requireAt(actor, brandId, [t.fromBranchId, t.toBranchId], VIEW);
      return transferView(t);
    });
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createTransferBody>) {
    this.access.assertReaches(actor, brandId, TRANSFER);
    this.requireAt(actor, brandId, [input.fromBranchId, input.toBranchId], TRANSFER);
    try {
      return await this.access.runPublic(brandId, async (tx) => {
        for (const branchId of [input.fromBranchId, input.toBranchId]) {
          if (!(await tx.branch.findFirst({ where: { id: branchId } }))) throw notFound('Branch');
        }
        for (const line of input.lines) {
          const product = await tx.product.findFirst({
            where: { id: line.productId, deletedAt: null },
          });
          if (!product) throw notFound('Product');
          if (
            line.variationId &&
            !(await tx.variation.findFirst({
              where: { id: line.variationId, productId: line.productId },
            }))
          ) {
            throw notFound('Variation');
          }
        }
        const head = await tx.stockTransfer.create({
          data: {
            brandId,
            fromBranchId: input.fromBranchId,
            toBranchId: input.toBranchId,
            note: input.note ?? null,
            requestedById: actor.staffId,
          },
        });
        await tx.stockTransferLine.createMany({
          data: input.lines.map((l) => ({
            transferId: head.id,
            brandId,
            productId: l.productId,
            variationId: l.variationId ?? null,
            quantityRequested: l.quantity,
          })),
        });
        const created = await this.load(tx, head.id, false);
        const out = transferView(created);
        await this.audit(tx, actor, created, 'request', null, out);
        return out;
      });
    } catch (err) {
      throw mapInventoryError(err);
    }
  }

  private stateError(t: { status: string }, wanted: string): ApiException {
    return new ApiException(
      409,
      'TRANSFER_STATE',
      `A transfer that is ${t.status.toLowerCase().replace('_', ' ')} cannot be ${wanted}`,
    );
  }

  /** Locks stock rows in id order so two transfers touching the same rows cannot deadlock. */
  private async lockRows(tx: Tx, ids: readonly string[]): Promise<void> {
    for (const id of [...ids].sort()) {
      await tx.$queryRaw`SELECT id FROM stock_level WHERE id = ${id}::uuid FOR UPDATE`;
    }
  }

  async ship(
    actor: AdminActor,
    brandId: string,
    id: string,
    body: z.infer<typeof shipTransferBody>,
  ) {
    this.access.assertReaches(actor, brandId, TRANSFER);
    try {
      return await this.access.runPublic(brandId, async (tx) => {
        const before = await this.load(tx, id, true);
        this.requireAt(actor, brandId, [before.fromBranchId], TRANSFER);
        if (before.status !== 'REQUESTED') throw this.stateError(before, 'shipped');
        const given = new Map(body.lines.map((l) => [l.lineId, l.quantity]));
        for (const lineId of given.keys()) {
          if (!before.lines.some((l) => l.id === lineId)) throw notFound('Transfer line');
        }
        const plan = before.lines.map((l) => {
          const quantity = given.get(l.id) ?? l.quantityRequested;
          if (quantity > l.quantityRequested) {
            throw new ApiException(
              422,
              'SHIPPED_EXCEEDS_REQUESTED',
              'A line cannot ship more than was requested',
            );
          }
          return { line: l, quantity };
        });
        if (plan.every((p) => p.quantity === 0)) {
          throw new ApiException(
            422,
            'NOTHING_TO_SHIP',
            'Ship at least one unit or cancel the transfer',
          );
        }
        const rows = await tx.stockLevel.findMany({
          where: { branchId: before.fromBranchId },
        });
        const rowOf = (p: (typeof plan)[number]) =>
          rows.find(
            (r) =>
              itemKey(r.productId ?? '', r.variationId) ===
              itemKey(p.line.productId, p.line.variationId),
          );
        const moving = plan.filter((p) => p.quantity > 0);
        for (const p of moving) {
          if (!rowOf(p)) {
            throw new ApiException(
              404,
              'STOCK_NOT_FOUND',
              'The sending branch does not track stock for an item on this transfer',
            );
          }
        }
        await this.lockRows(
          tx,
          moving.map((p) => rowOf(p)!.id),
        );
        for (const p of [...moving].sort((a, b) => rowOf(a)!.id.localeCompare(rowOf(b)!.id))) {
          const row = await tx.stockLevel.findUniqueOrThrow({ where: { id: rowOf(p)!.id } });
          const onHand = row.onHand - p.quantity;
          if (onHand < 0) {
            throw new ApiException(409, 'INSUFFICIENT_STOCK', 'There is not enough stock on hand');
          }
          if (onHand < row.reserved && row.outOfStock !== 'ALLOW_BACKORDER') {
            throw new ApiException(
              409,
              'STOCK_RESERVED',
              'That much stock is already reserved for open checkouts',
            );
          }
          const updated = await tx.stockLevel.update({ where: { id: row.id }, data: { onHand } });
          await tx.stockMovement.create({
            data: {
              brandId,
              stockLevelId: row.id,
              type: 'TRANSFER_OUT',
              quantity: p.quantity,
              onHandAfter: updated.onHand,
              reservedAfter: updated.reserved,
              referenceType: 'transfer',
              referenceId: id,
              transferId: id,
              actorStaffId: actor.staffId,
            },
          });
        }
        for (const p of plan) {
          await tx.stockTransferLine.update({
            where: { id: p.line.id },
            data: { quantityShipped: p.quantity },
          });
        }
        await tx.stockTransfer.update({
          where: { id },
          data: { status: 'IN_TRANSIT', shippedAt: new Date() },
        });
        const out = transferView(await this.load(tx, id, false));
        await this.audit(tx, actor, before, 'ship', { status: before.status }, out);
        return out;
      });
    } catch (err) {
      throw mapInventoryError(err);
    }
  }

  async receive(
    actor: AdminActor,
    brandId: string,
    id: string,
    body: z.infer<typeof receiveTransferBody>,
  ) {
    this.access.assertReaches(actor, brandId, TRANSFER);
    try {
      return await this.access.runPublic(brandId, async (tx) => {
        const before = await this.load(tx, id, true);
        this.requireAt(actor, brandId, [before.toBranchId], TRANSFER);
        if (before.status !== 'IN_TRANSIT') throw this.stateError(before, 'received');
        const given = new Map(body.lines.map((l) => [l.lineId, l]));
        for (const lineId of given.keys()) {
          if (!before.lines.some((l) => l.id === lineId)) throw notFound('Transfer line');
        }
        const plan = before.lines.map((l) => {
          const shipped = l.quantityShipped ?? 0;
          const entry = given.get(l.id);
          const quantity = entry?.quantity ?? shipped;
          if (quantity !== shipped && !entry?.note) {
            throw new ApiException(
              422,
              'DISCREPANCY_NOTE_REQUIRED',
              'Explain the difference between shipped and received quantities',
            );
          }
          return { line: l, quantity, note: quantity !== shipped ? (entry?.note ?? null) : null };
        });
        const setting = await tx.inventorySetting.findFirst({ where: { brandId } });
        const backorder = setting?.defaultOutOfStock === 'ALLOW_BACKORDER';
        const arriving = plan.filter((p) => p.quantity > 0);
        for (const p of arriving) {
          const exists = await tx.stockLevel.findFirst({
            where: {
              branchId: before.toBranchId,
              productId: p.line.productId,
              variationId: p.line.variationId,
            },
          });
          if (!exists) {
            // A parallel transfer may create the same row; the duplicate is simply skipped.
            await tx.stockLevel.createMany({
              data: [
                {
                  brandId,
                  branchId: before.toBranchId,
                  productId: p.line.productId,
                  variationId: p.line.variationId,
                  outOfStock: backorder ? 'ALLOW_BACKORDER' : null,
                },
              ],
              skipDuplicates: true,
            });
          }
        }
        const target = await tx.stockLevel.findMany({ where: { branchId: before.toBranchId } });
        const rowOf = (p: (typeof plan)[number]) =>
          target.find(
            (r) =>
              itemKey(r.productId ?? '', r.variationId) ===
              itemKey(p.line.productId, p.line.variationId),
          )!;
        await this.lockRows(
          tx,
          arriving.map((p) => rowOf(p).id),
        );
        for (const p of [...arriving].sort((a, b) => rowOf(a).id.localeCompare(rowOf(b).id))) {
          const row = await tx.stockLevel.findUniqueOrThrow({ where: { id: rowOf(p).id } });
          const onHand = row.onHand + p.quantity;
          if (onHand > MAX_STOCK_QUANTITY) {
            throw new ApiException(
              422,
              'QUANTITY_TOO_LARGE',
              'On-hand stock cannot exceed one million units',
            );
          }
          const updated = await tx.stockLevel.update({ where: { id: row.id }, data: { onHand } });
          await tx.stockMovement.create({
            data: {
              brandId,
              stockLevelId: row.id,
              type: 'TRANSFER_IN',
              quantity: p.quantity,
              onHandAfter: updated.onHand,
              reservedAfter: updated.reserved,
              reason: p.note,
              referenceType: 'transfer',
              referenceId: id,
              transferId: id,
              actorStaffId: actor.staffId,
            },
          });
        }
        for (const p of plan) {
          await tx.stockTransferLine.update({
            where: { id: p.line.id },
            data: { quantityReceived: p.quantity, discrepancyNote: p.note },
          });
        }
        await tx.stockTransfer.update({
          where: { id },
          data: { status: 'RECEIVED', receivedAt: new Date() },
        });
        const out = transferView(await this.load(tx, id, false));
        await this.audit(tx, actor, before, 'receive', { status: before.status }, out);
        return out;
      });
    } catch (err) {
      throw mapInventoryError(err);
    }
  }

  async cancel(
    actor: AdminActor,
    brandId: string,
    id: string,
    body: z.infer<typeof cancelTransferBody>,
  ) {
    this.access.assertReaches(actor, brandId, TRANSFER);
    return this.access.runPublic(brandId, async (tx) => {
      const before = await this.load(tx, id, true);
      this.requireAt(actor, brandId, [before.fromBranchId, before.toBranchId], TRANSFER);
      if (before.status !== 'REQUESTED') throw this.stateError(before, 'cancelled');
      await tx.stockTransfer.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          ...(body.reason && {
            note: [before.note, `Cancelled: ${body.reason}`].filter(Boolean).join('\n'),
          }),
        },
      });
      const out = transferView(await this.load(tx, id, false));
      await this.audit(tx, actor, before, 'cancel', { status: before.status }, out);
      return out;
    });
  }
}
