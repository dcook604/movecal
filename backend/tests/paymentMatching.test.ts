import { describe, expect, it } from 'vitest';
import { matchUnits, scoreCandidates, selectAutoMatch } from '../src/services/paymentMatching.js';

const d = (s: string) => new Date(s);
const get = (b: { unit: string; date: Date }) => ({ unit: b.unit, date: b.date });

describe('matchUnits', () => {
  it('matches equal units regardless of formatting', () => {
    expect(matchUnits('T4-1105', 't4 1105')).toBe('exact');
  });
  it('suffix-matches when only one side has a tower prefix', () => {
    expect(matchUnits('T4-1105', '1105')).toBe('suffix');
    expect(matchUnits('1105', 'T4-1105')).toBe('suffix');
  });
  it('does not match different towers with the same number, or short tails', () => {
    expect(matchUnits('T4-1105', 'T2-1105')).toBeNull();
    expect(matchUnits('T4-5', '5')).toBeNull();
    expect(matchUnits('1105', '1106')).toBeNull();
    expect(matchUnits(null, '1105')).toBeNull();
  });
});

describe('selectAutoMatch', () => {
  const ref = d('2026-03-01');
  it('picks a single close candidate', () => {
    const c = scoreCandidates('1105', ref, [{ unit: '1105', date: d('2026-03-10') }], get);
    expect(selectAutoMatch(c)?.item.date).toEqual(d('2026-03-10'));
  });
  it('refuses when two bookings are about equally likely', () => {
    const c = scoreCandidates('1105', ref, [{ unit: '1105', date: d('2026-03-05') }, { unit: '1105', date: d('2026-03-08') }], get);
    expect(selectAutoMatch(c)).toBeNull();
  });
  it('prefers the clearly nearer booking', () => {
    const c = scoreCandidates('1105', ref, [{ unit: '1105', date: d('2026-03-03') }, { unit: '1105', date: d('2026-05-01') }], get);
    expect(selectAutoMatch(c)?.item.date).toEqual(d('2026-03-03'));
  });
  it('refuses a candidate months away from the invoice', () => {
    const c = scoreCandidates('1105', ref, [{ unit: '1105', date: d('2026-09-01') }], get);
    expect(selectAutoMatch(c)).toBeNull();
  });
  it('refuses ambiguous suffix matches across towers', () => {
    const c = scoreCandidates('1105', ref, [{ unit: 'T4-1105', date: d('2026-03-05') }, { unit: 'T2-1105', date: d('2026-03-06') }], get);
    expect(selectAutoMatch(c)).toBeNull();
  });
});
