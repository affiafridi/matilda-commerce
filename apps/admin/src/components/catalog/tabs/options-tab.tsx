'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useScope } from '@/components/scope-context';
import { Checkbox, SelectField } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { fromMinor, toMinor, useCatalog, useDraft } from '@/lib/catalog';
import { SaveBar, type TabProps, useSaveState } from '../product-editor';

type OptionType = 'SELECT' | 'RADIO' | 'CHECKBOX' | 'TEXT' | 'TEXTAREA' | 'FILE' | 'DATE';
const TYPE_LABEL: Record<OptionType, string> = {
  SELECT: 'Drop-down list',
  RADIO: 'Single choice',
  CHECKBOX: 'Multiple choice',
  TEXT: 'Short text',
  TEXTAREA: 'Long text',
  FILE: 'Picture or file upload',
  DATE: 'Date',
};
const WITH_CHOICES: OptionType[] = ['SELECT', 'RADIO', 'CHECKBOX'];

interface ApiPrice {
  marketId: string;
  currency: string;
  delta: number;
}
interface ApiOptions {
  groups: Array<{
    key: string;
    type: OptionType;
    required: boolean;
    minSelect: number;
    maxSelect: number | null;
    maxLength: number | null;
    translations: Array<{ language: string; label: string; helpText?: string | null }>;
    prices: ApiPrice[];
    choices: Array<{
      key: string;
      translations: Array<{ language: string; label: string }>;
      prices: ApiPrice[];
    }>;
    showWhen: Array<{
      groupKey: string;
      operator: 'FILLED' | 'EQUALS' | 'NOT_EQUALS';
      choiceKey?: string;
    }>;
  }>;
}

/** Charges are typed per market and currency; the key is "marketId|currency". */
type Charges = Record<string, string>;
interface ChoiceDraft {
  key: string;
  en: string;
  ar: string;
  charges: Charges;
}
interface RuleDraft {
  groupKey: string;
  operator: 'FILLED' | 'EQUALS' | 'NOT_EQUALS';
  choiceKey: string;
}
interface GroupDraft {
  key: string;
  type: OptionType;
  required: boolean;
  minSelect: string;
  maxSelect: string;
  maxLength: string;
  en: string;
  ar: string;
  help: string;
  charges: Charges;
  choices: ChoiceDraft[];
  rules: RuleDraft[];
}

const chargesOf = (prices: ApiPrice[]): Charges =>
  Object.fromEntries(
    prices.map((p) => [`${p.marketId}|${p.currency}`, fromMinor(p.delta, p.currency)]),
  );
const text = (rows: Array<{ language: string; label: string }>, lang: string) =>
  rows.find((r) => r.language === lang)?.label ?? '';

const toDraft = (g: ApiOptions['groups'][number]): GroupDraft => ({
  key: g.key,
  type: g.type,
  required: g.required,
  minSelect: String(g.minSelect),
  maxSelect: g.maxSelect?.toString() ?? '',
  maxLength: g.maxLength?.toString() ?? '',
  en: text(g.translations, 'en'),
  ar: text(g.translations, 'ar'),
  help: g.translations.find((t) => t.language === 'en')?.helpText ?? '',
  charges: chargesOf(g.prices),
  choices: g.choices.map((c) => ({
    key: c.key,
    en: text(c.translations, 'en'),
    ar: text(c.translations, 'ar'),
    charges: chargesOf(c.prices),
  })),
  rules: g.showWhen.map((r) => ({
    groupKey: r.groupKey,
    operator: r.operator,
    choiceKey: r.choiceKey ?? '',
  })),
});

const blankGroup = (): GroupDraft => ({
  key: '',
  type: 'SELECT',
  required: false,
  minSelect: '0',
  maxSelect: '',
  maxLength: '',
  en: '',
  ar: '',
  help: '',
  charges: {},
  choices: [],
  rules: [],
});

