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
import { ItemName } from './stock-screen';

interface TransferLine {
  id: string;
  productId: string | null;
  variationId: string | null;
  quantityRequested: number;
  quantityShipped: number | null;
  quantityReceived: number | null;
  discrepancy: boolean;
  difference: number;
  discrepancyNote: string | null;
}
interface Transfer {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: 'REQUESTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  note: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  hasDiscrepancy: boolean;
  lines: TransferLine[];
}

const STATUS_LABEL: Record<Transfer['status'], string> = {
  REQUESTED: 'Requested',
  IN_TRANSIT: 'In transit',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

const failure = (e: unknown) =>
  e instanceof Error && !('status' in e) ? e.message : errorMessage(e);

export function TransfersScreen() {
  const { brandId, ready, api } = useBrandApi('inventory');
  const { branchName } = useBrandPlaces();
  const canTransfer = useCan('inventory.transfer');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['inventory', brandId, 'transfers', status],
    enabled: !!brandId,
    queryFn: () => api.get<{ items: Transfer[] }>(`transfers${status ? `?status=${status}` : ''}`),
  });
  const current = list.data?.items.find((t) => t.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Transfers"
        actions={
          canTransfer &&
          brandId && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Request transfer
            </Button>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Transfers" />
      ) : (
        <>
          <Toolbar>
            <SelectField
              compact
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
          </Toolbar>
          <DataTable
            caption="Stock transfers"
            rows={list.data?.items}
            rowKey={(t) => t.id}
            loading={list.isPending}
            error={list.isError ? errorMessage(list.error, 'We could not load transfers.') : null}
            onRetry={() => void list.refetch()}
            empty="No transfers yet."
            columns={[
              {
                id: 'route',
                header: 'From → to',
                cell: (t) => (
                  <button
                    type="button"
                    onClick={() => setOpenId(t.id)}
                    className="text-start font-medium underline-offset-2 hover:underline"
                  >
                    {branchName(t.fromBranchId)} → {branchName(t.toBranchId)}
                  </button>
                ),
              },
              {
                id: 'items',
                header: 'Items',
                className: 'text-end',
                cell: (t) => t.lines.length,
              },
              {
                id: 'status',
                header: 'Status',
                cell: (t) => (
                  <>
                    <StatusTag
                      value={
                        t.status === 'RECEIVED'
                          ? 'ACTIVE'
                          : t.status === 'CANCELLED'
                            ? 'INACTIVE'
                            : 'DRAFT'
                      }
                      label={STATUS_LABEL[t.status]}
                    />
                    {t.hasDiscrepancy && (
                      <span className="ms-2 text-xs text-danger">Difference found</span>
                    )}
                  </>
                ),
              },
              {
                id: 'created',
                header: 'Requested',
                cell: (t) => new Date(t.createdAt).toLocaleDateString(),
              },
            ]}
          />
          <TransferDrawer
            key={current?.id ?? 'none'}
            transfer={current}
            onClose={() => setOpenId(null)}
          />
          <RequestDrawer
            key={`new-${creating}`}
            open={creating}
            onClose={() => setCreating(false)}
          />
        </>
      )}
    </>
  );
}

