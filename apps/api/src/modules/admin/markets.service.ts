import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../iam/authorization/authorization.service';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { type AdminActor, assertCan, isUniqueViolation, notFound, visibleTo } from './admin-common';

const defaulted = <T extends z.ZodType<string>>(code: T) =>
  z
    .array(z.object({ code, isDefault: z.boolean().default(false) }))
    .min(1)
    .max(20)
    .refine((list) => list.filter((i) => i.isDefault).length === 1, 'Exactly one default');

const currencies = defaulted(z.string().length(3).toUpperCase());
const languages = defaulted(z.string().min(2).max(10).toLowerCase());

export const createMarketBody = z.object({
  brandId: z.string().uuid(),
  countryIso2: z.string().length(2).toUpperCase(),
  code: z.string().regex(/^[a-z]{2,8}$/, 'Two to eight lowercase letters'),
  timezone: z.string().min(3).max(64),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
  taxInclusive: z.boolean().default(true),
  status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED']).default('DRAFT'),
  currencies,
  languages,
});
export const updateMarketBody = z
  .object({
    timezone: z.string().min(3).max(64),
    taxRateBps: z.number().int().min(0).max(10000),
    taxInclusive: z.boolean(),
    status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED']),
    currencies,
    languages,
  })
  .partial();

type CreateMarket = z.infer<typeof createMarketBody>;
type UpdateMarket = z.infer<typeof updateMarketBody>;

const INCLUDE = {
  country: { select: { iso2: true, name: true } },
  currencies: true,
  languages: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.MarketInclude;

@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authz: AuthorizationService,
    private readonly resolver: TenantResolver,
  ) {}

  async list(actor: AdminActor, brandId?: string) {
    const scope = await this.authz.dbScopeFor(actor.grants, 'markets.view');
    const rows = await withScope(this.prisma.client, scope, (tx) =>
      tx.market.findMany({
        where: brandId ? { brandId } : undefined,
        include: INCLUDE,
        orderBy: [{ brandId: 'asc' }, { code: 'asc' }],
      }),
    );
    // The database scope is brand-wide; a market-restricted grant only shows its own market.
    return visibleTo(actor.grants, 'markets.view', rows, (m) => [
      { brandId: m.brandId, marketId: m.id },
    ]);
  }

  async get(actor: AdminActor, id: string) {
    const market = (await this.list(actor)).find((m) => m.id === id);
    if (!market) throw notFound('Market');
    return market;
  }

  async create(actor: AdminActor, input: CreateMarket) {
    assertCan(actor.grants, 'markets.manage', { brandId: input.brandId });
    const country = await this.prisma.client.country.findUnique({
      where: { iso2: input.countryIso2 },
    });
    if (!country) throw new ApiException(422, 'UNKNOWN_COUNTRY', 'Unknown country');
    try {
      const created = await withScope(
        this.prisma.client,
        { brandIds: [input.brandId] },
        async (tx) => {
          if (!(await tx.brand.findUnique({ where: { id: input.brandId } }))) {
            throw notFound('Brand');
          }
          const market = await tx.market.create({
            data: {
              brandId: input.brandId,
              countryId: country.id,
              code: input.code,
              timezone: input.timezone,
              taxRateBps: input.taxRateBps,
              taxInclusive: input.taxInclusive,
              status: input.status,
              currencies: {
                create: input.currencies.map((c) => ({
                  currencyCode: c.code,
                  isDefault: c.isDefault,
                })),
              },
              languages: {
                create: input.languages.map((l, i) => ({
                  languageCode: l.code,
                  isDefault: l.isDefault,
                  sortOrder: i,
                })),
              },
            },
            include: INCLUDE,
          });
          await this.audit.record(tx, {
            action: 'market.create',
            targetType: 'market',
            targetId: market.id,
            actor: { type: 'STAFF', id: actor.staffId },
            brandId: input.brandId,
            marketId: market.id,
            after: input,
          });
          return market;
        },
      );
      this.resolver.invalidateBrand(input.brandId);
      return created;
    } catch (err) {
      throw this.writeError(err);
    }
  }

  async update(actor: AdminActor, id: string, patch: UpdateMarket) {
    const current = await this.get(actor, id);
    assertCan(actor.grants, 'markets.manage', { brandId: current.brandId, marketId: id });
    try {
      const updated = await withScope(
        this.prisma.client,
        { brandIds: [current.brandId] },
        async (tx) => {
          if (patch.currencies) {
            await tx.marketCurrency.deleteMany({ where: { marketId: id } });
            await tx.marketCurrency.createMany({
              data: patch.currencies.map((c) => ({
                marketId: id,
                currencyCode: c.code,
                isDefault: c.isDefault,
              })),
            });
          }
          if (patch.languages) {
            await tx.marketLanguage.deleteMany({ where: { marketId: id } });
            await tx.marketLanguage.createMany({
              data: patch.languages.map((l, i) => ({
                marketId: id,
                languageCode: l.code,
                isDefault: l.isDefault,
                sortOrder: i,
              })),
            });
          }
          const market = await tx.market.update({
            where: { id },
            data: {
              timezone: patch.timezone,
              status: patch.status,
              taxRateBps: patch.taxRateBps,
              taxInclusive: patch.taxInclusive,
            },
            include: INCLUDE,
          });
          await this.audit.record(tx, {
            action: 'market.update',
            targetType: 'market',
            targetId: id,
            actor: { type: 'STAFF', id: actor.staffId },
            brandId: current.brandId,
            marketId: id,
            before: {
              timezone: current.timezone,
              status: current.status,
              taxRateBps: current.taxRateBps,
              taxInclusive: current.taxInclusive,
              currencies: current.currencies,
              languages: current.languages,
            },
            after: patch,
          });
          return market;
        },
      );
      this.resolver.invalidateBrand(current.brandId);
      return updated;
    } catch (err) {
      throw this.writeError(err);
    }
  }

  private writeError(err: unknown): unknown {
    if (err instanceof ApiException) return err;
    if (isUniqueViolation(err)) {
      return new ApiException(
        409,
        'MARKET_EXISTS',
        'This brand already has a market for that country or code',
      );
    }
    const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
    if (/check constraint/i.test(text)) {
      return new ApiException(422, 'INVALID_VALUE', 'A value violates a data rule');
    }
    if (/foreign key/i.test(text)) {
      return new ApiException(422, 'UNKNOWN_REFERENCE', 'Unknown currency or language');
    }
    return err;
  }
}
