import { normalizeUnit } from '../utils/identity.js';

// Pure matching logic (no I/O) so the rules are easy to test.

export const AUTO_MATCH_MAX_DAYS = 90;
export const AUTO_MATCH_MIN_MARGIN = 10;

export type UnitMatch = 'exact' | 'suffix';

/** "T4-1105" → "1105"; a unit with no dash is returned normalized as-is. */
function unitTail(unit: string): string {
  const parts = unit.split('-');
  return normalizeUnit(parts[parts.length - 1]);
}

/**
 * Compare a unit from an invoice with a booking's unit. Residents often omit the tower
 * prefix ("1105" vs "T4-1105"), so a match on the last dash segment counts as a weaker
 * "suffix" match. Very short tails (<3 chars) never suffix-match.
 */
export function matchUnits(a: string | null | undefined, b: string | null | undefined): UnitMatch | null {
  if (!a || !b) return null;
  const na = normalizeUnit(a);
  const nb = normalizeUnit(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exact';
  const ta = unitTail(a);
  const tb = unitTail(b);
  if (ta.length >= 3 && ta === tb && (a.includes('-') !== b.includes('-'))) return 'suffix';
  return null;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

function dateScore(days: number): number {
  if (days <= 14) return 30;
  if (days <= 30) return 20;
  if (days <= 60) return 10;
  if (days <= AUTO_MATCH_MAX_DAYS) return 5;
  return 0;
}

export interface ScoredCandidate<T> {
  item: T;
  score: number;
  unitMatch: UnitMatch;
  days: number;
}

/**
 * Score items (bookings or payments) against a unit + reference date. Items whose unit
 * doesn't match are dropped. Highest score first.
 */
export function scoreCandidates<T>(
  unit: string | null | undefined,
  refDate: Date,
  items: T[],
  get: (item: T) => { unit: string | null | undefined; date: Date }
): ScoredCandidate<T>[] {
  const out: ScoredCandidate<T>[] = [];
  for (const item of items) {
    const { unit: itemUnit, date } = get(item);
    const unitMatch = matchUnits(unit, itemUnit);
    if (!unitMatch) continue;
    const days = daysBetween(refDate, date);
    out.push({ item, unitMatch, days, score: (unitMatch === 'exact' ? 60 : 40) + dateScore(days) });
  }
  return out.sort((x, y) => y.score - x.score || x.days - y.days);
}

/**
 * Auto-match only when there is a single clear winner close in time. Anything ambiguous
 * (two candidates with similar scores, or too far from the move date) goes to human review.
 */
export function selectAutoMatch<T>(candidates: ScoredCandidate<T>[]): ScoredCandidate<T> | null {
  const [best, second] = candidates;
  if (!best) return null;
  if (best.days > AUTO_MATCH_MAX_DAYS) return null;
  if (second && best.score - second.score < AUTO_MATCH_MIN_MARGIN) return null;
  return best;
}
