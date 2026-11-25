'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ScopeFields, describeScope } from '@/components/scope-fields';
import { useScope } from '@/components/scope-context';
import {
  DataTable,
  Drawer,
  PageHeader,
  Pager,
  SearchBox,
  SelectField,
  StatusTag,
  Toolbar,
} from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useAdminContext, useCan } from '@/lib/auth';
import { applyApiError, formatDateTime } from '@/lib/forms';
import { http } from '@/lib/http';
import { EMPTY_SCOPE, type Scope } from '@/lib/scope';
import type { Page, Role, StaffMember } from '@/lib/types';

export default function EmployeesPage() {
  const { scope, markets, branches } = useScope();
  const context = useAdminContext(true);
  const canManage = useCan('users.manage');
  const [inviting, setInviting] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const staff = useQuery({
    queryKey: ['admin', 'staff', { page, search, status }],
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) q.set('search', search);
      if (status) q.set('status', status);
      return http.get<Page<StaffMember>>(`/admin/staff?${q}`);
    },
  });

  const inScope = (s: StaffMember) =>
    !scope.brandId ||
    s.assignments.some(
      (a) =>
        a.brandId === null ||
        (a.brandId === scope.brandId &&
          (!scope.branchId || a.branchId === null || a.branchId === scope.branchId)),
    );
  const rows = staff.data?.items.filter(inScope);
  const names = { brands: context.data?.brands ?? [], markets, branches };

  return (
    <>
      <PageHeader
        title="Employees"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              Invite employee
            </Button>
          )
        }
      />
      <Toolbar>
        <SearchBox
          label="Search employees"
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
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INVITED">Invited</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Deactivated</option>
        </SelectField>
      </Toolbar>
      <DataTable
        caption="Employees"
        rows={rows}
        rowKey={(s) => s.id}
        loading={staff.isPending}
        error={staff.isError ? errorMessage(staff.error, 'We could not load employees.') : null}
        onRetry={() => void staff.refetch()}
        empty="No employees match these filters."
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (s) => (
              <Link
                href={`/employees/${s.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {s.fullName}
              </Link>
            ),
          },
          {
            id: 'email',
            header: 'Email',
            cell: (s) => <span className="break-all">{s.email}</span>,
          },
          {
            id: 'roles',
            header: 'Roles and scope',
            cell: (s) =>
              s.assignments.length === 0 ? (
                <span className="text-muted">No active roles</span>
              ) : (
                <ul>
                  {s.assignments.map((a) => (
                    <li key={a.id}>
                      {a.role.name} <span className="text-muted">· {describeScope(a, names)}</span>
                    </li>
                  ))}
                </ul>
              ),
          },
          { id: 'status', header: 'Status', cell: (s) => <StatusTag value={s.status} /> },
          { id: 'last', header: 'Last sign-in', cell: (s) => formatDateTime(s.lastLoginAt) },
        ]}
      />
      {staff.data && <Pager page={page} pageSize={25} total={staff.data.total} onPage={setPage} />}
      <InviteDrawer open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}

const inviteSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter a name.').max(160),
  email: z.string().trim().min(1, 'Enter an email.').email('Enter a valid email address.'),
  phone: z.string().trim().max(40),
  roleId: z.string().min(1, 'Choose a role.'),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>(EMPTY_SCOPE);
  const [formError, setFormError] = useState<string | null>(null);
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => http.get<Role[]>('/admin/roles'),
    enabled: open,
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { fullName: '', email: '', phone: '', roleId: '' },
  });
  const invite = useMutation({
    mutationFn: (v: InviteValues) =>
      http.post<{ staff: { id: string } }>('/admin/staff', {
        fullName: v.fullName,
        email: v.email,
        phone: v.phone || undefined,
        roleId: v.roleId,
        brandId: scope.brandId,
        marketId: scope.marketId,
        branchId: scope.branchId,
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] });
      close();
      if (created?.staff?.id) router.push(`/employees/${created.staff.id}`);
    },
    onError: (e) =>
      setFormError(applyApiError(e, setError, ['fullName', 'email', 'phone', 'roleId'])),
  });
  function close() {
    reset();
    setScope(EMPTY_SCOPE);
    setFormError(null);
    onClose();
  }
  return (
    <Drawer
      open={open}
      title="Invite employee"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="invite-form" variant="primary" busy={invite.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <form
        id="invite-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          invite.mutate(v);
        })}
      >
        <TextField label="Full name" error={errors.fullName?.message} {...register('fullName')} />
        <TextField
          label="Work email"
          type="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField label="Phone (optional)" {...register('phone')} />
        <SelectField
          label="Role"
          error={errors.roleId?.message}
          help="You can only assign access you hold yourself."
          {...register('roleId')}
        >
          <option value="">Choose a role</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <ScopeFields value={scope} onChange={setScope} />
      </form>
    </Drawer>
  );
}
