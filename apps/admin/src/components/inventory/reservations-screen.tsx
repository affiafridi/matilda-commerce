'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, PageHeader, SelectField, Toolbar } from '@/components/ui/kit';
import { Alert, Button } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { NeedsBrand, useBrandApi } from '@/lib/ops';

interface StockHold {
  id: string;
  status: string;
  checkoutRef: string;
  expiresAt: string;
  extendedCount: number;
  lines: Array<{ stockLevelId: string; quantity: number }>;
}
interface SlotHold {
  id: string;
  status: string;
  checkoutRef: string;
  date: string;
  units: number;
  expiresAt: string;
}

export function ReservationsScreen() {
  const { brandId, ready, api } = useBrandApi('inventory');
  const canAdjust = useCan('inventory.adjust');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [releasing, setReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['inventory', brandId, 'reservations', status],
    enabled: !!brandId,
    queryFn: () =>
      api.get<{ stock: StockHold[]; slots: SlotHold[] }>(`reservations?status=${status}`),
  });
  const release = useMutation({
    mutationFn: (ref: string) => api.post(`reservations/${encodeURIComponent(ref)}/release`, {}),
    onSuccess: async () => {
      setReleasing(null);
      await queryClient.invalidateQueries({ queryKey: ['inventory', brandId] });
    },
    onError: (e) => {
      setReleasing(null);
      setError(errorMessage(e));
    },
  });

  const when = (iso: string) => new Date(iso).toLocaleString();
  const releaseCell = (ref: string) =>
    canAdjust && status === 'ACTIVE' ? (
      <Button variant="quiet" onClick={() => setReleasing(ref)}>
        Release
      </Button>
    ) : null;

  return (
    <>
      <PageHeader title="Reservations" />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Reservations" />
      ) : (
        <>
          <p className="mb-3 max-w-prose text-[13px] text-muted">
            A reservation keeps stock and a delivery slot for a shopper while they check out. Holds
            free themselves when they expire; release one by hand only if it is stuck.
          </p>
          {error && (
            <Alert tone="danger" className="mb-3">
              {error}
            </Alert>
          )}
          <Toolbar>
            <SelectField
              compact
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ACTIVE">Active</option>
              <option value="COMMITTED">Committed</option>
              <option value="RELEASED">Released</option>
              <option value="EXPIRED">Expired</option>
            </SelectField>
          </Toolbar>
          <DataTable
            caption="Stock holds"
            rows={list.data?.stock}
            rowKey={(r) => r.id}
            loading={list.isPending}
            error={
              list.isError ? errorMessage(list.error, 'We could not load reservations.') : null
            }
            onRetry={() => void list.refetch()}
            empty="No stock holds with this status."
            columns={[
              {
                id: 'ref',
                header: 'Checkout',
                cell: (r) => <code className="text-xs">{r.checkoutRef}</code>,
              },
              {
                id: 'units',
                header: 'Units held',
                className: 'text-end',
                cell: (r) => r.lines.reduce((sum, l) => sum + l.quantity, 0),
              },
              {
                id: 'ext',
                header: 'Extended',
                className: 'text-end',
                cell: (r) => r.extendedCount,
              },
              { id: 'exp', header: 'Expires', cell: (r) => when(r.expiresAt) },
              { id: 'act', header: 'Actions', cell: (r) => releaseCell(r.checkoutRef) },
            ]}
          />
          <div className="mt-6" />
          <DataTable
            caption="Delivery slot holds"
            rows={list.data?.slots}
            rowKey={(r) => r.id}
            loading={list.isPending}
            error={null}
            empty="No delivery slot holds with this status."
            columns={[
              {
                id: 'ref',
                header: 'Checkout',
                cell: (r) => <code className="text-xs">{r.checkoutRef}</code>,
              },
              { id: 'date', header: 'Delivery date', cell: (r) => r.date },
              { id: 'units', header: 'Places held', className: 'text-end', cell: (r) => r.units },
              { id: 'exp', header: 'Expires', cell: (r) => when(r.expiresAt) },
            ]}
          />
          <ConfirmDialog
            open={releasing !== null}
            title="Release this hold?"
            confirmLabel="Release hold"
            danger
            busy={release.isPending}
            onConfirm={() => releasing && release.mutate(releasing)}
            onCancel={() => setReleasing(null)}
          >
            The held stock and delivery places become available to other shoppers straight away. If
            the shopper&apos;s checkout is still open, it will have to hold them again.
          </ConfirmDialog>
        </>
      )}
    </>
  );
}
