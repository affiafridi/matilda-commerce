'use client';

import { useQuery } from '@tanstack/react-query';
import { SelectField } from '@/components/ui/kit';
import { errorMessage } from '@/lib/auth';
import { http } from '@/lib/http';
import type { Market } from '@/lib/types';
import { itemsOrArray, nameOf, useBrandApi, useMarketChoice } from '@/lib/ops';

export interface Named {
  language: string;
  name: string;
}
export interface Zone {
  id: string;
  marketId: string;
  code: string;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  translations: Named[];
  areaIds: string[];
  branches: Array<{ branchId: string; priority: number }>;
}
export interface Method {
  id: string;
  marketId: string;
  kind: 'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED';
  code: string;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  translations: Named[];
}
export interface Area {
  id: string;
  parentId: string | null;
  level: string;
  code: string;
  status: string;
  translations: Named[];
}

/** Message for a failed save: plain errors from our own checks, or the server's message. */
export const failure = (e: unknown) =>
  e instanceof Error && !('status' in e) ? e.message : errorMessage(e);

/** "09:00" style text check shared by the forms. */
export const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const marketLabel = (m: Market) => `${m.country.name} (${m.code})`;

/** Market chooser shared by delivery screens; delivery rules are kept per market. */
export function MarketSelect({
  markets,
  value,
  onChange,
}: {
  markets: Market[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <SelectField
      compact
      label="Market"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {markets.length === 0 && <option value="">No markets</option>}
      {markets.map((m) => (
        <option key={m.id} value={m.id}>
          {marketLabel(m)}
        </option>
      ))}
    </SelectField>
  );
}

/** The market of the screen, with the picker's props ready to spread. */
export function useDeliveryMarket() {
  const choice = useMarketChoice();
  return choice;
}

export function useZones(marketId: string | null) {
  const { brandId, api } = useBrandApi('delivery');
  return useQuery({
    queryKey: ['delivery', brandId, 'zones', marketId],
    enabled: !!brandId && !!marketId,
    queryFn: async () =>
      itemsOrArray(await api.get<Zone[] | { items: Zone[] }>(`zones?marketId=${marketId}`)),
  });
}

export function useMethods(marketId: string | null) {
  const { brandId, api } = useBrandApi('delivery');
  return useQuery({
    queryKey: ['delivery', brandId, 'methods', marketId],
    enabled: !!brandId && !!marketId,
    queryFn: async () =>
      itemsOrArray(await api.get<Method[] | { items: Method[] }>(`methods?marketId=${marketId}`)),
  });
}

/** The shared location tree (emirates, cities, areas), read for pickers. */
export function useAreas() {
  return useQuery({
    queryKey: ['delivery', 'areas'],
    queryFn: async () =>
      itemsOrArray(await http.get<Area[] | { items: Area[] }>('/admin/delivery/areas')),
  });
}

export const zoneName = (z: Pick<Zone, 'translations' | 'code'>) => nameOf(z.translations, z.code);
export const methodName = (m: Pick<Method, 'translations' | 'code'>) =>
  nameOf(m.translations, m.code);
