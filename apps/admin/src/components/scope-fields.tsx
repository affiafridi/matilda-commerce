'use client';

import { useAdminContext } from '@/lib/auth';
import { type Scope, scopeChoices, withBranch, withBrand, withMarket } from '@/lib/scope';
import { useScope } from './scope-context';
import { SelectField } from './ui/kit';

/**
 * Brand / market / branch pickers for a role assignment. "All" at a level means the grant covers
 * everything below the level above it; leaving every level on "All" is platform-wide and only
 * someone who holds that themselves can hand it out (the server enforces this).
 */
export function ScopeFields({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (next: Scope) => void;
}) {
  const context = useAdminContext(true);
  const { markets, branches } = useScope();
  const choices = scopeChoices(
    {
      platformWide: context.data?.platformWide ?? false,
      brands: (context.data?.brands ?? []).map((b) => ({ id: b.id, name: b.name })),
      markets: markets.map((m) => ({ id: m.id, brandId: m.brandId, code: m.code })),
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        marketIds: b.markets.map((l) => l.marketId),
      })),
    },
    value,
  );
  return (
    <fieldset className="mt-4">
      <legend className="text-[13px] font-medium">Applies to</legend>
      <div className="mt-2 space-y-3">
        <SelectField
          compact
          label="Brand"
          value={value.brandId ?? ''}
          onChange={(e) => onChange(withBrand(value, e.target.value || null))}
        >
          <option value="">All brands</option>
          {choices.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          compact
          label="Market"
          value={value.marketId ?? ''}
          disabled={!value.brandId}
          onChange={(e) => onChange(withMarket(value, e.target.value || null))}
        >
          <option value="">All markets</option>
          {choices.markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code.toUpperCase()}
            </option>
          ))}
        </SelectField>
        <SelectField
          compact
          label="Branch"
          value={value.branchId ?? ''}
          disabled={!value.brandId}
          onChange={(e) => onChange(withBranch(value, e.target.value || null))}
        >
          <option value="">All branches</option>
          {choices.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      </div>
    </fieldset>
  );
}

/** Human description of where an assignment applies. */
export function describeScope(
  a: { brandId: string | null; marketId: string | null; branchId: string | null },
  names: {
    brands: Array<{ id: string; name: string }>;
    markets: Array<{ id: string; code: string }>;
    branches: Array<{ id: string; name: string }>;
  },
): string {
  if (a.branchId) {
    const branch = names.branches.find((b) => b.id === a.branchId)?.name ?? 'Branch';
    return `Branch: ${branch}`;
  }
  const brand = a.brandId ? (names.brands.find((b) => b.id === a.brandId)?.name ?? 'Brand') : null;
  if (a.marketId) {
    const market = names.markets.find((m) => m.id === a.marketId)?.code.toUpperCase() ?? 'Market';
    return `Market: ${market}${brand ? ` · ${brand}` : ''}`;
  }
  return brand ? `Brand: ${brand}` : 'All brands';
}
