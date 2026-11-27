import {
  addDays,
  weekdayOf,
  localNow,
  nextOpen,
  toMinutes,
  zonedInstant,
  type OpenRange,
} from './local-time';

const DUBAI = 'Asia/Dubai';

describe('local time helpers', () => {
  it('reads the local date and minutes of an instant', () => {
    expect(localNow(new Date('2026-12-01T20:30:00Z'), DUBAI)).toEqual({
      date: '2026-12-02',
      minutes: 30,
    });
    expect(localNow(new Date('2026-12-01T10:00:00Z'), DUBAI)).toEqual({
      date: '2026-12-01',
      minutes: 840,
    });
  });

  it('turns local wall-clock time into an instant and back', () => {
    const t = zonedInstant('2026-12-04', toMinutes('14:00'), DUBAI);
    expect(t.toISOString()).toBe('2026-12-04T10:00:00.000Z');
    expect(localNow(t, DUBAI)).toEqual({ date: '2026-12-04', minutes: 840 });
  });

  it('follows daylight saving in other zones', () => {
    // London is UTC+0 in winter and UTC+1 in summer.
    expect(zonedInstant('2026-01-15', 600, 'Europe/London').toISOString()).toBe(
      '2026-01-15T10:00:00.000Z',
    );
    expect(zonedInstant('2026-07-15', 600, 'Europe/London').toISOString()).toBe(
      '2026-07-15T09:00:00.000Z',
    );
  });

  it('adds days across months and gives weekdays with Sunday as 0', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-12-04')).toBe(5);
    expect(weekdayOf('2026-12-06')).toBe(0);
    expect(weekdayOf('2026-12-07')).toBe(1);
  });

  describe('nextOpen', () => {
    const hours: OpenRange[] = [
      { weekday: 5, start: toMinutes('09:00'), end: toMinutes('18:00') },
      { weekday: 6, start: toMinutes('10:00'), end: toMinutes('14:00') },
      { weekday: 6, start: toMinutes('16:00'), end: toMinutes('20:00') },
    ];

    it('keeps an instant inside opening hours', () => {
      const at = new Date('2026-12-04T08:00:00Z'); // Friday 12:00 Dubai
      expect(nextOpen(at, hours, DUBAI)).toBe(at);
    });

    it('waits for opening on the same day', () => {
      const out = nextOpen(new Date('2026-12-04T02:00:00Z'), hours, DUBAI); // Friday 06:00
      expect(out?.toISOString()).toBe('2026-12-04T05:00:00.000Z'); // 09:00 Dubai
    });

    it('moves past closing to the next open day, and between split ranges', () => {
      const evening = nextOpen(new Date('2026-12-04T15:00:00Z'), hours, DUBAI); // Fri 19:00
      expect(evening?.toISOString()).toBe('2026-12-05T06:00:00.000Z'); // Saturday 10:00
      const gap = nextOpen(new Date('2026-12-05T10:30:00Z'), hours, DUBAI); // Sat 14:30
      expect(gap?.toISOString()).toBe('2026-12-05T12:00:00.000Z'); // Sat 16:00
    });

    it('skips days without hours and gives null for a branch with none', () => {
      const out = nextOpen(new Date('2026-12-05T17:00:00Z'), hours, DUBAI); // Sat 21:00
      expect(out?.toISOString()).toBe('2026-12-11T05:00:00.000Z'); // next Friday 09:00
      expect(nextOpen(new Date('2026-12-04T08:00:00Z'), [], DUBAI)).toBeNull();
    });
  });
});
