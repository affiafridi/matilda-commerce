import { z } from 'zod';
import { currencyCodeSchema, minorUnitsSchema, signedMinorUnitsSchema } from './catalog.ts';

/**
 * Shared commerce contracts (Phase 5, docs/PHASE-5-PLAN.md, docs/CART-AND-CHECKOUT.md,
 * docs/PAYMENTS.md). Used by the API for validation and by the storefront and admin as types.
 * Money is always integer minor units (rule 4); the backend recomputes every amount, so nothing
 * here is a source of price truth. Row shapes arrive with the schema in step 5.2.
 */

// ---------------------------------------------------------------- state machines (D5-05)

const machine = <S extends string>(next: Record<S, readonly S[]>) => ({
  next,
  can: (from: S, to: S): boolean => next[from].includes(to),
  isFinal: (state: S): boolean => next[state].length === 0,
});

/** Order lifecycle. Production and fulfillment are tracked on their own (D5-05). */
export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export const orderMachine = machine<OrderStatus>({
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

/** Payment lifecycle. COD_PENDING is an order confirmed with cash still to collect (D5-10). */
export const PAYMENT_STATUSES = [
  'UNPAID',
  'PENDING',
  'COD_PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export const paymentMachine = machine<PaymentStatus>({
  UNPAID: ['PENDING', 'COD_PENDING', 'PAID'],
  PENDING: ['PAID', 'PARTIALLY_PAID', 'FAILED'],
  COD_PENDING: ['PAID', 'PARTIALLY_PAID', 'FAILED'],
  PARTIALLY_PAID: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: ['PENDING'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  REFUNDED: [],
});

/** Fulfillment lifecycle, delivery or pickup. */
export const FULFILLMENT_STATUSES = [
  'UNASSIGNED',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED_DELIVERY',
  'RETURNED',
  'PICKUP_READY',
  'PICKED_UP',
] as const;
export const fulfillmentStatusSchema = z.enum(FULFILLMENT_STATUSES);
export type FulfillmentStatus = z.infer<typeof fulfillmentStatusSchema>;
export const fulfillmentMachine = machine<FulfillmentStatus>({
  UNASSIGNED: ['ASSIGNED'],
  ASSIGNED: ['OUT_FOR_DELIVERY', 'PICKUP_READY', 'UNASSIGNED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED_DELIVERY'],
  FAILED_DELIVERY: ['ASSIGNED', 'RETURNED'],
  PICKUP_READY: ['PICKED_UP'],
  DELIVERED: [],
  RETURNED: [],
  PICKED_UP: [],
});

/** One attempt to take payment through a provider. */
export const PAYMENT_ATTEMPT_STATUSES = [
  'INITIATED',
  'REDIRECTED',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
] as const;
export const paymentAttemptStatusSchema = z.enum(PAYMENT_ATTEMPT_STATUSES);
export type PaymentAttemptStatus = z.infer<typeof paymentAttemptStatusSchema>;
export const paymentAttemptMachine = machine<PaymentAttemptStatus>({
  INITIATED: ['REDIRECTED', 'SUCCEEDED', 'FAILED', 'EXPIRED'],
  REDIRECTED: ['SUCCEEDED', 'FAILED', 'EXPIRED'],
  SUCCEEDED: [],
  FAILED: [],
  EXPIRED: [],
});

export const CART_STATUSES = ['OPEN', 'CONVERTED', 'ABANDONED', 'MERGED'] as const;
export const cartStatusSchema = z.enum(CART_STATUSES);
export type CartStatus = z.infer<typeof cartStatusSchema>;
export const cartMachine = machine<CartStatus>({
  OPEN: ['CONVERTED', 'ABANDONED', 'MERGED'],
  ABANDONED: ['OPEN'],
  CONVERTED: [],
  MERGED: [],
});

// ---------------------------------------------------------------- payment methods and providers

export const PAYMENT_PROVIDERS = ['CCAVENUE', 'COD', 'MANUAL'] as const;
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

/** Providers that confirm payment on a server-side check with an outside gateway. */
export const isOnlineProvider = (p: PaymentProvider): boolean => p === 'CCAVENUE';

// ---------------------------------------------------------------- money helpers (rule 4)

/** Add whole minor-unit amounts, refusing anything that is not a safe integer. */
export const sumMinor = (amounts: readonly number[]): number => {
  let total = 0;
  for (const a of amounts) {
    if (!Number.isSafeInteger(a)) throw new RangeError('Money must be whole minor units.');
    total += a;
    if (!Number.isSafeInteger(total)) throw new RangeError('Money total is out of range.');
  }
  return total;
};

/** A line total from a unit price and a whole quantity. */
export const lineTotalMinor = (unitMinor: number, quantity: number): number => {
  if (!Number.isSafeInteger(unitMinor) || !Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError('Use whole minor units and a whole quantity.');
  }
  const total = unitMinor * quantity;
  if (!Number.isSafeInteger(total)) throw new RangeError('Money total is out of range.');
  return total;
};

/** Percentage (basis points, 10000 = 100%) of an amount, rounded half away from zero. */
export const percentOfMinor = (amountMinor: number, basisPoints: number): number => {
  if (!Number.isSafeInteger(amountMinor) || !Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError('Use whole minor units and whole basis points.');
  }
  const scaled = BigInt(amountMinor) * BigInt(basisPoints);
  const sign = scaled < 0n ? -1n : 1n;
  const abs = scaled < 0n ? -scaled : scaled;
  return Number(sign * ((abs + 5000n) / 10000n));
};

/** Tax contained in a tax-inclusive amount, rounded half away from zero. */
export const inclusiveTaxMinor = (grossMinor: number, basisPoints: number): number => {
  if (
    !Number.isSafeInteger(grossMinor) ||
    grossMinor < 0 ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0
  ) {
    throw new RangeError('Use whole minor units and whole basis points.');
  }
  const base = BigInt(10000 + basisPoints);
  const net = (BigInt(grossMinor) * 10000n * 2n + base) / (base * 2n);
  return grossMinor - Number(net);
};

// ---------------------------------------------------------------- cart and quote contracts

export const CART_LINE_MAX_QUANTITY = 99;
export const MAX_CART_LINES = 50;

const idSchema = z.string().uuid();

/** What the client sends for a cart line; the price is never part of it. */
export const cartLineInputSchema = z.object({
  productId: idSchema,
  variationId: idSchema.optional(),
  quantity: z.number().int().min(1).max(CART_LINE_MAX_QUANTITY),
  /** Customization choices: option id to the chosen value id(s) or text. */
  options: z
    .array(
      z.object({
        optionId: idSchema,
        valueIds: z.array(idSchema).max(20).default([]),
        text: z.string().trim().max(500).optional(),
      }),
    )
    .max(30)
    .default([]),
  addOns: z
    .array(
      z.object({
        addOnId: idSchema,
        quantity: z.number().int().min(1).max(CART_LINE_MAX_QUANTITY),
      }),
    )
    .max(20)
    .default([]),
  bundleChoices: z
    .array(z.object({ bundleItemId: idSchema, variationId: idSchema.optional() }))
    .max(30)
    .default([]),
});
export type CartLineInput = z.infer<typeof cartLineInputSchema>;

export const quoteLineKindSchema = z.enum(['PRODUCT', 'ADD_ON', 'GIFT']);
export type QuoteLineKind = z.infer<typeof quoteLineKindSchema>;

/** Names in every language the catalog holds, English required (D3-11). */
export const translatedTextSchema = z.record(z.string(), z.string());
export type TranslatedText = z.infer<typeof translatedTextSchema>;

/** One customization choice as priced, kept so the order can snapshot it (D5-06). */
export const quoteOptionSchema = z.object({
  optionId: idSchema,
  optionKey: z.string(),
  optionLabel: translatedTextSchema,
  choiceId: idSchema.nullable(),
  choiceKey: z.string().nullable(),
  choiceLabel: translatedTextSchema.nullable(),
  text: z.string().nullable(),
  deltaMinor: signedMinorUnitsSchema,
});
export type QuoteOption = z.infer<typeof quoteOptionSchema>;

/** A bundle component choice as priced. */
export const quoteBundleItemSchema = z.object({
  bundleItemId: idSchema,
  productId: idSchema,
  variationId: idSchema.nullable(),
  quantity: z.number().int().min(1),
});
export type QuoteBundleItem = z.infer<typeof quoteBundleItemSchema>;

/** A priced line in a quote. Every amount was computed by the backend. */
export const quoteLineSchema = z.object({
  kind: quoteLineKindSchema,
  /** The cart line this came from; an add-on line points at its parent product line. */
  cartLineId: idSchema.nullable(),
  productId: idSchema.nullable(),
  variationId: idSchema.nullable(),
  addonItemId: idSchema.nullable(),
  name: translatedTextSchema,
  sku: z.string().nullable(),
  options: z.array(quoteOptionSchema).default([]),
  bundleItems: z.array(quoteBundleItemSchema).default([]),
  quantity: z.number().int().min(0),
  unitMinor: minorUnitsSchema,
  discountMinor: minorUnitsSchema,
  taxMinor: minorUnitsSchema,
  totalMinor: minorUnitsSchema,
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteTotalsSchema = z.object({
  currency: currencyCodeSchema,
  subtotalMinor: minorUnitsSchema,
  discountMinor: minorUnitsSchema,
  deliveryFeeMinor: minorUnitsSchema,
  /** Tax contained in the totals when prices include tax, else added on top (D5-03). */
  taxMinor: minorUnitsSchema,
  taxInclusive: z.boolean(),
  totalMinor: signedMinorUnitsSchema.refine((n) => n >= 0, 'A total is never negative.'),
});
export type QuoteTotals = z.infer<typeof quoteTotalsSchema>;

/** A quote lasts this long; the order step recomputes it anyway (D5-01). */
export const QUOTE_TTL_SECONDS = 15 * 60;

/** Order numbers: brand prefix, dash, digits (D5-04). */
export const orderNumberSchema = z.string().regex(/^[A-Z0-9]{2,8}-\d{4,12}$/);

/** Idempotency keys sent by a client when creating an order or starting a payment (D5-07). */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** At most one coupon per order (D5-11). */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, 'Use letters, numbers, dashes or underscores.');

/** At most this many lines in one cart (the cart service enforces it). */
export const CART_MAX_LINES = 50;

/** Add a line to the cart; the price is never part of it. */
export const addCartLineSchema = cartLineInputSchema.extend({
  note: z.string().trim().max(200).optional(),
});
export type AddCartLineInput = z.infer<typeof addCartLineSchema>;

/** Change the quantity or note of one cart line. */
export const updateCartLineSchema = z
  .object({
    quantity: z.number().int().min(1).max(CART_LINE_MAX_QUANTITY).optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => v.quantity !== undefined || v.note !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateCartLineInput = z.infer<typeof updateCartLineSchema>;

/** Contact captured early for abandoned-cart tracking only; null clears it. */
export const cartContactSchema = z
  .object({
    contactEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,30}$/, 'Enter a valid phone number')
      .nullable()
      .optional(),
  })
  .refine((v) => v.contactEmail !== undefined || v.contactPhone !== undefined, {
    message: 'Nothing to change',
  });
export type CartContactInput = z.infer<typeof cartContactSchema>;
