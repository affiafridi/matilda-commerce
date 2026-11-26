'use client';

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import { useScope } from '@/components/scope-context';
import { Alert } from '@/components/ui/primitives';
import { http } from '@/lib/http';

/** Languages the catalog can be written in (English is required; Arabic is optional until launch). */
export const LANGUAGES = [
  { code: 'en', name: 'English', required: true },
  { code: 'ar', name: 'Arabic', required: false },
] as const;

export interface TextTranslation {
  language: string;
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  slug: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
}
export interface LabelTranslation {
  language: string;
  label: string;
  helpText?: string | null;
}

export type CatalogStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ProductType = 'SIMPLE' | 'VARIABLE' | 'BUNDLE';
export type Visibility = 'draft' | 'scheduled' | 'live' | 'expired' | 'archived';

export interface Taxon {
  id: string;
  status: CatalogStatus;
  sortOrder: number;
  parentId?: string | null;
  translations: TextTranslation[];
}

export interface Product {
  id: string;
  type: ProductType;
  status: CatalogStatus;
  visibility: Visibility;
  sku: string | null;
  publishAt: string | null;
  unpublishAt: string | null;
  madeToOrder: boolean;
  prepTimeMinutes: number | null;
  leadTimeMinutes: number | null;
  minQuantity: number;
  maxQuantity: number | null;
  primaryCategoryId: string | null;
  sortOrder: number;
  translations: TextTranslation[];
  categoryIds: string[];
  collectionIds: string[];
  tagIds: string[];
  marketIds: string[];
  branchIds: string[];
}

export interface Attribute {
  id: string;
  key: string;
  kind: 'TEXT' | 'COLOR' | 'NUMBER';
  translations: LabelTranslation[];
  values: Array<{
    id: string;
    key: string;
    colorHex: string | null;
    sortOrder: number;
    translations: LabelTranslation[];
  }>;
}

export interface MediaAsset {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  status: string;
  alt: Array<{ language: string; altText: string }>;
  variants: Array<{ kind: string; width: number; height: number }>;
}

/** Lists come back either as a bare array or as `{items}`; the screens accept both. */
export function itemsOf<T>(result: T[] | { items: T[] } | undefined): T[] {
  if (!result) return [];
  return Array.isArray(result) ? result : result.items;
}

export const nameIn = (rows: Array<{ language: string; name: string }>, language = 'en') =>
  rows.find((t) => t.language === language)?.name ?? rows[0]?.name ?? '';
export const labelIn = (rows: LabelTranslation[], language = 'en') =>
  rows.find((t) => t.language === language)?.label ?? rows[0]?.label ?? '';

/** Public URL of a processed picture (served by the API without sign-in). */
export const mediaUrl = (
  brandId: string,
  assetId: string,
  kind: 'thumbnail' | 'medium' | 'large',
) => `/api/v1/media/${brandId}/${assetId}/${kind}`;

const MINOR_DIGITS: Record<string, number> = {
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
  JPY: 0,
  KRW: 0,
};
export const minorDigits = (currency: string) => MINOR_DIGITS[currency] ?? 2;

/** "12.50" in major units to integer minor units (1250); null when it is not a valid amount. */
export function toMinor(text: string, currency: string): number | null {
  const digits = minorDigits(currency);
  const clean = text.trim();
  const re = new RegExp(`^\\d{1,9}(\\.\\d{1,${Math.max(digits, 1)}})?$`);
  if (!re.test(clean)) return null;
  if (digits === 0 && clean.includes('.')) return null;
  const [whole = '0', fraction = ''] = clean.split('.');
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0').slice(0, digits) || 0);
}

export function fromMinor(amount: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(amount);
  const text = String(amount).padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/** ISO instant to the value a datetime-local input understands (local time), and back. */
export const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (value: string): string | null =>
  value ? new Date(value).toISOString() : null;

/**
 * The brand the screens work in (from the top-bar switcher) and calls bound to its catalog API.
 * The server authorizes every call over this brand; nothing here is a security boundary.
 */
export function useCatalog() {
  const { scope, ready } = useScope();
  const brandId = scope.brandId;
  const api = useMemo(() => {
    const base = `/admin/brands/${brandId ?? ''}/catalog`;
    return {
      get: <T,>(path: string) => http.get<T>(`${base}/${path}`),
      post: <T,>(path: string, body: unknown = {}) => http.post<T>(`${base}/${path}`, body),
      put: <T,>(path: string, body: unknown = {}) => http.put<T>(`${base}/${path}`, body),
      patch: <T,>(path: string, body: unknown) => http.patch<T>(`${base}/${path}`, body),
      del: <T,>(path: string) => http.delete<T>(`${base}/${path}`),
    };
  }, [brandId]);
  return { brandId, ready, api };
}

/** Shown instead of a catalog screen until a brand is chosen in the top bar. */
export function NeedsBrand({ ready }: { ready: boolean }) {
  if (!ready) return null;
  return (
    <Alert tone="info">
      The catalog belongs to one brand. Choose a brand in the bar at the top to continue.
    </Alert>
  );
}

export const visibilityLabel: Record<Visibility, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  expired: 'Expired',
  archived: 'Archived',
};

/**
 * Form state that starts from server data and starts over whenever that data is reloaded (for
 * example after a save). `sourceKey` identifies the loaded data (null while it is still loading).
 * The state is adjusted while rendering, which React supports for exactly this case.
 */
export function useDraft<S>(
  sourceKey: string | null,
  build: () => S,
  empty: S,
): [S, Dispatch<SetStateAction<S>>] {
  const [state, setState] = useState<S>(empty);
  const [seen, setSeen] = useState<string | null>(null);
  if (sourceKey !== null && sourceKey !== seen) {
    setSeen(sourceKey);
    setState(build());
  }
  return [state, setState];
}
