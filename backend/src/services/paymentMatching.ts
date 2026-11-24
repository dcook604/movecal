import { normalizeUnit } from '../utils/identity.js';

// Pure matching logic (no I/O) so the rules are easy to test.

export const AUTO_MATCH_MAX_DAYS = 90;
export const AUTO_MATCH_MIN_MARGIN = 10;

export type UnitMatch = 'exact' | 'suffix';

/**
 * The trailing unit number of a unit string. Splits on any non-alphanumeric separator so
 * "T4-1105", "T4 1105" and "T4.1105" all yield "1105". A unit with no separator is
 * returned normalized as-is.
 */
export function unitTail(unit: string): string {
  const parts = unit.split(/[^a-z0-9]+/i).filter(Boolean);
  return normalizeUnit(parts[parts.length - 1] ?? '');
}

/**
 * Compare a unit from an invoice with a booking's unit. Residents often omit the tower
 * prefix ("1105" vs "T4-1105"), so a match on the trailing unit number counts as a weaker
 * "suffix" match. Exactly one side must carry a prefix (otherwise two different towers
 * with the same number would match), and very short tails (<3 chars) never suffix-match.
 */
export function matchUnits(a: string | null | undefined, b: string | null | undefined): UnitMatch | null {
  if (!a || !b) return null;
  const na = normalizeUnit(a);
  const nb = normalizeUnit(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exact';
  const ta = unitTail(a);
  const tb = unitTail(b);
  const prefixedA = na !== ta;
  const prefixedB = nb !== tb;
  if (ta.length >= 3 && ta === tb && prefixedA !== prefixedB) return 'suffix';
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
    // An exact normalized unit is definitive; a suffix match may be a different tower, so
    // it should never win autoselection over an exact match even if it is closer in time.
    out.push({ item, unitMatch, days, score: (unitMatch === 'exact' ? 70 : 40) + dateScore(days) });
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
