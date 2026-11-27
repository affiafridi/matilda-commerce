'use client';

import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader, StatusTag, Toolbar } from '@/components/ui/kit';
import { NeedsBrand, itemsOrArray, useBrandApi, useBrandPlaces } from '@/lib/ops';
import { MarketSelect, type Method, type Zone, useDeliveryMarket } from './shared';

interface Step {
  title: string;
  href: string;
  action: string;
  what: string;
  state: 'done' | 'todo' | 'optional' | 'loading';
  note: string;
}

const TAG: Record<Step['state'], { value: string; label: string }> = {
  done: { value: 'ACTIVE', label: 'Done' },
  todo: { value: 'DRAFT', label: 'To do' },
  optional: { value: 'INACTIVE', label: 'Optional' },
  loading: { value: 'INACTIVE', label: 'Checking' },
};

/** A guided checklist: delivery needs several things set up, in this order, before customers can order. */
export function DeliverySetupScreen() {
  const { brandId, ready, api } = useBrandApi('delivery');
  const { branches } = useBrandPlaces();
  const { markets, marketId, setMarketId } = useDeliveryMarket();

  const enabled = !!brandId && !!marketId;
  const [zones, methods, charges, slots, restrictions, hours] = useQueries({
    queries: [
      {
        queryKey: ['delivery', brandId, 'zones', marketId],
        enabled,
        queryFn: async () =>
          itemsOrArray(await api.get<Zone[] | { items: Zone[] }>(`zones?marketId=${marketId}`)),
      },
      {
        queryKey: ['delivery', brandId, 'methods', marketId],
        enabled,
        queryFn: async () =>
          itemsOrArray(
            await api.get<Method[] | { items: Method[] }>(`methods?marketId=${marketId}`),
          ),
      },
      {
        queryKey: ['delivery', brandId, 'charges-all'],
        enabled,
        queryFn: async () =>
          itemsOrArray(
            await api.get<
              | Array<{ zoneId: string; methodId: string }>
              | { items: Array<{ zoneId: string; methodId: string }> }
            >('charges'),
          ),
      },
      {
        queryKey: ['delivery', brandId, 'slots', marketId],
        enabled,
        queryFn: async () =>
          itemsOrArray(
            await api.get<unknown[] | { items: unknown[] }>(`slots?marketId=${marketId}`),
          ),
      },
      {
        queryKey: ['delivery', brandId, 'restrictions', marketId],
        enabled,
        queryFn: async () =>
          itemsOrArray(
            await api.get<unknown[] | { items: unknown[] }>(`restrictions?marketId=${marketId}`),
          ),
      },
      {
        queryKey: ['delivery', brandId, 'hours-all', branches.map((b) => b.id).join(',')],
        enabled: enabled && branches.length > 0,
        queryFn: async () => {
          const all = await Promise.all(
            branches.map((b) =>
              api
                .get<{ days: Array<{ ranges: unknown[] }> }>(`branches/${b.id}/hours`)
                .then((h) => h.days.some((d) => d.ranges.length > 0)),
            ),
          );
          return all.filter(Boolean).length;
        },
      },
    ],
  });

  const loading = (q: { isPending: boolean }) => enabled && q.isPending;
  const zoneRows = zones.data ?? [];
  const bareZones = zoneRows.filter((z) => z.areaIds.length === 0 || z.branches.length === 0);
  const chargedZones = new Set((charges.data ?? []).map((c) => c.zoneId));
  const zonesWithoutCharge = zoneRows.filter((z) => !chargedZones.has(z.id));
  const withHours = hours.data ?? 0;

  const steps: Step[] = [
    {
      title: 'Set opening hours for each branch',
      href: '/delivery/calendar',
      action: 'Open branch calendar',
      what: 'Orders are only prepared and handed over while a branch is open. A branch with no hours can not take any order.',
      state: loading(hours)
        ? 'loading'
        : branches.length > 0 && withHours === branches.length
          ? 'done'
          : 'todo',
      note: loading(hours)
        ? ''
        : `Opening hours are set for ${withHours} of ${branches.length} branch${branches.length === 1 ? '' : 'es'}.`,
    },
    {
      title: 'Create delivery zones',
      href: '/delivery/zones',
      action: 'Open zones',
      what: 'A zone groups the areas you deliver to and lists which branches serve them.',
      state: loading(zones)
        ? 'loading'
        : zoneRows.length > 0 && bareZones.length === 0
          ? 'done'
          : 'todo',
      note: loading(zones)
        ? ''
        : zoneRows.length === 0
          ? 'No zones yet.'
          : bareZones.length > 0
            ? `${bareZones.length} of ${zoneRows.length} zone${zoneRows.length === 1 ? ' needs' : 's need'} an area and a branch.`
            : `${zoneRows.length} zone${zoneRows.length === 1 ? '' : 's'}, each with areas and branches.`,
    },
    {
      title: 'Add delivery methods',
      href: '/delivery/methods',
      action: 'Open methods',
      what: 'How an order is delivered: same day, next day or on a scheduled date.',
      state: loading(methods) ? 'loading' : (methods.data?.length ?? 0) > 0 ? 'done' : 'todo',
      note: loading(methods)
        ? ''
        : `${methods.data?.length ?? 0} method${methods.data?.length === 1 ? '' : 's'}.`,
    },
    {
      title: 'Set a delivery fee for each zone and method',
      href: '/delivery/methods',
      action: 'Add fees',
      what: 'A method is offered in a zone only when it has a fee there. Use 0 for free delivery.',
      state:
        loading(charges) || loading(zones)
          ? 'loading'
          : zoneRows.length > 0 &&
              zonesWithoutCharge.length === 0 &&
              (charges.data?.length ?? 0) > 0
            ? 'done'
            : 'todo',
      note:
        loading(charges) || loading(zones)
          ? ''
          : zonesWithoutCharge.length > 0 && zoneRows.length > 0
            ? `${zonesWithoutCharge.length} zone${zonesWithoutCharge.length === 1 ? ' has' : 's have'} no fee, so customers there get no delivery options.`
            : `${charges.data?.length ?? 0} fee${charges.data?.length === 1 ? '' : 's'} set.`,
    },
    {
      title: 'Create delivery slots',
      href: '/delivery/slots',
      action: 'Open slots',
      what: 'The time windows customers choose from, with how many orders each can take and the last time to order.',
      state: loading(slots) ? 'loading' : (slots.data?.length ?? 0) > 0 ? 'done' : 'todo',
      note: loading(slots)
        ? ''
        : `${slots.data?.length ?? 0} slot${slots.data?.length === 1 ? '' : 's'}.`,
    },
    {
      title: 'Hold products back from some deliveries',
      href: '/delivery/restrictions',
      action: 'Open restrictions',
      what: 'For example, no fresh cakes to a far area, or no delivery of a product on a holiday.',
      state: loading(restrictions) ? 'loading' : 'optional',
      note: loading(restrictions)
        ? ''
        : `${restrictions.data?.length ?? 0} restriction${restrictions.data?.length === 1 ? '' : 's'}.`,
    },
    {
      title: 'Choose how a branch is picked',
      href: '/delivery/assignment',
      action: 'Open branch assignment',
      what: 'When several branches can make an order, decide which one gets it. Without preferences the zone priority decides.',
      state: 'optional',
      note: '',
    },
    {
      title: 'Try a delivery',
      href: '/delivery/assignment',
      action: 'Try a delivery',
      what: 'Pick an address and a product to see what a customer would be offered. Nothing is booked.',
      state: 'optional',
      note: '',
    },
  ];

  return (
    <>
      <PageHeader
        title="Delivery setup"
        lede="Customers can only order for delivery once these steps are done. Work through them from the top; each one tells you what is still missing."
      />
      {!brandId ? (
        <NeedsBrand ready={ready} what="Delivery settings" />
      ) : (
        <>
          <Toolbar>
            <MarketSelect markets={markets} value={marketId} onChange={setMarketId} />
          </Toolbar>
          <ol className="divide-y divide-line rounded-md border border-line bg-surface">
            {steps.map((s, i) => (
              <li key={s.title} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-semibold"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 basis-72">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {s.title}
                    <StatusTag value={TAG[s.state].value} label={TAG[s.state].label} />
                  </p>
                  <p className="mt-1 max-w-prose text-[13px] text-muted">{s.what}</p>
                  {s.note && <p className="mt-1 text-[13px] text-ink">{s.note}</p>}
                </div>
                <Link
                  href={s.href}
                  className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-sunken"
                >
                  {s.action}
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
