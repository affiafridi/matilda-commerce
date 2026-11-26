'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Checkbox, SelectField } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { type Attribute, type Product, itemsOf, labelIn, nameIn, useCatalog } from '@/lib/catalog';
import { SaveBar, type TabProps, useSaveState } from '../product-editor';
import { ChargeInputs } from './options-tab';
import { fromMinor, toMinor, useDraft } from '@/lib/catalog';

interface ApiPrice {
  marketId: string;
  currency: string;
  delta: number;
}
interface ApiAddons {
  groups: Array<{
    key: string;
    required: boolean;
    minSelect: number;
    maxSelect: number | null;
    translations: Array<{ language: string; label: string }>;
    items: Array<{
      kind: 'INLINE' | 'PRODUCT';
      key: string | null;
      productId: string | null;
      variationId: string | null;
      maxQuantity: number;
      translations: Array<{ language: string; label: string }>;
      prices: ApiPrice[];
    }>;
  }>;
}
interface ApiBundle {
  items: Array<{ productId: string; variationId: string | null; quantity: number }>;
}

interface ItemDraft {
  kind: 'INLINE' | 'PRODUCT';
  key: string;
  productId: string;
  variationId: string;
  maxQuantity: string;
  en: string;
  ar: string;
  charges: Record<string, string>;
}
interface GroupDraft {
  key: string;
  required: boolean;
  minSelect: string;
  maxSelect: string;
  en: string;
  ar: string;
  items: ItemDraft[];
}

const text = (rows: Array<{ language: string; label: string }>, lang: string) =>
  rows.find((r) => r.language === lang)?.label ?? '';

const toDraft = (g: ApiAddons['groups'][number]): GroupDraft => ({
  key: g.key,
  required: g.required,
  minSelect: String(g.minSelect),
  maxSelect: g.maxSelect?.toString() ?? '',
  en: text(g.translations, 'en'),
  ar: text(g.translations, 'ar'),
  items: g.items.map((i) => ({
    kind: i.kind,
    key: i.key ?? '',
    productId: i.productId ?? '',
    variationId: i.variationId ?? '',
    maxQuantity: String(i.maxQuantity),
    en: text(i.translations, 'en'),
    ar: text(i.translations, 'ar'),
    charges: Object.fromEntries(
      i.prices.map((p) => [`${p.marketId}|${p.currency}`, fromMinor(p.delta, p.currency)]),
    ),
  })),
});

/** Products that can be an add-on or a bundle component: not bundles, not the product itself. */
function useChoosableProducts(excludeId: string) {
  const { brandId, api } = useCatalog();
  return useQuery({
    queryKey: ['catalog', brandId, 'products', 'choosable'],
    queryFn: async () => {
      const r = await api.get<{ items: Product[] }>('products?page=1&pageSize=100');
      return r.items;
    },
    select: (items) => items.filter((p) => p.id !== excludeId && p.type !== 'BUNDLE'),
  });
}

/** Product chooser; a variable product also needs the exact variation. */
function ProductPicker({
  label,
  products,
  productId,
  variationId,
  disabled,
  onChange,
}: {
  label: string;
  products: Product[];
  productId: string;
  variationId: string;
  disabled: boolean;
  onChange: (next: { productId: string; variationId: string; name: string }) => void;
}) {
  const { brandId, api } = useCatalog();
  const chosen = products.find((p) => p.id === productId);
  const variations = useQuery({
    queryKey: ['catalog', brandId, 'product', productId, 'variations'],
    enabled: chosen?.type === 'VARIABLE',
    queryFn: () =>
      api.get<
        Array<{
          id: string;
          sku: string;
          values: Array<{ attributeId: string; attributeValueId: string }>;
        }>
      >(`products/${productId}/variations`),
  });
  const library = useQuery({
    queryKey: ['catalog', brandId, 'attributes'],
    enabled: chosen?.type === 'VARIABLE',
    queryFn: async () =>
      itemsOf(await api.get<Attribute[] | { items: Attribute[] }>('attributes?pageSize=200')),
  });
  const describe = (v: {
    sku: string;
    values: Array<{ attributeId: string; attributeValueId: string }>;
  }) =>
    v.values
      .map((x) =>
        labelIn(
          library.data
            ?.find((a) => a.id === x.attributeId)
            ?.values.find((y) => y.id === x.attributeValueId)?.translations ?? [],
        ),
      )
      .filter(Boolean)
      .join(' / ') || v.sku;
  return (
    <div className="grid grid-cols-2 gap-x-3">
      <SelectField
        label={label}
        disabled={disabled}
        value={productId}
        onChange={(e) => {
          const p = products.find((x) => x.id === e.target.value);
          onChange({
            productId: e.target.value,
            variationId: '',
            name: p ? nameIn(p.translations) : '',
          });
        }}
      >
        <option value="">Choose a product</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {nameIn(p.translations)}
          </option>
        ))}
      </SelectField>
      {chosen?.type === 'VARIABLE' ? (
        <SelectField
          label={`Variation of ${label}`}
          disabled={disabled}
          value={variationId}
          onChange={(e) => onChange({ productId, variationId: e.target.value, name: '' })}
        >
          <option value="">Choose a variation</option>
          {variations.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {describe(v)}
            </option>
          ))}
        </SelectField>
      ) : (
        <div />
      )}
    </div>
  );
}

