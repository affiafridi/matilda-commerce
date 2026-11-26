const TTL_MS = 30_000;
const MAX_ENTRIES = 500;

export interface CatalogCacheScope {
  brandId: string;
  marketId: string;
  language: string;
}

/**
 * Cache key of one public catalog response. Brand, market and language are always part of it
 * (CLAUDE.md rule 9), so one brand's or market's data can never answer another's request.
 */
export function catalogCacheKey(
  scope: CatalogCacheScope,
  resource: string,
  params: Record<string, unknown> = {},
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k] ?? '')}`)
    .join('&');
  return `catalog|${scope.brandId}|${scope.marketId}|${scope.language}|${resource}|${sorted}`;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Small in-process cache for public catalog reads. Public data only (never customer data).
 * Entries live 30 seconds, so a publish, unpublish or price change reaches the storefront within
 * that time without any invalidation hooks. A shared cache (Redis) with tag invalidation replaces
 * it when the API runs on several instances.
 */
export class PublicCatalogCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const promise = load()
      .then((value) => {
        if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
        this.entries.set(key, { value, expiresAt: Date.now() + TTL_MS });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}
