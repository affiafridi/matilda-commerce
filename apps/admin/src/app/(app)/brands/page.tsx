'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useScope } from '@/components/scope-context';
import { Drawer, PageHeader, StatusTag, DataTable } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { applyApiError, formatDate } from '@/lib/forms';
import { http } from '@/lib/http';
import type { Brand } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes only.')
    .max(40),
  legalEntityName: z.string().trim().max(200).optional(),
});
type Values = z.infer<typeof schema>;

export default function BrandsPage() {
  const { scope } = useScope();
  const canManage = useCan('brands.manage');
  const [creating, setCreating] = useState(false);
  const brands = useQuery({
    queryKey: ['admin', 'brands'],
    queryFn: () => http.get<Brand[]>('/admin/brands'),
  });
  const rows = brands.data?.filter((b) => !scope.brandId || b.id === scope.brandId);

  return (
    <>
      <PageHeader
        title="Brands and domains"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New brand
            </Button>
          )
        }
      />
      <DataTable
        caption="Brands"
        rows={rows}
        rowKey={(b) => b.id}
        loading={brands.isPending}
        error={brands.isError ? errorMessage(brands.error, 'We could not load brands.') : null}
        onRetry={() => void brands.refetch()}
        empty="No brands are visible to you."
        columns={[
          {
            id: 'name',
            header: 'Brand',
            cell: (b) => (
              <Link
                href={`/brands/${b.id}`}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {b.name}
              </Link>
            ),
          },
          { id: 'slug', header: 'Slug', cell: (b) => <code className="text-xs">{b.slug}</code> },
          {
            id: 'domains',
            header: 'Primary domain',
            cell: (b) =>
              b.domains.find((d) => d.isPrimary)?.hostname ?? (
                <span className="text-muted">None</span>
              ),
          },
          {
            id: 'count',
            header: 'Domains',
            className: 'text-end tabular-nums',
            cell: (b) => b.domains.length,
          },
          { id: 'status', header: 'Status', cell: (b) => <StatusTag value={b.status} /> },
          { id: 'created', header: 'Created', cell: (b) => formatDate(b.createdAt) },
        ]}
      />
      <CreateBrand open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateBrand({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: (values: Values) =>
      http.post<Brand>('/admin/brands', {
        ...values,
        legalEntityName: values.legalEntityName || undefined,
      }),
    onSuccess: async (brand) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
      reset();
      onClose();
      router.push(`/brands/${brand.id}`);
    },
    onError: (error) =>
      setFormError(applyApiError(error, setError, ['name', 'slug', 'legalEntityName'])),
  });
  const close = () => {
    reset();
    setFormError(null);
    onClose();
  };
  return (
    <Drawer
      open={open}
      title="New brand"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="brand-form" variant="primary" busy={create.isPending}>
            Create brand
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
        id="brand-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          create.mutate(v);
        })}
      >
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
        <TextField
          label="Slug"
          help="Used in internal references. It cannot be changed later."
          error={errors.slug?.message}
          {...register('slug')}
        />
        <TextField
          label="Legal entity (optional)"
          error={errors.legalEntityName?.message}
          {...register('legalEntityName')}
        />
      </form>
    </Drawer>
  );
}
