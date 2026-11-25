'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useScope } from '@/components/scope-context';
import {
  DataTable,
  PageHeader,
  Pager,
  SearchBox,
  SelectField,
  StatusTag,
  Toolbar,
} from '@/components/ui/kit';
import { errorMessage, useAdminContext } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/forms';
import { http } from '@/lib/http';
import type { Customer, Page } from '@/lib/types';

export default function CustomersPage() {
  const { scope, key } = useScope();
  const context = useAdminContext(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const customers = useQuery({
    queryKey: ['admin', 'customers', key, { page, search, status }],
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) q.set('search', search);
      if (status) q.set('status', status);
      if (scope.brandId) q.set('brandId', scope.brandId);
      return http.get<Page<Customer>>(`/admin/customers?${q}`);
    },
  });
  const brandName = (id: string) => context.data?.brands.find((b) => b.id === id)?.name ?? 'Brand';

  return (
    <>
      <PageHeader title="Customers" />
      <p className="-mt-3 mb-4 text-[13px] text-muted">
        Read only. Customers belong to one brand; accounts are never shared between brands.
      </p>
      <Toolbar>
        <SearchBox
          label="Search customers"
          placeholder="Search name or email"
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <SelectField
          compact
          hideLabel
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-52"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DELETION_REQUESTED">Deletion requested</option>
        </SelectField>
      </Toolbar>
      <DataTable
        caption="Customers"
        rows={customers.data?.items}
        rowKey={(c) => c.id}
        loading={customers.isPending}
        error={
          customers.isError ? errorMessage(customers.error, 'We could not load customers.') : null
        }
        onRetry={() => void customers.refetch()}
        empty="No customers match these filters."
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (c) => <span className="font-medium">{c.fullName}</span>,
          },
          {
            id: 'email',
            header: 'Email',
            cell: (c) => (
              <span className="break-all">
                {c.email}
                {!c.emailVerifiedAt && <span className="ms-2 text-xs text-muted">unverified</span>}
              </span>
            ),
          },
          { id: 'brand', header: 'Brand', cell: (c) => brandName(c.brandId) },
          { id: 'status', header: 'Status', cell: (c) => <StatusTag value={c.status} /> },
          { id: 'mk', header: 'Marketing', cell: (c) => (c.marketingConsent ? 'Opted in' : 'No') },
          { id: 'last', header: 'Last sign-in', cell: (c) => formatDateTime(c.lastLoginAt) },
          { id: 'joined', header: 'Joined', cell: (c) => formatDate(c.createdAt) },
        ]}
      />
      {customers.data && (
        <Pager page={page} pageSize={25} total={customers.data.total} onPage={setPage} />
      )}
    </>
  );
}