function TransferDrawer({ transfer, onClose }: { transfer: Transfer | null; onClose: () => void }) {
  const { brandId, api } = useBrandApi('inventory');
  const { branchName } = useBrandPlaces();
  const queryClient = useQueryClient();
  const canTransfer = useCan('inventory.transfer');
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      setError(null);
      return queryClient.invalidateQueries({ queryKey: ['inventory', brandId] });
    },
    onError: (e) => setError(failure(e)),
  });

  const t = transfer;
  const lines = t?.lines ?? [];
  const ship = () =>
    act.mutate(async () => {
      const body = lines.map((l) => {
        const q = toInt(shipQty[l.id] ?? String(l.quantityRequested));
        if (q === null) throw new Error('Enter whole numbers to ship.');
        return { lineId: l.id, quantity: q };
      });
      await api.post(`transfers/${t!.id}/ship`, { lines: body });
    });
  const receive = () =>
    act.mutate(async () => {
      const body = lines.map((l) => {
        const q = toInt(recvQty[l.id] ?? String(l.quantityShipped ?? 0));
        if (q === null) throw new Error('Enter whole numbers for what arrived.');
        const note = (notes[l.id] ?? '').trim();
        return { lineId: l.id, quantity: q, ...(note && { note }) };
      });
      await api.post(`transfers/${t!.id}/receive`, { lines: body });
    });
  const cancel = () => act.mutate(() => api.post(`transfers/${t!.id}/cancel`, {}));

  return (
    <Drawer
      open={t !== null}
      title="Transfer"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {canTransfer && t?.status === 'REQUESTED' && (
            <>
              <Button variant="danger" busy={act.isPending} onClick={cancel}>
                Cancel transfer
              </Button>
              <Button variant="primary" busy={act.isPending} onClick={ship}>
                Mark as shipped
              </Button>
            </>
          )}
          {canTransfer && t?.status === 'IN_TRANSIT' && (
            <Button variant="primary" busy={act.isPending} onClick={receive}>
              Confirm receipt
            </Button>
          )}
        </>
      }
    >
      {t && (
        <>
          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}
          <p className="text-[13px] font-semibold">
            {branchName(t.fromBranchId)} → {branchName(t.toBranchId)}
          </p>
          <p className="mb-3 text-xs text-muted">
            {STATUS_LABEL[t.status]}
            {t.note ? ` · ${t.note}` : ''}
          </p>
          {t.status === 'REQUESTED' && (
            <p className="mb-3 text-xs text-muted">
              Nothing leaves the sending branch until it is marked as shipped. Change a quantity if
              less goes out.
            </p>
          )}
          {t.status === 'IN_TRANSIT' && (
            <p className="mb-3 text-xs text-muted">
              Enter what actually arrived. If it differs from what was shipped, add a note.
            </p>
          )}
          <ul className="divide-y divide-line">
            {t.lines.map((l) => (
              <li key={l.id} className="py-3 text-[13px]">
                <p className="font-medium">{brandId && <ItemName item={l} brandId={brandId} />}</p>
                <p className="text-xs text-muted">
                  Requested {l.quantityRequested}
                  {l.quantityShipped !== null && ` · shipped ${l.quantityShipped}`}
                  {l.quantityReceived !== null && ` · received ${l.quantityReceived}`}
                </p>
                {l.discrepancy && (
                  <p className="text-xs text-danger">
                    Difference of {l.difference}
                    {l.discrepancyNote ? `: ${l.discrepancyNote}` : ''}
                  </p>
                )}
                {canTransfer && t.status === 'REQUESTED' && (
                  <TextField
                    label="Quantity to ship"
                    inputMode="numeric"
                    value={shipQty[l.id] ?? String(l.quantityRequested)}
                    onChange={(e) => setShipQty({ ...shipQty, [l.id]: e.target.value })}
                  />
                )}
                {canTransfer && t.status === 'IN_TRANSIT' && (
                  <>
                    <TextField
                      label="Quantity received"
                      inputMode="numeric"
                      value={recvQty[l.id] ?? String(l.quantityShipped ?? 0)}
                      onChange={(e) => setRecvQty({ ...recvQty, [l.id]: e.target.value })}
                    />
                    <TextField
                      label="Note (needed when the count differs)"
                      value={notes[l.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}

interface DraftLine {
  productId: string;
  variationId: string;
  quantity: string;
}

function RequestDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brandId, api } = useBrandApi('inventory');
  const { branches } = useBrandPlaces();
  const { products } = useProducts(brandId);
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [line, setLine] = useState<DraftLine>({ productId: '', variationId: '', quantity: '' });
  const [error, setError] = useState<string | null>(null);
  const product = products.find((p) => p.id === line.productId);
  const variations = useVariations(brandId, product?.type === 'VARIABLE' ? line.productId : null);

  const create = useMutation({
    mutationFn: () => {
      if (!from || !to) throw new Error('Choose the sending and the receiving branch.');
      if (from === to) throw new Error('The two branches must differ.');
      if (!line.productId) throw new Error('Choose a product.');
      if (product?.type === 'VARIABLE' && !line.variationId)
        throw new Error('Choose the variation.');
      const q = toInt(line.quantity);
      if (!q || q < 1) throw new Error('Enter how many units to move.');
      return api.post('transfers', {
        fromBranchId: from,
        toBranchId: to,
        ...(note.trim() && { note: note.trim() }),
        lines: [
          {
            productId: line.productId,
            ...(line.variationId && { variationId: line.variationId }),
            quantity: q,
          },
        ],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory', brandId] });
      onClose();
    },
    onError: (e) => setError(failure(e)),
  });

  return (
    <Drawer
      open={open}
      title="Request a transfer"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={create.isPending} onClick={() => create.mutate()}>
            Request transfer
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <SelectField label="Send from" value={from} onChange={(e) => setFrom(e.target.value)}>
        <option value="">Choose a branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Send to" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Choose a branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Product"
        value={line.productId}
        onChange={(e) => setLine({ ...line, productId: e.target.value, variationId: '' })}
      >
        <option value="">Choose a product</option>
        {products
          .filter((p) => p.type !== 'BUNDLE')
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.translations.find((x) => x.language === 'en')?.name ?? 'Untitled'}
            </option>
          ))}
      </SelectField>
      {product?.type === 'VARIABLE' && (
        <SelectField
          label="Variation"
          value={line.variationId}
          onChange={(e) => setLine({ ...line, variationId: e.target.value })}
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
        label="Units"
        inputMode="numeric"
        value={line.quantity}
        onChange={(e) => setLine({ ...line, quantity: e.target.value })}
      />
      <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Drawer>
  );
}
