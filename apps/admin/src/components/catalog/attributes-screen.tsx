'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, Drawer, PageHeader, SelectField } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { type Attribute, NeedsBrand, itemsOf, labelIn, useCatalog } from '@/lib/catalog';

interface ValueRow {
  id?: string;
  key: string;
  en: string;
  ar: string;
  colorHex: string;
}
interface Draft {
  key: string;
  kind: Attribute['kind'];
  en: string;
  ar: string;
  values: ValueRow[];
}

const emptyDraft = (): Draft => ({ key: '', kind: 'TEXT', en: '', ar: '', values: [] });
const labelOf = (rows: Array<{ language: string; label: string }>, lang: string) =>
  rows.find((r) => r.language === lang)?.label ?? '';

const toDraft = (a: Attribute): Draft => ({
  key: a.key,
  kind: a.kind,
  en: labelOf(a.translations, 'en'),
  ar: labelOf(a.translations, 'ar'),
  values: a.values.map((v) => ({
    id: v.id,
    key: v.key,
    en: labelOf(v.translations, 'en'),
    ar: labelOf(v.translations, 'ar'),
    colorHex: v.colorHex ?? '',
  })),
});

const translations = (en: string, ar: string) => [
  { language: 'en', label: en.trim() },
  ...(ar.trim() ? [{ language: 'ar', label: ar.trim() }] : []),
];

