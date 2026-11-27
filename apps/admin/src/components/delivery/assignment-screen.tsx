'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader, SelectField, Section, Toolbar } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import {
  NeedsBrand,
  toInt,
  useBrandApi,
  useBrandPlaces,
  useProducts,
  useVariations,
} from '@/lib/ops';
import { MarketSelect, failure, useAreas, useDeliveryMarket } from './shared';

interface Rule {
  id?: string;
  kind: string;
  status: 'ACTIVE' | 'INACTIVE';
  ranks: boolean;
}
interface Availability {
  deliverable: boolean;
  reason: string | null;
  zoneId: string | null;
  branchIds: string[];
  dates: Array<{
    date: string;
    slots: Array<{
      slotId: string;
      branchId: string;
      start: string;
      end: string;
      method: { id: string; kind: string };
      currencyCode: string;
      feeMinor: number;
    }>;
  }>;
}
interface Preview {
  chosenBranchId: string | null;
  reason: string | null;
  ranking: Array<{
    branchId: string;
    priority: number;
    loadBooked: number;
    distanceMeters: number | null;
  }>;
  check?: { branchId: string; eligible: boolean };
}

const RULE_LABEL: Record<string, [string, string]> = {
  COVERS_AREA: [
    'Covers the delivery area',
    'A branch must serve the zone of the address. Always required.',
  ],
  HAS_STOCK: ['Has the items in stock', 'The branch must hold every item. Always required.'],
  OPEN_IN_TIME: [
    'Can make it in time',
    'The branch must be open and have a free slot place. Always required.',
  ],
  PRIORITY: [
    'Zone priority',
    'Prefer the branch ranked first for the zone (set on the Zones screen).',
  ],
  CLOSEST: [
    'Closest to the customer',
    "Prefer the nearest branch. Needs the customer's map location.",
  ],
  LEAST_LOADED: ['Least busy', 'Prefer the branch with the fewest orders booked that day.'],
};
const REASON: Record<string, string> = {
  AREA_NOT_COVERED: 'We do not deliver to this area.',
  RESTRICTED: 'An item in the cart cannot be delivered here.',
  NO_BRANCH_CAN_SERVE: 'No branch can serve this cart.',
  NO_SLOTS: 'There are no delivery slots in this period.',
};

export function AssignmentScreen() {
  const { brandId, ready } = useBrandApi('delivery');
  const { markets, marketId, setMarketId } = useDeliveryMarket();

  return (
    <>
      <PageHeader
        title="Branch assignment"
        lede="Decide which branch prepares an order when more than one could, and try a delivery to see exactly what a customer would be offered."
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Assignment rules" />
      ) : (
        <>
          <Toolbar>
            <MarketSelect markets={markets} value={marketId} onChange={setMarketId} />
          </Toolbar>
          {marketId && (
            <>
              <RulesEditor key={`r-${marketId}`} marketId={marketId} />
              <Tester key={`t-${marketId}`} marketId={marketId} />
            </>
          )}
        </>
      )}
    </>
  );
}

