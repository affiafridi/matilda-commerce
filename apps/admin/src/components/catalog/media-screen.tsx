'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, PageHeader, Pager } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/auth';
import { type MediaAsset, NeedsBrand, mediaUrl, useCatalog } from '@/lib/catalog';

const PAGE_SIZE = 40;

export function useMediaLibrary(page: number) {
  const { brandId, api } = useCatalog();
  return useQuery({
    queryKey: ['catalog', brandId, 'media', page],
    enabled: !!brandId,
    queryFn: () =>
      api.get<{ total: number; items: MediaAsset[] }>(
        `media?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
      ),
  });
}

export const altOf = (a: MediaAsset, lang = 'en') =>
  a.alt.find((t) => t.language === lang)?.altText ?? '';

/** Uploads one picture with its English alt text. Shared by the library and the product gallery. */
export function UploadForm({ onUploaded }: { onUploaded?: (asset: MediaAsset) => void }) {
  const { brandId, api } = useCatalog();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a picture first.');
      const form = new FormData();
      form.append('file', file);
      if (alt.trim()) form.append('altText', alt.trim());
      return api.post<MediaAsset>('media', form);
    },
    onSuccess: async (asset) => {
      setFile(null);
      setAlt('');
      setError(null);
      if (input.current) input.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['catalog', brandId, 'media'] });
      onUploaded?.(asset);
    },
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });

  return (
    <form
      noValidate
      className="mb-6 rounded-md border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        upload.mutate();
      }}
    >
      <h2 className="text-[13px] font-semibold">Upload a picture</h2>
      <p className="mt-1 text-xs text-muted">
        JPEG, PNG or WebP, up to 10 MB. Location and other hidden data are removed, and smaller
        sizes are made automatically.
      </p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="media-file" className="mb-1 block text-[13px] font-medium">
            Picture file
          </label>
          <input
            ref={input}
            id="media-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px]"
          />
        </div>
        <TextField
          label="Alt text (English)"
          help="Describes the picture for people who cannot see it. Needed before it can be used on a product."
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
        />
        <Button type="submit" variant="primary" busy={upload.isPending}>
          Upload
        </Button>
      </div>
    </form>
  );
}

export function MediaScreen() {
  const { brandId, ready } = useCatalog();
  const [page, setPage] = useState(1);
  const library = useMediaLibrary(page);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);

  return (
    <>
      <PageHeader title="Media library" />
      {!brandId ? (
        <NeedsBrand ready={ready} />
      ) : (
        <>
          <UploadForm />
          {library.isError && (
            <Alert tone="danger">
              {errorMessage(library.error, 'We could not load the library.')}
            </Alert>
          )}
          {library.data && library.data.items.length === 0 && (
            <p className="text-[13px] text-muted">No pictures yet. Upload the first one above.</p>
          )}
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
            aria-label="Pictures"
          >
            {library.data?.items.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(a);
                    setDrawerKey((k) => k + 1);
                  }}
                  className="block w-full rounded-md border border-line bg-surface p-2 text-start hover:border-line-strong"
                >
                  {/* Served by the API without sign-in; a plain image keeps the admin independent of the image optimizer. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(brandId, a.id, 'thumbnail')}
                    alt={altOf(a)}
                    className="aspect-square w-full rounded-sm bg-sunken object-cover"
                  />
                  <span className="mt-2 block truncate text-xs font-medium">{a.filename}</span>
                  <span className="block text-xs text-muted">
                    {altOf(a) ? 'Alt text set' : 'Needs alt text'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={library.data?.total ?? 0}
            onPage={setPage}
          />
          <MediaDrawer key={drawerKey} asset={selected} onClose={() => setSelected(null)} />
        </>
      )}
    </>
  );
}

function MediaDrawer({ asset, onClose }: { asset: MediaAsset | null; onClose: () => void }) {
  const { brandId, api } = useCatalog();
  const queryClient = useQueryClient();
  const [en, setEn] = useState(() => (asset ? altOf(asset, 'en') : ''));
  const [ar, setAr] = useState(() => (asset ? altOf(asset, 'ar') : ''));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['catalog', brandId, 'media'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      if (!en.trim()) throw new Error('Enter the English alt text.');
      return api.put(`media/${asset!.id}/alt`, {
        translations: [
          { language: 'en', altText: en.trim() },
          ...(ar.trim() ? [{ language: 'ar', altText: ar.trim() }] : []),
        ],
      });
    },
    onSuccess: done,
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`media/${asset!.id}`),
    onSuccess: async () => {
      setConfirmDelete(false);
      await done();
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(errorMessage(e));
    },
  });

  return (
    <>
      <Drawer
        open={asset !== null}
        title="Picture"
        onClose={onClose}
        footer={
          <>
            <Button variant="danger" className="me-auto" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              Save alt text
            </Button>
          </>
        }
      >
        {asset && brandId && (
          <>
            {error && (
              <Alert tone="danger" className="mb-4">
                {error}
              </Alert>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(brandId, asset.id, 'medium')}
              alt={altOf(asset)}
              className="mb-4 w-full rounded-md bg-sunken"
            />
            <p className="text-xs text-muted">
              {asset.filename} · {asset.width} × {asset.height} ·{' '}
              {Math.round(asset.byteSize / 1024)} KB
            </p>
            <TextField
              label="Alt text (English)"
              value={en}
              onChange={(e) => setEn(e.target.value)}
            />
            <TextField
              label="Alt text (Arabic, optional)"
              dir="rtl"
              value={ar}
              onChange={(e) => setAr(e.target.value)}
            />
          </>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this picture?"
        confirmLabel="Delete picture"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      >
        The file is removed for good. A picture that a product or variation uses cannot be deleted.
      </ConfirmDialog>
    </>
  );
}