export function AddonsTab({ product, canEdit, refresh }: TabProps) {
  return (
    <div>
      <AddonGroups product={product} canEdit={canEdit} refresh={refresh} />
      {product.type === 'BUNDLE' && (
        <BundleComponents product={product} canEdit={canEdit} refresh={refresh} />
      )}
    </div>
  );
}

function AddonGroups({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const canPrice = useCan('pricing.edit');
  const state = useSaveState();
  const products = useChoosableProducts(product.id);
  const loaded = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'addons'],
    queryFn: () => api.get<ApiAddons>(`products/${product.id}/addons`),
  });
  const [groups, setGroups] = useDraft<GroupDraft[]>(
    loaded.data ? String(loaded.dataUpdatedAt) : null,
    () => (loaded.data?.groups ?? []).map(toDraft),
    [],
  );
  const patch = (i: number, p: Partial<GroupDraft>) =>
    setGroups((g) => g.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const patchItem = (i: number, n: number, p: Partial<ItemDraft>) =>
    setGroups((g) =>
      g.map((x, a) =>
        a === i ? { ...x, items: x.items.map((y, b) => (b === n ? { ...y, ...p } : y)) } : x,
      ),
    );

  const save = useMutation({
    mutationFn: () => {
      const body = groups.map((g, i) => {
        const name = g.en.trim() || `group ${i + 1}`;
        if (!g.key.trim() || !g.en.trim())
          throw new Error(`Add-on group ${i + 1} needs a key and an English label.`);
        const num = (v: string, what: string) => {
          if (v.trim() === '') return null;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0)
            throw new Error(`${what} of ${name} must be a whole number.`);
          return n;
        };
        return {
          key: g.key.trim(),
          required: g.required,
          minSelect: num(g.minSelect, 'The fewest') ?? 0,
          maxSelect: num(g.maxSelect, 'The most'),
          sortOrder: i,
          translations: [
            { language: 'en', label: g.en.trim() },
            ...(g.ar.trim() ? [{ language: 'ar', label: g.ar.trim() }] : []),
          ],
          items: g.items.map((it, n) => {
            const where = `item ${n + 1} of ${name}`;
            if (!it.en.trim()) throw new Error(`Give ${where} an English label.`);
            const maxQuantity = num(it.maxQuantity, 'The quantity limit') ?? 1;
            const translations = [
              { language: 'en', label: it.en.trim() },
              ...(it.ar.trim() ? [{ language: 'ar', label: it.ar.trim() }] : []),
            ];
            if (it.kind === 'PRODUCT') {
              if (!it.productId) throw new Error(`Choose the product for ${where}.`);
              return {
                kind: 'PRODUCT' as const,
                productId: it.productId,
                ...(it.variationId && { variationId: it.variationId }),
                maxQuantity,
                sortOrder: n,
                translations,
              };
            }
            if (!it.key.trim()) throw new Error(`Give ${where} a key.`);
            const prices = Object.entries(it.charges)
              .filter(([, v]) => v.trim() !== '')
              .map(([k, v]) => {
                const [marketId = '', currency = ''] = k.split('|');
                const delta = toMinor(v, currency);
                if (delta === null) throw new Error(`Enter a valid price for ${where}.`);
                return { marketId, currency, delta };
              });
            return {
              kind: 'INLINE' as const,
              key: it.key.trim(),
              maxQuantity,
              sortOrder: n,
              translations,
              prices,
            };
          }),
        };
      });
      return api.put(`products/${product.id}/addons`, { groups: body });
    },
    onSuccess: async () => {
      state.ok();
      await loaded.refetch();
      await refresh();
    },
    onError: state.fail,
  });

  if (loaded.isError) return <Alert tone="danger">{errorMessage(loaded.error)}</Alert>;

  return (
    <section aria-labelledby="addons-title">
      <h2 id="addons-title" className="text-[13px] font-semibold">
        Add-on groups
      </h2>
      <p className="mt-1 text-xs text-muted">
        Extras sold with the product, such as a gift box or balloons. An add-on is either a priced
        extra of its own, or another product sold at that product&apos;s own price.
      </p>
      {!canPrice && (
        <Alert tone="info" className="mt-3">
          Changing add-on prices needs the permission to edit prices.
        </Alert>
      )}
      {groups.length === 0 && <p className="mt-4 text-[13px] text-muted">No add-ons yet.</p>}
      {groups.map((g, i) => {
        const name = g.en || `Group ${i + 1}`;
        return (
          <fieldset key={i} className="mt-5 rounded-md border border-line p-4">
            <legend className="px-1 text-[13px] font-semibold">{name}</legend>
            <div className="grid grid-cols-3 gap-x-3">
              <TextField
                label={`Key of ${name}`}
                disabled={!canEdit}
                value={g.key}
                onChange={(e) => patch(i, { key: e.target.value })}
              />
              <TextField
                label={`Label of ${name} (English)`}
                disabled={!canEdit}
                value={g.en}
                onChange={(e) => patch(i, { en: e.target.value })}
              />
              <TextField
                label={`Label of ${name} (Arabic)`}
                dir="rtl"
                disabled={!canEdit}
                value={g.ar}
                onChange={(e) => patch(i, { ar: e.target.value })}
              />
            </div>
            <Checkbox
              label={`${name} is required`}
              disabled={!canEdit}
              checked={g.required}
              onChange={(e) => patch(i, { required: e.target.checked })}
            />
            <div className="grid grid-cols-2 gap-x-3">
              <TextField
                label={`Fewest items of ${name}`}
                inputMode="numeric"
                disabled={!canEdit}
                value={g.minSelect}
                onChange={(e) => patch(i, { minSelect: e.target.value })}
              />
              <TextField
                label={`Most items of ${name}`}
                inputMode="numeric"
                disabled={!canEdit}
                value={g.maxSelect}
                onChange={(e) => patch(i, { maxSelect: e.target.value })}
              />
            </div>
            {g.items.map((it, n) => (
              <div key={n} className="mt-4 rounded-md border border-line p-3">
                <SelectField
                  label={`Kind of item ${n + 1} in ${name}`}
                  disabled={!canEdit}
                  value={it.kind}
                  onChange={(e) => patchItem(i, n, { kind: e.target.value as ItemDraft['kind'] })}
                >
                  <option value="INLINE">Extra with its own price</option>
                  <option value="PRODUCT">Another product</option>
                </SelectField>
                {it.kind === 'PRODUCT' && (
                  <ProductPicker
                    label={`Product of item ${n + 1} in ${name}`}
                    products={products.data ?? []}
                    productId={it.productId}
                    variationId={it.variationId}
                    disabled={!canEdit}
                    onChange={(next) =>
                      patchItem(i, n, {
                        productId: next.productId,
                        variationId: next.variationId,
                        ...(next.name && !it.en ? { en: next.name } : {}),
                      })
                    }
                  />
                )}
                <div className="grid grid-cols-3 gap-x-3">
                  {it.kind === 'INLINE' && (
                    <TextField
                      label={`Key of item ${n + 1} in ${name}`}
                      disabled={!canEdit}
                      value={it.key}
                      onChange={(e) => patchItem(i, n, { key: e.target.value })}
                    />
                  )}
                  <TextField
                    label={`English label of item ${n + 1} in ${name}`}
                    disabled={!canEdit}
                    value={it.en}
                    onChange={(e) => patchItem(i, n, { en: e.target.value })}
                  />
                  <TextField
                    label={`Arabic label of item ${n + 1} in ${name}`}
                    dir="rtl"
                    disabled={!canEdit}
                    value={it.ar}
                    onChange={(e) => patchItem(i, n, { ar: e.target.value })}
                  />
                  <TextField
                    label={`Most per order of item ${n + 1} in ${name}`}
                    inputMode="numeric"
                    disabled={!canEdit}
                    value={it.maxQuantity}
                    onChange={(e) => patchItem(i, n, { maxQuantity: e.target.value })}
                  />
                </div>
                {it.kind === 'INLINE' && (
                  <ChargeInputs
                    legend={`Price of ${it.en || `item ${n + 1}`} in ${name}`}
                    marketIds={product.marketIds}
                    charges={it.charges}
                    disabled={!canEdit || !canPrice}
                    onChange={(charges) => patchItem(i, n, { charges })}
                  />
                )}
                {canEdit && (
                  <Button
                    className="mt-3"
                    onClick={() => patch(i, { items: g.items.filter((_, m) => m !== n) })}
                  >
                    Remove item {n + 1} of {name}
                  </Button>
                )}
              </div>
            ))}
            {canEdit && (
              <Button
                className="mt-4"
                onClick={() =>
                  patch(i, {
                    items: [
                      ...g.items,
                      {
                        kind: 'INLINE',
                        key: '',
                        productId: '',
                        variationId: '',
                        maxQuantity: '1',
                        en: '',
                        ar: '',
                        charges: {},
                      },
                    ],
                  })
                }
              >
                Add item to {name}
              </Button>
            )}
            {canEdit && (
              <Button
                variant="danger"
                className="ms-2 mt-4"
                onClick={() => setGroups((x) => x.filter((_, n) => n !== i))}
              >
                Remove {name}
              </Button>
            )}
          </fieldset>
        );
      })}
      {canEdit && (
        <Button
          className="mt-5"
          onClick={() =>
            setGroups((g) => [
              ...g,
              {
                key: '',
                required: false,
                minSelect: '0',
                maxSelect: '',
                en: '',
                ar: '',
                items: [],
              },
            ])
          }
        >
          Add add-on group
        </Button>
      )}
      {canEdit && (
        <SaveBar
          state={state}
          busy={save.isPending}
          onSave={() => save.mutate()}
          label="Save add-ons"
        />
      )}
    </section>
  );
}

