import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { normalizeHost } from './host';

export interface ResolvedTenant {
  hostname: string;
  brand: { id: string; slug: string };
  market: { id: string; code: string } | null;
  /** Default language configured on the domain, if any. */
  language: string | null;
  isPrimary: boolean;
  redirectToPrimary: boolean;
}

interface DomainRow {
  brand_id: string;
  brand_slug: string;
  market_id: string | null;
  market_code: string | null;
  language_code: string | null;
  is_primary: boolean;
  redirect_to_primary: boolean;
}

interface CacheEntry {
  value: ResolvedTenant | null;
  expiresAt: number;
}

export const POSITIVE_TTL_MS = 60_000;
export const NEGATIVE_TTL_MS = 10_000;
const MAX_ENTRIES = 1000;

/**
 * Maps a hostname to brand/market/language using the SECURITY DEFINER function
 * `resolve_brand_domain` (the brand is unknown until the host is resolved, so row-level security
 * cannot be scoped yet). Results are cached in process memory; domain management (step 2.7) must
 * call `invalidate*` after any change. A shared cache (Redis) replaces this when the API runs on
 * several instances.
 */
@Injectable()
export class TenantResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(rawHost: string | null | undefined): Promise<ResolvedTenant | null> {
    const host = normalizeHost(rawHost ?? undefined);
    if (!host) return null;

    const cached = this.cache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const rows = await this.prisma.client.$queryRaw<
      DomainRow[]
    >`SELECT * FROM resolve_brand_domain(${host})`;
    const row = rows[0];
    const value: ResolvedTenant | null = row
      ? {
          hostname: host,
          brand: { id: row.brand_id, slug: row.brand_slug },
          market:
            row.market_id && row.market_code ? { id: row.market_id, code: row.market_code } : null,
          language: row.language_code,
          isPrimary: row.is_primary,
          redirectToPrimary: row.redirect_to_primary,
        }
      : null;

    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(host, {
      value,
      expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
    return value;
  }

  /** True when `origin` (scheme://host[:port]) is a registered, active brand domain. */
  async isBrandOrigin(origin: string): Promise<boolean> {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      return (await this.resolve(url.hostname)) !== null;
    } catch {
      return false;
    }
  }

  invalidateHost(host: string): void {
    const normalized = normalizeHost(host);
    if (normalized) this.cache.delete(normalized);
  }

  /** Drops the brand's domains and every cached "unknown host" (a new domain may now exist). */
  invalidateBrand(brandId: string): void {
    for (const [host, entry] of this.cache) {
      if (entry.value === null || entry.value.brand.id === brandId) this.cache.delete(host);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
