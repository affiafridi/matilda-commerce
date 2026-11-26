'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useScope } from '@/components/scope-context';
import { SelectField } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import {
  type Attribute,
  fromLocalInput,
  fromMinor,
  itemsOf,
  labelIn,
  toLocalInput,
  toMinor,
  useCatalog,
  useDraft,
} from '@/lib/catalog';
import { SaveBar, type TabProps, useSaveState } from '../product-editor';

interface PriceRow {
  id: string;
  marketId: string;
  currency: string;
  variationId: string | null;
  regular: number;
  sale: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
}
interface Variation {
  id: string;
  sku: string;
  active: boolean;
  values: Array<{ attributeId: string; attributeValueId: string }>;
}
interface Preview {
  items: Array<{
    variationId: string | null;
    sku: string | null;
    prices: Array<{
      currency: string;
      regular: number;
      sale: number | null;
      effective: number;
      onSale: boolean;
      display: string;
    }>;
  }>;
}

interface Cell {
  regular: string;
  sale: string;
  starts: string;
  ends: string;
}
const key = (variationId: string | null, marketId: string, currency: string) =>
  `${variationId ?? 'product'}|${marketId}|${currency}`;
const EMPTY: Cell = { regular: '', sale: '', starts: '', ends: '' };

export function PricingTab({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const { markets } = useScope();
  const canPrice = useCan('pricing.edit');
  const editable = canEdit && canPrice;
  const state = useSaveState();
  const soldIn = markets.filter((m) => m.brandId === brandId && product.marketIds.includes(m.id));

  const prices = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'prices'],
    queryFn: () => api.get<PriceRow[]>(`products/${product.id}/prices`),
  });
  const variations = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'variations'],
    enabled: product.type === 'VARIABLE',
    queryFn: () => api.get<Variation[]>(`products/${product.id}/variations`),
  });
  const library = useQuery({
    queryKey: ['catalog', brandId, 'attributes'],
    enabled: product.type === 'VARIABLE',
    queryFn: async () =>
      itemsOf(await api.get<Attribute[] | { items: Attribute[] }>('attributes?pageSize=200')),
  });

  const targets = useMemo(() => {
    if (product.type !== 'VARIABLE') return [{ id: null as string | null, label: 'Product' }];
    return (variations.data ?? [])
      .filter((v) => v.active)
      .map((v) => ({
        id: v.id as string | null,
        label:
          v.values
            .map((x) => {
              const val = library.data
                ?.find((a) => a.id === x.attributeId)
                ?.values.find((y) => y.id === x.attributeValueId);
              return val ? labelIn(val.translations) : '';
            })
            .filter(Boolean)
            .join(' / ') || v.sku,
      }));
  }, [product.type, variations.data, library.data]);

  const [cells, setCells] = useDraft<Record<string, Cell>>(
    prices.data ? String(prices.dataUpdatedAt) : null,
    () =>
      Object.fromEntries(
        (prices.data ?? []).map((p) => [
          key(p.variationId, p.marketId, p.currency),
          {
            regular: fromMinor(p.regular, p.currency),
            sale: p.sale === null ? '' : fromMinor(p.sale, p.currency),
            starts: toLocalInput(p.saleStartsAt),
            ends: toLocalInput(p.saleEndsAt),
          },
        ]),
      ),
    {},
  );
  const setCell = (k: string, patch: Partial<Cell>) =>
    setCells((c) => ({ ...c, [k]: { ...(c[k] ?? EMPTY), ...patch } }));

  const save = useMutation({
    mutationFn: () => {
      const rows: unknown[] = [];
      for (const t of targets) {
        for (const m of soldIn) {
          for (const c of m.currencies) {
            const k = key(t.id, m.id, c.currencyCode);
            const cell = cells[k];
            if (!cell || cell.regular.trim() === '') continue;
            const where = `${t.label}, ${m.code.toUpperCase()} ${c.currencyCode}`;
            const regular = toMinor(cell.regular, c.currencyCode);
            if (regular === null) throw new Error(`Enter a valid regular price for ${where}.`);
            const sale = cell.sale.trim() === '' ? undefined : toMinor(cell.sale, c.currencyCode);
            if (sale === null) throw new Error(`Enter a valid sale price for ${where}.`);
            if (sale !== undefined && sale >= regular) {
              throw new Error(`The sale price must be lower than the regular price for ${where}.`);
            }
            rows.push({
              marketId: m.id,
              currency: c.currencyCode,
              regular,
              ...(t.id && { variationId: t.id }),
              ...(sale !== undefined && {
                sale,
                ...(cell.starts && { saleStartsAt: fromLocalInput(cell.starts) }),
                ...(cell.ends && { saleEndsAt: fromLocalInput(cell.ends) }),
              }),
            });
          }
        }
      }
      return api.put(`products/${product.id}/prices`, { prices: rows });
    },
    onSuccess: async () => {
      state.ok();
      await prices.refetch();
      await refresh();
    },
    onError: state.fail,
  });

  return (
    <div>
      {soldIn.length === 0 && (
        <Alert tone="warn">
          This product is not sold in any market yet. Choose markets on the Organise tab first, then
          set prices.
        </Alert>
      )}
      {product.type === 'VARIABLE' && targets.length === 0 && soldIn.length > 0 && (
        <Alert tone="warn">Generate the variations first; each variation has its own price.</Alert>
      )}
      {product.type === 'BUNDLE' && (
        <p className="mb-3 text-xs text-muted">A bundle is sold at one fixed price per market.</p>
      )}
      {!canPrice && (
        <Alert tone="info" className="mb-3">
          Changing prices needs the permission to edit prices.
        </Alert>
      )}
      {prices.isError && <Alert tone="danger">{errorMessage(prices.error)}</Alert>}
      {targets.map((t) =>
        soldIn.map((m) =>
          m.currencies.map((c) => {
            const k = key(t.id, m.id, c.currencyCode);
            const cell = cells[k] ?? EMPTY;
            const where = `${t.label} ${m.code.toUpperCase()} ${c.currencyCode}`;
            return (
              <fieldset key={k} className="mt-4 rounded-md border border-line p-3">
                <legend className="px-1 text-[13px] font-medium">
                  {product.type === 'VARIABLE' ? `${t.label} · ` : ''}
                  {m.code.toUpperCase()} · {c.currencyCode}
                </legend>
                <div className="grid gap-x-3 sm:grid-cols-2">
                  <TextField
                    label={`Regular price ${where}`}
                    inputMode="decimal"
                    disabled={!editable}
                    value={cell.regular}
                    onChange={(e) => setCell(k, { regular: e.target.value })}
                    help={`In ${c.currencyCode}, e.g. 150.00. Leave empty for no price.`}
                  />
                  <TextField
                    label={`Sale price ${where}`}
                    inputMode="decimal"
                    disabled={!editable}
                    value={cell.sale}
                    onChange={(e) => setCell(k, { sale: e.target.value })}
                    help="Optional, below the regular price."
                  />
                  <TextField
                    label={`Sale starts ${where}`}
                    type="datetime-local"
                    disabled={!editable}
                    value={cell.starts}
                    onChange={(e) => setCell(k, { starts: e.target.value })}
                  />
                  <TextField
                    label={`Sale ends ${where}`}
                    type="datetime-local"
                    disabled={!editable}
                    value={cell.ends}
                    onChange={(e) => setCell(k, { ends: e.target.value })}
                  />
                </div>
              </fieldset>
            );
          }),
        ),
      )}
      {editable && soldIn.length > 0 && targets.length > 0 && (
        <SaveBar
          state={state}
          busy={save.isPending}
          onSave={() => save.mutate()}
          label="Save prices"
        />
      )}
      {soldIn.length > 0 && <PricePreview product={product} />}
    </div>
  );
}

