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
import {
  METHOD_KINDS,
  NeedsBrand,
  WEEKDAYS,
  itemsOrArray,
  methodKindLabel,
  toInt,
  useBrandApi,
  useBrandPlaces,
} from '@/lib/ops';
import { MarketSelect, failure, isTime, useDeliveryMarket, useZones, zoneName } from './shared';

interface Slot {
  id: string;
  marketId: string;
  branchId: string;
  zoneId: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  cutoffTime: string;
  cutoffDaysBefore: number;
  methods: string[];
  status: 'ACTIVE' | 'INACTIVE';
}

export function SlotsScreen() {
  const { brandId, ready, api } = useBrandApi('delivery');
  const { branchName } = useBrandPlaces();
  const { markets, marketId, setMarketId } = useDeliveryMarket();
  const canManage = useCan('delivery.manage');
  const zones = useZones(marketId);
  const [editing, setEditing] = useState<Slot | 'new' | null>(null);
  const slots = useQuery({
    queryKey: ['delivery', brandId, 'slots', marketId],
    enabled: !!brandId && !!marketId,
    queryFn: async () =>
      itemsOrArray(await api.get<Slot[] | { items: Slot[] }>(`slots?marketId=${marketId}`)),
  });

  return (
    <>
      <PageHeader
        title="Delivery slots"
        actions={
          canManage &&
          marketId && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              Add slot
            </Button>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Delivery slots" />
      ) : (
        <>
          <p className="mb-3 max-w-prose text-[13px] text-muted">
            A slot is a weekly delivery window for one branch, with how many orders it takes per day
            and the last moment a customer can still choose it. Times are local to the branch.
          </p>
          <Toolbar>
            <MarketSelect markets={markets} value={marketId} onChange={setMarketId} />
          </Toolbar>
          <DataTable
            caption="Delivery slots"
            rows={slots.data}
            rowKey={(s) => s.id}
            loading={slots.isPending && !!marketId}
            error={slots.isError ? errorMessage(slots.error, 'We could not load slots.') : null}
            onRetry={() => void slots.refetch()}
            empty="No slots yet for this market."
            columns={[
              {
                id: 'when',
                header: 'Window',
                cell: (s) => (
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="text-start font-medium underline-offset-2 hover:underline"
                  >
                    {WEEKDAYS[s.weekday]} {s.startTime}–{s.endTime}
                  </button>
                ),
              },
              { id: 'branch', header: 'Branch', cell: (s) => branchName(s.branchId) },
              {
                id: 'zone',
                header: 'Zone',
                cell: (s) => {
                  const z = zones.data?.find((x) => x.id === s.zoneId);
                  return s.zoneId ? (z ? zoneName(z) : 'Unknown zone') : 'All zones of the branch';
                },
              },
              {
                id: 'cap',
                header: 'Orders per day',
                className: 'text-end',
                cell: (s) => s.capacity,
              },
              {
                id: 'methods',
                header: 'Methods',
                cell: (s) => s.methods.map(methodKindLabel).join(', '),
              },
              { id: 'status', header: 'Status', cell: (s) => <StatusTag value={s.status} /> },
            ]}
          />
          {marketId && (
            <SlotDrawer
              key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
              slot={editing}
              marketId={marketId}
              zones={zones.data ?? []}
              canManage={canManage}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}
    </>
  );
}

function SlotDrawer({
  slot,
  marketId,
  zones,
  canManage,
  onClose,
}: {
  slot: Slot | 'new' | null;
  marketId: string;
  zones: ReturnType<typeof useZones>['data'] & object;
  canManage: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useBrandApi('delivery');
  const { branches } = useBrandPlaces();
  const queryClient = useQueryClient();
  const existing = slot && slot !== 'new' ? slot : null;
  const [branchId, setBranchId] = useState(existing?.branchId ?? '');
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? '');
  const [weekday, setWeekday] = useState(String(existing?.weekday ?? 1));
  const [start, setStart] = useState(existing?.startTime ?? '10:00');
  const [end, setEnd] = useState(existing?.endTime ?? '14:00');
  const [capacity, setCapacity] = useState(String(existing?.capacity ?? 10));
  const [cutoff, setCutoff] = useState(existing?.cutoffTime ?? '09:00');
  const [cutoffDays, setCutoffDays] = useState(String(existing?.cutoffDaysBefore ?? 0));
  const [methods, setMethods] = useState<Set<string>>(
    new Set(existing?.methods ?? ['SAME_DAY', 'NEXT_DAY', 'SCHEDULED']),
  );
  const [status, setStatus] = useState(existing?.status ?? 'ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      if (!existing && !branchId) throw new Error('Choose the branch.');
      if (!isTime(start) || !isTime(end) || !isTime(cutoff))
        throw new Error('Times look like 09:30.');
      const cap = toInt(capacity);
      const days = toInt(cutoffDays);
      if (!cap || cap < 1) throw new Error('Capacity is a whole number, at least 1.');
      if (days === null || days > 14) throw new Error('Cutoff days are 0 to 14.');
      if (methods.size === 0) throw new Error('Choose at least one method kind.');
      const fields = {
        weekday: Number(weekday),
        startTime: start,
        endTime: end,
        capacity: cap,
        cutoffTime: cutoff,
        cutoffDaysBefore: days,
        methods: [...methods],
        status,
      };
      return existing
        ? api.patch(`slots/${existing.id}`, { ...fields, zoneId: zoneId || null })
        : api.post('slots', { marketId, branchId, zoneId: zoneId || null, ...fields });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => setError(failure(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`slots/${existing!.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => {
      setRemoving(false);
      setError(failure(e));
    },
  });
  const toggle = (kind: string) => {
    const next = new Set(methods);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setMethods(next);
  };

  return (
    <Drawer
      open={slot !== null}
      title={existing ? 'Edit slot' : 'Add slot'}
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
              Save slot
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
        label="Branch"
        value={branchId}
        disabled={!!existing || !canManage}
        onChange={(e) => setBranchId(e.target.value)}
      >
        <option value="">Choose a branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Zone"
        value={zoneId}
        disabled={!canManage}
        onChange={(e) => setZoneId(e.target.value)}
      >
        <option value="">All zones of the branch</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {zoneName(z)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Day"
        value={weekday}
        disabled={!canManage}
        onChange={(e) => setWeekday(e.target.value)}
      >
        {WEEKDAYS.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Starts"
          value={start}
          disabled={!canManage}
          onChange={(e) => setStart(e.target.value)}
        />
        <TextField
          label="Ends"
          value={end}
          disabled={!canManage}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      <TextField
        label="Orders per day"
        inputMode="numeric"
        value={capacity}
        disabled={!canManage}
        onChange={(e) => setCapacity(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Order cutoff"
          help="Last local time to choose this slot."
          value={cutoff}
          disabled={!canManage}
          onChange={(e) => setCutoff(e.target.value)}
        />
        <TextField
          label="Days before"
          help="0 means the same day."
          inputMode="numeric"
          value={cutoffDays}
          disabled={!canManage}
          onChange={(e) => setCutoffDays(e.target.value)}
        />
      </div>
      <fieldset className="mt-4">
        <legend className="mb-1 text-[13px] font-medium">Offered for</legend>
        {METHOD_KINDS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 py-1 text-[13px]">
            <input
              type="checkbox"
              className="size-4"
              checked={methods.has(v)}
              disabled={!canManage}
              onChange={() => toggle(v)}
            />
            {l}
          </label>
        ))}
      </fieldset>
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
        title="Delete this slot?"
        confirmLabel="Delete slot"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(false)}
      >
        Customers can no longer choose it. Orders already placed keep their chosen window.
      </ConfirmDialog>
    </Drawer>
  );
}
