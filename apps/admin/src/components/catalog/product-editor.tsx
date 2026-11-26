'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Checkbox, PageHeader, SelectField, StatusTag } from '@/components/ui/kit';
import { Alert, Button, TextField, cx } from '@/components/ui/primitives';
import { useScope } from '@/components/scope-context';
import { errorMessage, useCan } from '@/lib/auth';
import {
  LANGUAGES,
  NeedsBrand,
  type Product,
  type Taxon,
  fromLocalInput,
  itemsOf,
  nameIn,
  toLocalInput,
  useCatalog,
  visibilityLabel,
} from '@/lib/catalog';
import { AddonsTab } from './tabs/addons-tab';
import { MediaTab } from './tabs/media-tab';
import { OptionsTab } from './tabs/options-tab';
import { PricingTab } from './tabs/pricing-tab';
import { VariationsTab } from './tabs/variations-tab';

export interface TabProps {
  product: Product;
  canEdit: boolean;
  refresh: () => Promise<unknown>;
}

const messageOf = (e: unknown) =>
  e instanceof Error && !('status' in e) ? e.message : errorMessage(e);

/** Local validation errors are plain Errors; API errors carry a status and a server message. */
export function useSaveState() {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return {
    error,
    saved,
    fail: (e: unknown) => {
      setSaved(false);
      setError(messageOf(e));
    },
    ok: () => {
      setError(null);
      setSaved(true);
    },
    reset: () => {
      setError(null);
      setSaved(false);
    },
  };
}

export function SaveBar({
  state,
  busy,
  onSave,
  label = 'Save changes',
}: {
  state: ReturnType<typeof useSaveState>;
  busy: boolean;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button variant="primary" busy={busy} onClick={onSave}>
        {label}
      </Button>
      {state.saved && !state.error && (
        <span role="status" className="text-[13px] text-ok">
          Saved.
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-[13px] text-danger">
          {state.error}
        </span>
      )}
    </div>
  );
}

type TabId =
  'details' | 'content' | 'organise' | 'variations' | 'pricing' | 'options' | 'addons' | 'media';

