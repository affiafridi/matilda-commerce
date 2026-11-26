'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Checkbox } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/auth';
import { type Attribute, itemsOf, labelIn, useCatalog, useDraft } from '@/lib/catalog';
import { SaveBar, type TabProps, useSaveState } from '../product-editor';

interface ProductAttribute {
  attributeId: string;
  key: string;
  drivesVariations: boolean;
  visible: boolean;
  sortOrder: number;
  values: Array<{ id: string; key: string }>;
}
interface Variation {
  id: string;
  sku: string;
  active: boolean;
  combinationKey: string;
  values: Array<{ attributeId: string; attributeValueId: string }>;
}

interface Pick {
  use: boolean;
  drives: boolean;
  visible: boolean;
  valueIds: string[];
}

export function VariationsTab({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const attrState = useSaveState();
  const varState = useSaveState();

  const library = useQuery({
    queryKey: ['catalog', brandId, 'attributes'],
    queryFn: async () =>
      itemsOf(await api.get<Attribute[] | { items: Attribute[] }>('attributes?pageSize=200')),
  });
  const mine = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'attributes'],
    queryFn: () => api.get<ProductAttribute[]>(`products/${product.id}/attributes`),
  });
  const variations = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'variations'],
    queryFn: () => api.get<Variation[]>(`products/${product.id}/variations`),
  });

  const [picks, setPicks] = useDraft<Record<string, Pick>>(
    library.data && mine.data ? `${library.dataUpdatedAt}-${mine.dataUpdatedAt}` : null,
    () =>
      Object.fromEntries(
        (library.data ?? []).map((a) => {
          const m = mine.data?.find((x) => x.attributeId === a.id);
          return [
            a.id,
            {
              use: !!m,
              drives: m?.drivesVariations ?? true,
              visible: m?.visible ?? true,
              valueIds: m?.values.map((v) => v.id) ?? [],
            },
          ];
        }),
      ),
    {},
  );
  const setPick = (id: string, patch: Partial<Pick>) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id]!, ...patch } }));

  const [edits, setEdits] = useDraft<Record<string, { sku: string; active: boolean }>>(
    variations.data ? String(variations.dataUpdatedAt) : null,
    () =>
      Object.fromEntries(
        (variations.data ?? []).map((v) => [v.id, { sku: v.sku, active: v.active }]),
      ),
    {},
  );
  const [prefix, setPrefix] = useState('');

  const reload = async () => {
    await Promise.all([mine.refetch(), variations.refetch()]);
    await refresh();
  };

  const saveAttrs = useMutation({
    mutationFn: () => {
      const chosen = (library.data ?? []).filter((a) => picks[a.id]?.use);
      for (const a of chosen) {
        if (picks[a.id]!.valueIds.length === 0) {
          throw new Error(`Choose at least one value of ${labelIn(a.translations)}.`);
        }
      }
      return api.put(`products/${product.id}/attributes`, {
        attributes: chosen.map((a, i) => ({
          attributeId: a.id,
          drivesVariations: picks[a.id]!.drives,
          visible: picks[a.id]!.visible,
          sortOrder: i,
          valueIds: picks[a.id]!.valueIds,
        })),
      });
    },
    onSuccess: async () => {
      attrState.ok();
      await reload();
    },
    onError: attrState.fail,
  });

  const generate = useMutation({
    mutationFn: () => {
      if (!prefix.trim()) throw new Error('Enter a SKU prefix such as CAKE.');
      return api.post(`products/${product.id}/variations/generate`, {
        skuPrefix: prefix.trim().toUpperCase(),
      });
    },
    onSuccess: async () => {
      varState.ok();
      await reload();
    },
    onError: varState.fail,
  });

  const saveVariations = useMutation({
    mutationFn: () => {
      const changed = (variations.data ?? []).filter((v) => {
        const e = edits[v.id];
        return e && (e.sku !== v.sku || e.active !== v.active);
      });
      if (changed.length === 0) throw new Error('Nothing has changed.');
      return api.patch(`products/${product.id}/variations`, {
        items: changed.map((v) => ({
          id: v.id,
          sku: edits[v.id]!.sku.trim(),
          active: edits[v.id]!.active,
        })),
      });
    },
    onSuccess: async () => {
      varState.ok();
      await reload();
    },
    onError: varState.fail,
  });

  const removeVariation = useMutation({
    mutationFn: (id: string) => api.del(`products/${product.id}/variations/${id}`),
    onSuccess: async () => {
      varState.ok();
      await reload();
    },
    onError: varState.fail,
  });

  const describe = (v: Variation) =>
    v.values
      .map((x) => {
        const a = library.data?.find((y) => y.id === x.attributeId);
        const val = a?.values.find((y) => y.id === x.attributeValueId);
        return val ? labelIn(val.translations) : '';
      })
      .filter(Boolean)
      .join(' / ');

  return (
    <div>
      <h2 className="text-[13px] font-semibold">Attributes of this product</h2>
      <p className="mt-1 text-xs text-muted">
        Tick the attributes that describe this product and the values it offers. Attributes that
        create variations (such as size) are combined into one variation per combination.
      </p>
      {library.isError && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(library.error)}
        </Alert>
      )}
      {library.data?.length === 0 && (
        <Alert tone="info" className="mt-3">
          No attributes exist yet. Create them under Attributes first.
        </Alert>
      )}
      {library.data?.map((a) => {
        const p = picks[a.id];
        if (!p) return null;
        return (
          <fieldset key={a.id} className="mt-4 rounded-md border border-line p-3">
            <legend className="px-1 text-[13px] font-medium">{labelIn(a.translations)}</legend>
            <Checkbox
              label={`Use ${labelIn(a.translations)}`}
              disabled={!canEdit}
              checked={p.use}
              onChange={(e) => setPick(a.id, { use: e.target.checked })}
            />
            {p.use && (
              <>
                <Checkbox
                  label="Creates variations"
                  disabled={!canEdit}
                  checked={p.drives}
                  onChange={(e) => setPick(a.id, { drives: e.target.checked })}
                />
                <Checkbox
                  label="Show to shoppers as a specification"
                  disabled={!canEdit}
                  checked={p.visible}
                  onChange={(e) => setPick(a.id, { visible: e.target.checked })}
                />
                <div className="mt-2 ps-6">
                  {a.values.map((v) => (
                    <Checkbox
                      key={v.id}
                      label={labelIn(v.translations)}
                      disabled={!canEdit}
                      checked={p.valueIds.includes(v.id)}
                      onChange={(e) =>
                        setPick(a.id, {
                          valueIds: e.target.checked
                            ? [...p.valueIds, v.id]
                            : p.valueIds.filter((x) => x !== v.id),
                        })
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </fieldset>
        );
      })}
      {canEdit && (
        <SaveBar
          state={attrState}
          busy={saveAttrs.isPending}
          onSave={() => saveAttrs.mutate()}
          label="Save attributes"
        />
      )}

      <h2 className="mt-10 text-[13px] font-semibold">Variations</h2>
      {product.type === 'VARIABLE' && (variations.data?.length ?? 0) === 0 && (
        <p className="mt-1 text-xs text-muted">
          Save the attributes above, then generate the variations. At least one variation is needed
          to publish.
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <TextField
            label="SKU prefix"
            help="Each SKU is the prefix plus the value keys, e.g. CAKE-1KG."
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <Button busy={generate.isPending} onClick={() => generate.mutate()}>
            Generate variations
          </Button>
        </div>
      )}
      {variations.data && variations.data.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Variations</caption>
            <thead>
              <tr className="border-b border-line bg-sunken text-xs">
                <th scope="col" className="h-9 px-3 text-start font-semibold">
                  Variation
                </th>
                <th scope="col" className="h-9 px-3 text-start font-semibold">
                  SKU
                </th>
                <th scope="col" className="h-9 px-3 text-start font-semibold">
                  Active
                </th>
                <th scope="col" className="h-9 px-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {variations.data.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-medium">{describe(v)}</td>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`sku-${v.id}`}>
                      SKU of {describe(v)}
                    </label>
                    <input
                      id={`sku-${v.id}`}
                      disabled={!canEdit}
                      value={edits[v.id]?.sku ?? v.sku}
                      onChange={(e) =>
                        setEdits((s) => ({ ...s, [v.id]: { ...s[v.id]!, sku: e.target.value } }))
                      }
                      className="h-8 w-48 rounded-md border border-line-strong bg-surface px-2 text-[13px] disabled:bg-sunken"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${describe(v)} is active`}
                      disabled={!canEdit}
                      checked={edits[v.id]?.active ?? v.active}
                      onChange={(e) =>
                        setEdits((s) => ({
                          ...s,
                          [v.id]: { ...s[v.id]!, active: e.target.checked },
                        }))
                      }
                      className="size-4"
                    />
                  </td>
                  <td className="px-3 py-2 text-end">
                    {canEdit && (
                      <Button variant="quiet" onClick={() => removeVariation.mutate(v.id)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (variations.data?.length ?? 0) > 0 && (
        <SaveBar
          state={varState}
          busy={saveVariations.isPending}
          onSave={() => saveVariations.mutate()}
          label="Save variations"
        />
      )}
      {canEdit && (variations.data?.length ?? 0) === 0 && varState.error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {varState.error}
        </p>
      )}
    </div>
  );
}
