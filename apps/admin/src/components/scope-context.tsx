'use client';

import { ApiError } from '@matilda/api-client';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { type AdminContext } from '@/lib/auth';
import { http } from '@/lib/http';
import {
  EMPTY_SCOPE,
  type Scope,
  type ScopeOptions,
  normalizeScope,
  scopeChoices,
  scopeKey,
  withBranch,
  withBrand,
  withMarket,
} from '@/lib/scope';
import type { Branch, Market } from '@/lib/types';

interface ScopeApi {
  scope: Scope;
  /** Stable text for query keys. */
  key: string;
  choices: ReturnType<typeof scopeChoices>;
  ready: boolean;
  selectBrand: (id: string | null) => Promise<void>;
  selectMarket: (id: string | null) => void;
  selectBranch: (id: string | null) => void;
  markets: Market[];
  branches: Branch[];
}

const ScopeContext = createContext<ScopeApi | null>(null);

const storageKey = (staffId: string) => `matilda-admin-scope:${staffId}`;

function readStored(staffId: string): Scope {
  try {
    const raw = window.localStorage.getItem(storageKey(staffId));
    if (!raw) return EMPTY_SCOPE;
    const parsed = JSON.parse(raw) as Partial<Scope>;
    return {
      brandId: typeof parsed.brandId === 'string' ? parsed.brandId : null,
      marketId: typeof parsed.marketId === 'string' ? parsed.marketId : null,
      branchId: typeof parsed.branchId === 'string' ? parsed.branchId : null,
    };
  } catch {
    return EMPTY_SCOPE;
  }
}

/** Lists the person is not allowed to read simply stay empty; the server decides, not the menu. */
async function listOrEmpty<T>(path: string): Promise<T[]> {
  try {
    const result = await http.get<T[]>(path);
    return result;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return [];
    throw error;
  }
}

/**
 * Holds the working scope the top-bar switchers edit. Everything is re-validated by the API on each
 * call (the `X-Admin-Brand` check below, and scope checks on every record), so a tampered
 * browser value can at worst show an empty screen.
 */
export function ScopeProvider({
  context,
  children,
}: {
  context: AdminContext;
  children: ReactNode;
}) {
  const staffId = context.staff.id;
  const [wanted, setWanted] = useState<Scope>(() => readStored(staffId));

  const markets = useQuery({
    queryKey: ['admin', 'markets', 'all'],
    queryFn: () => listOrEmpty<Market>('/admin/markets'),
  });
  const branches = useQuery({
    queryKey: ['admin', 'branches', 'all'],
    queryFn: () => listOrEmpty<Branch>('/admin/branches'),
  });

  const options: ScopeOptions = useMemo(
    () => ({
      platformWide: context.platformWide,
      brands: context.brands.map((b) => ({ id: b.id, name: b.name })),
      markets: (markets.data ?? []).map((m) => ({ id: m.id, brandId: m.brandId, code: m.code })),
      branches: (branches.data ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        marketIds: b.markets.map((l) => l.marketId),
      })),
    }),
    [context, markets.data, branches.data],
  );

  const ready = !markets.isPending && !branches.isPending;
  const scope = useMemo(
    () => (ready ? normalizeScope(options, wanted) : EMPTY_SCOPE),
    [ready, options, wanted],
  );
  const choices = useMemo(() => scopeChoices(options, scope), [options, scope]);

  const apply = useCallback(
    (next: Scope) => {
      setWanted(next);
      try {
        window.localStorage.setItem(storageKey(staffId), JSON.stringify(next));
      } catch {
        // The choice is a convenience; losing it only resets the switchers.
      }
    },
    [staffId],
  );

  const selectBrand = useCallback(
    async (id: string | null) => {
      if (id) {
        // The API checks the brand against the person's grants; a forged id is refused (403).
        try {
          await http.get('/admin/me/context', { headers: { 'X-Admin-Brand': id } });
        } catch {
          return;
        }
      }
      apply(withBrand(scope, id));
    },
    [apply, scope],
  );

  const api: ScopeApi = {
    scope,
    key: scopeKey(scope),
    choices,
    ready,
    selectBrand,
    selectMarket: (id) => apply(withMarket(scope, id)),
    selectBranch: (id) => apply(withBranch(scope, id)),
    markets: markets.data ?? [],
    branches: branches.data ?? [],
  };
  return <ScopeContext.Provider value={api}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeApi {
  const value = useContext(ScopeContext);
  if (!value) throw new Error('useScope must be used inside the app shell');
  return value;
}
