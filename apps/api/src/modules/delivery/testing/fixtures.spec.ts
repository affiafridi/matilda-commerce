import {
  dayHoursSchema,
  localDateSchema,
  localTimeSchema,
  timeRangeSchema,
} from '@matilda/validation';
import { CAKE_KITCHEN, FIXTURE_BRANCHES, FIXTURE_ZONES, FLOWER_KITCHEN } from './fixtures';

describe('delivery test fixtures', () => {
  it('are valid against the shared schemas', () => {
    for (const b of FIXTURE_BRANCHES) {
      for (const h of b.hours) expect(dayHoursSchema.safeParse(h).success).toBe(true);
      for (const c of b.closures) expect(localDateSchema.safeParse(c).success).toBe(true);
      for (const s of b.slots) {
        expect(timeRangeSchema.safeParse({ start: s.start, end: s.end }).success).toBe(true);
        expect(localTimeSchema.safeParse(s.cutoff).success).toBe(true);
        expect(s.capacity).toBeGreaterThan(0);
        // The database refuses a same-day cutoff that is not before the slot starts.
        if (s.cutoffDaysBefore === 0) expect(s.cutoff < s.start).toBe(true);
      }
    }
  });

  it('only name zones that exist, and every zone has areas', () => {
    for (const b of FIXTURE_BRANCHES) {
      for (const z of b.zones) expect(Object.keys(FIXTURE_ZONES)).toContain(z);
    }
    for (const z of Object.values(FIXTURE_ZONES)) expect(z.areas.length).toBeGreaterThan(0);
  });

  it('describe two genuinely different businesses', () => {
    expect(FLOWER_KITCHEN.hours).toHaveLength(7);
    expect(CAKE_KITCHEN.hours).toHaveLength(6);
    expect(CAKE_KITCHEN.hours.every((h) => h.ranges.length === 2)).toBe(true);
    expect(CAKE_KITCHEN.slots.some((s) => s.methods.includes('SAME_DAY'))).toBe(false);
    expect(FLOWER_KITCHEN.slots.some((s) => s.methods.includes('SAME_DAY'))).toBe(true);
  });
});