/** What a shopper pays for one unit right now (or at a chosen time), from the server's own rules. */
function PricePreview({ product }: { product: TabProps['product'] }) {
  const { brandId, api } = useCatalog();
  const { markets } = useScope();
  const soldIn = markets.filter((m) => m.brandId === brandId && product.marketIds.includes(m.id));
  const [marketId, setMarketId] = useState(soldIn[0]?.id ?? '');
  const [at, setAt] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => {
      const q = new URLSearchParams({ marketId });
      const when = fromLocalInput(at);
      if (when) q.set('at', when);
      return api.get<Preview>(`products/${product.id}/price-preview?${q}`);
    },
    onSuccess: (r) => {
      setError(null);
      setResult(r);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <section aria-labelledby="preview-title" className="mt-10 border-t border-line pt-5">
      <h2 id="preview-title" className="text-[13px] font-semibold">
        Price preview
      </h2>
      <p className="mt-1 text-xs text-muted">
        Shows the price a shopper would pay for one unit, before options, add-ons, promotions and
        tax. Save your changes first.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <SelectField label="Market" value={marketId} onChange={(e) => setMarketId(e.target.value)}>
          {soldIn.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code.toUpperCase()}
            </option>
          ))}
        </SelectField>
        <TextField
          label="At (optional)"
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
        <Button busy={run.isPending} onClick={() => run.mutate()}>
          Preview
        </Button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      {result && (
        <ul aria-label="Preview result" className="mt-3 text-[13px]">
          {result.items.map((i) => (
            <li
              key={i.variationId ?? 'product'}
              className="border-b border-line py-2 last:border-b-0"
            >
              {i.sku && <span className="me-2 font-medium">{i.sku}</span>}
              {i.prices.length === 0 && <span className="text-muted">No price in this market</span>}
              {i.prices.map((p) => (
                <span key={p.currency}>
                  {p.display} {p.currency}
                  {p.onSale ? ' (on sale)' : ''}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
