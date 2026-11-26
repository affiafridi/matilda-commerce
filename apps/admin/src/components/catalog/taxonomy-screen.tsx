'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, Drawer, PageHeader, SelectField, StatusTag } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import {
  type CatalogStatus,
  LANGUAGES,
  NeedsBrand,
  type Taxon,
  itemsOf,
  nameIn,
  useCatalog,
} from '@/lib/catalog';

type Kind = 'categories' | 'collections' | 'tags';
const COPY: Record<Kind, { title: string; one: string; empty: string }> = {
  categories: {
    title: 'Categories',
    one: 'category',
    empty: 'No categories yet. Create the first one.',
  },
  collections: {
    title: 'Collections',
    one: 'collection',
    empty: 'No collections yet. Create the first one.',
  },
  tags: { title: 'Tags', one: 'tag', empty: 'No tags yet. Create the first one.' },
};

interface Draft {
  status: CatalogStatus;
  sortOrder: string;
  parentId: string;
  text: Record<string, { name: string; slug: string; description: string }>;
}

const emptyDraft = (): Draft => ({
  status: 'DRAFT',
  sortOrder: '0',
  parentId: '',
  text: Object.fromEntries(LANGUAGES.map((l) => [l.code, { name: '', slug: '', description: '' }])),
});

const toDraft = (t: Taxon): Draft => {
  const d = emptyDraft();
  d.status = t.status;
  d.sortOrder = String(t.sortOrder);
  d.parentId = t.parentId ?? '';
  for (const tr of t.translations) {
    d.text[tr.language] = {
      name: tr.name,
      slug: tr.slug,
      description: tr.description ?? '',
    };
  }
  return d;
};

