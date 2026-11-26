import { Injectable } from '@nestjs/common';
import { languageCodeSchema, slugSchema, z } from '@matilda/validation';
import type { Prisma } from '../../generated/prisma/client';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import { AuditService } from '../audit/audit.service';
import { type AdminActor, assertCan, isUniqueViolation, notFound } from '../admin/admin-common';

export type Tx = Prisma.TransactionClient;

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

/**
 * Entry point of every catalog service call: checks the permission over the brand, opens a
 * brand-scoped transaction (row-level security applies) and confirms the brand exists. Services
 * never read or write catalog tables outside it.
 */
@Injectable()
export class CatalogAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Extra permission check inside a call (e.g. scheduling needs publish rights as well as edit). */
  require(actor: AdminActor, brandId: string, permission: string): void {
    assertCan(actor.grants, permission, { brandId });
  }

  async run<T>(
    actor: AdminActor,
    brandId: string,
    permission: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    assertCan(actor.grants, permission, { brandId });
    return withScope(this.prisma.client, { brandIds: [brandId] }, async (tx) => {
      const brand = await tx.brand.findFirst({ where: { id: brandId }, select: { id: true } });
      if (!brand) throw notFound('Brand');
      return fn(tx);
    });
  }

  /** Brand-scoped read for public routes (no staff actor): the brand id comes from the URL. */
  runPublic<T>(brandId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withScope(this.prisma.client, { brandIds: [brandId] }, fn);
  }

  record(
    tx: Tx,
    actor: AdminActor,
    brandId: string,
    action: string,
    targetType: string,
    targetId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    return this.audit.record(tx, {
      action,
      targetType,
      targetId,
      actor: { type: 'STAFF', id: actor.staffId },
      brandId,
      before,
      after,
    });
  }
}

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
