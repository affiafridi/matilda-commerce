import { Injectable } from '@nestjs/common';
import type { StorefrontContext, StorefrontMarket } from '@matilda/types';
import { withScope } from '../../database/scope';
import { PrismaService } from '../../database/prisma.service';
import type { ResolvedTenant } from './tenant-resolver.service';

/** Public brand configuration for the storefront. Reads only the resolved brand's rows (scoped). */
@Injectable()
export class StorefrontContextService {
  constructor(private readonly prisma: PrismaService) {}

  async load(tenant: ResolvedTenant): Promise<StorefrontContext> {
    const brandId = tenant.brand.id;
    return withScope(this.prisma.client, { brandIds: [brandId] }, async (tx) => {
      const brand = await tx.brand.findUniqueOrThrow({
        where: { id: brandId },
        select: {
          slug: true,
          name: true,
          markets: {
            where: { OR: [{ id: tenant.market?.id ?? '' }, { status: 'ACTIVE' }] },
            orderBy: { code: 'asc' },
            select: {
              id: true,
              code: true,
              status: true,
              timezone: true,
              country: { select: { iso2: true, name: true } },
              currencies: {
                select: { isDefault: true, currency: true },
                orderBy: { currencyCode: 'asc' },
              },
              languages: {
                select: { isDefault: true, language: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
      });

      const toMarket = (m: (typeof brand.markets)[number]): StorefrontMarket => ({
        code: m.code,
        status: m.status,
        country: m.country,
        timezone: m.timezone,
        currencies: m.currencies.map((c) => ({
          code: c.currency.code,
          symbol: c.currency.symbol,
          minorUnitDigits: c.currency.minorUnitDigits,
          isDefault: c.isDefault,
        })),
        languages: m.languages.map((l) => ({
          code: l.language.code,
          name: l.language.name,
          nativeName: l.language.nativeName,
          direction: l.language.direction,
          isDefault: l.isDefault,
        })),
      });

      const current = brand.markets.find((m) => m.id === tenant.market?.id);
      const marketDefaultLanguage = current?.languages.find((l) => l.isDefault)?.language.code;

      let redirect: StorefrontContext['redirect'] = null;
      if (tenant.redirectToPrimary && !tenant.isPrimary) {
        const primary = await tx.brandDomain.findFirst({
          where: { brandId, marketId: tenant.market?.id ?? null, isPrimary: true },
          select: { hostname: true },
        });
        if (primary) redirect = { hostname: primary.hostname };
      }

      return {
        brand: { slug: brand.slug, name: brand.name, themeKey: brand.slug },
        market: current ? toMarket(current) : null,
        markets: brand.markets.filter((m) => m.status === 'ACTIVE').map(toMarket),
        language: tenant.language ?? marketDefaultLanguage ?? null,
        redirect,
      };
    });
  }
}
