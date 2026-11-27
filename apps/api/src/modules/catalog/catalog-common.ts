import { Injectable } from '@nestjs/common';
import { languageCodeSchema, slugSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../admin/admin-common';
import { BrandScopedAccess, type Tx } from '../admin/brand-access';

export type { Tx };

/** English is the required source language of every catalog text (D3-11). */
export const REQUIRED_LANGUAGE = 'en';

export const languageParam = languageCodeSchema;

/** Text of one taxonomy entity in one language. A missing slug is built from the name. */
export const taxonomyTranslationBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).nullish(),
  slug: slugSchema.optional(),
  seoTitle: z.string().trim().max(200).nullish(),
  seoDescription: z.string().trim().max(500).nullish(),
});
export type TaxonomyTranslationBody = z.infer<typeof taxonomyTranslationBody>;

export const taxonomyTranslationWithLanguage = taxonomyTranslationBody.extend({
  language: languageCodeSchema,
});

export const labelTranslationBody = z.object({ label: z.string().trim().min(1).max(200) });
export const labelTranslationWithLanguage = labelTranslationBody.extend({
  language: languageCodeSchema,
});

/** Throws when the list lacks English or repeats a language. */
export function assertTranslationSet(languages: readonly string[]): void {
  if (!languages.includes(REQUIRED_LANGUAGE)) {
    throw new ApiException(422, 'ENGLISH_REQUIRED', 'An English translation is required');
  }
  if (new Set(languages).size !== languages.length) {
    throw new ApiException(422, 'DUPLICATE_LANGUAGE', 'Each language can appear only once');
  }
}

/** Brand-scoped entry point of every catalog service call (see `BrandScopedAccess`). */
@Injectable()
export class CatalogAccess extends BrandScopedAccess {}

/**
 * Turns database errors that mean "the caller asked for something invalid" into API errors:
 * unique violations become 409 and the category tree trigger becomes 422. Anything else is
 * returned unchanged so it surfaces as a server error.
 */
export function mapCatalogError(
  err: unknown,
  uniqueCode = 'CONFLICT',
  uniqueMessage = 'That value is already in use',
): Error {
  if (err instanceof ApiException) return err;
  if (isUniqueViolation(err)) return new ApiException(409, uniqueCode, uniqueMessage);
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
  if (/nested at most|under itself/i.test(text)) {
    return new ApiException(422, 'CATEGORY_TREE_INVALID', 'That category placement is not allowed');
  }
  return err instanceof Error ? err : new Error(String(err));
}