function toPrices(charges: Charges, where: string) {
  const out: ApiPrice[] = [];
  for (const [k, v] of Object.entries(charges)) {
    if (v.trim() === '') continue;
    const [marketId = '', currency = ''] = k.split('|');
    const delta = toMinor(v, currency);
    if (delta === null) throw new Error(`Enter a valid extra charge for ${where}.`);
    out.push({ marketId, currency, delta });
  }
  return out;
}

const labels = (en: string, ar: string, help?: string) => [
  { language: 'en', label: en.trim(), ...(help?.trim() && { helpText: help.trim() }) },
  ...(ar.trim() ? [{ language: 'ar', label: ar.trim() }] : []),
];

/** Extra charge inputs, one per market the product is sold in and each of its currencies. */
export function ChargeInputs({
  legend,
  marketIds,
  charges,
  disabled,
  onChange,
}: {
  legend: string;
  marketIds: string[];
  charges: Charges;
  disabled: boolean;
  onChange: (next: Charges) => void;
}) {
  const { markets } = useScope();
  const sold = markets.filter((m) => marketIds.includes(m.id));
  if (sold.length === 0) return null;
  return (
    <div className="grid gap-x-3 sm:grid-cols-2">
      {sold.flatMap((m) =>
        m.currencies.map((c) => {
          const k = `${m.id}|${c.currencyCode}`;
          return (
            <TextField
              key={k}
              label={`${legend} ${m.code.toUpperCase()} ${c.currencyCode}`}
              inputMode="decimal"
              disabled={disabled}
              value={charges[k] ?? ''}
              onChange={(e) => onChange({ ...charges, [k]: e.target.value })}
            />
          );
        }),
      )}
    </div>
  );
}

