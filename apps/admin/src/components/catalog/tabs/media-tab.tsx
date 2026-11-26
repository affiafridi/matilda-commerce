'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '@/components/ui/kit';
import { Alert, Button } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/auth';
import {
  type Attribute,
  type MediaAsset,
  itemsOf,
  labelIn,
  mediaUrl,
  useCatalog,
  useDraft,
} from '@/lib/catalog';
import { UploadForm, altOf, useMediaLibrary } from '../media-screen';
import { SaveBar, type TabProps, useSaveState } from '../product-editor';

interface GalleryItem extends MediaAsset {
  isPrimary: boolean;
}
interface Variation {
  id: string;
  sku: string;
  active: boolean;
  values: Array<{ attributeId: string; attributeValueId: string }>;
}

export function MediaTab({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const state = useSaveState();
  const gallery = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'media'],
    queryFn: () => api.get<{ items: GalleryItem[] }>(`products/${product.id}/media`),
  });
  const library = useMediaLibrary(1);
  const [items, setItems] = useDraft<GalleryItem[]>(
    gallery.data ? String(gallery.dataUpdatedAt) : null,
    () => gallery.data?.items ?? [],
    [],
  );

  const move = (i: number, by: -1 | 1) =>
    setItems((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = list.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const makeMain = (id: string) =>
    setItems((l) => l.map((x) => ({ ...x, isPrimary: x.id === id })));
  const add = (a: MediaAsset) =>
    setItems((l) =>
      l.some((x) => x.id === a.id) ? l : [...l, { ...a, isPrimary: l.length === 0 }],
    );

  const save = useMutation({
    mutationFn: () =>
      api.put(`products/${product.id}/media`, {
        items: items.map((x) => ({ mediaAssetId: x.id, isPrimary: x.isPrimary })),
      }),
    onSuccess: async () => {
      state.ok();
      await gallery.refetch();
      await refresh();
    },
    onError: state.fail,
  });

  const available = (library.data?.items ?? []).filter((a) => !items.some((x) => x.id === a.id));

  return (
    <div>
      <h2 className="text-[13px] font-semibold">Gallery</h2>
      <p className="mt-1 text-xs text-muted">
        The first picture, or the one marked as main, is shown on listings. A picture needs English
        alt text before it can be used here.
      </p>
      {gallery.isError && <Alert tone="danger">{errorMessage(gallery.error)}</Alert>}
      {items.length === 0 && <p className="mt-3 text-[13px] text-muted">No pictures yet.</p>}
      <ol className="mt-3 grid gap-3" aria-label="Gallery pictures">
        {items.map((x, i) => (
          <li
            key={x.id}
            className="flex items-center gap-3 rounded-md border border-line bg-surface p-2"
          >
            {brandId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(brandId, x.id, 'thumbnail')}
                alt={altOf(x)}
                className="size-16 rounded-sm bg-sunken object-cover"
              />
            )}
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="truncate font-medium">{x.filename}</p>
              <p className="text-xs text-muted">
                {x.isPrimary ? 'Main picture' : `Picture ${i + 1}`}
              </p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-1">
                <Button
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${x.filename} earlier`}
                >
                  Earlier
                </Button>
                <Button
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${x.filename} later`}
                >
                  Later
                </Button>
                <Button
                  disabled={x.isPrimary}
                  onClick={() => makeMain(x.id)}
                  aria-label={`Make ${x.filename} the main picture`}
                >
                  Make main
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    setItems((l) => {
                      const rest = l.filter((y) => y.id !== x.id);
                      return rest.length > 0 && !rest.some((y) => y.isPrimary)
                        ? rest.map((y, n) => ({ ...y, isPrimary: n === 0 }))
                        : rest;
                    })
                  }
                  aria-label={`Remove ${x.filename}`}
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <SaveBar
          state={state}
          busy={save.isPending}
          onSave={() => save.mutate()}
          label="Save gallery"
        />
      )}

      {canEdit && (
        <section aria-labelledby="add-pictures" className="mt-10 border-t border-line pt-5">
          <h2 id="add-pictures" className="text-[13px] font-semibold">
            Add pictures
          </h2>
          <UploadForm onUploaded={add} />
          {available.length === 0 && (
            <p className="text-[13px] text-muted">
              Every picture in the library is already in this gallery.
            </p>
          )}
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-label="Library pictures">
            {available.map((a) => (
              <li key={a.id} className="rounded-md border border-line bg-surface p-2">
                {brandId && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(brandId, a.id, 'thumbnail')}
                    alt={altOf(a)}
                    className="aspect-square w-full rounded-sm bg-sunken object-cover"
                  />
                )}
                <p className="mt-1 truncate text-xs">{a.filename}</p>
                <Button
                  className="mt-1 w-full"
                  onClick={() => add(a)}
                  aria-label={`Add ${a.filename} to the gallery`}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {product.type === 'VARIABLE' && (
        <VariationPictures product={product} canEdit={canEdit} refresh={refresh} />
      )}
    </div>
  );
}

function VariationPictures({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const library = useMediaLibrary(1);
  const variations = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'variations'],
    queryFn: () => api.get<Variation[]>(`products/${product.id}/variations`),
  });
  const attributes = useQuery({
    queryKey: ['catalog', brandId, 'attributes'],
    queryFn: async () =>
      itemsOf(await api.get<Attribute[] | { items: Attribute[] }>('attributes?pageSize=200')),
  });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = useMutation({
    mutationFn: ({ id, assetId }: { id: string; assetId: string }) =>
      api.put(`products/${product.id}/variations/${id}/media`, { mediaAssetId: assetId || null }),
    onSuccess: async (_r, v) => {
      setError(null);
      setMessage(v.assetId ? 'Variation picture saved.' : 'Variation picture removed.');
      await refresh();
    },
    onError: (e) => {
      setMessage(null);
      setError(errorMessage(e));
    },
  });

  const describe = (v: Variation) =>
    v.values
      .map((x) =>
        labelIn(
          attributes.data
            ?.find((a) => a.id === x.attributeId)
            ?.values.find((y) => y.id === x.attributeValueId)?.translations ?? [],
        ),
      )
      .filter(Boolean)
      .join(' / ') || v.sku;

  const active = (variations.data ?? []).filter((v) => v.active);
  if (active.length === 0) return null;
  return (
    <section aria-labelledby="var-pictures" className="mt-10 border-t border-line pt-5">
      <h2 id="var-pictures" className="text-[13px] font-semibold">
        Variation pictures
      </h2>
      <p className="mt-1 text-xs text-muted">
        Optional: show a different picture when a shopper picks a variation.
      </p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      {message && (
        <p role="status" className="mt-3 text-[13px] text-ok">
          {message}
        </p>
      )}
      {active.map((v) => (
        <div key={v.id} className="mt-3 flex flex-wrap items-end gap-3">
          <SelectField
            label={`Picture for ${describe(v)}`}
            disabled={!canEdit}
            value={chosen[v.id] ?? ''}
            onChange={(e) => setChosen((c) => ({ ...c, [v.id]: e.target.value }))}
          >
            <option value="">No picture</option>
            {library.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.filename}
              </option>
            ))}
          </SelectField>
          {canEdit && (
            <Button
              busy={set.isPending}
              onClick={() => set.mutate({ id: v.id, assetId: chosen[v.id] ?? '' })}
              aria-label={`Save picture of ${describe(v)}`}
            >
              Save
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