export function AttributesScreen() {
  const { brandId, ready, api } = useCatalog();
  const canManage = useCan('taxonomy.manage');
  const [editing, setEditing] = useState<Attribute | 'new' | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);
  const openDrawer = (t: Attribute | 'new') => {
    setEditing(t);
    setDrawerKey((k) => k + 1);
  };
  const list = useQuery({
    queryKey: ['catalog', brandId, 'attributes'],
    enabled: !!brandId,
    queryFn: async () =>
      itemsOf(await api.get<Attribute[] | { items: Attribute[] }>('attributes?pageSize=200')),
  });

  return (
    <>
      <PageHeader
        title="Attributes"
        actions={
          canManage &&
          brandId && (
            <Button variant="primary" onClick={() => openDrawer('new')}>
              New attribute
            </Button>
          )
        }
      />
      {!brandId ? (
        <NeedsBrand ready={ready} />
      ) : (
        <DataTable
          caption="Attributes"
          rows={list.data}
          rowKey={(a) => a.id}
          loading={list.isPending}
          error={list.isError ? errorMessage(list.error, 'We could not load attributes.') : null}
          onRetry={() => void list.refetch()}
          empty="No attributes yet. Attributes such as Size or Colour describe products and drive variations."
          columns={[
            {
              id: 'label',
              header: 'Attribute',
              cell: (a) => (
                <button
                  type="button"
                  onClick={() => openDrawer(a)}
                  className="text-start font-medium underline-offset-2 hover:underline"
                >
                  {labelIn(a.translations)}
                </button>
              ),
            },
            { id: 'key', header: 'Key', cell: (a) => <span className="text-muted">{a.key}</span> },
            {
              id: 'kind',
              header: 'Type',
              cell: (a) => a.kind.charAt(0) + a.kind.slice(1).toLowerCase(),
            },
            {
              id: 'values',
              header: 'Values',
              cell: (a) => a.values.map((v) => labelIn(v.translations)).join(', ') || '—',
            },
          ]}
        />
      )}
      {brandId && (
        <AttributeDrawer
          key={drawerKey}
          target={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function AttributeDrawer({
  target,
  canManage,
  onClose,
}: {
  target: Attribute | 'new' | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const { brandId, api } = useCatalog();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() =>
    target && target !== 'new' ? toDraft(target) : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const creating = target === 'new';
  const attribute = target && target !== 'new' ? target : null;

  const setValue = (i: number, patch: Partial<ValueRow>) =>
    setDraft((d) => ({ ...d, values: d.values.map((v, n) => (n === i ? { ...v, ...patch } : v)) }));

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ['catalog', brandId, 'attributes'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!draft.key.trim()) throw new Error('Enter a key such as size.');
      if (!draft.en.trim()) throw new Error('Enter the English label.');
      const isColor = draft.kind === 'COLOR';
      for (const v of draft.values) {
        if (!v.key.trim() || !v.en.trim())
          throw new Error('Every value needs a key and an English label.');
        if (isColor && v.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(v.colorHex)) {
          throw new Error('Colours look like #C8A2C8.');
        }
      }
      const valueBody = (v: ValueRow, sortOrder: number) => ({
        key: v.key.trim(),
        colorHex: isColor && v.colorHex ? v.colorHex : null,
        sortOrder,
      });
      if (creating) {
        await api.post('attributes', {
          key: draft.key.trim(),
          kind: draft.kind,
          translations: translations(draft.en, draft.ar),
          values: draft.values.map((v, i) => ({
            ...valueBody(v, i),
            translations: translations(v.en, v.ar),
          })),
        });
        return;
      }
      const id = attribute!.id;
      await api.patch(`attributes/${id}`, { key: draft.key.trim(), kind: draft.kind });
      await api.put(`attributes/${id}/translations/en`, { label: draft.en.trim() });
      if (draft.ar.trim())
        await api.put(`attributes/${id}/translations/ar`, { label: draft.ar.trim() });
      else if (labelOf(attribute!.translations, 'ar'))
        await api.del(`attributes/${id}/translations/ar`);
      const keep = new Set(draft.values.flatMap((v) => (v.id ? [v.id] : [])));
      for (const old of attribute!.values) {
        if (!keep.has(old.id)) await api.del(`attributes/${id}/values/${old.id}`);
      }
      for (const [i, v] of draft.values.entries()) {
        if (!v.id) {
          await api.post(`attributes/${id}/values`, {
            ...valueBody(v, i),
            translations: translations(v.en, v.ar),
          });
          continue;
        }
        await api.patch(`attributes/${id}/values/${v.id}`, valueBody(v, i));
        await api.put(`attributes/${id}/values/${v.id}/translations/en`, { label: v.en.trim() });
        if (v.ar.trim())
          await api.put(`attributes/${id}/values/${v.id}/translations/ar`, { label: v.ar.trim() });
        else
          await api.del(`attributes/${id}/values/${v.id}/translations/ar`).catch(() => undefined);
      }
    },
    onSuccess: finish,
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`attributes/${attribute!.id}`),
    onSuccess: async () => {
      setConfirmDelete(false);
      await finish();
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(errorMessage(e));
    },
  });

  return (
    <>
      <Drawer
        open={target !== null}
        title={creating ? 'New attribute' : 'Edit attribute'}
        onClose={onClose}
        footer={
          <>
            {canManage && attribute && (
              <Button variant="danger" className="me-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button onClick={onClose}>{canManage ? 'Cancel' : 'Close'}</Button>
            {canManage && (
              <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
                {creating ? 'Create attribute' : 'Save changes'}
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
        <TextField
          label="Key"
          disabled={!canManage}
          help="Lower-case letters, numbers and hyphens, e.g. size."
          value={draft.key}
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
        />
        <SelectField
          label="Type"
          disabled={!canManage}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as Attribute['kind'] })}
        >
          <option value="TEXT">Text</option>
          <option value="COLOR">Colour</option>
          <option value="NUMBER">Number</option>
        </SelectField>
        <TextField
          label="Label (English)"
          disabled={!canManage}
          value={draft.en}
          onChange={(e) => setDraft({ ...draft, en: e.target.value })}
        />
        <TextField
          label="Label (Arabic, optional)"
          dir="rtl"
          disabled={!canManage}
          value={draft.ar}
          onChange={(e) => setDraft({ ...draft, ar: e.target.value })}
        />
        <fieldset className="mt-6 border-t border-line pt-4">
          <legend className="px-1 text-[13px] font-semibold">Values</legend>
          {draft.values.length === 0 && <p className="text-xs text-muted">No values yet.</p>}
          {draft.values.map((v, i) => (
            <div key={v.id ?? `new-${i}`} className="mt-3 rounded-md border border-line p-3">
              <div className="grid grid-cols-2 gap-x-3">
                <TextField
                  label={`Value ${i + 1} key`}
                  disabled={!canManage}
                  value={v.key}
                  onChange={(e) => setValue(i, { key: e.target.value })}
                />
                {draft.kind === 'COLOR' ? (
                  <TextField
                    label={`Value ${i + 1} colour`}
                    disabled={!canManage}
                    placeholder="#C8A2C8"
                    value={v.colorHex}
                    onChange={(e) => setValue(i, { colorHex: e.target.value })}
                  />
                ) : (
                  <div />
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                <TextField
                  label={`Value ${i + 1} English`}
                  disabled={!canManage}
                  value={v.en}
                  onChange={(e) => setValue(i, { en: e.target.value })}
                />
                <TextField
                  label={`Value ${i + 1} Arabic`}
                  dir="rtl"
                  disabled={!canManage}
                  value={v.ar}
                  onChange={(e) => setValue(i, { ar: e.target.value })}
                />
              </div>
              {canManage && (
                <Button
                  className="mt-3"
                  onClick={() =>
                    setDraft((d) => ({ ...d, values: d.values.filter((_, n) => n !== i) }))
                  }
                >
                  Remove value {i + 1}
                </Button>
              )}
            </div>
          ))}
          {canManage && (
            <Button
              className="mt-3"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  values: [...d.values, { key: '', en: '', ar: '', colorHex: '' }],
                }))
              }
            >
              Add value
            </Button>
          )}
        </fieldset>
      </Drawer>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this attribute?"
        confirmLabel="Delete attribute"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      >
        Attributes that products still use cannot be deleted.
      </ConfirmDialog>
    </>
  );
}
