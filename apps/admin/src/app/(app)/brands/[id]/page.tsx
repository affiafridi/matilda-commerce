'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Checkbox,
  DataTable,
  Drawer,
  PageHeader,
  Section,
  SelectField,
  StatusTag,
} from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { applyApiError } from '@/lib/forms';
import { http } from '@/lib/http';
import type { Brand, Domain, Market } from '@/lib/types';

const detailSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  legalEntityName: z.string().trim().max(200),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type DetailValues = z.infer<typeof detailSchema>;

export default function BrandPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const canManage = useCan('brands.manage');
  const [addingDomain, setAddingDomain] = useState(false);
  const [removing, setRemoving] = useState<Domain | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const brand = useQuery({
    queryKey: ['admin', 'brands', id],
    queryFn: () => http.get<Brand>(`/admin/brands/${id}`),
  });
  const markets = useQuery({
    queryKey: ['admin', 'markets', 'brand', id],
    queryFn: () => http.get<Market[]>(`/admin/markets?brandId=${id}`).catch(() => [] as Market[]),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
  const makePrimary = useMutation({
    mutationFn: (d: Domain) =>
      http.patch(`/admin/brands/${id}/domains/${d.id}`, { isPrimary: true }),
    onSuccess: refresh,
    onError: (e) => setRowError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (d: Domain) => http.delete(`/admin/brands/${id}/domains/${d.id}`),
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
    onError: (e) => {
      setRemoving(null);
      setRowError(errorMessage(e));
    },
  });

  if (brand.isPending)
    return (
      <p role="status" className="text-[13px] text-muted">
        Loading brand…
      </p>
    );
  if (brand.isError || !brand.data) {
    return (
      <>
        <PageHeader title="Brand" crumbs={[{ label: 'Brands and domains', href: '/brands' }]} />
        <Alert tone="danger">That brand was not found, or you do not have access to it.</Alert>
      </>
    );
  }
  const b = brand.data;
  const marketCode = (marketId: string | null) =>
    marketId
      ? (markets.data?.find((m) => m.id === marketId)?.code.toUpperCase() ?? 'Market')
      : 'All markets';

  return (
    <>
      <PageHeader
        title={b.name}
        crumbs={[{ label: 'Brands and domains', href: '/brands' }, { label: b.name }]}
        status={<StatusTag value={b.status} />}
      />
      <div>
        <DetailsForm brand={b} canManage={canManage} />

        <Section
          title="Domains"
          action={canManage && <Button onClick={() => setAddingDomain(true)}>Add domain</Button>}
        >
          {rowError && (
            <Alert tone="danger" className="mb-3">
              {rowError}
            </Alert>
          )}
          <DataTable
            caption="Domains"
            rows={b.domains}
            rowKey={(d) => d.id}
            empty="No domains yet. A storefront cannot resolve this brand without one."
            columns={[
              {
                id: 'host',
                header: 'Hostname',
                cell: (d) => <span className="font-medium">{d.hostname}</span>,
              },
              { id: 'market', header: 'Market', cell: (d) => marketCode(d.marketId) },
              {
                id: 'lang',
                header: 'Language',
                cell: (d) => d.defaultLanguageCode ?? <span className="text-muted">Default</span>,
              },
              {
                id: 'role',
                header: 'Role',
                cell: (d) =>
                  d.isPrimary
                    ? 'Primary'
                    : d.redirectToPrimary
                      ? 'Redirects to primary'
                      : 'Serves the brand',
              },
              {
                id: 'actions',
                header: 'Actions',
                hideHeader: true,
                className: 'text-end whitespace-nowrap',
                cell: (d) =>
                  canManage && (
                    <span className="inline-flex gap-1">
                      {!d.isPrimary && (
                        <Button variant="quiet" onClick={() => makePrimary.mutate(d)}>
                          Make primary
                        </Button>
                      )}
                      <Button variant="quiet" onClick={() => setRemoving(d)}>
                        Remove
                      </Button>
                    </span>
                  ),
              },
            ]}
          />
        </Section>
      </div>

      <AddDomain
        brandId={id}
        markets={markets.data ?? []}
        open={addingDomain}
        onClose={() => setAddingDomain(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this domain?"
        confirmLabel="Remove domain"
        danger
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      >
        {removing?.hostname} will stop resolving to {b.name}. Storefront visitors on that address
        will no longer reach the brand.
      </ConfirmDialog>
    </>
  );
}

function DetailsForm({ brand, canManage }: { brand: Brand; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<DetailValues>({
    resolver: zodResolver(detailSchema),
    defaultValues: {
      name: brand.name,
      legalEntityName: brand.legalEntityName ?? '',
      status: brand.status,
    },
  });
  useEffect(() => {
    reset({ name: brand.name, legalEntityName: brand.legalEntityName ?? '', status: brand.status });
  }, [brand, reset]);
  const save = useMutation({
    mutationFn: (v: DetailValues) =>
      http.patch(`/admin/brands/${brand.id}`, { ...v, legalEntityName: v.legalEntityName || null }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
    },
    onError: (e) => setFormError(applyApiError(e, setError, ['name', 'legalEntityName', 'status'])),
  });
  return (
    <Section title="Details">
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
            label="Name"
            disabled={!canManage}
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="Legal entity"
            disabled={!canManage}
            error={errors.legalEntityName?.message}
            {...register('legalEntityName')}
          />
        </div>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField
            label="Slug"
            value={brand.slug}
            readOnly
            disabled
            help="Fixed after creation."
            onChange={() => undefined}
          />
          <SelectField
            label="Status"
            disabled={!canManage}
            error={errors.status?.message}
            {...register('status')}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </SelectField>
        </div>
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
    </Section>
  );
}

const domainSchema = z.object({
  hostname: z.string().trim().min(1, 'Enter a hostname.').max(253),
  marketId: z.string(),
  defaultLanguageCode: z.string().trim().max(10),
  isPrimary: z.boolean(),
  redirectToPrimary: z.boolean(),
});
type DomainValues = z.infer<typeof domainSchema>;

function AddDomain({
  brandId,
  markets,
  open,
  onClose,
}: {
  brandId: string;
  markets: Market[];
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<DomainValues>({
    resolver: zodResolver(domainSchema),
    defaultValues: {
      hostname: '',
      marketId: '',
      defaultLanguageCode: '',
      isPrimary: false,
      redirectToPrimary: false,
    },
  });
  const add = useMutation({
    mutationFn: (v: DomainValues) =>
      http.post(`/admin/brands/${brandId}/domains`, {
        hostname: v.hostname,
        marketId: v.marketId || null,
        defaultLanguageCode: v.defaultLanguageCode || null,
        isPrimary: v.isPrimary,
        redirectToPrimary: v.redirectToPrimary,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
      reset();
      onClose();
    },
    onError: (e) =>
      setFormError(applyApiError(e, setError, ['hostname', 'marketId', 'defaultLanguageCode'])),
  });
  const close = () => {
    reset();
    setFormError(null);
    onClose();
  };
  return (
    <Drawer
      open={open}
      title="Add domain"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="domain-form" variant="primary" busy={add.isPending}>
            Add domain
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
        id="domain-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          add.mutate(v);
        })}
      >
        <TextField
          label="Hostname"
          help="For example shop.example.com, without https://."
          error={errors.hostname?.message}
          {...register('hostname')}
        />
        <SelectField
          label="Market"
          help="Leave on All markets for a brand-wide domain."
          {...register('marketId')}
        >
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code.toUpperCase()} · {m.country.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Default language (optional)"
          help="Language code such as en or ar."
          error={errors.defaultLanguageCode?.message}
          {...register('defaultLanguageCode')}
        />
        <Checkbox
          label="Primary domain"
          help="The address shown as the brand's main site."
          {...register('isPrimary')}
        />
        <Checkbox
          label="Redirect visitors to the primary domain"
          {...register('redirectToPrimary')}
        />
      </form>
    </Drawer>
  );
}
