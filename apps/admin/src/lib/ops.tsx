'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useScope } from '@/components/scope-context';
import { Alert } from '@/components/ui/primitives';
import { http } from '@/lib/http';
import type { Branch, Market } from '@/lib/types';

/** Calls bound to one brand's inventory or delivery API; the server authorizes every call. */
export function useBrandApi(section: 'inventory' | 'delivery') {
  const { scope, ready } = useScope();
  const brandId = scope.brandId;
  const api = useMemo(() => {
    const base = `/admin/brands/${brandId ?? ''}/${section}`;
    return {
      get: <T,>(path: string) => http.get<T>(`${base}/${path}`),
      post: <T,>(path: string, body: unknown = {}) => http.post<T>(`${base}/${path}`, body),
      put: <T,>(path: string, body: unknown = {}) => http.put<T>(`${base}/${path}`, body),
      patch: <T,>(path: string, body: unknown) => http.patch<T>(`${base}/${path}`, body),
      del: <T,>(path: string) => http.delete<T>(`${base}/${path}`),
    };
  }, [brandId, section]);
  return { brandId, ready, api };
}

/** Shown instead of a screen until a brand is chosen in the top bar. */
export function NeedsBrand({ ready, what }: { ready: boolean; what: string }) {
  if (!ready) return null;
  return (
    <Alert tone="info">
      {what} belong to one brand. Choose a brand in the bar at the top to continue.
    </Alert>
  );
}

/** The markets and branches of the brand being worked in. */
export function useBrandPlaces() {
  const { scope, markets, branches } = useScope();
  const brandId = scope.brandId;
  const brandMarkets = useMemo<Market[]>(
    () => markets.filter((m) => m.brandId === brandId),
    [markets, brandId],
  );
  const brandBranches = useMemo<Branch[]>(
    () => branches.filter((b) => b.markets.some((l) => l.market.brandId === brandId)),
    [branches, brandId],
  );
  const branchName = (id: string) =>
    brandBranches.find((b) => b.id === id)?.name ?? 'Unknown branch';
  return { markets: brandMarkets, branches: brandBranches, branchName };
}

/** The market a screen works in: the one chosen in the top bar, else the first of the brand. */
export function useMarketChoice() {
  const { scope } = useScope();
  const { markets } = useBrandPlaces();
  const [picked, setPicked] = useState<string | null>(null);
  const marketId =
    [picked, scope.marketId].find((id) => id && markets.some((m) => m.id === id)) ??
    markets[0]?.id ??
    null;
  const market = markets.find((m) => m.id === marketId) ?? null;
  return { markets, marketId, market, setMarketId: setPicked };
}

export interface CatalogProduct {
  id: string;
  type: 'SIMPLE' | 'VARIABLE' | 'BUNDLE';
  translations: Array<{ language: string; name: string }>;
}
export interface CatalogVariation {
  id: string;
  sku: string;
}

export const productName = (p: Pick<CatalogProduct, 'translations'>) =>
  p.translations.find((t) => t.language === 'en')?.name ?? p.translations[0]?.name ?? 'Untitled';

/** Products of the brand (first 200) for pickers and for naming stock rows. */
export function useProducts(brandId: string | null) {
  const query = useQuery({
    queryKey: ['ops', brandId, 'products'],
    enabled: !!brandId,
    queryFn: async () => {
      const result = await http.get<{ items: CatalogProduct[] }>(
        `/admin/brands/${brandId}/catalog/products?pageSize=100`,
      );
      return result.items;
    },
  });
  const byId = useMemo(() => new Map((query.data ?? []).map((p) => [p.id, p])), [query.data]);
  return {
    products: query.data ?? [],
    loading: query.isPending && !!brandId,
    nameOf: (id: string) => {
      const p = byId.get(id);
      return p ? productName(p) : 'Unknown product';
    },
  };
}

/** SKUs of a variable product's variations, for the item picker. */
export function useVariations(brandId: string | null, productId: string | null) {
  return useQuery({
    queryKey: ['ops', brandId, 'variations', productId],
    enabled: !!brandId && !!productId,
    queryFn: () =>
      http.get<CatalogVariation[]>(
        `/admin/brands/${brandId}/catalog/products/${productId}/variations`,
      ),
  });
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const METHOD_KINDS = [
  ['SAME_DAY', 'Same day'],
  ['NEXT_DAY', 'Next day'],
  ['SCHEDULED', 'Scheduled'],
] as const;
export const methodKindLabel = (kind: string) =>
  METHOD_KINDS.find(([k]) => k === kind)?.[1] ?? kind;

/** Localized name of a record with `translations: [{language, name}]`, English first. */
export const nameOf = (
  rows: Array<{ language: string; name: string }> | undefined,
  fallback = '',
) => rows?.find((t) => t.language === 'en')?.name ?? rows?.[0]?.name ?? fallback;

/** Whole-number text to an integer; null when it is not one. */
export function toInt(text: string): number | null {
  const clean = text.trim();
  return /^\d{1,9}$/.test(clean) ? Number(clean) : null;
}

export const itemsOrArray = <T,>(result: T[] | { items: T[] } | undefined): T[] =>
  !result ? [] : Array.isArray(result) ? result : result.items;
