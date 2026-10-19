import { describe, expect, it } from 'vitest';
import { validateMoveTime } from '../src/utils/moveTimeValidator.js';

// 2026-10-19 is a Monday; 2026-10-24/25 are Saturday/Sunday.

describe('renovation time validation', () => {
  it('accepts a single 1-hour block on a weekday', () => {
    expect(validateMoveTime(
      new Date('2026-10-19T10:00:00'),
      new Date('2026-10-19T11:00:00'),
      'RENO'
    )).toEqual({ valid: true });
  });

  it('accepts multiple consecutive blocks covering a full weekday', () => {
    expect(validateMoveTime(
      new Date('2026-10-19T10:00:00'),
      new Date('2026-10-19T16:00:00'),
      'RENO'
    )).toEqual({ valid: true });
  });

  it('accepts a full weekend day', () => {
    expect(validateMoveTime(
      new Date('2026-10-24T08:00:00'),
      new Date('2026-10-24T17:00:00'),
      'RENO'
    )).toEqual({ valid: true });
  });

  it('rejects durations that are not whole hours', () => {
    const result = validateMoveTime(
      new Date('2026-10-19T10:00:00'),
      new Date('2026-10-19T12:30:00'),
      'RENO'
    );
    expect(result.valid).toBe(false);
  });

  it('rejects starts that are not on the hour', () => {
    const result = validateMoveTime(
      new Date('2026-10-19T10:30:00'),
      new Date('2026-10-19T12:30:00'),
      'RENO'
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a block outside permitted weekday hours', () => {
    const result = validateMoveTime(
      new Date('2026-10-19T15:00:00'),
      new Date('2026-10-19T17:00:00'),
      'RENO'
    );
    expect(result.valid).toBe(false);
  });
});
