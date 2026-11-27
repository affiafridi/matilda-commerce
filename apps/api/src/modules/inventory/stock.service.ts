import { Injectable } from '@nestjs/common';
import {
  MAX_STOCK_QUANTITY,
  type OutOfStockBehavior,
  availableQuantity,
  outOfStockBehaviorSchema,
  quantitySchema,
  stockLevelQuantitySchema,
  z,
} from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma, StockMovementType } from '../../generated/prisma/client';
import { type AdminActor, notFound, paginate, pageQuery } from '../admin/admin-common';
import type { Tx } from '../admin/brand-access';
import { can } from '../iam/authorization/scope';
import { InventoryAccess, mapInventoryError } from './inventory-common';

const uuid = z.string().uuid();
const VIEW = ['inventory.view', 'inventory.adjust'] as const;

export const settingsBody = z
  .object({
    reservationMinutes: z.number().int().min(1).max(240),
    maxExtensions: z.number().int().min(0).max(5),
    defaultOutOfStock: outOfStockBehaviorSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

export const stockListQuery = pageQuery.extend({
  branchId: uuid.optional(),
  productId: uuid.optional(),
  variationId: uuid.optional(),
  /** Only rows at or below their low-stock threshold. */
  low: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const createStockBody = z.object({
  branchId: uuid,
  productId: uuid,
  variationId: uuid.nullish(),
  lowStockThreshold: stockLevelQuantitySchema.default(0),
  outOfStock: outOfStockBehaviorSchema.nullish(),
});

export const updateStockBody = z
  .object({
    lowStockThreshold: stockLevelQuantitySchema,
    outOfStock: outOfStockBehaviorSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

/** Movements staff may record by hand; sales, returns and transfers come from their own flows. */
const MANUAL_TYPES = ['RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'WASTAGE'] as const;
export const movementBody = z
  .object({
    type: z.enum(MANUAL_TYPES),
    quantity: quantitySchema,
    reason: z.string().trim().min(1).max(300).optional(),
    referenceType: z.string().trim().min(1).max(60).optional(),
    referenceId: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.type === 'RECEIPT' || !!v.reason, {
    message: 'A reason is required for adjustments and wastage.',
    path: ['reason'],
  });

/** A stocktake: set on-hand to the counted number; the difference is recorded as an adjustment. */
export const countBody = z.object({
  counted: stockLevelQuantitySchema,
  reason: z.string().trim().min(1).max(300),
});

export const movementListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Return movements older than this id (ids are time-ordered). */
  before: uuid.optional(),
});

type Setting = {
  reservationMinutes: number;
  maxExtensions: number;
  defaultOutOfStock: OutOfStockBehavior;
};
const DEFAULT_SETTING: Setting = {
  reservationMinutes: 15,
  maxExtensions: 1,
  defaultOutOfStock: 'SHOW_UNAVAILABLE',
};

type Level = Prisma.StockLevelGetPayload<object>;
const levelView = (l: Level, brandDefault: string) => {
  const effective = l.outOfStock ?? brandDefault;
  return {
    id: l.id,
    branchId: l.branchId,
    productId: l.productId,
    variationId: l.variationId,
    onHand: l.onHand,
    reserved: l.reserved,
    available: availableQuantity(l.onHand, l.reserved),
    lowStockThreshold: l.lowStockThreshold,
    low: availableQuantity(l.onHand, l.reserved) <= l.lowStockThreshold,
    outOfStock: l.outOfStock,
    effectiveOutOfStock: effective,
  };
};

const movementView = (m: Prisma.StockMovementGetPayload<object>) => ({
  id: m.id,
  type: m.type,
  quantity: m.quantity,
  onHandAfter: m.onHandAfter,
  reservedAfter: m.reservedAfter,
  reason: m.reason,
  referenceType: m.referenceType,
  referenceId: m.referenceId,
  transferId: m.transferId,
  actorStaffId: m.actorStaffId,
  createdAt: m.createdAt.toISOString(),
});

/**
 * Stock levels per branch, the brand's inventory settings, and the append-only movement ledger.
 * On-hand changes only through a movement recorded in the same transaction, after the row is
 * locked, so two staff members (or checkouts, in 4.8) cannot both take the last unit; the
 * database check on `reserved <= on_hand` is the last line of defence. Whether a brand allows
 * backorder is written on the row (`ALLOW_BACKORDER`) because the database has to know.
 */
@Injectable()
export class StockService {
  constructor(private readonly access: InventoryAccess) {}

  // Settings ---------------------------------------------------------------------------------

  private async settingOf(tx: Tx, brandId: string): Promise<Setting> {
    const row = await tx.inventorySetting.findFirst({ where: { brandId } });
    return row ?? DEFAULT_SETTING;
  }

  getSettings(actor: AdminActor, brandId: string) {
    return this.access.run(actor, brandId, 'inventory.view', (tx) => this.settingOf(tx, brandId));
  }

  /**
   * Moving the default to ALLOW_BACKORDER also writes it on the rows that follow the default, so
   * the database accepts reservations beyond on-hand. Moving it away leaves those rows as they
   * are (the database cannot tell a default from a choice); staff change them per row.
   */
  putSettings(actor: AdminActor, brandId: string, patch: z.infer<typeof settingsBody>) {
    return this.access.run(actor, brandId, 'inventory.adjust', async (tx) => {
      const before = await this.settingOf(tx, brandId);
      const next = { ...before, ...patch };
      await tx.inventorySetting.upsert({
        where: { brandId },
        create: { brandId, ...next },
        update: patch,
      });
      let converted = 0;
      if (
        next.defaultOutOfStock === 'ALLOW_BACKORDER' &&
        before.defaultOutOfStock !== 'ALLOW_BACKORDER'
      ) {
        converted = (
          await tx.stockLevel.updateMany({
            where: { outOfStock: null },
            data: { outOfStock: 'ALLOW_BACKORDER' },
          })
        ).count;
      }
      await this.access.record(
        tx,
        actor,
        brandId,
        'inventory.settings.put',
        'inventory_setting',
        brandId,
        before,
        next,
      );
      return { ...next, rowsSetToBackorder: converted };
    });
  }

  // Levels -----------------------------------------------------------------------------------

  async list(actor: AdminActor, brandId: string, query: z.infer<typeof stockListQuery>) {
    this.access.assertReaches(actor, brandId, VIEW);
    return this.access.runPublic(brandId, async (tx) => {
      const setting = await this.settingOf(tx, brandId);
      const rows = await tx.stockLevel.findMany({
        where: {
          ...(query.branchId && { branchId: query.branchId }),
          ...(query.productId && { productId: query.productId }),
          ...(query.variationId && { variationId: query.variationId }),
        },
        orderBy: [{ branchId: 'asc' }, { productId: 'asc' }, { id: 'asc' }],
      });
      const visible = rows
        .filter((r) => VIEW.some((p) => can(actor.grants, p, { brandId, branchId: r.branchId })))
        .map((r) => levelView(r, setting.defaultOutOfStock))
        .filter((r) => query.low === undefined || r.low === query.low);
      return paginate(visible, query.page, query.pageSize);
    });
  }

  /** Loads a row under the brand scope and checks a permission over its branch. */
  private async loadFor(
    tx: Tx,
    actor: AdminActor,
    brandId: string,
    id: string,
    permissions: readonly string[],
    lock = false,
  ): Promise<Level> {
    this.access.assertReaches(actor, brandId, permissions);
    if (lock) await tx.$queryRaw`SELECT id FROM stock_level WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.stockLevel.findFirst({ where: { id } });
    if (!row) throw notFound('Stock');
    if (!permissions.some((p) => can(actor.grants, p, { brandId, branchId: row.branchId }))) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    return row;
  }

  get(actor: AdminActor, brandId: string, id: string) {
    return this.access.runPublic(brandId, async (tx) => {
      const row = await this.loadFor(tx, actor, brandId, id, VIEW);
      return levelView(row, (await this.settingOf(tx, brandId)).defaultOutOfStock);
    });
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createStockBody>) {
    try {
      return await this.access.runAt(
        actor,
        { brandId, branchId: input.branchId },
        ['inventory.adjust'],
        async (tx) => {
          const setting = await this.settingOf(tx, brandId);
          if (!(await tx.branch.findFirst({ where: { id: input.branchId } })))
            throw notFound('Branch');
          const product = await tx.product.findFirst({
            where: { id: input.productId, deletedAt: null },
          });
          if (!product) throw notFound('Product');
          const outOfStock =
            input.outOfStock ??
            (setting.defaultOutOfStock === 'ALLOW_BACKORDER' ? 'ALLOW_BACKORDER' : null);
          const row = await tx.stockLevel.create({
            data: {
              brandId,
              branchId: input.branchId,
              productId: input.productId,
              variationId: input.variationId ?? null,
              lowStockThreshold: input.lowStockThreshold,
              outOfStock,
            },
          });
          const out = levelView(row, setting.defaultOutOfStock);
          await this.access.recordFor(tx, actor, {
            brandId,
            branchId: row.branchId,
            action: 'inventory.stock.create',
            targetType: 'stock_level',
            targetId: row.id,
            after: out,
          });
          return out;
        },
      );
    } catch (err) {
      throw mapInventoryError(err);
    }
  }

  update(actor: AdminActor, brandId: string, id: string, patch: z.infer<typeof updateStockBody>) {
    return this.access.runPublic(brandId, async (tx) => {
      const setting = await this.settingOf(tx, brandId);
      const current = await this.loadFor(tx, actor, brandId, id, ['inventory.adjust'], true);
      const data: Prisma.StockLevelUpdateInput = { ...patch };
      if (patch.outOfStock === null && setting.defaultOutOfStock === 'ALLOW_BACKORDER') {
        data.outOfStock = 'ALLOW_BACKORDER'; // following the default means backorder: keep the row consistent
      }
      let row: Level;
      try {
        row = await tx.stockLevel.update({ where: { id }, data });
      } catch (err) {
        const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
        if (/no_oversell/.test(text)) {
          throw new ApiException(
            409,
            'STOCK_RESERVED',
            'Stock is already reserved beyond on-hand; backorder cannot be switched off yet',
          );
        }
        throw err;
      }
      const out = levelView(row, setting.defaultOutOfStock);
      await this.access.recordFor(tx, actor, {
        brandId,
        branchId: row.branchId,
        action: 'inventory.stock.update',
        targetType: 'stock_level',
        targetId: id,
        before: levelView(current, setting.defaultOutOfStock),
        after: out,
      });
      return out;
    });
  }

  // Ledger -----------------------------------------------------------------------------------

  /**
   * Applies one movement to a locked row and records it. Removing stock is refused when it would
   * take on-hand below zero or below what is reserved (unless the row allows backorder).
   */
  private async apply(
    tx: Tx,
    actor: AdminActor,
    brandId: string,
    level: Level,
    type: StockMovementType,
    quantity: number,
    meta: { reason?: string; referenceType?: string; referenceId?: string },
  ) {
    const adds = type === 'RECEIPT' || type === 'ADJUSTMENT_IN';
    const onHand = level.onHand + (adds ? quantity : -quantity);
    if (onHand > MAX_STOCK_QUANTITY) {
      throw new ApiException(
        422,
        'QUANTITY_TOO_LARGE',
        'On-hand stock cannot exceed one million units',
      );
    }
    if (onHand < 0) {
      throw new ApiException(409, 'INSUFFICIENT_STOCK', 'There is not enough stock on hand');
    }
    if (onHand < level.reserved && level.outOfStock !== 'ALLOW_BACKORDER') {
      throw new ApiException(
        409,
        'STOCK_RESERVED',
        'That much stock is already reserved for open checkouts',
      );
    }
    const row = await tx.stockLevel.update({ where: { id: level.id }, data: { onHand } });
    const movement = await tx.stockMovement.create({
      data: {
        brandId,
        stockLevelId: level.id,
        type,
        quantity,
        onHandAfter: row.onHand,
        reservedAfter: row.reserved,
        reason: meta.reason ?? null,
        referenceType: meta.referenceType ?? null,
        referenceId: meta.referenceId ?? null,
        actorStaffId: actor.staffId,
      },
    });
    await this.access.recordFor(tx, actor, {
      brandId,
      branchId: level.branchId,
      action: `inventory.stock.${type.toLowerCase()}`,
      targetType: 'stock_level',
      targetId: level.id,
      before: { onHand: level.onHand },
      after: { onHand: row.onHand, quantity, reason: meta.reason ?? null },
    });
    return { movement: movementView(movement), level: row };
  }

  async record(actor: AdminActor, brandId: string, id: string, body: z.infer<typeof movementBody>) {
    return this.access.runPublic(brandId, async (tx) => {
      const level = await this.loadFor(tx, actor, brandId, id, ['inventory.adjust'], true);
      const setting = await this.settingOf(tx, brandId);
      const { movement, level: row } = await this.apply(
        tx,
        actor,
        brandId,
        level,
        body.type,
        body.quantity,
        body,
      );
      return { movement, stock: levelView(row, setting.defaultOutOfStock) };
    });
  }

  async count(actor: AdminActor, brandId: string, id: string, body: z.infer<typeof countBody>) {
    return this.access.runPublic(brandId, async (tx) => {
      const level = await this.loadFor(tx, actor, brandId, id, ['inventory.adjust'], true);
      const setting = await this.settingOf(tx, brandId);
      const delta = body.counted - level.onHand;
      if (delta === 0) {
        throw new ApiException(422, 'NO_CHANGE', 'The count equals the stock on hand');
      }
      const { movement, level: row } = await this.apply(
        tx,
        actor,
        brandId,
        level,
        delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        Math.abs(delta),
        { reason: body.reason, referenceType: 'stocktake' },
      );
      return { movement, stock: levelView(row, setting.defaultOutOfStock) };
    });
  }

  async movements(
    actor: AdminActor,
    brandId: string,
    id: string,
    query: z.infer<typeof movementListQuery>,
  ) {
    return this.access.runPublic(brandId, async (tx) => {
      await this.loadFor(tx, actor, brandId, id, VIEW);
      const rows = await tx.stockMovement.findMany({
        where: { stockLevelId: id, ...(query.before && { id: { lt: query.before } }) },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(movementView),
        next: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    });
  }
}
