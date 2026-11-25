'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useScope } from '@/components/scope-context';
import { DataTable, Drawer, PageHeader, SelectField, StatusTag } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useAdminContext, useCan } from '@/lib/auth';
import { applyApiError, parseCodes } from '@/lib/forms';
import { http } from '@/lib/http';
import type { Market } from '@/lib/types';

const schema = z.object({
  brandId: z.string(),
  countryIso2: z.string().trim(),
  code: z.string().trim(),
  timezone: z.string().trim().min(3, 'Enter a timezone such as Asia/Dubai.').max(64),
  status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED']),
  defaultCurrency: z.string().trim().length(3, 'Use a 3-letter currency code.'),
  otherCurrencies: z.string().trim(),
  defaultLanguage: z.string().trim().min(2, 'Enter a language code such as en.').max(10),
  otherLanguages: z.string().trim(),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  brandId: '',
  countryIso2: '',
  code: '',
  timezone: '',
  status: 'DRAFT',
  defaultCurrency: '',
  otherCurrencies: '',
  defaultLanguage: '',
  otherLanguages: '',
};

export default function MarketsPage() {
  const { scope } = useScope();
  const canManage = useCan('markets.manage');
  const context = useAdminContext(true);
  const [editing, setEditing] = useState<Market | 'new' | null>(null);
  const markets = useQuery({
    queryKey: ['admin', 'markets', 'all'],
    queryFn: () => http.get<Market[]>('/admin/markets'),
  });
  const brandName = (id: string) => context.data?.brands.find((b) => b.id === id)?.name ?? 'Brand';
  const rows = markets.data?.filter((m) => !scope.brandId || m.brandId === scope.brandId);

  return (
    <>
      <PageHeader
        title="Markets"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              New market
            </Button>
          )
        }
      />
      <DataTable
        caption="Markets"
        rows={rows}
        rowKey={(m) => m.id}
        loading={markets.isPending}
        error={markets.isError ? errorMessage(markets.error, 'We could not load markets.') : null}
        onRetry={() => void markets.refetch()}
        empty="No markets in this scope."
        columns={[
          {
            id: 'market',
            header: 'Market',
            cell: (m) => (
              <button
                type="button"
                onClick={() => setEditing(m)}
                className="font-medium underline-offset-2 hover:underline"
              >
                {m.country.name} <span className="text-muted">({m.code})</span>
              </button>
            ),
          },
          { id: 'brand', header: 'Brand', cell: (m) => brandName(m.brandId) },
          { id: 'status', header: 'Status', cell: (m) => <StatusTag value={m.status} /> },
          { id: 'tz', header: 'Timezone', cell: (m) => m.timezone },
          {
            id: 'cur',
            header: 'Currencies',
            cell: (m) =>
              m.currencies.map((c) => c.currencyCode + (c.isDefault ? '*' : '')).join(', '),
          },
          {
            id: 'lang',
            header: 'Languages',
            cell: (m) =>
              m.languages.map((l) => l.languageCode + (l.isDefault ? '*' : '')).join(', '),
          },
        ]}
      />
      <p className="mt-2 text-xs text-muted">* default</p>
      <MarketDrawer
        target={editing}
        canManage={canManage}
        brands={context.data?.brands ?? []}
        defaultBrandId={scope.brandId}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function MarketDrawer({
  target,
  canManage,
  brands,
  defaultBrandId,
  onClose,
}: {
  target: Market | 'new' | null;
  canManage: boolean;
  brands: Array<{ id: string; name: string }>;
  defaultBrandId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const creating = target === 'new';
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (target === 'new') reset({ ...EMPTY, brandId: defaultBrandId ?? brands[0]?.id ?? '' });
    else if (target) {
      const cur = target.currencies.find((c) => c.isDefault)?.currencyCode ?? '';
      const lang = target.languages.find((l) => l.isDefault)?.languageCode ?? '';
      reset({
        brandId: target.brandId,
        countryIso2: target.country.iso2,
        code: target.code,
        timezone: target.timezone,
        status: target.status,
        defaultCurrency: cur,
        otherCurrencies: target.currencies
          .filter((c) => !c.isDefault)
          .map((c) => c.currencyCode)
          .join(', '),
        defaultLanguage: lang,
        otherLanguages: target.languages
          .filter((l) => !l.isDefault)
          .map((l) => l.languageCode)
          .join(', '),
      });
    }
  }, [target, reset, brands, defaultBrandId]);

  const close = () => {
    setFormError(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: (v: Values) => {
      const currencies = [
        { code: v.defaultCurrency.toUpperCase(), isDefault: true },
        ...parseCodes(v.otherCurrencies, (c) => c.toUpperCase())
          .filter((c) => c !== v.defaultCurrency.toUpperCase())
          .map((code) => ({ code, isDefault: false })),
      ];
      const languages = [
        { code: v.defaultLanguage.toLowerCase(), isDefault: true },
        ...parseCodes(v.otherLanguages, (c) => c.toLowerCase())
          .filter((c) => c !== v.defaultLanguage.toLowerCase())
          .map((code) => ({ code, isDefault: false })),
      ];
      return creating
        ? http.post('/admin/markets', {
            brandId: v.brandId,
            countryIso2: v.countryIso2.toUpperCase(),
            code: v.code.toLowerCase(),
            timezone: v.timezone,
            status: v.status,
            currencies,
            languages,
          })
        : http.patch(`/admin/markets/${(target as Market).id}`, {
            timezone: v.timezone,
            status: v.status,
            currencies,
            languages,
          });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      close();
    },
    onError: (e) =>
      setFormError(
        applyApiError(e, setError, ['brandId', 'countryIso2', 'code', 'timezone', 'status']),
      ),
  });

  return (
    <Drawer
      open={target !== null}
      title={creating ? 'New market' : 'Edit market'}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{canManage ? 'Cancel' : 'Close'}</Button>
          {canManage && (
            <Button type="submit" form="market-form" variant="primary" busy={save.isPending}>
              {creating ? 'Create market' : 'Save changes'}
            </Button>
          )}
        </>
      }
    >
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <form
        id="market-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <SelectField
          label="Brand"
          disabled={!creating}
          error={errors.brandId?.message}
          {...register('brandId')}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            label="Country code"
            disabled={!creating}
            help="Two letters, e.g. AE."
            maxLength={2}
            error={errors.countryIso2?.message}
            {...register('countryIso2')}
          />
          <TextField
            label="Market code"
            disabled={!creating}
            help="e.g. uae"
            error={errors.code?.message}
            {...register('code')}
          />
        </div>
        <TextField
          label="Timezone"
          disabled={!canManage}
          error={errors.timezone?.message}
          {...register('timezone')}
        />
        <SelectField label="Status" disabled={!canManage} {...register('status')}>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </SelectField>
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            label="Default currency"
            disabled={!canManage}
            error={errors.defaultCurrency?.message}
            {...register('defaultCurrency')}
          />
          <TextField
            label="Other currencies"
            disabled={!canManage}
            help="Comma separated."
            {...register('otherCurrencies')}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            label="Default language"
            disabled={!canManage}
            error={errors.defaultLanguage?.message}
            {...register('defaultLanguage')}
          />
          <TextField
            label="Other languages"
            disabled={!canManage}
            help="Comma separated."
            {...register('otherLanguages')}
          />
        </div>
      </form>
    </Drawer>
  );
}
