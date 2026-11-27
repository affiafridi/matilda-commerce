import { Injectable } from '@nestjs/common';
import { languageCodeSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../admin/admin-common';
import { BrandScopedAccess } from '../admin/brand-access';

/** English is the required source language of every delivery name, as for the catalog. */
export const REQUIRED_LANGUAGE = 'en';

export const languageParam = languageCodeSchema;

/** Lower-case letters and digits separated by single hyphens: stable codes used by staff and APIs. */
export const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens only.');

export const nameTranslationBody = z.object({ name: z.string().trim().min(1).max(200) });
export const nameTranslationWithLanguage = nameTranslationBody.extend({
  language: languageCodeSchema,
});

/** Throws when the list lacks English or repeats a language. */
export function assertTranslationSet(languages: readonly string[]): void {
  if (!languages.includes(REQUIRED_LANGUAGE)) {
    throw new ApiException(422, 'ENGLISH_REQUIRED', 'An English name is required');
  }
  if (new Set(languages).size !== languages.length) {
    throw new ApiException(422, 'DUPLICATE_LANGUAGE', 'Each language can appear only once');
  }
}

/** `time` columns hold a local wall-clock time; they travel as `HH:mm` and are stored on 1970-01-01 UTC. */
export const toTime = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);
export const fromTime = (d: Date): string => d.toISOString().slice(11, 16);

/** Brand-scoped entry point of every delivery service call (see `BrandScopedAccess`). */
@Injectable()
export class DeliveryAccess extends BrandScopedAccess {}

/**
 * Turns database errors that mean "the caller asked for something invalid" into API errors.
 * The triggers of the location and zone tables raise check violations with readable messages;
 * anything not recognised is returned unchanged so it surfaces as a server error.
 */
export function mapDeliveryError(
  err: unknown,
  uniqueCode = 'CONFLICT',
  uniqueMessage = 'That value is already in use',
): Error {
  if (err instanceof ApiException) return err;
  if (isUniqueViolation(err)) return new ApiException(409, uniqueCode, uniqueMessage);
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
  if (
    /emirate can be at the top|cannot be placed under|under itself|tree is too deep/i.test(text)
  ) {
    return new ApiException(422, 'AREA_TREE_INVALID', 'That location placement is not allowed');
  }
  if (/not in the market's country/i.test(text)) {
    return new ApiException(
      422,
      'AREA_COUNTRY_MISMATCH',
      "The area is not in the market's country",
    );
  }
  if (/delivery_slot_cutoff_before_start/i.test(text)) {
    return new ApiException(
      422,
      'SLOT_CUTOFF_INVALID',
      'A same-day cutoff must be before the slot starts',
    );
  }
  if (/exclusion constraint/i.test(text)) {
    return new ApiException(422, 'HOURS_OVERLAP', 'Opening hours of one day cannot overlap');
  }
  if (/branch does not serve this brand|branch is not linked/i.test(text)) {
    return new ApiException(422, 'BRANCH_NOT_AVAILABLE', 'The branch does not serve this market');
  }
  return err instanceof Error ? err : new Error(String(err));
}