/** Depth-first order so sub-categories sit under their parent. */
function ordered(items: Taxon[]): Array<{ item: Taxon; depth: number }> {
  const byParent = new Map<string | null, Taxon[]>();
  for (const i of items)
    byParent.set(i.parentId ?? null, [...(byParent.get(i.parentId ?? null) ?? []), i]);
  const out: Array<{ item: Taxon; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const i of byParent.get(parent) ?? []) {
      out.push({ item: i, depth });
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything whose parent is missing from the list still appears (at the top level).
  for (const i of items) if (!out.some((o) => o.item.id === i.id)) out.push({ item: i, depth: 0 });
  return out;
}

export function TaxonomyScreen({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  const { brandId, ready, api } = useCatalog();
  const canManage = useCan('taxonomy.manage');
  const [editing, setEditing] = useState<Taxon | 'new' | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);
  /** A new key remounts the drawer so its form starts from the chosen record. */
  const openDrawer = (t: Taxon | 'new') => {
    setEditing(t);
    setDrawerKey((k) => k + 1);
  };
  const list = useQuery({
    queryKey: ['catalog', brandId, kind],
    enabled: !!brandId,
    queryFn: async () => itemsOf(await api.get<Taxon[] | { items: Taxon[] }>(kind)),
  });
  const rows =
    kind === 'categories'
      ? ordered(list.data ?? [])
      : (list.data ?? []).map((item) => ({ item, depth: 0 }));

  return (
    <>
      <PageHeader
        title={copy.title}
        actions={
          canManage &&
          brandId && (
            <Button variant="primary" onClick={() => openDrawer('new')}>
              New {copy.one}
            </Button>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} />
      ) : (
        <DataTable
          caption={copy.title}
          rows={rows}
          rowKey={(r) => r.item.id}
          loading={list.isPending}
          error={list.isError ? errorMessage(list.error, `We could not load ${kind}.`) : null}
          onRetry={() => void list.refetch()}
          empty={copy.empty}
          columns={[
            {
              id: 'name',
              header: 'Name',
              cell: (r) => (
                <button
                  type="button"
                  onClick={() => openDrawer(r.item)}
                  style={{ paddingInlineStart: `${r.depth * 1.25}rem` }}
                  className="text-start font-medium underline-offset-2 hover:underline"
                >
                  {nameIn(r.item.translations)}
                </button>
              ),
            },
            {
              id: 'slug',
              header: 'Address (English)',
              cell: (r) => (
                <span className="text-muted">
                  {r.item.translations.find((t) => t.language === 'en')?.slug}
                </span>
              ),
            },
            {
              id: 'langs',
              header: 'Languages',
              cell: (r) => r.item.translations.map((t) => t.language.toUpperCase()).join(', '),
            },
            { id: 'status', header: 'Status', cell: (r) => <StatusTag value={r.item.status} /> },
          ]}
        />
      )}
      {brandId && (
        <TaxonDrawer
          key={drawerKey}
          kind={kind}
          target={editing}
          all={list.data ?? []}
          canManage={canManage}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function TaxonDrawer({
  kind,
  target,
  all,
  canManage,
  onClose,
}: {
  kind: Kind;
  target: Taxon | 'new' | null;
  all: Taxon[];
  canManage: boolean;
  onClose: () => void;
}) {
  const copy = COPY[kind];
  const { brandId, api } = useCatalog();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() =>
    target && target !== 'new' ? toDraft(target) : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const creating = target === 'new';
  const taxon = target && target !== 'new' ? target : null;

  const setText = (lang: string, field: 'name' | 'slug' | 'description', value: string) =>
    setDraft((d) => ({ ...d, text: { ...d.text, [lang]: { ...d.text[lang]!, [field]: value } } }));

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ['catalog', brandId, kind] });
    setError(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      const sortOrder = Number(draft.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0)
        throw new Error('Sort order must be a whole number from 0.');
      const filled = LANGUAGES.filter((l) => draft.text[l.code]!.name.trim() !== '');
      if (!draft.text.en!.name.trim()) throw new Error('Enter the English name.');
      const body = (code: string) => {
        const t = draft.text[code]!;
        return {
          name: t.name.trim(),
          ...(t.slug.trim() && { slug: t.slug.trim() }),
          description: t.description.trim() || null,
        };
      };
      const base = {
        status: draft.status,
        sortOrder,
        ...(kind === 'categories' && { parentId: draft.parentId || null }),
      };
      if (creating) {
        await api.post(kind, {
          ...base,
          translations: filled.map((l) => ({ language: l.code, ...body(l.code) })),
        });
        return;
      }
      const id = taxon!.id;
      await api.patch(`${kind}/${id}`, base);
      for (const l of LANGUAGES) {
        const has = taxon!.translations.some((t) => t.language === l.code);
        const wants = draft.text[l.code]!.name.trim() !== '';
        if (wants) await api.put(`${kind}/${id}/translations/${l.code}`, body(l.code));
        else if (has && !l.required) await api.del(`${kind}/${id}/translations/${l.code}`);
      }
    },
    onSuccess: finish,
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`${kind}/${taxon!.id}`),
    onSuccess: async () => {
      setConfirmDelete(false);
      await finish();
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(errorMessage(e));
    },
  });

  const parents = all.filter((c) => c.id !== taxon?.id);

  return (
    <>
      <Drawer
        open={target !== null}
        title={creating ? `New ${copy.one}` : `Edit ${copy.one}`}
        onClose={onClose}
        footer={
          <>
            {canManage && taxon && (
              <Button variant="danger" className="me-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button onClick={onClose}>{canManage ? 'Cancel' : 'Close'}</Button>
            {canManage && (
              <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
                {creating ? `Create ${copy.one}` : 'Save changes'}
              </Button>
            )}
          </>
        }
      >
        {error && (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        )}
        <SelectField
          label="Status"
          disabled={!canManage}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as CatalogStatus })}
          help="Only published items appear on the storefront."
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </SelectField>
        {kind === 'categories' && (
          <SelectField
            label="Parent category"
            disabled={!canManage}
            value={draft.parentId}
            onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
          >
            <option value="">None (top level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {nameIn(p.translations)}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Sort order"
          inputMode="numeric"
          disabled={!canManage}
          value={draft.sortOrder}
          onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
        />
        {LANGUAGES.map((l) => (
          <fieldset key={l.code} className="mt-6 border-t border-line pt-4">
            <legend className="px-1 text-[13px] font-semibold">
              {l.name}
              {l.required ? '' : ' (optional)'}
            </legend>
            <TextField
              label={`Name (${l.name})`}
              disabled={!canManage}
              dir={l.code === 'ar' ? 'rtl' : undefined}
              value={draft.text[l.code]!.name}
              onChange={(e) => setText(l.code, 'name', e.target.value)}
            />
            <TextField
              label={`Address (${l.name})`}
              disabled={!canManage}
              help="Leave empty to build it from the name."
              value={draft.text[l.code]!.slug}
              onChange={(e) => setText(l.code, 'slug', e.target.value)}
            />
            <TextField
              label={`Description (${l.name})`}
              disabled={!canManage}
              dir={l.code === 'ar' ? 'rtl' : undefined}
              value={draft.text[l.code]!.description}
              onChange={(e) => setText(l.code, 'description', e.target.value)}
            />
          </fieldset>
        ))}
      </Drawer>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete this ${copy.one}?`}
        confirmLabel={`Delete ${copy.one}`}
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      >
        It disappears from the catalog. The address is kept so old links can be redirected later.
        Items that are still in use cannot be deleted.
      </ConfirmDialog>
    </>
  );
}
