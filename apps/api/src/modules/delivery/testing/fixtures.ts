import type { DayHours, DeliveryMethodKind } from '@matilda/validation';

/**
 * Modelled delivery setups used ONLY by tests (as D3-14 did for products). They are not the owner's
 * real branches or rules (those are still outstanding, docs/PHASE-4-PLAN.md section 10) and are never
 * seeded or shown as data. They exist to prove the engine copes with two different businesses at once:
 * a flower kitchen that is open long hours every day, and a cake kitchen with a short week, a long
 * lead time, a lunch break and a small number of slots.
 */
export interface FixtureSlot {
  start: string;
  end: string;
  /** Orders this slot accepts. */
  capacity: number;
  /** Local time before which an order may still be placed for this slot's day. */
  cutoff: string;
  methods: readonly DeliveryMethodKind[];
}

export interface FixtureBranch {
  code: string;
  timezone: string;
  /** Latitude and longitude, used only for the "closest" assignment rule. */
  location: { latitude: number; longitude: number };
  hours: readonly DayHours[];
  /** Zones this branch serves, in priority order. */
  zones: readonly string[];
  /** Whole days with no preparation or delivery. */
  closures: readonly string[];
  slots: readonly FixtureSlot[];
}

const allDays = (ranges: DayHours['ranges'], except: readonly number[] = []): DayHours[] =>
  [0, 1, 2, 3, 4, 5, 6].filter((d) => !except.includes(d)).map((weekday) => ({ weekday, ranges }));

export const FLOWER_KITCHEN: FixtureBranch = {
  code: 'fx-flowers-dubai',
  timezone: 'Asia/Dubai',
  location: { latitude: 25.2048, longitude: 55.2708 },
  hours: allDays([{ start: '08:00', end: '22:00' }]),
  zones: ['dubai-central', 'dubai-outer'],
  closures: ['2026-12-02'],
  slots: [
    {
      start: '10:00',
      end: '12:00',
      capacity: 20,
      cutoff: '08:00',
      methods: ['SAME_DAY', 'NEXT_DAY', 'SCHEDULED'],
    },
    {
      start: '14:00',
      end: '16:00',
      capacity: 20,
      cutoff: '12:00',
      methods: ['SAME_DAY', 'NEXT_DAY', 'SCHEDULED'],
    },
    {
      start: '18:00',
      end: '21:00',
      capacity: 30,
      cutoff: '16:00',
      methods: ['SAME_DAY', 'NEXT_DAY', 'SCHEDULED'],
    },
  ],
};

export const CAKE_KITCHEN: FixtureBranch = {
  code: 'fx-cakes-dubai',
  timezone: 'Asia/Dubai',
  location: { latitude: 25.1972, longitude: 55.2744 },
  // Closed on Sunday (0); a lunch break on the other days.
  hours: allDays(
    [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '20:00' },
    ],
    [0],
  ),
  zones: ['dubai-central', 'sharjah'],
  closures: ['2026-12-02', '2026-12-03'],
  slots: [
    {
      start: '11:00',
      end: '14:00',
      capacity: 6,
      cutoff: '18:00',
      methods: ['NEXT_DAY', 'SCHEDULED'],
    },
    {
      start: '15:00',
      end: '19:00',
      capacity: 6,
      cutoff: '18:00',
      methods: ['NEXT_DAY', 'SCHEDULED'],
    },
  ],
};

export const FIXTURE_ZONES = {
  'dubai-central': { areas: ['downtown', 'business-bay', 'jumeirah'], fee: 0, minimumOrder: 0 },
  'dubai-outer': { areas: ['mirdif', 'dubai-hills'], fee: 2500, minimumOrder: 15000 },
  sharjah: { areas: ['al-majaz', 'al-khan'], fee: 4000, minimumOrder: 20000 },
} as const;

/** Lead times (minutes) of the fixture products, as Phase 3 stores them on the product. */
export const FIXTURE_LEAD_TIMES = {
  /** Fresh flowers: ready in two hours. */
  'rose-bouquet': { prepMinutes: 120, leadMinutes: 0, madeToOrder: false },
  /** A custom cake: a full day to bake and decorate. */
  'custom-cake': { prepMinutes: 240, leadMinutes: 1440, madeToOrder: true },
} as const;

export const FIXTURE_BRANCHES: readonly FixtureBranch[] = [FLOWER_KITCHEN, CAKE_KITCHEN];
