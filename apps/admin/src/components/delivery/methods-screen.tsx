'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { fromMinor, toMinor } from '@/lib/catalog';
import { METHOD_KINDS, NeedsBrand, itemsOrArray, methodKindLabel, useBrandApi } from '@/lib/ops';
import {
  type Method,
  type Zone,
  MarketSelect,
  failure,
  methodName,
  useDeliveryMarket,
  useMethods,
  useZones,
  zoneName,
} from './shared';

interface Charge {
  id: string;
  zoneId: string;
  methodId: string;
  currencyCode: string;
  feeMinor: number;
  minimumOrderMinor: number;
  freeOverMinor: number | null;
}

export function MethodsScreen() {
  const { brandId, ready, api } = useBrandApi('delivery');
  const { markets, market, marketId, setMarketId } = useDeliveryMarket();
  const canManage = useCan('delivery.manage');
  const methods = useMethods(marketId);
  const zones = useZones(marketId);
  const charges = useQuery({
    queryKey: ['delivery', brandId, 'charges', marketId],
    enabled: !!brandId && !!marketId,
    queryFn: async () => {
      const all = itemsOrArray(await api.get<Charge[] | { items: Charge[] }>('charges'));
      const zoneIds = new Set((zones.data ?? []).map((z) => z.id));
      return all.filter((c) => zoneIds.has(c.zoneId));
    },
  });
  const [editing, setEditing] = useState<Method | 'new' | null>(null);
  const [charging, setCharging] = useState<Charge | 'new' | null>(null);
  const currency = market?.currencies.find((c) => c.isDefault)?.currencyCode ?? 'AED';

  return (
    <>
      <PageHeader
        title="Methods and fees"
        actions={
          canManage &&
          marketId && (
            <>
              <Button onClick={() => setCharging('new')}>Add fee</Button>
              <Button variant="primary" onClick={() => setEditing('new')}>
                Add method
              </Button>
            </>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Delivery methods" />
      ) : (
        <>
          <p className="mb-3 max-w-prose text-[13px] text-muted">
            A method is how an order is delivered: same day, next day or scheduled. A method is
            offered in a zone only when it has a charge there.
          </p>
          <Toolbar>
            <MarketSelect markets={markets} value={marketId} onChange={setMarketId} />
          </Toolbar>
          <DataTable
            caption="Delivery methods"
            rows={methods.data}
            rowKey={(m) => m.id}
            loading={methods.isPending && !!marketId}
            error={
              methods.isError ? errorMessage(methods.error, 'We could not load methods.') : null
            }
            onRetry={() => void methods.refetch()}
            empty="No methods yet for this market."
            columns={[
              {
                id: 'name',
                header: 'Method',
                cell: (m) => (
                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    className="text-start font-medium underline-offset-2 hover:underline"
                  >
                    {methodName(m)}
                  </button>
                ),
              },
              { id: 'kind', header: 'Kind', cell: (m) => methodKindLabel(m.kind) },
              {
                id: 'code',
                header: 'Code',
                cell: (m) => <code className="text-xs">{m.code}</code>,
              },
              { id: 'status', header: 'Status', cell: (m) => <StatusTag value={m.status} /> },
            ]}
          />
          <h2 className="mb-2 mt-8 text-[13px] font-semibold">Fees by zone</h2>
          <DataTable
            caption="Delivery fees"
            rows={charges.data}
            rowKey={(c) => c.id}
            loading={charges.isPending && !!marketId}
            error={
              charges.isError ? errorMessage(charges.error, 'We could not load charges.') : null
            }
            onRetry={() => void charges.refetch()}
            empty="No fees yet. Add one so a method can be offered in a zone."
            columns={[
              {
                id: 'zone',
                header: 'Zone',
                cell: (c) => {
                  const z = zones.data?.find((x) => x.id === c.zoneId);
                  return (
                    <button
                      type="button"
                      onClick={() => setCharging(c)}
                      className="text-start font-medium underline-offset-2 hover:underline"
                    >
                      {z ? zoneName(z) : 'Unknown zone'}
                    </button>
                  );
                },
              },
              {
                id: 'method',
                header: 'Method',
                cell: (c) => {
                  const m = methods.data?.find((x) => x.id === c.methodId);
                  return m ? methodName(m) : 'Unknown method';
                },
              },
              {
                id: 'fee',
                header: 'Fee',
                className: 'text-end',
                cell: (c) => `${c.currencyCode} ${fromMinor(c.feeMinor, c.currencyCode)}`,
              },
              {
                id: 'min',
                header: 'Minimum order',
                className: 'text-end',
                cell: (c) => fromMinor(c.minimumOrderMinor, c.currencyCode),
              },
              {
                id: 'free',
                header: 'Free over',
                className: 'text-end',
                cell: (c) =>
                  c.freeOverMinor === null ? '—' : fromMinor(c.freeOverMinor, c.currencyCode),
              },
            ]}
          />
          {marketId && (
            <>
              <MethodDrawer
                key={editing === null ? 'm-closed' : editing === 'new' ? 'm-new' : editing.id}
                method={editing}
                marketId={marketId}
                canManage={canManage}
                onClose={() => setEditing(null)}
              />
              <ChargeDrawer
                key={charging === null ? 'c-closed' : charging === 'new' ? 'c-new' : charging.id}
                charge={charging}
                currency={currency}
                zones={zones.data ?? []}
                methods={methods.data ?? []}
                canManage={canManage}
                onClose={() => setCharging(null)}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

function MethodDrawer({
  method,
  marketId,
  canManage,
  onClose,
}: {
  method: Method | 'new' | null;
  marketId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useBrandApi('delivery');
  const queryClient = useQueryClient();
  const existing = method && method !== 'new' ? method : null;
  const [kind, setKind] = useState(existing?.kind ?? 'SAME_DAY');
  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState(existing ? methodName(existing) : '');
  const [status, setStatus] = useState(existing?.status ?? 'ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Give the method a name.');
      if (existing) {
        await api.patch(`methods/${existing.id}`, { kind, code, status });
        await api.put(`methods/${existing.id}/translations/en`, { name: name.trim() });
      } else {
        await api.post('methods', {
          marketId,
          kind,
          code,
          status,
          translations: [{ language: 'en', name: name.trim() }],
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => setError(failure(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`methods/${existing!.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => {
      setRemoving(false);
      setError(failure(e));
    },
  });

  return (
    <Drawer
      open={method !== null}
      title={existing ? 'Edit method' : 'Add method'}
      onClose={onClose}
      footer={
        <>
          {existing && canManage && (
            <Button variant="danger" onClick={() => setRemoving(true)}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>{canManage ? 'Cancel' : 'Close'}</Button>
          {canManage && (
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              Save method
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <TextField
        label="Name"
        value={name}
        disabled={!canManage}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Code"
        help="Lower-case letters, numbers and hyphens."
        value={code}
        disabled={!canManage}
        onChange={(e) => setCode(e.target.value)}
      />
      <SelectField
        label="Kind"
        help="Kinds decide which delivery dates a method is offered on."
        value={kind}
        disabled={!canManage}
        onChange={(e) => setKind(e.target.value as Method['kind'])}
      >
        {METHOD_KINDS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Status"
        value={status}
        disabled={!canManage}
        onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
      >
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
      </SelectField>
      <ConfirmDialog
        open={removing}
        title="Delete this method?"
        confirmLabel="Delete method"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(false)}
      >
        Its charges are removed with it. This cannot be undone.
      </ConfirmDialog>
    </Drawer>
  );
}

function ChargeDrawer({
  charge,
  currency,
  zones,
  methods,
  canManage,
  onClose,
}: {
  charge: Charge | 'new' | null;
  currency: string;
  zones: Zone[];
  methods: Method[];
  canManage: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useBrandApi('delivery');
  const queryClient = useQueryClient();
  const existing = charge && charge !== 'new' ? charge : null;
  const cur = existing?.currencyCode ?? currency;
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? '');
  const [methodId, setMethodId] = useState(existing?.methodId ?? '');
  const [fee, setFee] = useState(existing ? fromMinor(existing.feeMinor, cur) : '');
  const [minimum, setMinimum] = useState(
    existing ? fromMinor(existing.minimumOrderMinor, cur) : '0',
  );
  const [freeOver, setFreeOver] = useState(
    existing?.freeOverMinor != null ? fromMinor(existing.freeOverMinor, cur) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      if (!existing && (!zoneId || !methodId)) throw new Error('Choose the zone and the method.');
      const feeMinor = toMinor(fee, cur);
      const minimumOrderMinor = toMinor(minimum || '0', cur);
      const freeOverMinor = freeOver.trim() ? toMinor(freeOver, cur) : null;
      if (feeMinor === null)
        throw new Error('Enter the fee as an amount, for example 25 or 25.50.');
      if (minimumOrderMinor === null) throw new Error('Enter the minimum order as an amount.');
      if (freeOver.trim() && freeOverMinor === null)
        throw new Error('Enter the free-delivery level as an amount.');
      return existing
        ? api.patch(`charges/${existing.id}`, { feeMinor, minimumOrderMinor, freeOverMinor })
        : api.post('charges', {
            zoneId,
            methodId,
            currencyCode: cur,
            feeMinor,
            minimumOrderMinor,
            freeOverMinor,
          });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => setError(failure(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`charges/${existing!.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => {
      setRemoving(false);
      setError(failure(e));
    },
  });

  return (
    <Drawer
      open={charge !== null}
      title={existing ? 'Edit fee' : 'Add fee'}
      onClose={onClose}
      footer={
        <>
          {existing && canManage && (
            <Button variant="danger" onClick={() => setRemoving(true)}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>{canManage ? 'Cancel' : 'Close'}</Button>
          {canManage && (
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              Save fee
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <SelectField
        label="Zone"
        value={zoneId}
        disabled={!!existing || !canManage}
        onChange={(e) => setZoneId(e.target.value)}
      >
        <option value="">Choose a zone</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {zoneName(z)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Method"
        value={methodId}
        disabled={!!existing || !canManage}
        onChange={(e) => setMethodId(e.target.value)}
      >
        <option value="">Choose a method</option>
        {methods.map((m) => (
          <option key={m.id} value={m.id}>
            {methodName(m)}
          </option>
        ))}
      </SelectField>
      <TextField
        label={`Fee (${cur})`}
        inputMode="decimal"
        value={fee}
        disabled={!canManage}
        onChange={(e) => setFee(e.target.value)}
      />
      <TextField
        label={`Minimum order (${cur})`}
        inputMode="decimal"
        value={minimum}
        disabled={!canManage}
        onChange={(e) => setMinimum(e.target.value)}
      />
      <TextField
        label={`Free delivery from (${cur})`}
        help="Leave empty when the fee always applies."
        inputMode="decimal"
        value={freeOver}
        disabled={!canManage}
        onChange={(e) => setFreeOver(e.target.value)}
      />
      <ConfirmDialog
        open={removing}
        title="Delete this fee?"
        confirmLabel="Delete fee"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(false)}
      >
        The method will no longer be offered in this zone. This cannot be undone.
      </ConfirmDialog>
    </Drawer>
  );
}
