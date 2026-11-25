/**
 * Working scope (brand → market → branch) rules, kept free of React so they can be unit tested.
 * The server validates and enforces scope on every call; this only decides what the switchers offer.
 */

export interface ScopeBrand {
  id: string;
  name: string;
}
export interface ScopeMarket {
  id: string;
  brandId: string;
  code: string;
}
export interface ScopeBranch {
  id: string;
  name: string;
  /** Markets the branch serves, with the owning brand of each link. */
  marketIds: string[];
}

export interface Scope {
  brandId: string | null;
  marketId: string | null;
  branchId: string | null;
}

export const EMPTY_SCOPE: Scope = { brandId: null, marketId: null, branchId: null };

export interface ScopeOptions {
  brands: ScopeBrand[];
  markets: ScopeMarket[];
  branches: ScopeBranch[];
  /** "All brands" is offered only to people with platform-wide access. */
  platformWide: boolean;
}

/** What each switcher may show for the current selection. */
export function scopeChoices(options: ScopeOptions, scope: Scope) {
  const markets = options.markets.filter((m) => !scope.brandId || m.brandId === scope.brandId);
  const marketIds = new Set(markets.map((m) => m.id));
  const branches = options.branches.filter((b) =>
    scope.marketId
      ? b.marketIds.includes(scope.marketId)
      : b.marketIds.some((id) => marketIds.has(id)) || !scope.brandId,
  );
  return {
    brands: options.brands,
    markets,
    branches,
    allowAllBrands: options.platformWide,
    /** Someone with a single reachable brand has nothing to switch between. */
    brandLocked: !options.platformWide && options.brands.length <= 1,
    marketLocked: markets.length <= 1 && !options.platformWide,
    branchLocked: branches.length <= 1 && !options.platformWide,
  };
}

/**
 * Brings a stored or requested selection back inside what the person may use: unknown brands are
 * dropped, a single reachable brand is selected for them, and a market or branch that no longer
 * fits its parent is cleared.
 */
export function normalizeScope(options: ScopeOptions, wanted: Scope): Scope {
  let brandId = wanted.brandId;
  if (brandId && !options.brands.some((b) => b.id === brandId)) brandId = null;
  if (!brandId && !options.platformWide && options.brands.length === 1) {
    brandId = options.brands[0]?.id ?? null;
  }
  const choices = scopeChoices(options, { brandId, marketId: null, branchId: null });
  let marketId = wanted.marketId;
  if (marketId && !choices.markets.some((m) => m.id === marketId)) marketId = null;
  if (!marketId && !options.platformWide && choices.markets.length === 1) {
    marketId = choices.markets[0]?.id ?? null;
  }
  const branchChoices = scopeChoices(options, { brandId, marketId, branchId: null }).branches;
  let branchId = wanted.branchId;
  if (branchId && !branchChoices.some((b) => b.id === branchId)) branchId = null;
  if (!branchId && !options.platformWide && branchChoices.length === 1) {
    branchId = branchChoices[0]?.id ?? null;
  }
  return { brandId, marketId, branchId };
}

/** Changing a level resets the levels below it. */
export function withBrand(scope: Scope, brandId: string | null): Scope {
  return { brandId, marketId: null, branchId: null };
}
export function withMarket(scope: Scope, marketId: string | null): Scope {
  return { ...scope, marketId, branchId: null };
}
export function withBranch(scope: Scope, branchId: string | null): Scope {
  return { ...scope, branchId };
}

/** Stable key part for query caches: switching scope never shows another scope's data. */
export const scopeKey = (scope: Scope): string =>
  `${scope.brandId ?? '*'}/${scope.marketId ?? '*'}/${scope.branchId ?? '*'}`;
