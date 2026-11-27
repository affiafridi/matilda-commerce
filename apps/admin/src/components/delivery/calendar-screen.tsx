'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, Fields, PageHeader, SelectField, Section, Toolbar } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { NeedsBrand, WEEKDAYS, itemsOrArray, useBrandApi, useBrandPlaces } from '@/lib/ops';
import { failure, isTime } from './shared';

type Range = { start: string; end: string };
type Week = Record<number, Range[]>;

interface Hours {
  branchId: string;
  timezone: string;
  days: Array<{ weekday: number; ranges: Range[] }>;
}
interface Closure {
  id: string;
  closedOn: string;
  marketId: string | null;
  branchId: string | null;
  reason: string | null;
}

const DEFAULT_RANGE: Range = { start: '09:00', end: '18:00' };
const TIME_INPUT =
  'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm disabled:bg-sunken disabled:text-muted';

export function CalendarScreen() {
  const { brandId, ready } = useBrandApi('delivery');
  const { branches, markets } = useBrandPlaces();
  const [picked, setPicked] = useState('');
  const branchId = branches.some((b) => b.id === picked) ? picked : (branches[0]?.id ?? '');

  return (
    <>
      <PageHeader
        title="Branch calendar"
        lede="Set when each branch is open and which days it is closed. The delivery times offered to customers follow these hours."
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="The branch calendar" />
      ) : branches.length === 0 ? (
        <Alert tone="info">This brand has no branch yet.</Alert>
      ) : (
        <>
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
  const [draft, setDraft] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hours = useQuery({
    queryKey: ['delivery', brandId, 'hours', branchId],
    queryFn: () => api.get<Hours>(`branches/${branchId}/hours`),
  });
  const week: Week =
    draft ?? Object.fromEntries((hours.data?.days ?? []).map((d) => [d.weekday, d.ranges]));
  const setRanges = (weekday: number, ranges: Range[]) => {
    setSaved(false);
    setDraft({ ...week, [weekday]: ranges });
  };

  const save = useMutation({
    mutationFn: () => {
      const days = WEEKDAYS.map((_, weekday) => ({ weekday, ranges: week[weekday] ?? [] })).filter(
        (d) => d.ranges.length > 0,
      );
      for (const d of days) {
        for (const r of d.ranges) {
          if (!isTime(r.start) || !isTime(r.end) || r.end <= r.start) {
            throw new Error(
              `${WEEKDAYS[d.weekday]}: the closing time must be after the opening time.`,
            );
          }
        }
      }
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

  const zone = hours.data ? ` Time zone: ${hours.data.timezone}.` : '';
  return (
    <Section
      title="Opening hours"
      description={`When this branch is open each week. Orders are only prepared and handed over while it is open. Need a lunch break? Add a second time range.${zone}`}
    >
      {hours.isError && (
        <Alert tone="danger">{errorMessage(hours.error, 'We could not load the hours.')}</Alert>
      )}
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert tone="ok" className="mb-3">
          Opening hours saved.
        </Alert>
      )}
      <ul className="divide-y divide-line">
        {WEEKDAYS.map((name, weekday) => {
          const ranges = week[weekday] ?? [];
          const open = ranges.length > 0;
          return (
            <li key={name} className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3">
              <label className="flex h-9 w-44 items-center gap-2 text-[13px] font-medium">
                <input
                  type="checkbox"
                  role="switch"
                  className="size-4"
                  checked={open}
                  disabled={!canEdit || hours.isPending}
                  onChange={(e) => setRanges(weekday, e.target.checked ? [DEFAULT_RANGE] : [])}
                />
                {name}
              </label>
              {!open ? (
                <span className="flex h-9 items-center text-[13px] text-muted">Closed</span>
              ) : (
                <div className="space-y-2">
                  {ranges.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        aria-label={`${name} opens${i > 0 ? ` (range ${i + 1})` : ''}`}
                        className={TIME_INPUT}
                        value={r.start}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setRanges(
                            weekday,
                            ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                          )
                        }
                      />
                      <span className="text-xs text-muted">to</span>
                      <input
                        type="time"
                        aria-label={`${name} closes${i > 0 ? ` (range ${i + 1})` : ''}`}
                        className={TIME_INPUT}
                        value={r.end}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setRanges(
                            weekday,
                            ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                          )
                        }
                      />
                      {canEdit && i > 0 && (
                        <Button
                          variant="quiet"
                          onClick={() =>
                            setRanges(
                              weekday,
                              ranges.filter((_, j) => j !== i),
                            )
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {canEdit && ranges.length < 4 && (
                    <Button
                      variant="quiet"
                      onClick={() =>
                        setRanges(weekday, [...ranges, { start: '16:00', end: '20:00' }])
                      }
                    >
                      Add a second time range
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <Button
          className="mt-4"
          variant="primary"
          busy={save.isPending}
          onClick={() => save.mutate()}
        >
          Save opening hours
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted">You can view these hours but not change them.</p>
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose the date.');
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
    <Section
      title="Closed dates"
      description="Holidays and other days with no deliveries. A closed date stops orders for that day even when the weekly hours say open."
    >
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {canEdit && (
        <div className="mb-5 border-b border-line pb-5">
          <Fields columns={3}>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <SelectField
              label="Who is closed"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="branch">This branch only</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  All branches in {m.label}
                </option>
              ))}
              <option value="brand">The whole brand</option>
            </SelectField>
            <TextField
              label="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Fields>
          <Button
            className="mt-4"
            variant="primary"
            busy={add.isPending}
            onClick={() => add.mutate()}
          >
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
