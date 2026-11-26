import { z } from 'zod';

/**
 * Shared delivery contracts (Phase 4, docs/PHASE-4-PLAN.md, docs/DELIVERY.md). Slots and hours are
 * local wall-clock times in the branch time zone (D4-10); instants are stored as timestamptz.
 * Nothing here is specific to a brand, branch or area (rule 7 of CLAUDE.md).
 */

export const DELIVERY_AREA_LEVELS = ['EMIRATE', 'CITY', 'AREA'] as const;
export const deliveryAreaLevelSchema = z.enum(DELIVERY_AREA_LEVELS);
export type DeliveryAreaLevel = z.infer<typeof deliveryAreaLevelSchema>;

export const DELIVERY_METHOD_KINDS = ['SAME_DAY', 'NEXT_DAY', 'SCHEDULED'] as const;
export const deliveryMethodKindSchema = z.enum(DELIVERY_METHOD_KINDS);
export type DeliveryMethodKind = z.infer<typeof deliveryMethodKindSchema>;

/** What a restriction applies to, and the small fixed set of conditions (D4-13). */
export const RESTRICTION_TARGETS = ['PRODUCT', 'CATEGORY', 'COLLECTION'] as const;
export const restrictionTargetSchema = z.enum(RESTRICTION_TARGETS);
export type RestrictionTarget = z.infer<typeof restrictionTargetSchema>;

export const RESTRICTION_CONDITIONS = ['AREA', 'ZONE', 'DATE_RANGE', 'WEEKDAY', 'METHOD'] as const;
export const restrictionConditionSchema = z.enum(RESTRICTION_CONDITIONS);
export type RestrictionCondition = z.infer<typeof restrictionConditionSchema>;

/** Branch assignment rule kinds, applied in the configured order (D4-12). */
export const ASSIGNMENT_RULE_KINDS = [
  'COVERS_AREA',
  'HAS_STOCK',
  'OPEN_IN_TIME',
  'PRIORITY',
  'CLOSEST',
  'LEAST_LOADED',
] as const;
export const assignmentRuleKindSchema = z.enum(ASSIGNMENT_RULE_KINDS);
export type AssignmentRuleKind = z.infer<typeof assignmentRuleKindSchema>;

/** 0 = Sunday ... 6 = Saturday, the same numbering as JavaScript's `Date#getDay`. */
export const weekdaySchema = z.number().int().min(0).max(6);

/** Local time of day, `HH:mm` (24 hours). `24:00` is not valid; a range may not cross midnight. */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, 00:00 to 23:59.');

export const minutesOfDay = (time: string): number => {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
};

/** A time range within one day; the end must be after the start. */
export const timeRangeSchema = z
  .object({ start: localTimeSchema, end: localTimeSchema })
  .refine((r) => minutesOfDay(r.end) > minutesOfDay(r.start), {
    message: 'The end must be after the start.',
    path: ['end'],
  });
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const timeRangesOverlap = (a: TimeRange, b: TimeRange): boolean =>
  minutesOfDay(a.start) < minutesOfDay(b.end) && minutesOfDay(b.start) < minutesOfDay(a.end);

/** Opening hours of one weekday: ranges must not overlap. Several ranges allow a lunch break. */
export const dayHoursSchema = z
  .object({ weekday: weekdaySchema, ranges: z.array(timeRangeSchema).max(4) })
  .refine(
    (d) => d.ranges.every((r, i) => d.ranges.every((o, j) => i === j || !timeRangesOverlap(r, o))),
    { message: 'Opening ranges must not overlap.', path: ['ranges'] },
  );
export type DayHours = z.infer<typeof dayHoursSchema>;

/** A calendar date with no time zone, `YYYY-MM-DD` (closures and disabled dates). */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'That date does not exist.');

export const weekdayOfLocalDate = (date: string): number =>
  new Date(`${date}T00:00:00Z`).getUTCDay();

/** Longest date range the availability service will evaluate in one request. */
export const MAX_AVAILABILITY_DAYS = 31;
