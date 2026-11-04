import { MoveType } from '@prisma/client';

export type FeeType = 'move_in' | 'move_out' | 'furnished_move' | 'suitcase_move' | 'delivery' | 'reno';

export const FEE_TYPES: FeeType[] = ['move_in', 'move_out', 'furnished_move', 'suitcase_move', 'delivery', 'reno'];

export const FEE_TYPE_TO_MOVE_TYPE: Record<FeeType, MoveType> = {
  move_in: MoveType.MOVE_IN,
  move_out: MoveType.MOVE_OUT,
  furnished_move: MoveType.FURNISHED_MOVE,
  suitcase_move: MoveType.SUITCASE_MOVE,
  delivery: MoveType.DELIVERY,
  reno: MoveType.RENO,
};

export const MOVE_TYPE_TO_FEE_TYPE: Partial<Record<MoveType, FeeType>> = Object.fromEntries(
  Object.entries(FEE_TYPE_TO_MOVE_TYPE).map(([fee, move]) => [move, fee])
);

export function isFeeType(value: string): value is FeeType {
  return (FEE_TYPES as string[]).includes(value);
}

export function feeTypeToMoveType(feeType: string): MoveType | null {
  return isFeeType(feeType) ? FEE_TYPE_TO_MOVE_TYPE[feeType] : null;
}

/**
 * Rule-based classification of an invoice line item. Returns null when the text is
 * unrecognised or ambiguous (e.g. mentions both "move in" and "move out") so the caller
 * can fall back to an LLM or leave the payment for manual review.
 */
export function classifyFeeText(productKey: string, notes: string): FeeType | null {
  const text = `${productKey} ${notes}`.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  if (/\bsuitcase\b/.test(text)) return 'suitcase_move';
  if (/\bfurnished\b/.test(text)) return 'furnished_move';
  if (/\bdeliver(?:y|ies|ed)?\b/.test(text)) return 'delivery';
  if (/\b(reno|renovation|renovations|renovate)\b/.test(text)) return 'reno';
  const isIn = /\b(move in|moving in|movein|move into|moving into)\b/.test(text);
  const isOut = /\b(move out|moving out|moveout|vacate|vacating)\b/.test(text);
  if (isIn && isOut) return null;
  if (isIn) return 'move_in';
  if (isOut) return 'move_out';
  return null;
}

/** Best-effort unit number from free text ("Unit 1105", "#T4-3102", "apt 502"). */
export function extractUnit(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /\b(?:unit|apt|suite|apartment)\s*#?\s*([a-z0-9][-a-z0-9]*)/i,
    /#\s*([a-z0-9][-a-z0-9]*)/i,
    /\b([A-Z]\d{1,2}-\d{2,4})\b/, // T4-3102 style
    /\b(\d{3,4})\b/,              // bare 3–4 digit unit numbers
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const unit = m[1].trim();
      if (unit.length <= 20) return unit;
    }
  }
  return null;
}