interface ComponentDraft {
  productId: string;
  variationId: string;
  quantity: string;
}

function BundleComponents({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const state = useSaveState();
  const products = useChoosableProducts(product.id);
  const loaded = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'bundle'],
    queryFn: () => api.get<ApiBundle>(`products/${product.id}/bundle`),
  });
  const [rows, setRows] = useDraft<ComponentDraft[]>(
    loaded.data ? String(loaded.dataUpdatedAt) : null,
    () =>
      (loaded.data?.items ?? []).map((i) => ({
        productId: i.productId,
        variationId: i.variationId ?? '',
        quantity: String(i.quantity),
      })),
    [],
  );

  const save = useMutation({
    mutationFn: () =>
      api.put(`products/${product.id}/bundle`, {
        items: rows.map((r, i) => {
          const quantity = Number(r.quantity);
          if (!r.productId) throw new Error(`Choose the product of component ${i + 1}.`);
          if (!Number.isInteger(quantity) || quantity < 1) {
            throw new Error(`The quantity of component ${i + 1} must be a whole number from 1.`);
          }
          return {
            productId: r.productId,
            ...(r.variationId && { variationId: r.variationId }),
            quantity,
            sortOrder: i,
          };
        }),
      }),
    onSuccess: async () => {
      state.ok();
      await loaded.refetch();
      await refresh();
    },
    onError: state.fail,
  });

  return (
    <section aria-labelledby="bundle-title" className="mt-10 border-t border-line pt-5">
      <h2 id="bundle-title" className="text-[13px] font-semibold">
        Bundle components
      </h2>
      <p className="mt-1 text-xs text-muted">
        The products sold together. The bundle has its own fixed price per market (Pricing tab); a
        bundle needs at least one component to be published.
      </p>
      {rows.length === 0 && <p className="mt-3 text-[13px] text-muted">No components yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="mt-3 rounded-md border border-line p-3">
          <ProductPicker
            label={`Component ${i + 1}`}
            products={products.data ?? []}
            productId={r.productId}
            variationId={r.variationId}
            disabled={!canEdit}
            onChange={(next) =>
              setRows((x) =>
                x.map((y, n) =>
                  n === i ? { ...y, productId: next.productId, variationId: next.variationId } : y,
                ),
              )
            }
          />
          <TextField
            label={`Quantity of component ${i + 1}`}
            inputMode="numeric"
            disabled={!canEdit}
            value={r.quantity}
            onChange={(e) =>
              setRows((x) => x.map((y, n) => (n === i ? { ...y, quantity: e.target.value } : y)))
            }
          />
          {canEdit && (
            <Button className="mt-3" onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>
              Remove component {i + 1}
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <Button
          className="mt-4"
          onClick={() => setRows((x) => [...x, { productId: '', variationId: '', quantity: '1' }])}
        >
          Add component
        </Button>
      )}
      {canEdit && (
        <SaveBar
          state={state}
          busy={save.isPending}
          onSave={() => save.mutate()}
          label="Save components"
        />
      )}
    </section>
  );
}
