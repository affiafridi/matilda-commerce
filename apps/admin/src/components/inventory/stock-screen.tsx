'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  DataTable,
  Drawer,
  PageHeader,
  SelectField,
  StatusTag,
  Toolbar,
} from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import {
  NeedsBrand,
  toInt,
  useBrandApi,
  useBrandPlaces,
  useProducts,
  useVariations,
} from '@/lib/ops';

export interface StockRow {
  id: string;
  branchId: string;
  productId: string | null;
  variationId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  low: boolean;
  outOfStock: string | null;
  effectiveOutOfStock: string;
}

interface Movement {
  id: string;
  type: string;
  quantity: number;
  onHandAfter: number;
  reason: string | null;
  referenceType: string | null;
  createdAt: string;
}

interface Settings {
  reservationMinutes: number;
  maxExtensions: number;
  defaultOutOfStock: 'HIDE' | 'SHOW_UNAVAILABLE' | 'ALLOW_BACKORDER';
}

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: 'Receipt',
  ADJUSTMENT_IN: 'Adjustment in',
  ADJUSTMENT_OUT: 'Adjustment out',
  SALE: 'Sale',
  RETURN: 'Return',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  WASTAGE: 'Wastage',
  PRODUCTION_CONSUMPTION: 'Production',
};

const BEHAVIOUR: Array<[string, string]> = [
  ['HIDE', 'Hide the product'],
  ['SHOW_UNAVAILABLE', 'Show as unavailable'],
  ['ALLOW_BACKORDER', 'Allow backorders'],
];

/** Name of the item a stock row holds: the product, and the SKU of the variation when it has one. */
export function ItemName({
  item,
  brandId,
}: {
  item: { productId: string | null; variationId: string | null };
  brandId: string;
}) {
  const { nameOf } = useProducts(brandId);
  const variations = useVariations(brandId, item.variationId ? item.productId : null);
  const sku = variations.data?.find((v) => v.id === item.variationId)?.sku;
  return (
    <>
      {item.productId ? nameOf(item.productId) : 'Unknown product'}
      {item.variationId && <span className="text-muted"> · {sku ?? 'variation'}</span>}
    </>
  );
}

