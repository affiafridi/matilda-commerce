'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useScope } from '@/components/scope-context';
import {
  Checkbox,
  DataTable,
  Drawer,
  PageHeader,
  SelectField,
  StatusTag,
} from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useAdminContext, useCan } from '@/lib/auth';
import { applyApiError } from '@/lib/forms';
import { http } from '@/lib/http';
import type { Branch } from '@/lib/types';

const optional = z.string().trim().max(200);
const schema = z.object({
  code: z.string().trim(),
  name: z.string().trim().min(1, 'Enter a name.').max(160),
  countryIso2: z.string().trim(),
  timezone: z.string().trim().min(3, 'Enter a timezone such as Asia/Dubai.').max(64),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  addressLine1: optional,
  addressLine2: optional,
  city: z.string().trim().max(100),
  area: z.string().trim().max(100),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(254),
  marketIds: z.array(z.string()).min(1, 'Choose at least one market.'),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  code: '',
  name: '',
  countryIso2: '',
  timezone: '',
  status: 'ACTIVE',
  addressLine1: '',
  addressLine2: '',
  city: '',
  area: '',
  phone: '',
  email: '',
  marketIds: [],
};

const nullable = (v: string) => (v === '' ? null : v);

export default function BranchesPage() {
  const { scope, markets } = useScope();
  const canManage = useCan('branches.manage');
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const branches = useQuery({
    queryKey: ['admin', 'branches', 'all'],
    queryFn: () => http.get<Branch[]>('/admin/branches'),
  });
  const rows = branches.data?.filter((b) => {
    if (scope.branchId) return b.id === scope.branchId;
    if (scope.marketId) return b.markets.some((l) => l.marketId === scope.marketId);
    if (scope.brandId) return b.markets.some((l) => l.market.brandId === scope.brandId);
    return true;
  });
  const marketLabel = (id: string) => {
    const m = markets.find((x) => x.id === id);
    return m ? m.code.toUpperCase() : 'Market';
  };

  return (
    <>
      <PageHeader
        title="Branches"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              New branch
            </Button>
          )
        }
      />
      <DataTable
        caption="Branches"
        rows={rows}
        rowKey={(b) => b.id}
        loading={branches.isPending}
        error={
          branches.isError ? errorMessage(branches.error, 'We could not load branches.') : null
        }
        onRetry={() => void branches.refetch()}
        empty="No branches in this scope."
        columns={[
          {
            id: 'name',
            header: 'Branch',
            cell: (b) => (
              <button
                type="button"
                onClick={() => setEditing(b)}
                className="text-start font-medium underline-offset-2 hover:underline"
              >
                {b.name} <span className="text-muted">({b.code})</span>
              </button>
            ),
          },
          {
            id: 'where',
            header: 'Location',
            cell: (b) =>
              [b.area, b.city].filter(Boolean).join(', ') || (
                <span className="text-muted">Not set</span>
              ),
          },
          {
            id: 'markets',
            header: 'Serves',
            cell: (b) =>
              b.markets
                .filter((l) => l.status === 'ACTIVE')
                .map((l) => marketLabel(l.marketId))
                .join(', '),
          },
          { id: 'tz', header: 'Timezone', cell: (b) => b.timezone },
          { id: 'status', header: 'Status', cell: (b) => <StatusTag value={b.status} /> },
        ]}
      />
      <BranchDrawer target={editing} canManage={canManage} onClose={() => setEditing(null)} />
    </>
  );
}

