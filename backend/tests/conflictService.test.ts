import { describe, expect, it } from 'vitest';
import { hasElevatorConflict, validateMoveHours } from '../src/services/conflictService.js';

describe('conflict logic', () => {
  it('detects overlapping elevator bookings', () => {
    const conflict = hasElevatorConflict(
      [{ startDatetime: new Date('2025-01-01T10:00:00'), endDatetime: new Date('2025-01-01T11:00:00'), elevatorRequired: true }],
      { startDatetime: new Date('2025-01-01T10:30:00'), endDatetime: new Date('2025-01-01T11:30:00'), elevatorRequired: true }
    );
    expect(conflict).toBe(true);
  });

  it('allows adjacent elevator bookings (no buffer rule)', () => {
    const conflict = hasElevatorConflict(
      [{ startDatetime: new Date('2025-01-01T10:00:00'), endDatetime: new Date('2025-01-01T11:00:00'), elevatorRequired: true }],
      { startDatetime: new Date('2025-01-01T11:00:00'), endDatetime: new Date('2025-01-01T12:00:00'), elevatorRequired: true }
    );
    expect(conflict).toBe(false);
  });

  it('allows non-elevator bookings', () => {
    const conflict = hasElevatorConflict(
      [{ startDatetime: new Date('2025-01-01T10:00:00'), endDatetime: new Date('2025-01-01T11:00:00'), elevatorRequired: true }],
      { startDatetime: new Date('2025-01-01T10:30:00'), endDatetime: new Date('2025-01-01T11:30:00'), elevatorRequired: false }
    );
    expect(conflict).toBe(false);
  });

  it('enforces move hours — rejects before 8am', () => {
    expect(() => validateMoveHours(new Date('2025-01-01T07:30:00'), new Date('2025-01-01T08:30:00'))).toThrow();
  });

  it('enforces move hours — rejects after 7pm', () => {
    expect(() => validateMoveHours(new Date('2025-01-01T18:00:00'), new Date('2025-01-01T19:30:00'))).toThrow();
  });

  it('allows a weekend booking ending at 7pm', () => {
    expect(() => validateMoveHours(new Date('2025-01-01T16:00:00'), new Date('2025-01-01T19:00:00'))).not.toThrow();
  });

  it('allows booking within outer bounds', () => {
    expect(() => validateMoveHours(new Date('2025-01-01T10:00:00'), new Date('2025-01-01T13:00:00'))).not.toThrow();
  });
});
