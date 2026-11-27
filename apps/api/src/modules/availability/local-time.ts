/**
 * Local wall-clock helpers for delivery rules. Hours, slots and cutoffs are stored as local times
 * of the branch's time zone (D4-10); these helpers turn them into instants and back using the
 * platform's time zone data (`Intl`), so no date library is needed.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** `YYYY-MM-DD` calendar date. */
export type LocalDate = string;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(instant: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as unknown as Parts;
}

/** Offset of the time zone from UTC at an instant, in minutes (Dubai is +240). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local date and minutes since local midnight at an instant. */
export function localNow(instant: Date, timeZone: string): { date: LocalDate; minutes: number } {
  const p = partsOf(instant, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minutes: p.hour * 60 + p.minute };
}

/** `HH:mm` to minutes since midnight. */
export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** The instant at which the wall clock of `timeZone` shows `date` and `minutes`. */
export function zonedInstant(date: LocalDate, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let instant = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60000);
  // One refinement handles instants next to a daylight-saving change.
  instant = new Date(naive - offsetMinutes(instant, timeZone) * 60000);
  return instant;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Weekday as the platform stores it for hours, slots and restrictions: 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface OpenRange {
  weekday: number;
  /** Minutes since local midnight. */
  start: number;
  end: number;
}

/**
 * The first moment at or after `instant` when a branch with these opening ranges is open, or null
 * when it has no hours at all (a branch without hours produces nothing). Looks one week ahead.
 */
export function nextOpen(
  instant: Date,
  ranges: readonly OpenRange[],
  timeZone: string,
): Date | null {
  if (ranges.length === 0) return null;
  const now = localNow(instant, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const date = addDays(now.date, offset);
    const day = ranges
      .filter((r) => r.weekday === weekdayOf(date))
      .sort((a, b) => a.start - b.start);
    for (const r of day) {
      if (offset === 0) {
        if (now.minutes >= r.start && now.minutes < r.end) return instant;
        if (now.minutes < r.start) return zonedInstant(date, r.start, timeZone);
      } else {
        return zonedInstant(date, r.start, timeZone);
      }
    }
  }
  return null;
}
