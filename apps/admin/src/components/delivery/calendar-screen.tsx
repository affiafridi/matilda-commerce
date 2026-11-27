'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, PageHeader, SelectField, Section, Toolbar } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { NeedsBrand, WEEKDAYS, itemsOrArray, useBrandApi, useBrandPlaces } from '@/lib/ops';
import { failure, isTime } from './shared';

interface Hours {
  branchId: string;
  timezone: string;
  days: Array<{ weekday: number; ranges: Array<{ start: string; end: string }> }>;
}
interface Closure {
  id: string;
  closedOn: string;
  marketId: string | null;
  branchId: string | null;
  reason: string | null;
}

/** One text line per weekday: "09:00-18:00" or "09:00-13:00, 15:00-20:00"; empty means closed. */
const toText = (ranges: Array<{ start: string; end: string }>) =>
  ranges.map((r) => `${r.start}-${r.end}`).join(', ');

function parseRanges(text: string, day: string): Array<{ start: string; end: string }> {
  if (!text.trim()) return [];
  return text.split(',').map((part) => {
    const [start = '', end = ''] = part
      .trim()
      .split('-')
      .map((p) => p.trim());
    if (!isTime(start) || !isTime(end)) {
      throw new Error(`${day}: write hours like 09:00-18:00, or leave empty when closed.`);
    }
    return { start, end };
  });
}

export function CalendarScreen() {
  const { brandId, ready } = useBrandApi('delivery');
  const { branches, markets } = useBrandPlaces();
  const [picked, setPicked] = useState('');
  const branchId = branches.some((b) => b.id === picked) ? picked : (branches[0]?.id ?? '');

  return (
    <>
      <PageHeader title="Branch calendar" />
      {!brandId ? (
        <NeedsBrand ready={ready} what="The branch calendar" />
      ) : branches.length === 0 ? (
        <Alert tone="info">This brand has no branch yet.</Alert>
      ) : (
        <>
          <p className="mb-3 max-w-prose text-[13px] text-muted">
            Opening hours decide when a branch can prepare and hand over orders. Closed dates apply
            to one branch, to a whole market or to the whole brand. Times are local to the branch.
          </p>
          <Toolbar>
            <SelectField
              compact
              label="Branch"
              value={branchId}
              onChange={(e) => setPicked(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
          </Toolbar>
          <HoursEditor key={branchId} branchId={branchId} />
          <Closures
            branchId={branchId}
            markets={markets.map((m) => ({ id: m.id, label: m.country.name }))}
          />
        </>
      )}
    </>
  );
}

function HoursEditor({ branchId }: { branchId: string }) {
  const { brandId, api } = useBrandApi('delivery');
  const canEdit = useCan('branches.calendar');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hours = useQuery({
    queryKey: ['delivery', brandId, 'hours', branchId],
    queryFn: () => api.get<Hours>(`branches/${branchId}/hours`),
  });
  const text = (weekday: number) =>
    draft?.[weekday] ?? toText(hours.data?.days.find((d) => d.weekday === weekday)?.ranges ?? []);

  const save = useMutation({
    mutationFn: () => {
      const days = WEEKDAYS.map((name, weekday) => ({
        weekday,
        ranges: parseRanges(text(weekday), name),
      })).filter((d) => d.ranges.length > 0);
      return api.put(`branches/${branchId}/hours`, { days });
    },
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId, 'hours', branchId] });
    },
    onError: (e) => {
      setSaved(false);
      setError(failure(e));
    },
  });

  return (
    <Section title="Weekly opening hours">
      {hours.isError && (
        <Alert tone="danger">{errorMessage(hours.error, 'We could not load the hours.')}</Alert>
      )}
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert tone="info" className="mb-3">
          Opening hours saved.
        </Alert>
      )}
      {hours.data && <p className="mb-2 text-xs text-muted">Time zone: {hours.data.timezone}</p>}
      <div className="max-w-md">
        {WEEKDAYS.map((name, weekday) => (
          <TextField
            key={name}
            label={name}
            placeholder="Closed"
            value={text(weekday)}
            disabled={!canEdit || hours.isPending}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...draft, [weekday]: e.target.value });
            }}
          />
        ))}
      </div>
      {canEdit && (
        <Button
          className="mt-4"
          variant="primary"
          busy={save.isPending}
          onClick={() => save.mutate()}
        >
          Save opening hours
        </Button>
      )}
    </Section>
  );
}

function Closures({
  branchId,
  markets,
}: {
  branchId: string;
  markets: Array<{ id: string; label: string }>;
}) {
  const { brandId, api } = useBrandApi('delivery');
  const canEdit = useCan('branches.calendar');
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('branch');
  const [error, setError] = useState<string | null>(null);
  const closures = useQuery({
    queryKey: ['delivery', brandId, 'closures', branchId],
    queryFn: async () =>
      itemsOrArray(
        await api.get<Closure[] | { items: Closure[] }>(`closures?branchId=${branchId}`),
      ),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['delivery', brandId, 'closures'] });

  const add = useMutation({
    mutationFn: () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Write the date like 2026-12-25.');
      return api.post('closures', {
        closedOn: date,
        ...(scope === 'branch' ? { branchId } : scope === 'brand' ? {} : { marketId: scope }),
        ...(reason.trim() && { reason: reason.trim() }),
      });
    },
    onSuccess: async () => {
      setDate('');
      setReason('');
      setError(null);
      await refresh();
    },
    onError: (e) => setError(failure(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`closures/${id}`),
    onSuccess: refresh,
    onError: (e) => setError(failure(e)),
  });

  return (
    <Section title="Closed dates">
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {canEdit && (
        <div className="mb-4 flex max-w-2xl flex-wrap items-end gap-3">
          <TextField
            label="Date"
            placeholder="2026-12-25"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <SelectField
            compact
            label="Closes"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="branch">This branch</option>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                Market: {m.label}
              </option>
            ))}
            <option value="brand">The whole brand</option>
          </SelectField>
          <Button variant="primary" busy={add.isPending} onClick={() => add.mutate()}>
            Add closed date
          </Button>
        </div>
      )}
      <DataTable
        caption="Closed dates"
        rows={closures.data}
        rowKey={(c) => c.id}
        loading={closures.isPending}
        error={
          closures.isError ? errorMessage(closures.error, 'We could not load closed dates.') : null
        }
        onRetry={() => void closures.refetch()}
        empty="No closed dates for this branch."
        columns={[
          { id: 'date', header: 'Date', cell: (c) => c.closedOn },
          {
            id: 'scope',
            header: 'Applies to',
            cell: (c) => (c.branchId ? 'This branch' : c.marketId ? 'A market' : 'The whole brand'),
          },
          { id: 'reason', header: 'Reason', cell: (c) => c.reason ?? '' },
          {
            id: 'act',
            header: 'Actions',
            cell: (c) =>
              canEdit && (
                <Button variant="quiet" onClick={() => remove.mutate(c.id)}>
                  Remove
                </Button>
              ),
          },
        ]}
      />
    </Section>
  );
}