export function ProductEditor({ productId }: { productId: string }) {
  const { brandId, ready, api } = useCatalog();
  const canEdit = useCan('products.edit');
  const canPublish = useCan('products.publish');
  const canDelete = useCan('products.delete');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('details');
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  const product = useQuery({
    queryKey: ['catalog', brandId, 'product', productId],
    enabled: !!brandId,
    queryFn: () => api.get<Product>(`products/${productId}`),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['catalog', brandId] });
  };

  const act = useMutation({
    mutationFn: (action: 'publish' | 'unpublish' | 'archive') =>
      api.post(`products/${productId}/${action}`),
    onSuccess: async () => {
      setMessage(null);
      setConfirm(null);
      await refresh();
    },
    onError: (e) => {
      setConfirm(null);
      setMessage(errorMessage(e));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`products/${productId}`),
    onSuccess: async () => {
      await refresh();
      router.push('/products');
    },
    onError: (e) => {
      setConfirm(null);
      setMessage(errorMessage(e));
    },
  });

  if (!brandId) {
    return (
      <>
        <PageHeader title="Product" crumbs={[{ label: 'Products', href: '/products' }]} />
        <NeedsBrand ready={ready} />
      </>
    );
  }
  if (product.isError) {
    return (
      <>
        <PageHeader title="Product" crumbs={[{ label: 'Products', href: '/products' }]} />
        <Alert tone="danger">
          {errorMessage(product.error, 'We could not load this product.')}
        </Alert>
      </>
    );
  }
  const p = product.data;
  if (!p) return <PageHeader title="Product" crumbs={[{ label: 'Products', href: '/products' }]} />;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'details', label: 'Details' },
    { id: 'content', label: 'Content' },
    { id: 'organise', label: 'Organise' },
    ...(p.type === 'VARIABLE' ? [{ id: 'variations' as const, label: 'Variations' }] : []),
    { id: 'pricing', label: 'Pricing' },
    { id: 'options', label: 'Options' },
    { id: 'addons', label: p.type === 'BUNDLE' ? 'Add-ons and bundle' : 'Add-ons' },
    { id: 'media', label: 'Media' },
  ];
  const props: TabProps = { product: p, canEdit, refresh };

  return (
    <>
      <PageHeader
        title={nameIn(p.translations) || 'Untitled product'}
        crumbs={[
          { label: 'Products', href: '/products' },
          { label: nameIn(p.translations) || 'Product' },
        ]}
        status={<StatusTag value={p.status} label={visibilityLabel[p.visibility]} />}
        actions={
          <>
            {canPublish && p.status !== 'PUBLISHED' && p.status !== 'ARCHIVED' && (
              <Button variant="primary" busy={act.isPending} onClick={() => act.mutate('publish')}>
                Publish
              </Button>
            )}
            {canPublish && p.status === 'PUBLISHED' && (
              <Button busy={act.isPending} onClick={() => act.mutate('unpublish')}>
                Unpublish
              </Button>
            )}
            {canPublish && p.status === 'ARCHIVED' && (
              <Button busy={act.isPending} onClick={() => act.mutate('unpublish')}>
                Restore as draft
              </Button>
            )}
            {canPublish && p.status !== 'ARCHIVED' && (
              <Button onClick={() => setConfirm('archive')}>Archive</Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => setConfirm('delete')}>
                Delete
              </Button>
            )}
          </>
        }
      />
      {message && (
        <Alert tone="danger" className="mb-4">
          {message}
        </Alert>
      )}
      <div
        role="tablist"
        aria-label="Product sections"
        className="mb-5 flex flex-wrap gap-1 border-b border-line"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="tab-panel"
            onClick={() => setTab(t.id)}
            className={cx(
              '-mb-px h-9 border-b-2 px-3 text-[13px] font-medium',
              tab === t.id
                ? 'border-action text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`} className="max-w-3xl">
        {!canEdit && (
          <Alert tone="info" className="mb-4">
            You can view this product but not change it.
          </Alert>
        )}
        {tab === 'details' && <DetailsTab {...props} />}
        {tab === 'content' && <ContentTab {...props} />}
        {tab === 'organise' && <OrganiseTab {...props} />}
        {tab === 'variations' && <VariationsTab {...props} />}
        {tab === 'pricing' && <PricingTab {...props} />}
        {tab === 'options' && <OptionsTab {...props} />}
        {tab === 'addons' && <AddonsTab {...props} />}
        {tab === 'media' && <MediaTab {...props} />}
      </div>
      <ConfirmDialog
        open={confirm === 'archive'}
        title="Archive this product?"
        confirmLabel="Archive product"
        busy={act.isPending}
        onConfirm={() => act.mutate('archive')}
        onCancel={() => setConfirm(null)}
      >
        It leaves the storefront. You can restore it as a draft later.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this product?"
        confirmLabel="Delete product"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirm(null)}
      >
        The product and its variations are removed from the catalog. Products used as a bundle
        component or add-on cannot be deleted.
      </ConfirmDialog>
    </>
  );
}

/* ------------------------------------------------------------------ details */