export function StockScreen() {
  const { brandId, ready, api } = useBrandApi('inventory');
  const { branches, branchName } = useBrandPlaces();
  const canAdjust = useCan('inventory.adjust');
  const [branchId, setBranchId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [open, setOpen] = useState<StockRow | null>(null);
  const [tracking, setTracking] = useState(false);
  const [settings, setSettings] = useState(false);

  const query = new URLSearchParams({ pageSize: '100' });
  if (branchId) query.set('branchId', branchId);
  if (lowOnly) query.set('low', 'true');
  const list = useQuery({
    queryKey: ['inventory', brandId, 'stock', branchId, lowOnly],
    enabled: !!brandId,
    queryFn: () => api.get<{ items: StockRow[]; total: number }>(`stock?${query}`),
  });
  const current = open && list.data?.items.find((r) => r.id === open.id);

  return (
    <>
      <PageHeader
        title="Stock"
        actions={
          canAdjust &&
          brandId && (
            <>
              <Button onClick={() => setSettings(true)}>Inventory settings</Button>
              <Button variant="primary" onClick={() => setTracking(true)}>
                Track item
              </Button>
            </>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Stock levels" />
      ) : (
        <>
          <Toolbar>
            <SelectField
              compact
              label="Branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <label className="flex h-9 items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />
              Low stock only
            </label>
          </Toolbar>
          <DataTable
            caption="Stock levels"
            rows={list.data?.items}
            rowKey={(r) => r.id}
            loading={list.isPending}
            error={list.isError ? errorMessage(list.error, 'We could not load stock.') : null}
            onRetry={() => void list.refetch()}
            empty="No stock is tracked yet. Use Track item to start counting a product at a branch."
            columns={[
              {
                id: 'item',
                header: 'Item',
                cell: (r) => (
                  <button
                    type="button"
                    onClick={() => setOpen(r)}
                    className="text-start font-medium underline-offset-2 hover:underline"
                  >
                    <ItemName item={r} brandId={brandId} />
                  </button>
                ),
              },
              { id: 'branch', header: 'Branch', cell: (r) => branchName(r.branchId) },
              { id: 'onHand', header: 'On hand', className: 'text-end', cell: (r) => r.onHand },
              {
                id: 'reserved',
                header: 'Reserved',
                className: 'text-end',
                cell: (r) => r.reserved,
              },
              {
                id: 'available',
                header: 'Available',
                className: 'text-end',
                cell: (r) => <strong>{r.available}</strong>,
              },
              {
                id: 'status',
                header: 'Status',
                cell: (r) =>
                  r.low ? (
                    <StatusTag value="DRAFT" label="Low stock" />
                  ) : (
                    <StatusTag value="ACTIVE" label="In stock" />
                  ),
              },
            ]}
          />
          {list.data && list.data.total > list.data.items.length && (
            <p className="mt-2 text-xs text-muted">
              Showing the first {list.data.items.length} of {list.data.total}. Filter by branch to
              narrow the list.
            </p>
          )}
        </>
      )}
      {brandId && (
        <>
          <StockDrawer
            key={current ? current.id : 'closed'}
            row={current || null}
            canAdjust={canAdjust}
            onClose={() => setOpen(null)}
          />
          <TrackDrawer
            key={`track-${tracking}`}
            open={tracking}
            onClose={() => setTracking(false)}
          />
          <SettingsDrawer
            key={`set-${settings}`}
            open={settings}
            onClose={() => setSettings(false)}
          />
        </>
      )}
    </>
  );
}

function StockDrawer({
  row,
  canAdjust,
  onClose,
}: {
  row: StockRow | null;
  canAdjust: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useBrandApi('inventory');
  const { branchName } = useBrandPlaces();
  const queryClient = useQueryClient();
  const [type, setType] = useState('RECEIPT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState('');
  const [countReason, setCountReason] = useState('');
  const [threshold, setThreshold] = useState(String(row?.lowStockThreshold ?? 0));
  const [behaviour, setBehaviour] = useState(row?.outOfStock ?? '');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['inventory', brandId, 'movements', row?.id],
    enabled: !!row,
    queryFn: () => api.get<{ items: Movement[] }>(`stock/${row!.id}/movements?limit=20`),
  });
  const refresh = async (message: string) => {
    setError(null);
    setDone(message);
    await queryClient.invalidateQueries({ queryKey: ['inventory', brandId] });
  };
  const fail = (e: unknown) => {
    setDone(null);
    setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
  };

  const move = useMutation({
    mutationFn: () => {
      const q = toInt(quantity);
      if (!q || q < 1) throw new Error('Enter a whole number of units, at least 1.');
      if (type !== 'RECEIPT' && reason.trim().length < 3)
        throw new Error('Say why the stock changed.');
      return api.post(`stock/${row!.id}/movements`, {
        type,
        quantity: q,
        ...(reason.trim() && { reason: reason.trim() }),
      });
    },
    onSuccess: async () => {
      setQuantity('');
      setReason('');
      await refresh('Movement recorded.');
    },
    onError: fail,
  });
  const count = useMutation({
    mutationFn: () => {
      const c = toInt(counted);
      if (c === null) throw new Error('Enter the number you counted.');
      if (countReason.trim().length < 3) throw new Error('Say what the count was for.');
      return api.post(`stock/${row!.id}/count`, { counted: c, reason: countReason.trim() });
    },
    onSuccess: async () => {
      setCounted('');
      setCountReason('');
      await refresh('Stocktake recorded.');
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: () => {
      const t = toInt(threshold);
      if (t === null) throw new Error('The low-stock level is a whole number.');
      return api.patch(`stock/${row!.id}`, {
        lowStockThreshold: t,
        outOfStock: behaviour || null,
      });
    },
    onSuccess: () => refresh('Settings saved.'),
    onError: fail,
  });

  return (
    <Drawer
      open={row !== null}
      title="Stock item"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {row && (
        <>
          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}
          {done && (
            <Alert tone="info" className="mb-4">
              {done}
            </Alert>
          )}
          <p className="text-[13px] font-semibold">
            {brandId && <ItemName item={row} brandId={brandId} />}
          </p>
          <p className="mb-3 text-xs text-muted">{branchName(row.branchId)}</p>
          <dl className="grid grid-cols-3 gap-2 rounded-md border border-line p-3 text-center text-[13px]">
            <div>
              <dt className="text-xs text-muted">On hand</dt>
              <dd className="text-base font-semibold">{row.onHand}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reserved</dt>
              <dd className="text-base font-semibold">{row.reserved}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Available</dt>
              <dd className="text-base font-semibold">{row.available}</dd>
            </div>
          </dl>
          {canAdjust && (
            <>
              <fieldset className="mt-6 border-t border-line pt-4">
                <legend className="px-1 text-[13px] font-semibold">Record a movement</legend>
                <SelectField
                  label="Movement"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="RECEIPT">Receipt (stock arrived)</option>
                  <option value="ADJUSTMENT_IN">Adjustment in</option>
                  <option value="ADJUSTMENT_OUT">Adjustment out</option>
                  <option value="WASTAGE">Wastage</option>
                </SelectField>
                <TextField
                  label="Units"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <TextField
                  label={type === 'RECEIPT' ? 'Note (optional)' : 'Reason'}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  className="mt-3"
                  variant="primary"
                  busy={move.isPending}
                  onClick={() => move.mutate()}
                >
                  Record movement
                </Button>
              </fieldset>
              <fieldset className="mt-6 border-t border-line pt-4">
                <legend className="px-1 text-[13px] font-semibold">Stocktake</legend>
                <TextField
                  label="Counted on the shelf"
                  inputMode="numeric"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
                <TextField
                  label="Count note"
                  value={countReason}
                  onChange={(e) => setCountReason(e.target.value)}
                />
                <Button className="mt-3" busy={count.isPending} onClick={() => count.mutate()}>
                  Record stocktake
                </Button>
              </fieldset>
              <fieldset className="mt-6 border-t border-line pt-4">
                <legend className="px-1 text-[13px] font-semibold">This item&apos;s rules</legend>
                <TextField
                  label="Low-stock level"
                  inputMode="numeric"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <SelectField
                  label="When it runs out"
                  value={behaviour}
                  onChange={(e) => setBehaviour(e.target.value)}
                >
                  <option value="">Follow the brand setting</option>
                  {BEHAVIOUR.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </SelectField>
                <Button className="mt-3" busy={save.isPending} onClick={() => save.mutate()}>
                  Save item rules
                </Button>
              </fieldset>
            </>
          )}
          <h3 className="mt-6 border-t border-line pt-4 text-[13px] font-semibold">History</h3>
          {history.isPending && <p className="mt-2 text-xs text-muted">Loading history…</p>}
          {history.data && history.data.items.length === 0 && (
            <p className="mt-2 text-xs text-muted">No movements yet.</p>
          )}
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {history.data?.items.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{MOVEMENT_LABEL[m.type] ?? m.type}</span>{' '}
                  {m.quantity}
                  {m.reason && <span className="block text-xs text-muted">{m.reason}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(m.createdAt).toLocaleString()} · {m.onHandAfter} on hand
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}

function TrackDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brandId, api } = useBrandApi('inventory');
  const { branches } = useBrandPlaces();
  const { products } = useProducts(brandId);
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [productId, setProductId] = useState('');
  const [variationId, setVariationId] = useState('');
  const [threshold, setThreshold] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const product = products.find((p) => p.id === productId);
  const variations = useVariations(brandId, product?.type === 'VARIABLE' ? productId : null);
  const trackable = products.filter((p) => p.type !== 'BUNDLE');

  const create = useMutation({
    mutationFn: () => {
      if (!branchId) throw new Error('Choose the branch.');
      if (!productId) throw new Error('Choose the product.');
      if (product?.type === 'VARIABLE' && !variationId) throw new Error('Choose the variation.');
      const t = toInt(threshold);
      if (t === null) throw new Error('The low-stock level is a whole number.');
      return api.post('stock', {
        branchId,
        productId,
        ...(variationId && { variationId }),
        lowStockThreshold: t,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory', brandId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });

  return (
    <Drawer
      open={open}
      title="Track an item"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={create.isPending} onClick={() => create.mutate()}>
            Start tracking
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <p className="mb-3 text-xs text-muted">
        Stock is counted per branch for a simple product or for each variation. Bundles take stock
        from their components. Tracking starts at zero; record a receipt to add units.
      </p>
      <SelectField label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
        <option value="">Choose a branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Product"
        value={productId}
        onChange={(e) => {
          setProductId(e.target.value);
          setVariationId('');
        }}
      >
        <option value="">Choose a product</option>
        {trackable.map((p) => (
          <option key={p.id} value={p.id}>
            {p.translations.find((t) => t.language === 'en')?.name ?? 'Untitled'}
          </option>
        ))}
      </SelectField>
      {product?.type === 'VARIABLE' && (
        <SelectField
          label="Variation"
          value={variationId}
          onChange={(e) => setVariationId(e.target.value)}
        >
          <option value="">Choose a variation</option>
          {variations.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.sku}
            </option>
          ))}
        </SelectField>
      )}
      <TextField
        label="Low-stock level"
        inputMode="numeric"
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
      />
    </Drawer>
  );
}

function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brandId, api } = useBrandApi('inventory');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{
    minutes: string;
    extensions: string;
    behaviour: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useQuery({
    queryKey: ['inventory', brandId, 'settings'],
    enabled: open && !!brandId,
    queryFn: () => api.get<Settings>('settings'),
  });
  const draft = form ?? {
    minutes: String(loaded.data?.reservationMinutes ?? ''),
    extensions: String(loaded.data?.maxExtensions ?? ''),
    behaviour: loaded.data?.defaultOutOfStock ?? 'SHOW_UNAVAILABLE',
  };
  const save = useMutation({
    mutationFn: () => {
      const minutes = toInt(draft.minutes);
      const extensions = toInt(draft.extensions);
      if (!minutes || minutes < 1 || minutes > 240)
        throw new Error('The hold lasts 1 to 240 minutes.');
      if (extensions === null || extensions > 5) throw new Error('Extensions are 0 to 5.');
      return api.put('settings', {
        reservationMinutes: minutes,
        maxExtensions: extensions,
        defaultOutOfStock: draft.behaviour,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory', brandId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });
  return (
    <Drawer
      open={open}
      title="Inventory settings"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Save settings
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <p className="mb-3 text-xs text-muted">
        These apply to the whole brand. A hold keeps stock and a delivery slot for a shopper while
        they check out.
      </p>
      <TextField
        label="Hold lasts (minutes)"
        inputMode="numeric"
        value={draft.minutes}
        onChange={(e) => setForm({ ...draft, minutes: e.target.value })}
      />
      <TextField
        label="Extensions allowed"
        inputMode="numeric"
        help="How many times a hold can be extended, for example when payment starts."
        value={draft.extensions}
        onChange={(e) => setForm({ ...draft, extensions: e.target.value })}
      />
      <SelectField
        label="When an item runs out"
        help="Items can override this on their own page."
        value={draft.behaviour}
        onChange={(e) => setForm({ ...draft, behaviour: e.target.value })}
      >
        {BEHAVIOUR.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
    </Drawer>
  );
}
