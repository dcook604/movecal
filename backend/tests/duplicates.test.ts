import { describe, expect, it, vi } from 'vitest';
import { assertNoDuplicateMoveRequest, DuplicateMoveRequestError } from '../src/services/conflictService.js';

function fakeTx(existing: any) {
  return { $executeRaw: vi.fn(), booking: { findFirst: vi.fn().mockResolvedValue(existing) } } as any;
}
const base = { unit: ' 5-03 ', moveDate: new Date('2026-10-28'), moveType: 'MOVE_OUT' };

describe('duplicate move guard', () => {
  it('rejects when a move already exists for the unit and day', async () => {
    await expect(assertNoDuplicateMoveRequest(fakeTx({ moveType: 'MOVE_IN' }), base)).rejects.toBeInstanceOf(DuplicateMoveRequestError);
  });
  it('allows when nothing exists', async () => {
    await expect(assertNoDuplicateMoveRequest(fakeTx(null), base)).resolves.toBeUndefined();
  });
  it('looks up by normalized unit, takes a lock, and treats the move family together', async () => {
    const tx = fakeTx(null);
    await assertNoDuplicateMoveRequest(tx, base);
    const where = tx.booking.findFirst.mock.calls[0][0].where;
    expect(where.unitNorm).toBe('503');
    expect(where.moveType.in).toEqual(['MOVE_IN', 'MOVE_OUT', 'FURNISHED_MOVE', 'SUITCASE_MOVE']);
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
  it('only matches the same type for non-move bookings', async () => {
    const tx = fakeTx(null);
    await assertNoDuplicateMoveRequest(tx, { ...base, moveType: 'DELIVERY' });
    expect(tx.booking.findFirst.mock.calls[0][0].where.moveType.in).toEqual(['DELIVERY']);
  });
});