const intOrNull = (v: string, label: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number.`);
  return n;
};

function DetailsTab({ product, canEdit, refresh }: TabProps) {
  const { api } = useCatalog();
  const canPublish = useCan('products.publish');
  const state = useSaveState();
  const [f, setF] = useState(() => ({
    sku: product.sku ?? '',
    madeToOrder: product.madeToOrder,
    prep: product.prepTimeMinutes?.toString() ?? '',
    lead: product.leadTimeMinutes?.toString() ?? '',
    min: String(product.minQuantity),
    max: product.maxQuantity?.toString() ?? '',
    publishAt: toLocalInput(product.publishAt),
    unpublishAt: toLocalInput(product.unpublishAt),
  }));

  const save = useMutation({
    mutationFn: () => {
      const min = intOrNull(f.min, 'Minimum quantity') ?? 1;
      const body: Record<string, unknown> = {
        madeToOrder: f.madeToOrder,
        prepTimeMinutes: intOrNull(f.prep, 'Preparation time'),
        leadTimeMinutes: intOrNull(f.lead, 'Lead time'),
        minQuantity: min,
        maxQuantity: intOrNull(f.max, 'Maximum quantity'),
      };
      if (product.type !== 'VARIABLE') body.sku = f.sku.trim() || null;
      if (canPublish) {
        body.publishAt = fromLocalInput(f.publishAt);
        body.unpublishAt = fromLocalInput(f.unpublishAt);
      }
      return api.patch(`products/${product.id}`, body);
    },
    onSuccess: async () => {
      state.ok();
      await refresh();
    },
    onError: state.fail,
  });

  return (
    <div>
      <Facts2 type={product.type} />
      {product.type !== 'VARIABLE' && (
        <TextField
          label="SKU"
          disabled={!canEdit}
          value={f.sku}
          onChange={(e) => setF({ ...f, sku: e.target.value })}
          help="Stock keeping code, unique within the brand."
        />
      )}
      <div className="grid grid-cols-2 gap-x-3">
        <TextField
          label="Minimum quantity"
          inputMode="numeric"
          disabled={!canEdit}
          value={f.min}
          onChange={(e) => setF({ ...f, min: e.target.value })}
        />
        <TextField
          label="Maximum quantity"
          inputMode="numeric"
          disabled={!canEdit}
          help="Empty means no limit."
          value={f.max}
          onChange={(e) => setF({ ...f, max: e.target.value })}
        />
      </div>
      <Checkbox
        label="Made to order"
        help="Prepared after the order is placed rather than taken from stock."
        disabled={!canEdit}
        checked={f.madeToOrder}
        onChange={(e) => setF({ ...f, madeToOrder: e.target.checked })}
      />
      <div className="grid grid-cols-2 gap-x-3">
        <TextField
          label="Preparation time (minutes)"
          inputMode="numeric"
          disabled={!canEdit}
          value={f.prep}
          onChange={(e) => setF({ ...f, prep: e.target.value })}
        />
        <TextField
          label="Lead time (minutes)"
          inputMode="numeric"
          disabled={!canEdit}
          help="Used by delivery rules in a later phase."
          value={f.lead}
          onChange={(e) => setF({ ...f, lead: e.target.value })}
        />
      </div>
      <fieldset className="mt-6 border-t border-line pt-4">
        <legend className="px-1 text-[13px] font-semibold">Schedule</legend>
        {!canPublish && (
          <p className="mb-2 text-xs text-muted">
            Scheduling needs the permission to publish products.
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            label="Publish at"
            type="datetime-local"
            disabled={!canEdit || !canPublish}
            value={f.publishAt}
            onChange={(e) => setF({ ...f, publishAt: e.target.value })}
            help="Leave empty to publish as soon as you press Publish."
          />
          <TextField
            label="Unpublish at"
            type="datetime-local"
            disabled={!canEdit || !canPublish}
            value={f.unpublishAt}
            onChange={(e) => setF({ ...f, unpublishAt: e.target.value })}
          />
        </div>
      </fieldset>
      {canEdit && <SaveBar state={state} busy={save.isPending} onSave={() => save.mutate()} />}
    </div>
  );
}

function Facts2({ type }: { type: Product['type'] }) {
  const label = { SIMPLE: 'Simple product', VARIABLE: 'Product with variations', BUNDLE: 'Bundle' }[
    type
  ];
  return <p className="mb-4 text-[13px] text-muted">Type: {label}</p>;
}

/* ------------------------------------------------------------------ content */

interface ContentDraft {
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
}
const emptyContent = (): ContentDraft => ({
  name: '',
  slug: '',
  shortDescription: '',
  description: '',
  seoTitle: '',
  seoDescription: '',
});

function ContentTab({ product, canEdit, refresh }: TabProps) {
  const { api } = useCatalog();
  const state = useSaveState();
  const [drafts, setDrafts] = useState<Record<string, ContentDraft>>(() =>
    Object.fromEntries(
      LANGUAGES.map((l) => {
        const t = product.translations.find((x) => x.language === l.code);
        return [
          l.code,
          t
            ? {
                name: t.name,
                slug: t.slug,
                shortDescription: t.shortDescription ?? '',
                description: t.description ?? '',
                seoTitle: t.seoTitle ?? '',
                seoDescription: t.seoDescription ?? '',
              }
            : emptyContent(),
        ];
      }),
    ),
  );
  const set = (lang: string, patch: Partial<ContentDraft>) =>
    setDrafts((d) => ({ ...d, [lang]: { ...d[lang]!, ...patch } }));

  const save = useMutation({
    mutationFn: async () => {
      if (!drafts.en!.name.trim()) throw new Error('Enter the English name.');
      for (const l of LANGUAGES) {
        const d = drafts[l.code]!;
        const has = product.translations.some((t) => t.language === l.code);
        if (d.name.trim()) {
          await api.put(`products/${product.id}/translations/${l.code}`, {
            name: d.name.trim(),
            ...(d.slug.trim() && { slug: d.slug.trim() }),
            shortDescription: d.shortDescription.trim() || null,
            description: d.description.trim() || null,
            seoTitle: d.seoTitle.trim() || null,
            seoDescription: d.seoDescription.trim() || null,
          });
        } else if (has && !l.required) {
          await api.del(`products/${product.id}/translations/${l.code}`);
        }
      }
    },
    onSuccess: async () => {
      state.ok();
      await refresh();
    },
    onError: state.fail,
  });

  return (
    <div>
      {LANGUAGES.map((l, i) => {
        const d = drafts[l.code]!;
        const dir = l.code === 'ar' ? 'rtl' : undefined;
        return (
          <fieldset key={l.code} className={cx(i > 0 && 'mt-6 border-t border-line pt-4')}>
            <legend className="px-1 text-[13px] font-semibold">
              {l.name}
              {l.required ? '' : ' (optional)'}
            </legend>
            <TextField
              label={`Name (${l.name})`}
              dir={dir}
              disabled={!canEdit}
              value={d.name}
              onChange={(e) => set(l.code, { name: e.target.value })}
            />
            <TextField
              label={`Address (${l.name})`}
              disabled={!canEdit}
              help="Part of the product web address. Leave empty to build it from the name."
              value={d.slug}
              onChange={(e) => set(l.code, { slug: e.target.value })}
            />
            <TextField
              label={`Short description (${l.name})`}
              dir={dir}
              disabled={!canEdit}
              value={d.shortDescription}
              onChange={(e) => set(l.code, { shortDescription: e.target.value })}
            />
            <div className="mt-4">
              <label htmlFor={`desc-${l.code}`} className="mb-1 block text-[13px] font-medium">
                Description ({l.name})
              </label>
              <textarea
                id={`desc-${l.code}`}
                dir={dir}
                rows={5}
                disabled={!canEdit}
                value={d.description}
                onChange={(e) => set(l.code, { description: e.target.value })}
                className="w-full rounded-md border border-line-strong bg-surface p-3 text-sm disabled:bg-sunken"
              />
            </div>
            <TextField
              label={`Search title (${l.name})`}
              dir={dir}
              disabled={!canEdit}
              value={d.seoTitle}
              onChange={(e) => set(l.code, { seoTitle: e.target.value })}
            />
            <TextField
              label={`Search description (${l.name})`}
              dir={dir}
              disabled={!canEdit}
              value={d.seoDescription}
              onChange={(e) => set(l.code, { seoDescription: e.target.value })}
            />
          </fieldset>
        );
      })}
      {canEdit && <SaveBar state={state} busy={save.isPending} onSave={() => save.mutate()} />}
    </div>
  );
}

/* ------------------------------------------------------------------ organise */

function useTaxa(kind: 'categories' | 'collections' | 'tags') {
  const { brandId, api } = useCatalog();
  return useQuery({
    queryKey: ['catalog', brandId, kind],
    queryFn: async () => itemsOf(await api.get<Taxon[] | { items: Taxon[] }>(kind)),
  });
}

function OrganiseTab({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const { markets, branches } = useScope();
  const state = useSaveState();
  const categories = useTaxa('categories');
  const collections = useTaxa('collections');
  const tags = useTaxa('tags');
  const brandMarkets = markets.filter((m) => m.brandId === brandId);
  const marketIds = new Set(brandMarkets.map((m) => m.id));
  const brandBranches = branches.filter((b) => b.markets.some((l) => marketIds.has(l.marketId)));

  const [f, setF] = useState(() => ({
    primary: product.primaryCategoryId ?? '',
    categoryIds: product.categoryIds,
    collectionIds: product.collectionIds,
    tagIds: product.tagIds,
    marketIds: product.marketIds,
    branchIds: product.branchIds,
  }));
  const toggle = (
    key: 'categoryIds' | 'collectionIds' | 'tagIds' | 'marketIds' | 'branchIds',
    id: string,
  ) =>
    setF((s) => ({
      ...s,
      [key]: s[key].includes(id) ? s[key].filter((x) => x !== id) : [...s[key], id],
    }));

  const save = useMutation({
    mutationFn: async () => {
      await api.put(`products/${product.id}/taxonomy`, {
        primaryCategoryId: f.primary || null,
        categoryIds: f.categoryIds,
        collectionIds: f.collectionIds,
        tagIds: f.tagIds,
      });
      await api.put(`products/${product.id}/availability`, {
        marketIds: f.marketIds,
        branchIds: f.branchIds,
      });
    },
    onSuccess: async () => {
      state.ok();
      await refresh();
    },
    onError: state.fail,
  });

  const group = (
    legend: string,
    key: 'categoryIds' | 'collectionIds' | 'tagIds',
    items: Taxon[] | undefined,
  ) => (
    <fieldset className="mt-5">
      <legend className="text-[13px] font-medium">{legend}</legend>
      {(items?.length ?? 0) === 0 && <p className="mt-1 text-xs text-muted">None created yet.</p>}
      {items?.map((t) => (
        <Checkbox
          key={t.id}
          label={nameIn(t.translations)}
          disabled={!canEdit}
          checked={f[key].includes(t.id)}
          onChange={() => toggle(key, t.id)}
        />
      ))}
    </fieldset>
  );

  return (
    <div>
      <fieldset>
        <legend className="text-[13px] font-medium">Markets</legend>
        <p className="mt-1 text-xs text-muted">
          A product is sold only in the markets ticked here, and needs a price in each of them to be
          published.
        </p>
        {brandMarkets.length === 0 && (
          <p className="mt-1 text-xs text-muted">This brand has no markets yet.</p>
        )}
        {brandMarkets.map((m) => (
          <Checkbox
            key={m.id}
            label={`${m.code.toUpperCase()} · ${m.country.name}`}
            disabled={!canEdit}
            checked={f.marketIds.includes(m.id)}
            onChange={() => toggle('marketIds', m.id)}
          />
        ))}
      </fieldset>
      {group('Categories', 'categoryIds', categories.data)}
      <SelectField
        label="Main category"
        disabled={!canEdit}
        value={f.primary}
        onChange={(e) => setF({ ...f, primary: e.target.value })}
      >
        <option value="">None</option>
        {categories.data
          ?.filter((c) => f.categoryIds.includes(c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {nameIn(c.translations)}
            </option>
          ))}
      </SelectField>
      {group('Collections', 'collectionIds', collections.data)}
      {group('Tags', 'tagIds', tags.data)}
      <fieldset className="mt-5">
        <legend className="text-[13px] font-medium">Allowed branches</legend>
        <p className="mt-1 text-xs text-muted">
          Optional. Which branches may prepare this product; delivery and stock rules that use this
          come in a later phase.
        </p>
        {brandBranches.map((b) => (
          <Checkbox
            key={b.id}
            label={b.name}
            disabled={!canEdit}
            checked={f.branchIds.includes(b.id)}
            onChange={() => toggle('branchIds', b.id)}
          />
        ))}
      </fieldset>
      {canEdit && <SaveBar state={state} busy={save.isPending} onSave={() => save.mutate()} />}
    </div>
  );
}
