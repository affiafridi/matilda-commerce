'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useScope } from '@/components/scope-context';
import {
  DataTable,
  Drawer,
  Facts,
  PageHeader,
  SearchBox,
  SelectField,
  StatusTag,
  Toolbar,
} from '@/components/ui/kit';
import { Button, TextField } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/auth';
import { formatDateTime } from '@/lib/forms';
import { http } from '@/lib/http';
import type { AuditPage, AuditRow } from '@/lib/types';

export default function AuditLogPage() {
  const { scope, key } = useScope();
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [actorType, setActorType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<AuditRow | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', key, { action, outcome, actorType, from, to }],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: '50' });
      if (pageParam) q.set('before', pageParam);
      if (action) q.set('action', action);
      if (outcome) q.set('outcome', outcome);
      if (actorType) q.set('actorType', actorType);
      if (from) q.set('from', new Date(`${from}T00:00:00`).toISOString());
      if (to) q.set('to', new Date(`${to}T23:59:59`).toISOString());
      if (scope.brandId) q.set('brandId', scope.brandId);
      return http.get<AuditPage>(`/admin/audit?${q}`);
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items);

  return (
    <>
      <PageHeader title="Audit log" />
      <Toolbar>
        <SearchBox
          label="Filter by action"
          placeholder="Action, e.g. staff.invite"
          onSearch={setAction}
        />
        <SelectField
          compact
          hideLabel
          label="Outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="w-40"
        >
          <option value="">All outcomes</option>
          <option value="SUCCESS">Success</option>
          <option value="DENIED">Denied</option>
          <option value="FAILED">Failed</option>
        </SelectField>
        <SelectField
          compact
          hideLabel
          label="Actor type"
          value={actorType}
          onChange={(e) => setActorType(e.target.value)}
          className="w-40"
        >
          <option value="">All actors</option>
          <option value="STAFF">Staff</option>
          <option value="CUSTOMER">Customer</option>
          <option value="SYSTEM">System</option>
          <option value="GUEST">Guest</option>
        </SelectField>
        <div className="w-40">
          <TextField
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="w-40">
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Toolbar>
      <DataTable
        caption="Audit log"
        rows={rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, 'We could not load the audit log.') : null}
        onRetry={() => void query.refetch()}
        empty="No entries match these filters."
        columns={[
          {
            id: 'when',
            header: 'When',
            className: 'whitespace-nowrap',
            cell: (r) => formatDateTime(r.occurredAt),
          },
          {
            id: 'action',
            header: 'Action',
            cell: (r) => (
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="font-medium underline-offset-2 hover:underline"
              >
                {r.action}
              </button>
            ),
          },
          {
            id: 'target',
            header: 'Target',
            cell: (r) => (
              <span className="text-ink-2">
                {r.targetType}
                {r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ''}
              </span>
            ),
          },
          {
            id: 'actor',
            header: 'Actor',
            cell: (r) => (
              <span>
                {r.actorType.charAt(0) + r.actorType.slice(1).toLowerCase()}
                {r.actorId ? ` · ${r.actorId.slice(0, 8)}` : ''}
              </span>
            ),
          },
          { id: 'outcome', header: 'Outcome', cell: (r) => <StatusTag value={r.outcome} /> },
        ]}
      />
      {query.hasNextPage && (
        <div className="py-3">
          <Button busy={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Load older entries
          </Button>
        </div>
      )}
      <Drawer open={open !== null} title="Audit entry" onClose={() => setOpen(null)}>
        {open && (
          <>
            <Facts
              items={[
                ['Action', open.action],
                ['When', formatDateTime(open.occurredAt)],
                ['Outcome', <StatusTag key="o" value={open.outcome} />],
                ['Actor', `${open.actorType}${open.actorId ? ` · ${open.actorId}` : ''}`],
                ['Target', `${open.targetType}${open.targetId ? ` · ${open.targetId}` : ''}`],
                ['Request id', open.requestId ?? 'None'],
              ]}
            />
            <Json title="Before" value={open.before} />
            <Json title="After" value={open.after} />
          </>
        )}
      </Drawer>
    </>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-[13px] font-semibold">{title}</h3>
      <pre className="max-h-64 overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