function BranchDrawer({
  target,
  canManage,
  onClose,
}: {
  target: Branch | 'new' | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { markets } = useScope();
  const context = useAdminContext(true);
  const [formError, setFormError] = useState<string | null>(null);
  const creating = target === 'new';
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (target === 'new') reset(EMPTY);
    else if (target) {
      reset({
        code: target.code,
        name: target.name,
        countryIso2: target.country.iso2,
        timezone: target.timezone,
        status: target.status,
        addressLine1: target.addressLine1 ?? '',
        addressLine2: target.addressLine2 ?? '',
        city: target.city ?? '',
        area: target.area ?? '',
        phone: target.phone ?? '',
        email: target.email ?? '',
        marketIds: target.markets.filter((l) => l.status === 'ACTIVE').map((l) => l.marketId),
      });
    }
  }, [target, reset]);

  const close = () => {
    setFormError(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const common = {
        name: v.name,
        timezone: v.timezone,
        status: v.status,
        addressLine1: nullable(v.addressLine1),
        addressLine2: nullable(v.addressLine2),
        city: nullable(v.city),
        area: nullable(v.area),
        phone: nullable(v.phone),
        email: nullable(v.email),
      };
      if (target === 'new') {
        return http.post('/admin/branches', {
          ...common,
          code: v.code.toLowerCase(),
          countryIso2: v.countryIso2.toUpperCase(),
          marketIds: v.marketIds,
        });
      }
      const branch = target as Branch;
      await http.patch(`/admin/branches/${branch.id}`, common);
      const current = new Set(
        branch.markets.filter((l) => l.status === 'ACTIVE').map((l) => l.marketId),
      );
      const wanted = new Set(v.marketIds);
      for (const id of wanted) {
        if (!current.has(id)) await http.put(`/admin/branches/${branch.id}/markets/${id}`, {});
      }
      for (const id of current) {
        if (!wanted.has(id)) await http.delete(`/admin/branches/${branch.id}/markets/${id}`);
      }
      return null;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'branches'] });
      close();
    },
    onError: (e) =>
      setFormError(
        applyApiError(e, setError, [
          'code',
          'name',
          'countryIso2',
          'timezone',
          'email',
          'marketIds',
        ]),
      ),
  });

  return (
    <Drawer
      open={target !== null}
      title={creating ? 'New branch' : 'Edit branch'}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{canManage ? 'Cancel' : 'Close'}</Button>
          {canManage && (
            <Button type="submit" form="branch-form" variant="primary" busy={save.isPending}>
              {creating ? 'Create branch' : 'Save changes'}
            </Button>
          )}
        </>
      }
    >
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <form
        id="branch-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <TextField
          label="Name"
          disabled={!canManage}
          error={errors.name?.message}
          {...register('name')}
        />
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            label="Code"
            disabled={!creating}
            help={creating ? 'Lowercase, e.g. dubai-marina.' : 'Fixed after creation.'}
            error={errors.code?.message}
            {...register('code')}
          />
          <TextField
            label="Country code"
            disabled={!creating}
            maxLength={2}
            help="Two letters, e.g. AE."
            error={errors.countryIso2?.message}
            {...register('countryIso2')}
          />
        </div>
        <TextField
          label="Timezone"
          disabled={!canManage}
          error={errors.timezone?.message}
          {...register('timezone')}
        />
        <SelectField label="Status" disabled={!canManage} {...register('status')}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </SelectField>
        <fieldset className="mt-5">
          <legend className="text-[13px] font-medium">Markets served</legend>
          {markets.length === 0 && (
            <p className="mt-1 text-xs text-muted">No markets are available to you.</p>
          )}
          {markets.map((m) => (
            <Checkbox
              key={m.id}
              label={`${m.code.toUpperCase()} · ${m.country.name}`}
              help={context.data?.brands.find((b) => b.id === m.brandId)?.name}
              value={m.id}
              disabled={!canManage}
              {...register('marketIds')}
            />
          ))}
          {errors.marketIds?.message && (
            <p className="mt-1 text-xs text-danger">{errors.marketIds.message}</p>
          )}
        </fieldset>
        <TextField label="Address line 1" disabled={!canManage} {...register('addressLine1')} />
        <TextField label="Address line 2" disabled={!canManage} {...register('addressLine2')} />
        <div className="grid grid-cols-2 gap-x-3">
          <TextField label="Area" disabled={!canManage} {...register('area')} />
          <TextField label="City" disabled={!canManage} {...register('city')} />
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <TextField label="Phone" disabled={!canManage} {...register('phone')} />
          <TextField
            label="Email"
            type="email"
            disabled={!canManage}
            error={errors.email?.message}
            {...register('email')}
          />
        </div>
      </form>
    </Drawer>
  );
}
