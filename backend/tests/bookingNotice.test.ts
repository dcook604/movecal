import { describe, expect, it } from 'vitest';
import { hasMinimumNotice, weekdayHoursBetween } from '../src/utils/bookingNotice.js';

// 2026-11-16 is a Monday. Vancouver is UTC-8 in November, so 18:00Z = 10:00 local.
describe('minimum booking notice', () => {
  const now = new Date('2026-11-16T18:00:00Z'); // Mon 10:00 local

  it('excludes weekend time from the notice period', () => {
    expect(weekdayHoursBetween(new Date('2026-11-13T10:00:00Z'), new Date('2026-11-17T10:00:00Z'))).toBe(48);
    expect(weekdayHoursBetween(new Date('2026-11-14T10:00:00Z'), new Date('2026-11-15T10:00:00Z'))).toBe(0);
  });

  it('rejects less than 48 weekday hours', () => {
    expect(hasMinimumNotice(new Date('2026-11-18T09:00:00Z'), now)).toBe(false);
  });

  it('accepts 48 weekday hours or more', () => {
    expect(hasMinimumNotice(new Date('2026-11-18T10:00:00Z'), now)).toBe(true);
  });

  it('does not count a weekend toward notice', () => {
    const fri = new Date('2026-11-20T18:00:00Z'); // Fri 10:00 local
    expect(hasMinimumNotice(new Date('2026-11-22T10:00:00Z'), fri)).toBe(false); // Sunday
    expect(hasMinimumNotice(new Date('2026-11-24T10:00:00Z'), fri)).toBe(true);  // Tuesday
  });
});
