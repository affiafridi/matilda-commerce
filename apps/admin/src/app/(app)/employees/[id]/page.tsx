'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ScopeFields, describeScope } from '@/components/scope-fields';
import { useScope } from '@/components/scope-context';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DataTable,
  Drawer,
  Facts,
  PageHeader,
  Section,
  SelectField,
  StatusTag,
} from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useAdminContext, useCan } from '@/lib/auth';
import { applyApiError, formatDate, formatDateTime } from '@/lib/forms';
import { http } from '@/lib/http';
import { EMPTY_SCOPE, type Scope } from '@/lib/scope';
import type { Role, StaffAssignment, StaffMember, StaffStatus } from '@/lib/types';

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter a name.').max(160),
  phone: z.string().trim().max(40),
});
type ProfileValues = z.infer<typeof profileSchema>;

const STATUS_ACTIONS: Record<
  StaffStatus,
  Array<{ to: StaffStatus; label: string; danger?: boolean; body: string }>
> = {
  INVITED: [
    {
      to: 'DEACTIVATED',
      label: 'Cancel invitation',
      danger: true,
      body: 'The invitation link stops working and the account is closed.',
    },
  ],
  ACTIVE: [
    {
      to: 'SUSPENDED',
      label: 'Suspend',
      body: 'They are signed out everywhere and cannot sign in until reactivated.',
    },
    {
      to: 'DEACTIVATED',
      label: 'Deactivate',
      danger: true,
      body: 'They are signed out everywhere and can no longer sign in. This cannot be undone from the admin.',
    },
  ],
  SUSPENDED: [
    {
      to: 'ACTIVE',
      label: 'Reactivate',
      body: 'They can sign in again with their existing password and two-factor device.',
    },
    {
      to: 'DEACTIVATED',
      label: 'Deactivate',
      danger: true,
      body: 'The account is closed for good. This cannot be undone from the admin.',
    },
  ],
  DEACTIVATED: [],
};

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { markets, branches } = useScope();
  const context = useAdminContext(true);
  const canManage = useCan('users.manage');
  const [assigning, setAssigning] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{
    to: StaffStatus;
    label: string;
    danger?: boolean;
    body: string;
  } | null>(null);
  const [revoking, setRevoking] = useState<StaffAssignment | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const staff = useQuery({
    queryKey: ['admin', 'staff', id],
    queryFn: () => http.get<StaffMember>(`/admin/staff/${id}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] });

  const changeStatus = useMutation({
    mutationFn: (to: StaffStatus) => http.patch(`/admin/staff/${id}/status`, { status: to }),
    onSuccess: async () => {
      setPendingStatus(null);
      await refresh();
    },
    onError: (e) => {
      setPendingStatus(null);
      setNotice({ tone: 'danger', text: errorMessage(e) });
    },
  });
  const resend = useMutation({
    mutationFn: () => http.post(`/admin/staff/${id}/invite`, {}),
    onSuccess: () =>
      setNotice({
        tone: 'ok',
        text: 'A new invitation was sent. The previous link no longer works.',
      }),
    onError: (e) => setNotice({ tone: 'danger', text: errorMessage(e) }),
  });
  const revoke = useMutation({
    mutationFn: (a: StaffAssignment) => http.delete(`/admin/assignments/${a.id}`),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
    },
    onError: (e) => {
      setRevoking(null);
      setNotice({ tone: 'danger', text: errorMessage(e) });
    },
  });

  if (staff.isPending)
    return (
      <p role="status" className="text-[13px] text-muted">
        Loading employee…
      </p>
    );
  if (staff.isError || !staff.data) {
    return (
      <>
        <PageHeader title="Employee" crumbs={[{ label: 'Employees', href: '/employees' }]} />
        <Alert tone="danger">That employee was not found, or you do not have access to them.</Alert>
      </>
    );
  }
  const s = staff.data;
  const names = { brands: context.data?.brands ?? [], markets, branches };

  return (
    <>
      <PageHeader
        title={s.fullName}
        crumbs={[{ label: 'Employees', href: '/employees' }, { label: s.fullName }]}
        status={<StatusTag value={s.status} />}
        actions={
          canManage && (
            <>
              {s.status === 'INVITED' && (
                <Button busy={resend.isPending} onClick={() => resend.mutate()}>
                  Resend invitation
                </Button>
              )}
              {STATUS_ACTIONS[s.status].map((a) => (
                <Button
                  key={a.to}
                  variant={a.danger ? 'danger' : 'secondary'}
                  onClick={() => setPendingStatus(a)}
                >
                  {a.label}
                </Button>
              ))}
            </>
          )
        }
      />
      <div>
        {notice && (
          <Alert tone={notice.tone} className="mb-4">
            {notice.text}
          </Alert>
        )}
        <Section title="Profile">
          <ProfileForm
            staff={s}
            canManage={canManage && s.status !== 'DEACTIVATED'}
            onSaved={refresh}
          />
          <div className="mt-3">
            <Facts
              items={[
                [
                  'Two-factor',
                  s.mfaEnrolledAt ? `On since ${formatDate(s.mfaEnrolledAt)}` : 'Not set up yet',
                ],
                ['Last sign-in', formatDateTime(s.lastLoginAt)],
                ['Added', formatDate(s.createdAt)],
              ]}
            />
          </div>
        </Section>

        <Section
          title="Roles and scope"
          action={
            canManage &&
            s.status !== 'DEACTIVATED' && (
              <Button onClick={() => setAssigning(true)}>Add role</Button>
            )
          }
        >
          <DataTable
            caption="Role assignments"
            rows={s.assignments}
            rowKey={(a) => a.id}
            empty="No active roles. This person cannot do anything until a role is assigned."
            columns={[
              {
                id: 'role',
                header: 'Role',
                cell: (a) => <span className="font-medium">{a.role.name}</span>,
              },
              { id: 'scope', header: 'Applies to', cell: (a) => describeScope(a, names) },
              {
                id: 'exp',
                header: 'Expires',
                cell: (a) => (a.expiresAt ? formatDate(a.expiresAt) : 'No expiry'),
              },
              {
                id: 'actions',
                header: 'Actions',
                hideHeader: true,
                className: 'text-end',
                cell: (a) =>
                  canManage && (
                    <Button variant="quiet" onClick={() => setRevoking(a)}>
                      Revoke
                    </Button>
                  ),
              },
            ]}
          />
        </Section>
      </div>

      <AssignDrawer
        staffId={id}
        open={assigning}
        onClose={() => setAssigning(false)}
        onDone={refresh}
      />
      <ConfirmDialog
        open={pendingStatus !== null}
        title={`${pendingStatus?.label ?? ''} ${s.fullName}?`}
        confirmLabel={pendingStatus?.label ?? 'Confirm'}
        danger={pendingStatus?.danger}
        busy={changeStatus.isPending}
        onConfirm={() => pendingStatus && changeStatus.mutate(pendingStatus.to)}
        onCancel={() => setPendingStatus(null)}
      >
        {pendingStatus?.body}
      </ConfirmDialog>
      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this role?"
        confirmLabel="Revoke role"
        danger
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        onCancel={() => setRevoking(null)}
      >
        {s.fullName} will lose {revoking?.role.name} access (
        {revoking ? describeScope(revoking, names) : ''}) immediately.
      </ConfirmDialog>
    </>
  );
}

function ProfileForm({
  staff,
  canManage,
  onSaved,
}: {
  staff: StaffMember;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: staff.fullName, phone: staff.phone ?? '' },
  });
  useEffect(() => {
    reset({ fullName: staff.fullName, phone: staff.phone ?? '' });
  }, [staff, reset]);
  const save = useMutation({
    mutationFn: (v: ProfileValues) =>
      http.patch(`/admin/staff/${staff.id}`, { fullName: v.fullName, phone: v.phone || null }),
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
    onError: (e) => setFormError(applyApiError(e, setError, ['fullName', 'phone'])),
  });
  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) => {
        setSaved(false);
        setFormError(null);
        save.mutate(v);
      })}
      className="rounded-md border border-line bg-surface p-4"
    >
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      {saved && !isDirty && (
        <Alert tone="ok" className="mb-4">
          Saved.
        </Alert>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField
          label="Full name"
          disabled={!canManage}
          error={errors.fullName?.message}
          {...register('fullName')}
        />
        <TextField
          label="Phone"
          disabled={!canManage}
          error={errors.phone?.message}
          {...register('phone')}
        />
      </div>
      <TextField
        label="Email"
        value={staff.email}
        readOnly
        disabled
        help="The sign-in address cannot be changed."
        onChange={() => undefined}
      />
      {canManage && (
        <div className="mt-5 flex gap-2">
          <Button type="submit" variant="primary" busy={save.isPending} disabled={!isDirty}>
            Save changes
          </Button>
          <Button disabled={!isDirty} onClick={() => reset()}>
            Discard
          </Button>
        </div>
      )}
    </form>
  );
}

function AssignDrawer({
  staffId,
  open,
  onClose,
  onDone,
}: {
  staffId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<Scope>(EMPTY_SCOPE);
  const [expires, setExpires] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => http.get<Role[]>('/admin/roles'),
    enabled: open,
  });
  const assign = useMutation({
    mutationFn: () =>
      http.post(`/admin/staff/${staffId}/assignments`, {
        roleId,
        brandId: scope.brandId,
        marketId: scope.marketId,
        branchId: scope.branchId,
        ...(expires ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}),
      }),
    onSuccess: () => {
      onDone();
      close();
    },
    onError: (e) => setFormError(errorMessage(e)),
  });
  function close() {
    setRoleId('');
    setScope(EMPTY_SCOPE);
    setExpires('');
    setFormError(null);
    onClose();
  }
  return (
    <Drawer
      open={open}
      title="Add role"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            busy={assign.isPending}
            disabled={!roleId}
            onClick={() => {
              setFormError(null);
              assign.mutate();
            }}
          >
            Assign role
          </Button>
        </>
      }
    >
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <SelectField
        label="Role"
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        help="You can only assign access you hold yourself."
      >
        <option value="">Choose a role</option>
        {roles.data?.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      <ScopeFields value={scope} onChange={setScope} />
      <TextField
        label="Expires (optional)"
        type="date"
        value={expires}
        onChange={(e) => setExpires(e.target.value)}
        help="Leave empty for no expiry."
      />
    </Drawer>
  );
}
