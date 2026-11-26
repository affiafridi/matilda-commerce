import { z } from 'zod';

/**
 * Shared catalog contracts (Phase 3, docs/PHASE-3-PLAN.md). Used by the API for request validation
 * and by the admin for forms, so both sides agree on the rules. Money is always integer minor units.
 */

export const PRODUCT_TYPES = ['SIMPLE', 'VARIABLE', 'BUNDLE'] as const;
export const productTypeSchema = z.enum(PRODUCT_TYPES);
export type ProductType = z.infer<typeof productTypeSchema>;

export const PRODUCT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** Customization option types. Options never affect SKU or stock (D3-06). */
export const OPTION_TYPES = [
  'SELECT',
  'RADIO',
  'CHECKBOX',
  'TEXT',
  'TEXTAREA',
  'FILE',
  'DATE',
] as const;
export const optionTypeSchema = z.enum(OPTION_TYPES);
export type OptionType = z.infer<typeof optionTypeSchema>;

/** At most this many variations per product at first (D3-05). */
export const MAX_VARIATIONS_PER_PRODUCT = 100;

/** Lower-case letters and digits (any script, so Arabic slugs work) separated by single hyphens. */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u, 'Use letters, numbers and single hyphens only.')
  .refine((s) => s === s.toLowerCase(), 'Use lower-case letters.');

/** Stock keeping unit: upper-case letters, digits, hyphen, underscore, dot; unique per brand. */
export const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use upper-case letters, numbers, dot, hyphen or underscore.');

/** Language code as used by markets, e.g. "en", "ar". */
export const languageCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a language code such as en or ar.');

/** ISO 4217 currency code. */
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code.');

/** A price or price delta in the currency's minor units (fils for AED). Never a float. */
export const minorUnitsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const signedMinorUnitsSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

/** Text in one language; English is required by the product rules, others are optional (D3-11). */
export const translationSchema = z.object({
  language: languageCodeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional(),
});
export type Translation = z.infer<typeof translationSchema>;

/** A product is sold in a market at a price in one of that market's currencies. */
export const marketPriceSchema = z
  .object({
    marketId: z.string().uuid(),
    currency: currencyCodeSchema,
    regular: minorUnitsSchema,
    sale: minorUnitsSchema.optional(),
    saleStartsAt: z.coerce.date().optional(),
    saleEndsAt: z.coerce.date().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.sale !== undefined && p.sale >= p.regular) {
      ctx.addIssue({
        code: 'custom',
        path: ['sale'],
        message: 'The sale price must be lower than the regular price.',
      });
    }
    if (p.saleStartsAt && p.saleEndsAt && p.saleEndsAt <= p.saleStartsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['saleEndsAt'],
        message: 'The sale must end after it starts.',
      });
    }
    if ((p.saleStartsAt || p.saleEndsAt) && p.sale === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sale'],
        message: 'Enter a sale price for the sale dates.',
      });
    }
  });
export type MarketPrice = z.infer<typeof marketPriceSchema>;

/**
 * Formats minor units as a plain decimal string without floating point, e.g. (12550, 2) -> "125.50".
 * Display formatting with symbols and locale belongs to the storefront.
 */
export function formatMinorUnits(amount: number, digits: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Amount must be a safe integer');
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) throw new RangeError('Bad digits');
  const negative = amount < 0;
  const text = Math.abs(amount)
    .toString()
    .padStart(digits + 1, '0');
  const whole = digits === 0 ? text : text.slice(0, -digits);
  const fraction = digits === 0 ? '' : `.${text.slice(-digits)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Parses a decimal string such as "125.5" into minor units. Rejects more decimals than the currency has. */
export function parseMajorToMinorUnits(input: string, digits: number): number {
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(input.trim());
  if (!match) throw new RangeError('Enter an amount such as 125.50');
  const fraction = match[2] ?? '';
  if (fraction.length > digits) throw new RangeError(`Use at most ${digits} decimal places`);
  return Number(`${match[1]}${fraction.padEnd(digits, '0')}`);
}

export interface VariationAttributeInput {
  key: string;
  values: readonly string[];
}

/** One chosen value per variation-driving attribute, in attribute order. */
export type VariationSelection = Record<string, string>;

/** Canonical identity of a combination, used to prove uniqueness (keys sorted). */
export function variationKey(selection: VariationSelection): string {
  return Object.keys(selection)
    .sort()
    .map((k) => `${k}=${selection[k]}`)
    .join('|');
}

/**
 * Builds every combination of the variation-driving attributes (cartesian product), in a stable order.
 * Throws when an attribute has no values or the product would exceed the variation limit (D3-05).
 */
export function generateVariationCombinations(
  attributes: readonly VariationAttributeInput[],
  limit: number = MAX_VARIATIONS_PER_PRODUCT,
): VariationSelection[] {
  if (attributes.length === 0) return [];
  const keys = new Set<string>();
  let count = 1;
  for (const a of attributes) {
    if (keys.has(a.key)) throw new RangeError(`Attribute ${a.key} is listed twice`);
    keys.add(a.key);
    const distinct = new Set(a.values);
    if (distinct.size === 0) throw new RangeError(`Attribute ${a.key} has no values`);
    if (distinct.size !== a.values.length)
      throw new RangeError(`Attribute ${a.key} repeats a value`);
    count *= distinct.size;
    if (count > limit) throw new RangeError(`More than ${limit} variations would be created`);
  }
  let combos: VariationSelection[] = [{}];
  for (const a of attributes) {
    combos = combos.flatMap((c) => a.values.map((v) => ({ ...c, [a.key]: v })));
  }
  return combos;
}

/**
 * Builds a URL slug from a name: Unicode-normalised, lower-case, accents removed from Latin letters,
 * every run of other characters turned into one hyphen. Arabic letters are kept. Returns "" when the
 * name has no letters or digits, so callers must reject that and ask for a slug.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

export interface PriceLike {
  regular: number;
  sale?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
}

/**
 * The price a shopper pays for one unit at a moment in time, before options, add-ons, promotions or
 * tax. The sale price applies from `saleStartsAt` (inclusive) until `saleEndsAt` (exclusive); a
 * missing date means unbounded. This pure function is the base that the Phase 5 pricing service
 * extends, so the admin preview and checkout can never disagree on the base price.
 */
export function effectivePrice(price: PriceLike, at: Date): { amount: number; onSale: boolean } {
  const { sale, saleStartsAt, saleEndsAt } = price;
  const started = !saleStartsAt || saleStartsAt <= at;
  const notEnded = !saleEndsAt || at < saleEndsAt;
  if (sale !== null && sale !== undefined && started && notEnded) {
    return { amount: sale, onSale: true };
  }
  return { amount: price.regular, onSale: false };
}
