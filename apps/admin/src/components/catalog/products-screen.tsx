'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  DataTable,
  PageHeader,
  Pager,
  SearchBox,
  SelectField,
  StatusTag,
  Toolbar,
} from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import {
  NeedsBrand,
  type Product,
  type ProductType,
  nameIn,
  useCatalog,
  visibilityLabel,
} from '@/lib/catalog';

const PAGE_SIZE = 25;
const TYPE_LABEL: Record<ProductType, string> = {
  SIMPLE: 'Simple',
  VARIABLE: 'With variations',
  BUNDLE: 'Bundle',
};

export function ProductsScreen() {
  const { brandId, ready, api } = useCatalog();
  const canCreate = useCan('products.create');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['catalog', brandId, 'products', { search, status, type, page }],
    enabled: !!brandId,
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search) q.set('search', search);
      if (status) q.set('status', status);
      if (type) q.set('type', type);
      return api.get<{ items: Product[]; total: number }>(`products?${q}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Products"
        actions={
          canCreate &&
          brandId && (
            <Link
              href="/products/new"
              className="inline-flex h-9 items-center rounded-md border border-action bg-action px-3.5 text-sm font-medium text-action-ink hover:bg-action-hover"
            >
              New product
            </Link>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} />
      ) : (
        <>
          <Toolbar>
            <SearchBox
              label="Search products"
              placeholder="Search by name or SKU"
              onSearch={(v) => {
                setSearch(v);
                setPage(1);
              }}
            />
            <SelectField
              compact
              hideLabel
              label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </SelectField>
            <SelectField
              compact
              hideLabel
              label="Filter by type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              <option value="SIMPLE">Simple</option>
              <option value="VARIABLE">With variations</option>
              <option value="BUNDLE">Bundle</option>
            </SelectField>
          </Toolbar>
          <DataTable
            caption="Products"
            rows={list.data?.items}
            rowKey={(p) => p.id}
            loading={list.isPending}
            error={list.isError ? errorMessage(list.error, 'We could not load products.') : null}
            onRetry={() => void list.refetch()}
            empty={
              search || status || type ? 'No products match these filters.' : 'No products yet.'
            }
            columns={[
              {
                id: 'name',
                header: 'Product',
                cell: (p) => (
                  <Link
                    href={`/products/${p.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {nameIn(p.translations) || 'Untitled'}
                  </Link>
                ),
              },
              { id: 'type', header: 'Type', cell: (p) => TYPE_LABEL[p.type] },
              {
                id: 'sku',
                header: 'SKU',
                cell: (p) => p.sku ?? <span className="text-muted">Per variation</span>,
              },
              {
                id: 'status',
                header: 'Status',
                cell: (p) => <StatusTag value={p.status} label={visibilityLabel[p.visibility]} />,
              },
              { id: 'markets', header: 'Markets', cell: (p) => p.marketIds.length },
            ]}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}

export function NewProductScreen() {
  const { brandId, ready, api } = useCatalog();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ProductType>('SIMPLE');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Enter the English name.');
      return api.post<Product>('products', {
        type,
        ...(type !== 'VARIABLE' && sku.trim() && { sku: sku.trim() }),
        translations: [{ language: 'en', name: name.trim() }],
      });
    },
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: ['catalog', brandId, 'products'] });
      router.push(`/products/${p.id}`);
    },
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="New product"
        crumbs={[{ label: 'Products', href: '/products' }, { label: 'New' }]}
      />
      {!brandId ? (
        <NeedsBrand ready={ready} />
      ) : (
        <form
          noValidate
          className="max-w-xl rounded-md border border-line bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}
          <SelectField
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as ProductType)}
            help="The type cannot be changed once variations, prices or components exist."
          >
            <option value="SIMPLE">Simple: one item, one price</option>
            <option value="VARIABLE">With variations: sizes, colours and so on</option>
            <option value="BUNDLE">Bundle: several products sold together</option>
          </SelectField>
          <TextField
            label="Name (English)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {type !== 'VARIABLE' && (
            <TextField
              label="SKU (optional)"
              help="Stock keeping code. Leave empty to add it later."
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          )}
          <p className="mt-4 text-xs text-muted">
            The product is created as a draft. You can add content, prices and pictures before
            publishing.
          </p>
          <div className="mt-5 flex gap-2">
            <Button type="submit" variant="primary" busy={create.isPending}>
              Create product
            </Button>
            <Link
              href="/products"
              className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-sunken"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
