import { describe, expect, it } from 'vitest';
import { classifyFeeText, extractUnit, feeTypeToMoveType } from '../src/services/feeClassifier.js';

describe('classifyFeeText', () => {
  it.each([
    ['Move-In Fee', 'Unit 1105', 'move_in'],
    ['', 'Moving out of T4-3102', 'move_out'],
    ['Move Out', '', 'move_out'],
    ['Furnished Move', 'Unit 502', 'furnished_move'],
    ['Suitcase Move In', '#905', 'suitcase_move'],
    ['Delivery fee', 'large sofa', 'delivery'],
    ['Renovation deposit', '', 'reno'],
  ])('%s / %s → %s', (key, notes, expected) => {
    expect(classifyFeeText(key, notes)).toBe(expected);
  });

  it('does not treat the bare word "out" or "into" as a move', () => {
    expect(classifyFeeText('Parking - out of service', '')).toBeNull();
    expect(classifyFeeText('Key deposit', 'handed into concierge')).toBeNull();
  });

  it('returns null when both directions are mentioned', () => {
    expect(classifyFeeText('Move in / move out', '')).toBeNull();
  });
});

describe('feeTypeToMoveType', () => {
  it('maps furnished_move (previously unmatchable) and rejects unknown', () => {
    expect(feeTypeToMoveType('furnished_move')).toBe('FURNISHED_MOVE');
    expect(feeTypeToMoveType('unknown')).toBeNull();
  });
});

describe('extractUnit', () => {
  it('finds units in common formats', () => {
    expect(extractUnit('Move in for Unit 1105')).toBe('1105');
    expect(extractUnit('T4-3102 move')).toBe('T4-3102');
    expect(extractUnit('nothing here')).toBeNull();
  });
});
