import { z } from 'zod';

/**
 * Shared inventory contracts (Phase 4, docs/PHASE-4-PLAN.md, docs/INVENTORY.md). Used by the API
 * for request validation and by the admin for forms. Quantities are whole units; stock changes
 * always come with a ledger movement (D4-02).
 */

/** Ledger movement kinds. Positive kinds add to on-hand stock, negative kinds remove it. */
export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'SALE',
  'RETURN',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'WASTAGE',
  'PRODUCTION_CONSUMPTION',
] as const;
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;

const ADDS = new Set<StockMovementType>(['RECEIPT', 'ADJUSTMENT_IN', 'RETURN', 'TRANSFER_IN']);

/** +1 when the movement adds on-hand stock, -1 when it removes it. */
export const movementDirection = (type: StockMovementType): 1 | -1 => (ADDS.has(type) ? 1 : -1);

/** Out-of-stock behaviour (D4-05): per product, with a brand default of SHOW_UNAVAILABLE. */
export const OUT_OF_STOCK_BEHAVIORS = ['HIDE', 'SHOW_UNAVAILABLE', 'ALLOW_BACKORDER'] as const;
export const outOfStockBehaviorSchema = z.enum(OUT_OF_STOCK_BEHAVIORS);
export type OutOfStockBehavior = z.infer<typeof outOfStockBehaviorSchema>;
export const DEFAULT_OUT_OF_STOCK_BEHAVIOR: OutOfStockBehavior = 'SHOW_UNAVAILABLE';

export const RESERVATION_STATUSES = ['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const;
export const reservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

/** Transfer lifecycle: request, in transit, received (or cancelled before shipping). */
export const TRANSFER_STATUSES = ['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'] as const;
export const transferStatusSchema = z.enum(TRANSFER_STATUSES);
export type TransferStatus = z.infer<typeof transferStatusSchema>;

const TRANSFER_NEXT: Record<TransferStatus, readonly TransferStatus[]> = {
  REQUESTED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};
export const canTransition = (from: TransferStatus, to: TransferStatus): boolean =>
  TRANSFER_NEXT[from].includes(to);

/** Reservation window defaults (D4-03): a per-brand setting, these are only the fallbacks. */
export const DEFAULT_RESERVATION_MINUTES = 15;
export const MAX_RESERVATION_EXTENSIONS = 1;

export const MAX_STOCK_QUANTITY = 1_000_000;
export const quantitySchema = z.number().int().min(1).max(MAX_STOCK_QUANTITY);
export const stockLevelQuantitySchema = z.number().int().min(0).max(MAX_STOCK_QUANTITY);

/** What can be sold now: on hand minus reserved, never below zero. */
export const availableQuantity = (onHand: number, reserved: number): number =>
  Math.max(0, onHand - reserved);

/** Public stock state; real numbers are never exposed to shoppers (docs/PHASE-4-PLAN.md section 6). */
export type PublicStockState = 'AVAILABLE' | 'LOW' | 'UNAVAILABLE';
export const publicStockState = (
  available: number,
  lowThreshold: number,
  allowsBackorder = false,
): PublicStockState =>
  available <= 0
    ? allowsBackorder
      ? 'AVAILABLE'
      : 'UNAVAILABLE'
    : available <= lowThreshold
      ? 'LOW'
      : 'AVAILABLE';
