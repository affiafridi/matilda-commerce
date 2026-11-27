'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { NeedsBrand, toInt, useBrandApi, useBrandPlaces } from '@/lib/ops';
import {
  type Zone,
  MarketSelect,
  failure,
  useAreas,
  useDeliveryMarket,
  useZones,
  zoneName,
} from './shared';

export function ZonesScreen() {
  const { brandId, ready } = useBrandApi('delivery');
  const { markets, marketId, setMarketId } = useDeliveryMarket();
  const canManage = useCan('delivery.manage');
  const zones = useZones(marketId);
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Delivery zones"
        actions={
          canManage &&
          marketId && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              Add zone
            </Button>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Delivery zones" />
      ) : (
        <>
          <p className="mb-3 max-w-prose text-[13px] text-muted">
            A zone groups the areas you deliver to and says which branches serve them. Prices are
            set per zone and method under Methods and charges.
          </p>
          <Toolbar>
            <MarketSelect markets={markets} value={marketId} onChange={setMarketId} />
          </Toolbar>
          <DataTable
            caption="Delivery zones"
            rows={zones.data}
            rowKey={(z) => z.id}
            loading={zones.isPending && !!marketId}
            error={zones.isError ? errorMessage(zones.error, 'We could not load zones.') : null}
            onRetry={() => void zones.refetch()}
            empty={marketId ? 'No zones yet for this market.' : 'This brand has no market yet.'}
            columns={[
              {
                id: 'name',
                header: 'Zone',
                cell: (z) => (
                  <button
                    type="button"
                    onClick={() => setEditing(z)}
                    className="text-start font-medium underline-offset-2 hover:underline"
                  >
                    {zoneName(z)}
                  </button>
                ),
              },
              {
                id: 'code',
                header: 'Code',
                cell: (z) => <code className="text-xs">{z.code}</code>,
              },
              {
                id: 'areas',
                header: 'Areas',
                className: 'text-end',
                cell: (z) => z.areaIds.length,
              },
              {
                id: 'branches',
                header: 'Branches',
                className: 'text-end',
                cell: (z) => z.branches.length,
              },
              { id: 'status', header: 'Status', cell: (z) => <StatusTag value={z.status} /> },
            ]}
          />
          {marketId && (
            <ZoneDrawer
              key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
              zone={editing}
              marketId={marketId}
              canManage={canManage}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}
    </>
  );
}

function ZoneDrawer({
  zone,
  marketId,
  canManage,
  onClose,
}: {
  zone: Zone | 'new' | null;
  marketId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useBrandApi('delivery');
  const { branches } = useBrandPlaces();
  const areas = useAreas();
  const queryClient = useQueryClient();
  const existing = zone && zone !== 'new' ? zone : null;
  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState(existing ? zoneName(existing) : '');
  const [status, setStatus] = useState(existing?.status ?? 'ACTIVE');
  const [areaIds, setAreaIds] = useState<Set<string>>(new Set(existing?.areaIds ?? []));
  const [priorities, setPriorities] = useState<Record<string, string>>(
    Object.fromEntries((existing?.branches ?? []).map((b) => [b.branchId, String(b.priority)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const readOnly = !canManage;

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Give the zone a name.');
      let id = existing?.id;
      if (existing) {
        await api.patch(`zones/${existing.id}`, { code, status });
        await api.put(`zones/${existing.id}/translations/en`, { name: name.trim() });
      } else {
        const created = await api.post<Zone>('zones', {
          marketId,
          code,
          status,
          translations: [{ language: 'en', name: name.trim() }],
        });
        id = created.id;
      }
      await api.put(`zones/${id}/areas`, { areaIds: [...areaIds] });
      const links = Object.entries(priorities).map(([branchId, p]) => {
        const priority = toInt(p);
        if (priority === null) throw new Error('Priorities are whole numbers.');
        return { branchId, priority };
      });
      await api.put(`zones/${id}/branches`, { branches: links });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => setError(failure(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`zones/${existing!.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => {
      setRemoving(false);
      setError(failure(e));
    },
  });

  const toggleArea = (id: string) => {
    const next = new Set(areaIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAreaIds(next);
  };
  const toggleBranch = (id: string) => {
    const next = { ...priorities };
    if (id in next) delete next[id];
    else next[id] = '0';
    setPriorities(next);
  };

  const list = areas.data ?? [];

  return (
    <Drawer
      open={zone !== null}
      title={existing ? 'Edit zone' : 'Add zone'}
      onClose={onClose}
      footer={
        <>
          {existing && !readOnly && (
            <Button variant="danger" onClick={() => setRemoving(true)}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              Save zone
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
        disabled={readOnly}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Code"
        help="Lower-case letters, numbers and hyphens, for example dubai-central."
        value={code}
        disabled={readOnly}
        onChange={(e) => setCode(e.target.value)}
      />
      <SelectField
        label="Status"
        value={status}
        disabled={readOnly}
        onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
      >
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
      </SelectField>
      <fieldset className="mt-5 border-t border-line pt-4">
        <legend className="px-1 text-[13px] font-semibold">Areas covered</legend>
        {areas.isPending && <p className="text-xs text-muted">Loading areas…</p>}
        {areas.data && list.length === 0 && (
          <p className="text-xs text-muted">
            No areas exist yet. They are set up by the platform team.
          </p>
        )}
        <ul className="max-h-56 overflow-y-auto">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1 text-[13px]">
              <input
                id={`area-${a.id}`}
                type="checkbox"
                className="size-4"
                checked={areaIds.has(a.id)}
                disabled={readOnly}
                onChange={() => toggleArea(a.id)}
              />
              <label htmlFor={`area-${a.id}`}>
                {a.translations.find((t) => t.language === 'en')?.name ?? a.code}
                <span className="text-xs text-muted"> · {a.level.toLowerCase()}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset className="mt-5 border-t border-line pt-4">
        <legend className="px-1 text-[13px] font-semibold">Branches that serve this zone</legend>
        <p className="mb-2 text-xs text-muted">A lower priority number is tried first.</p>
        {branches.map((b) => (
          <div key={b.id} className="flex items-center gap-3 py-1 text-[13px]">
            <input
              id={`branch-${b.id}`}
              type="checkbox"
              className="size-4"
              checked={b.id in priorities}
              disabled={readOnly}
              onChange={() => toggleBranch(b.id)}
            />
            <label htmlFor={`branch-${b.id}`} className="grow">
              {b.name}
            </label>
            {b.id in priorities && (
              <input
                aria-label={`Priority for ${b.name}`}
                inputMode="numeric"
                className="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-sm"
                value={priorities[b.id]}
                disabled={readOnly}
                onChange={(e) => setPriorities({ ...priorities, [b.id]: e.target.value })}
              />
            )}
          </div>
        ))}
      </fieldset>
      <ConfirmDialog
        open={removing}
        title="Delete this zone?"
        confirmLabel="Delete zone"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(false)}
      >
        Its charges and slot links are removed with it. This cannot be undone.
      </ConfirmDialog>
    </Drawer>
  );
}