export function OptionsTab({ product, canEdit, refresh }: TabProps) {
  const { brandId, api } = useCatalog();
  const canPrice = useCan('pricing.edit');
  const state = useSaveState();
  const loaded = useQuery({
    queryKey: ['catalog', brandId, 'product', product.id, 'options'],
    queryFn: () => api.get<ApiOptions>(`products/${product.id}/options`),
  });
  const [groups, setGroups] = useDraft<GroupDraft[]>(
    loaded.data ? String(loaded.dataUpdatedAt) : null,
    () => (loaded.data?.groups ?? []).map(toDraft),
    [],
  );
  const patch = (i: number, p: Partial<GroupDraft>) =>
    setGroups((g) => g.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const patchChoice = (i: number, c: number, p: Partial<ChoiceDraft>) =>
    setGroups((g) =>
      g.map((x, n) =>
        n === i ? { ...x, choices: x.choices.map((y, m) => (m === c ? { ...y, ...p } : y)) } : x,
      ),
    );
  const patchRule = (i: number, r: number, p: Partial<RuleDraft>) =>
    setGroups((g) =>
      g.map((x, n) =>
        n === i ? { ...x, rules: x.rules.map((y, m) => (m === r ? { ...y, ...p } : y)) } : x,
      ),
    );

  const save = useMutation({
    mutationFn: () => {
      const body = groups.map((g, i) => {
        const where = g.en.trim() || `option ${i + 1}`;
        if (!g.key.trim() || !g.en.trim())
          throw new Error(`Option ${i + 1} needs a key and an English label.`);
        const hasChoices = WITH_CHOICES.includes(g.type);
        const num = (v: string, name: string) => {
          if (v.trim() === '') return null;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0)
            throw new Error(`${name} of ${where} must be a whole number.`);
          return n;
        };
        return {
          key: g.key.trim(),
          type: g.type,
          required: g.required,
          sortOrder: i,
          ...(g.type === 'CHECKBOX' && {
            minSelect: num(g.minSelect, 'The minimum') ?? 0,
            maxSelect: num(g.maxSelect, 'The maximum'),
          }),
          ...((g.type === 'TEXT' || g.type === 'TEXTAREA') && {
            maxLength: num(g.maxLength, 'The length limit'),
          }),
          translations: labels(g.en, g.ar, g.help),
          prices: hasChoices ? [] : toPrices(g.charges, where),
          choices: hasChoices
            ? g.choices.map((c, n) => {
                if (!c.key.trim() || !c.en.trim()) {
                  throw new Error(`Every choice of ${where} needs a key and an English label.`);
                }
                return {
                  key: c.key.trim(),
                  sortOrder: n,
                  translations: labels(c.en, c.ar),
                  prices: toPrices(c.charges, `${c.en} in ${where}`),
                };
              })
            : [],
          showWhen: g.rules.map((r) => ({
            groupKey: r.groupKey,
            operator: r.operator,
            ...(r.operator !== 'FILLED' && { choiceKey: r.choiceKey }),
          })),
        };
      });
      return api.put(`products/${product.id}/options`, { groups: body });
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
    <div>
      <p className="text-xs text-muted">
        Options let shoppers customise the product, for example a message on a cake or a colour.
        Extra charges are added to the product price. Saving replaces the whole list.
      </p>
      {!canPrice && (
        <Alert tone="info" className="mt-3">
          Changing extra charges needs the permission to edit prices; other changes are saved as
          usual.
        </Alert>
      )}
      {groups.length === 0 && <p className="mt-4 text-[13px] text-muted">No options yet.</p>}
      {groups.map((g, i) => {
        const hasChoices = WITH_CHOICES.includes(g.type);
        const others = groups.filter((_, n) => n !== i);
        const name = g.en || `Option ${i + 1}`;
        return (
          <fieldset key={i} className="mt-5 rounded-md border border-line p-4">
            <legend className="px-1 text-[13px] font-semibold">{name}</legend>
            <div className="grid grid-cols-2 gap-x-3">
              <TextField
                label={`Key of ${name}`}
                disabled={!canEdit}
                help="Lower-case, e.g. cake-message."
                value={g.key}
                onChange={(e) => patch(i, { key: e.target.value })}
              />
              <SelectField
                label={`Type of ${name}`}
                disabled={!canEdit}
                value={g.type}
                onChange={(e) => patch(i, { type: e.target.value as OptionType })}
              >
                {(Object.keys(TYPE_LABEL) as OptionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="grid grid-cols-2 gap-x-3">
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
            <TextField
              label={`Help text of ${name} (English)`}
              disabled={!canEdit}
              value={g.help}
              onChange={(e) => patch(i, { help: e.target.value })}
            />
            <Checkbox
              label={`${name} is required`}
              disabled={!canEdit}
              checked={g.required}
              onChange={(e) => patch(i, { required: e.target.checked })}
            />
            {g.type === 'CHECKBOX' && (
              <div className="grid grid-cols-2 gap-x-3">
                <TextField
                  label={`Fewest choices of ${name}`}
                  inputMode="numeric"
                  disabled={!canEdit}
                  value={g.minSelect}
                  onChange={(e) => patch(i, { minSelect: e.target.value })}
                />
                <TextField
                  label={`Most choices of ${name}`}
                  inputMode="numeric"
                  disabled={!canEdit}
                  value={g.maxSelect}
                  onChange={(e) => patch(i, { maxSelect: e.target.value })}
                />
              </div>
            )}
            {(g.type === 'TEXT' || g.type === 'TEXTAREA') && (
              <TextField
                label={`Character limit of ${name}`}
                inputMode="numeric"
                disabled={!canEdit}
                value={g.maxLength}
                onChange={(e) => patch(i, { maxLength: e.target.value })}
              />
            )}
            {!hasChoices && (
              <ChargeInputs
                legend={`Extra charge for ${name}`}
                marketIds={product.marketIds}
                charges={g.charges}
                disabled={!canEdit || !canPrice}
                onChange={(charges) => patch(i, { charges })}
              />
            )}
            {hasChoices && (
              <div className="mt-4">
                <h3 className="text-[13px] font-medium">Choices</h3>
                {g.choices.map((c, n) => (
                  <div key={n} className="mt-3 rounded-md border border-line p-3">
                    <div className="grid grid-cols-3 gap-x-3">
                      <TextField
                        label={`Choice ${n + 1} key of ${name}`}
                        disabled={!canEdit}
                        value={c.key}
                        onChange={(e) => patchChoice(i, n, { key: e.target.value })}
                      />
                      <TextField
                        label={`Choice ${n + 1} English of ${name}`}
                        disabled={!canEdit}
                        value={c.en}
                        onChange={(e) => patchChoice(i, n, { en: e.target.value })}
                      />
                      <TextField
                        label={`Choice ${n + 1} Arabic of ${name}`}
                        dir="rtl"
                        disabled={!canEdit}
                        value={c.ar}
                        onChange={(e) => patchChoice(i, n, { ar: e.target.value })}
                      />
                    </div>
                    <ChargeInputs
                      legend={`Extra charge for ${c.en || `choice ${n + 1}`} in ${name}`}
                      marketIds={product.marketIds}
                      charges={c.charges}
                      disabled={!canEdit || !canPrice}
                      onChange={(charges) => patchChoice(i, n, { charges })}
                    />
                    {canEdit && (
                      <Button
                        className="mt-3"
                        onClick={() => patch(i, { choices: g.choices.filter((_, m) => m !== n) })}
                      >
                        Remove choice {n + 1} of {name}
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <Button
                    className="mt-3"
                    onClick={() =>
                      patch(i, {
                        choices: [...g.choices, { key: '', en: '', ar: '', charges: {} }],
                      })
                    }
                  >
                    Add choice to {name}
                  </Button>
                )}
              </div>
            )}
            {others.length > 0 && (
              <div className="mt-4">
                <h3 className="text-[13px] font-medium">Show only when</h3>
                {g.rules.map((r, n) => {
                  const target = groups.find((x) => x.key === r.groupKey);
                  return (
                    <div key={n} className="mt-2 grid grid-cols-3 items-end gap-x-3">
                      <SelectField
                        label={`Rule ${n + 1} option of ${name}`}
                        disabled={!canEdit}
                        value={r.groupKey}
                        onChange={(e) => patchRule(i, n, { groupKey: e.target.value })}
                      >
                        <option value="">Choose an option</option>
                        {others.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.en || o.key}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField
                        label={`Rule ${n + 1} condition of ${name}`}
                        disabled={!canEdit}
                        value={r.operator}
                        onChange={(e) =>
                          patchRule(i, n, { operator: e.target.value as RuleDraft['operator'] })
                        }
                      >
                        <option value="FILLED">has been filled in</option>
                        <option value="EQUALS">equals</option>
                        <option value="NOT_EQUALS">does not equal</option>
                      </SelectField>
                      {r.operator !== 'FILLED' ? (
                        <SelectField
                          label={`Rule ${n + 1} choice of ${name}`}
                          disabled={!canEdit}
                          value={r.choiceKey}
                          onChange={(e) => patchRule(i, n, { choiceKey: e.target.value })}
                        >
                          <option value="">Choose</option>
                          {target?.choices.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.en || c.key}
                            </option>
                          ))}
                        </SelectField>
                      ) : (
                        <div />
                      )}
                      {canEdit && (
                        <Button
                          className="col-span-3 mt-2 justify-self-start"
                          onClick={() => patch(i, { rules: g.rules.filter((_, m) => m !== n) })}
                        >
                          Remove rule {n + 1} of {name}
                        </Button>
                      )}
                    </div>
                  );
                })}
                {canEdit && (
                  <Button
                    className="mt-3"
                    onClick={() =>
                      patch(i, {
                        rules: [...g.rules, { groupKey: '', operator: 'FILLED', choiceKey: '' }],
                      })
                    }
                  >
                    Add rule to {name}
                  </Button>
                )}
              </div>
            )}
            {canEdit && (
              <Button
                variant="danger"
                className="mt-5"
                onClick={() => setGroups((x) => x.filter((_, n) => n !== i))}
              >
                Remove {name}
              </Button>
            )}
          </fieldset>
        );
      })}
      {canEdit && (
        <Button className="mt-5" onClick={() => setGroups((g) => [...g, blankGroup()])}>
          Add option
        </Button>
      )}
      {canEdit && (
        <SaveBar
          state={state}
          busy={save.isPending}
          onSave={() => save.mutate()}
          label="Save options"
        />
      )}
    </div>
  );
}