function RulesEditor({ marketId }: { marketId: string }) {
  const { brandId, api } = useBrandApi('delivery');
  const canManage = useCan('delivery.manage');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loaded = useQuery({
    queryKey: ['delivery', brandId, 'rules', marketId],
    queryFn: () => api.get<{ rules: Rule[] }>(`assignment-rules?marketId=${marketId}`),
  });
  const rules: Rule[] = draft ?? (loaded.data?.rules.length ? loaded.data.rules : []);
  const missing = Object.keys(RULE_LABEL).filter((k) => !rules.some((r) => r.kind === k));
  const set = (next: Rule[]) => {
    setSaved(false);
    setDraft(next);
  };
  const move = (i: number, by: number) => {
    const next = [...rules];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    set(next);
  };

  const save = useMutation({
    mutationFn: () =>
      api.put('assignment-rules', {
        marketId,
        rules: rules.map((r) => ({ kind: r.kind, status: r.status })),
      }),
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery', brandId, 'rules'] });
    },
    onError: (e) => setError(failure(e)),
  });

  return (
    <Section
      title="How a branch is chosen"
      description="A branch can only get an order if it delivers to the address, has the stock and is open in time. When several branches can, the preferences below are applied in order. With none, the zone's branch priority decides."
    >
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert tone="info" className="mb-3">
          Preferences saved.
        </Alert>
      )}
      {loaded.isError && (
        <Alert tone="danger">{errorMessage(loaded.error, 'We could not load the rules.')}</Alert>
      )}
      <ol className="max-w-2xl divide-y divide-line border-y border-line">
        {rules.map((r, i) => (
          <li key={r.kind} className="flex items-center gap-3 py-2 text-[13px]">
            <span className="w-5 text-muted">{i + 1}</span>
            <span className="grow">
              <span className="font-medium">{RULE_LABEL[r.kind]?.[0] ?? r.kind}</span>
              <span className="block text-xs text-muted">{RULE_LABEL[r.kind]?.[1]}</span>
            </span>
            {canManage && (
              <>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={r.status === 'ACTIVE'}
                    onChange={(e) =>
                      set(
                        rules.map((x) =>
                          x.kind === r.kind
                            ? { ...x, status: e.target.checked ? 'ACTIVE' : 'INACTIVE' }
                            : x,
                        ),
                      )
                    }
                  />
                  On
                </label>
                <Button
                  variant="quiet"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${RULE_LABEL[r.kind]?.[0]} up`}
                >
                  Up
                </Button>
                <Button
                  variant="quiet"
                  disabled={i === rules.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${RULE_LABEL[r.kind]?.[0]} down`}
                >
                  Down
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => set(rules.filter((x) => x.kind !== r.kind))}
                  aria-label={`Remove ${RULE_LABEL[r.kind]?.[0]}`}
                >
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
        {rules.length === 0 && !loaded.isPending && (
          <li className="py-3 text-[13px] text-muted">
            No preferences yet: the zone priority decides.
          </li>
        )}
      </ol>
      {canManage && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {missing.length > 0 && (
            <SelectField
              compact
              label="Add a preference"
              value=""
              onChange={(e) =>
                e.target.value &&
                set([...rules, { kind: e.target.value, status: 'ACTIVE', ranks: false }])
              }
            >
              <option value="">Choose</option>
              {missing.map((k) => (
                <option key={k} value={k}>
                  {RULE_LABEL[k]?.[0]}
                </option>
              ))}
            </SelectField>
          )}
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Save preferences
          </Button>
        </div>
      )}
    </Section>
  );
}

