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
import { http } from '@/lib/http';
import {
  METHOD_KINDS,
  NeedsBrand,
  WEEKDAYS,
  itemsOrArray,
  methodKindLabel,
  nameOf,
  useBrandApi,
  useProducts,
} from '@/lib/ops';
import { MarketSelect, failure, useAreas, useDeliveryMarket, useZones, zoneName } from './shared';

interface Restriction {
  id: string;
  marketId: string;
  target: 'PRODUCT' | 'CATEGORY' | 'COLLECTION';
  targetId: string;
  condition: 'AREA' | 'ZONE' | 'DATE_RANGE' | 'WEEKDAY' | 'METHOD';
  areaId: string | null;
  zoneId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  weekday: number | null;
  methodKind: string | null;
  note: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

const CONDITIONS: Array<[Restriction['condition'], string]> = [
  ['AREA', 'An area'],
  ['ZONE', 'A zone'],
  ['DATE_RANGE', 'A date range'],
  ['WEEKDAY', 'A weekday'],
  ['METHOD', 'A delivery method'],
];

/** Categories or collections of the brand, for choosing what a restriction holds back. */
function useGroups(brandId: string | null, kind: 'categories' | 'collections') {
  return useQuery({
    queryKey: ['ops', brandId, kind],
    enabled: !!brandId,
    queryFn: async () =>
      itemsOrArray(
        await http.get<
          | Array<{ id: string; translations: Array<{ language: string; name: string }> }>
          | {
              items: Array<{ id: string; translations: Array<{ language: string; name: string }> }>;
            }
        >(`/admin/brands/${brandId}/catalog/${kind}`),
      ),
  });
}

export function RestrictionsScreen() {
  const { brandId, ready, api } = useBrandApi('delivery');
  const { markets, marketId, setMarketId } = useDeliveryMarket();
  const canManage = useCan('delivery.manage');
  const { nameOf: productName } = useProducts(brandId);
  const categories = useGroups(brandId, 'categories');
  const collections = useGroups(brandId, 'collections');
  const zones = useZones(marketId);
  const areas = useAreas();
  const [editing, setEditing] = useState<Restriction | 'new' | null>(null);
  const rows = useQuery({
    queryKey: ['delivery', brandId, 'restrictions', marketId],
    enabled: !!brandId && !!marketId,
    queryFn: async () =>
      itemsOrArray(
        await api.get<Restriction[] | { items: Restriction[] }>(
          `restrictions?marketId=${marketId}`,
        ),
      ),
  });

  const targetName = (r: Restriction) => {
    if (r.target === 'PRODUCT') return productName(r.targetId);
    const list = r.target === 'CATEGORY' ? categories.data : collections.data;
    const found = list?.find((x) => x.id === r.targetId);
    return found ? nameOf(found.translations, 'Untitled') : 'Unknown';
  };
  const describe = (r: Restriction) => {
    switch (r.condition) {
      case 'AREA':
        return nameOf(areas.data?.find((a) => a.id === r.areaId)?.translations, 'an area');
      case 'ZONE': {
        const z = zones.data?.find((x) => x.id === r.zoneId);
        return z ? zoneName(z) : 'a zone';
      }
      case 'DATE_RANGE':
        return `${r.dateFrom} to ${r.dateTo}`;
      case 'WEEKDAY':
        return r.weekday === null ? '' : `every ${WEEKDAYS[r.weekday]}`;
      case 'METHOD':
        return methodKindLabel(r.methodKind ?? '');
    }
  };

  return (
    <>
      <PageHeader
        title="Delivery restrictions"
        actions={
          canManage &&
          marketId && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              Add restriction
            </Button>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Delivery restrictions" />
      ) : (
        <>
          <p className="mb-3 max-w-prose text-[13px] text-muted">
            A restriction holds a product, a category or a collection back from delivery when its
            condition matches: for example, no fresh cakes to a far area, or no delivery of a
            product during a holiday.
          </p>
          <Toolbar>
            <MarketSelect markets={markets} value={marketId} onChange={setMarketId} />
          </Toolbar>
          <DataTable
            caption="Delivery restrictions"
            rows={rows.data}
            rowKey={(r) => r.id}
            loading={rows.isPending && !!marketId}
            error={
              rows.isError ? errorMessage(rows.error, 'We could not load restrictions.') : null
            }
            onRetry={() => void rows.refetch()}
            empty="No restrictions for this market."
            columns={[
              {
                id: 'target',
                header: 'Held back',
                cell: (r) => (
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="text-start font-medium underline-offset-2 hover:underline"
                  >
                    {targetName(r)}{' '}
                    <span className="text-xs font-normal text-muted">
                      ({r.target.toLowerCase()})
                    </span>
                  </button>
                ),
              },
              {
                id: 'cond',
                header: 'When',
                cell: (r) =>
                  `${CONDITIONS.find(([c]) => c === r.condition)?.[1] ?? r.condition}: ${describe(r)}`,
              },
              { id: 'note', header: 'Note', cell: (r) => r.note ?? '' },
              { id: 'status', header: 'Status', cell: (r) => <StatusTag value={r.status} /> },
            ]}
          />
          {marketId && (
            <RestrictionDrawer
              key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
              restriction={editing}
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

function RestrictionDrawer({
  restriction,
  marketId,
  canManage,
  onClose,
}: {
  restriction: Restriction | 'new' | null;
  marketId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useBrandApi('delivery');
  const queryClient = useQueryClient();
  const { products } = useProducts(brandId);
  const categories = useGroups(brandId, 'categories');
  const collections = useGroups(brandId, 'collections');
  const zones = useZones(marketId);
  const areas = useAreas();
  const existing = restriction && restriction !== 'new' ? restriction : null;
  const [target, setTarget] = useState<Restriction['target']>(existing?.target ?? 'PRODUCT');
  const [targetId, setTargetId] = useState(existing?.targetId ?? '');
  const [condition, setCondition] = useState<Restriction['condition']>(
    existing?.condition ?? 'AREA',
  );
  const [areaId, setAreaId] = useState(existing?.areaId ?? '');
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? '');
  const [dateFrom, setDateFrom] = useState(existing?.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(existing?.dateTo ?? '');
  const [weekday, setWeekday] = useState(String(existing?.weekday ?? 0));
  const [methodKind, setMethodKind] = useState(existing?.methodKind ?? 'SAME_DAY');
  const [note, setNote] = useState(existing?.note ?? '');
  const [status, setStatus] = useState(existing?.status ?? 'ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const targets: Array<{ id: string; name: string }> =
    target === 'PRODUCT'
      ? products.map((p) => ({ id: p.id, name: nameOf(p.translations, 'Untitled') }))
      : ((target === 'CATEGORY' ? categories.data : collections.data) ?? []).map((g) => ({
          id: g.id,
          name: nameOf(g.translations, 'Untitled'),
        }));

  const save = useMutation({
    mutationFn: () => {
      if (existing)
        return api.patch(`restrictions/${existing.id}`, { note: note.trim() || null, status });
      if (!targetId) throw new Error('Choose what is held back.');
      const common = {
        marketId,
        target,
        targetId,
        condition,
        status,
        ...(note.trim() && { note: note.trim() }),
      };
      switch (condition) {
        case 'AREA':
          if (!areaId) throw new Error('Choose the area.');
          return api.post('restrictions', { ...common, areaId });
        case 'ZONE':
          if (!zoneId) throw new Error('Choose the zone.');
          return api.post('restrictions', { ...common, zoneId });
        case 'DATE_RANGE':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo))
            throw new Error('Dates look like 2026-12-24.');
          return api.post('restrictions', { ...common, dateFrom, dateTo });
        case 'WEEKDAY':
          return api.post('restrictions', { ...common, weekday: Number(weekday) });
        case 'METHOD':
          return api.post('restrictions', { ...common, methodKind });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => setError(failure(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`restrictions/${existing!.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId] });
      onClose();
    },
    onError: (e) => {
      setRemoving(false);
      setError(failure(e));
    },
  });
  const locked = !!existing || !canManage;

  return (
    <Drawer
      open={restriction !== null}
      title={existing ? 'Edit restriction' : 'Add restriction'}
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
              Save restriction
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
      {existing && (
        <p className="mb-3 text-xs text-muted">
          Only the note and the status can change. To change what a rule does, delete it and add a
          new one.
        </p>
      )}
      <SelectField
        label="Hold back"
        value={target}
        disabled={locked}
        onChange={(e) => {
          setTarget(e.target.value as Restriction['target']);
          setTargetId('');
        }}
      >
        <option value="PRODUCT">A product</option>
        <option value="CATEGORY">A category</option>
        <option value="COLLECTION">A collection</option>
      </SelectField>
      <SelectField
        label="Which one"
        value={targetId}
        disabled={locked}
        onChange={(e) => setTargetId(e.target.value)}
      >
        <option value="">Choose</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="When the delivery is for"
        value={condition}
        disabled={locked}
        onChange={(e) => setCondition(e.target.value as Restriction['condition'])}
      >
        {CONDITIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      {condition === 'AREA' && (
        <SelectField
          label="Area"
          value={areaId}
          disabled={locked}
          onChange={(e) => setAreaId(e.target.value)}
        >
          <option value="">Choose an area</option>
          {areas.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {nameOf(a.translations, a.code)}
            </option>
          ))}
        </SelectField>
      )}
      {condition === 'ZONE' && (
        <SelectField
          label="Zone"
          value={zoneId}
          disabled={locked}
          onChange={(e) => setZoneId(e.target.value)}
        >
          <option value="">Choose a zone</option>
          {zones.data?.map((z) => (
            <option key={z.id} value={z.id}>
              {zoneName(z)}
            </option>
          ))}
        </SelectField>
      )}
      {condition === 'DATE_RANGE' && (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="From"
            help="YYYY-MM-DD"
            value={dateFrom}
            disabled={locked}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <TextField
            label="Until"
            help="YYYY-MM-DD"
            value={dateTo}
            disabled={locked}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      )}
      {condition === 'WEEKDAY' && (
        <SelectField
          label="Weekday"
          value={weekday}
          disabled={locked}
          onChange={(e) => setWeekday(e.target.value)}
        >
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </SelectField>
      )}
      {condition === 'METHOD' && (
        <SelectField
          label="Method"
          value={methodKind}
          disabled={locked}
          onChange={(e) => setMethodKind(e.target.value)}
        >
          {METHOD_KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
      )}
      <TextField
        label="Note (optional)"
        value={note}
        disabled={!canManage}
        onChange={(e) => setNote(e.target.value)}
      />
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
        title="Delete this restriction?"
        confirmLabel="Delete restriction"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(false)}
      >
        The item becomes deliverable again under this condition. This cannot be undone.
      </ConfirmDialog>
    </Drawer>
  );
}