function Tester({ marketId }: { marketId: string }) {
  const { brandId, api } = useBrandApi('delivery');
  const { branchName } = useBrandPlaces();
  const { products } = useProducts(brandId);
  const areas = useAreas();
  const canAssign = useCan('delivery.assign');
  const [areaId, setAreaId] = useState('');
  const [productId, setProductId] = useState('');
  const [variationId, setVariationId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Availability | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const product = products.find((p) => p.id === productId);
  const variations = useVariations(brandId, product?.type === 'VARIABLE' ? productId : null);

  const cart = () => {
    if (!areaId) throw new Error('Choose the delivery area.');
    if (!productId) throw new Error('Choose a product.');
    if (product?.type === 'VARIABLE' && !variationId) throw new Error('Choose the variation.');
    const q = toInt(quantity);
    if (!q || q < 1) throw new Error('Quantity is a whole number, at least 1.');
    return {
      marketId,
      areaId,
      lines: [{ productId, ...(variationId && { variationId }), quantity: q }],
    };
  };

  const run = useMutation({
    mutationFn: async () => {
      setNotice(null);
      setPreview(null);
      setOverride(null);
      return api.post<Availability>('availability-test', cart());
    },
    onSuccess: (r) => {
      setError(null);
      setResult(r);
    },
    onError: (e) => {
      setResult(null);
      setError(failure(e));
    },
  });
  const choose = useMutation({
    mutationFn: ({ date, slotId }: { date: string; slotId: string }) =>
      api.post<Preview>('assignment/preview', { ...cart(), date, slotId }),
    onSuccess: (p) => {
      setError(null);
      setPreview(p);
    },
    onError: (e) => setError(failure(e)),
  });
  const force = useMutation({
    mutationFn: ({ date, slotId, branchId }: { date: string; slotId: string; branchId: string }) =>
      api.post<{ branchId: string; automaticBranchId: string; changed: boolean }>(
        'assignment/override',
        {
          ...cart(),
          date,
          slotId,
          branchId,
          reason: overrideReason.trim(),
        },
      ),
    onSuccess: (r) => {
      setError(null);
      setNotice(
        r.changed
          ? `Assigned to ${branchName(r.branchId)} instead of ${branchName(r.automaticBranchId)}. The change is in the audit log.`
          : `${branchName(r.branchId)} is already the automatic choice.`,
      );
    },
    onError: (e) => setError(failure(e)),
  });
  const [picked, setPicked] = useState<{ date: string; slotId: string } | null>(null);

  return (
    <Section
      title="Try a delivery"
      description="Pick an address and a product to see the dates and slots a customer would be offered, and which branch would get the order. Nothing is booked or changed."
    >
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <div className="max-w-xl">
        <SelectField
          label="Delivery area"
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
        >
          <option value="">Choose an area</option>
          {areas.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.translations.find((t) => t.language === 'en')?.name ?? a.code}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Product"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setVariationId('');
          }}
        >
          <option value="">Choose a product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.translations.find((t) => t.language === 'en')?.name ?? 'Untitled'}
            </option>
          ))}
        </SelectField>
        {product?.type === 'VARIABLE' && (
          <SelectField
            label="Variation"
            value={variationId}
            onChange={(e) => setVariationId(e.target.value)}
          >
            <option value="">Choose a variation</option>
            {variations.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.sku}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Quantity"
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Button
          className="mt-4"
          variant="primary"
          busy={run.isPending}
          onClick={() => run.mutate()}
        >
          Check availability
        </Button>
      </div>
      {result && (
        <div className="mt-6" aria-live="polite">
          {!result.deliverable ? (
            <Alert tone="info">
              {REASON[result.reason ?? ''] ?? 'This cart cannot be delivered.'}
            </Alert>
          ) : (
            <>
              <p className="mb-2 text-[13px] font-semibold">
                Offered to the customer ({result.branchIds.length} branch
                {result.branchIds.length === 1 ? '' : 'es'} can serve it)
              </p>
              <ul className="divide-y divide-line border-y border-line">
                {result.dates.map((d) => (
                  <li key={d.date} className="py-2 text-[13px]">
                    <p className="font-medium">{d.date}</p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {d.slots.map((s) => (
                        <li key={s.slotId}>
                          <button
                            type="button"
                            className="rounded-md border border-line-strong px-2 py-1 text-xs hover:bg-sunken"
                            onClick={() => {
                              setPicked({ date: d.date, slotId: s.slotId });
                              setNotice(null);
                              setOverride(null);
                              choose.mutate({ date: d.date, slotId: s.slotId });
                            }}
                          >
                            {s.start}–{s.end} · {methodKindLabelOf(s.method.kind)} ·{' '}
                            {s.currencyCode} {s.feeMinor / 100}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {preview && picked && (
        <div className="mt-6" aria-live="polite">
          <p className="text-[13px] font-semibold">
            {preview.chosenBranchId
              ? `The order would go to ${branchName(preview.chosenBranchId)}.`
              : 'No branch can take this order for that slot.'}
          </p>
          <ol className="mt-2 max-w-xl divide-y divide-line border-y border-line text-[13px]">
            {preview.ranking.map((r, i) => (
              <li key={r.branchId} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {i + 1}. {branchName(r.branchId)}
                  <span className="block text-xs text-muted">
                    Priority {r.priority} · {r.loadBooked} booked
                    {r.distanceMeters !== null && ` · ${(r.distanceMeters / 1000).toFixed(1)} km`}
                  </span>
                </span>
                {canAssign && (
                  <Button variant="quiet" onClick={() => setOverride(r.branchId)}>
                    Assign here
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {override && (
            <div className="mt-3 max-w-md">
              <TextField
                label={`Why assign to ${branchName(override)}?`}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
              <Button
                className="mt-3"
                variant="primary"
                busy={force.isPending}
                onClick={() => force.mutate({ ...picked, branchId: override })}
              >
                Confirm assignment
              </Button>
            </div>
          )}
          {notice && (
            <Alert tone="info" className="mt-3">
              {notice}
            </Alert>
          )}
        </div>
      )}
    </Section>
  );
}

const methodKindLabelOf = (kind: string) =>
  kind === 'SAME_DAY' ? 'Same day' : kind === 'NEXT_DAY' ? 'Next day' : 'Scheduled';
