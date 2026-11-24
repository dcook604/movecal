import { ApprovalSource, BookingStatus, MoveType, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import type { Booking, PaymentsLedger } from '@prisma/client';
import { prisma } from '../prisma.js';
import { logAudit } from './auditService.js';
import { feeTypeToMoveType, MOVE_TYPE_TO_FEE_TYPE } from './feeClassifier.js';
import { scoreCandidates, selectAutoMatch, ScoredCandidate, unitTail } from './paymentMatching.js';
import { normalizeUnit } from '../utils/identity.js';

// Statuses a payment may be attached to. APPROVED is included so payments that arrive after
// a manual approval still get linked (no state change in that case).
const MATCHABLE: BookingStatus[] = [BookingStatus.SUBMITTED, BookingStatus.PENDING, BookingStatus.APPROVED];
const OPEN: BookingStatus[] = [BookingStatus.SUBMITTED, BookingStatus.PENDING];

export type MatchError =
  | 'PAYMENT_NOT_FOUND' | 'PAYMENT_UNAVAILABLE' | 'BOOKING_NOT_FOUND' | 'BOOKING_UNAVAILABLE' | 'ALREADY_PAID';

export type MatchResult =
  | { ok: true; booking: Booking; payment: PaymentsLedger; transitioned: boolean }
  | { ok: false; code: MatchError; message: string };

export async function getSystemUserId(): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { role: UserRole.CONCIERGE }, select: { id: true } });
  return u?.id ?? null;
}

const BASE_BOOKING_WHERE = {
  status: { in: MATCHABLE },
  paymentStatus: PaymentStatus.NONE,
};

/**
 * Unpaid bookings that could be the target of this payment, best first.
 *
 * The query is deliberately precise rather than broad: an exact normalized unit match, plus
 * (only when the payment unit omits its tower) bookings whose unit is a bare trailing number.
 * That keeps the lookup index-friendly and avoids the old "take 50 arbitrary rows" cap
 * silently hiding the real booking.
 */
export async function candidateBookingsForPayment(payment: PaymentsLedger): Promise<ScoredCandidate<Booking>[]> {
  const moveType = feeTypeToMoveType(payment.feeType);
  if (!moveType || !payment.unit) return [];
  const normalized = normalizeUnit(payment.unit);
  const tail = unitTail(payment.unit);
  if (!normalized || !tail) return [];

  const base: Prisma.BookingWhereInput = { ...BASE_BOOKING_WHERE, moveType };
  const exactQuery = prisma.booking.findMany({
    where: { ...base, unitNorm: normalized },
    orderBy: { moveDate: 'asc' },
    take: 100,
  });

  // If the payment has a tower prefix, the only valid suffix candidate is a booking with
  // no prefix (unitNorm === tail). If it has no prefix, the valid suffix candidates are
  // prefixed bookings ending in the same number.
  let suffixQuery: Promise<Booking[]> = Promise.resolve([]);
  if (normalized === tail) {
    if (tail.length >= 3) {
      suffixQuery = prisma.booking.findMany({
        where: { ...base, unitNorm: { endsWith: tail }, NOT: { unitNorm: normalized } },
        orderBy: { moveDate: 'asc' },
        take: 100,
      });
    }
  } else if (tail.length >= 3) {
    suffixQuery = prisma.booking.findMany({
      where: { ...base, unitNorm: tail },
      orderBy: { moveDate: 'asc' },
      take: 100,
    });
  }

  const [exact, suffix] = await Promise.all([exactQuery, suffixQuery]);
  return scoreCandidates(payment.unit, payment.invoiceDate ?? payment.paidAt, [...exact, ...suffix], (b) => ({ unit: b.unit, date: b.moveDate }));
}

/**
 * Candidate suggestions for many payments at once (used by the review queue). One query
 * for all unpaid bookings instead of one query per payment.
 */
export async function candidateBookingsForPayments(payments: PaymentsLedger[]): Promise<Map<string, ScoredCandidate<Booking>[]>> {
  const moveTypes = [...new Set(payments.map((p) => feeTypeToMoveType(p.feeType)).filter((m): m is MoveType => m !== null))];
  const bookingsByType = new Map<MoveType, Booking[]>();
  if (moveTypes.length) {
    const bookings = await prisma.booking.findMany({
      where: { ...BASE_BOOKING_WHERE, moveType: { in: moveTypes } },
    });
    for (const booking of bookings) {
      const list = bookingsByType.get(booking.moveType);
      if (list) list.push(booking);
      else bookingsByType.set(booking.moveType, [booking]);
    }
  }

  const out = new Map<string, ScoredCandidate<Booking>[]>();
  for (const payment of payments) {
    const moveType = feeTypeToMoveType(payment.feeType);
    if (!moveType || !payment.unit) {
      out.set(payment.id, []);
      continue;
    }
    out.set(
      payment.id,
      scoreCandidates(payment.unit, payment.invoiceDate ?? payment.paidAt, bookingsByType.get(moveType) ?? [], (b) => ({ unit: b.unit, date: b.moveDate }))
    );
  }
  return out;
}

/** Unmatched paid invoices that could belong to this booking, best first. */
export async function candidatePaymentsForBooking(booking: Pick<Booking, 'unit' | 'moveType' | 'moveDate'>): Promise<ScoredCandidate<PaymentsLedger>[]> {
  const feeType = MOVE_TYPE_TO_FEE_TYPE[booking.moveType];
  if (!feeType) return [];
  // The unmatched pool is the review queue (deliberately small); load it and let the pure
  // scorer apply unit rules. This avoids an unindexed `contains` scan plus a row cap.
  const payments = await prisma.paymentsLedger.findMany({
    where: {
      feeType,
      dismissed: false,
      reversedAt: null,
      moveApprovals: { none: {} },
    },
    orderBy: { paidAt: 'desc' },
  });
  return scoreCandidates(booking.unit, booking.moveDate, payments, (p) => ({ unit: p.unit, date: p.invoiceDate ?? p.paidAt }));
}

/**
 * Link a payment to a booking atomically. Every precondition is re-checked inside the
 * transaction and the unique index on move_approvals.invoice_id backstops races between
 * the poller, retry-match and manual matches.
 */
export async function applyMatch(params: {
  paymentId: string;
  bookingId: string;
  source: 'AUTO' | 'MANUAL';
  actorId: string | null;
}): Promise<MatchResult> {
  const { paymentId, bookingId, source, actorId } = params;
  try {
    return await prisma.$transaction(async (tx): Promise<MatchResult> => {
      const payment = await tx.paymentsLedger.findUnique({ where: { id: paymentId }, include: { moveApprovals: true } });
      if (!payment) return { ok: false, code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' };
      if (payment.moveApprovals.length) return { ok: false, code: 'PAYMENT_UNAVAILABLE', message: 'Payment is already matched to a booking' };
      if (payment.dismissed) return { ok: false, code: 'PAYMENT_UNAVAILABLE', message: 'Payment was dismissed — restore it first' };
      if (payment.reversedAt) return { ok: false, code: 'PAYMENT_UNAVAILABLE', message: 'Payment was reversed or cancelled in Invoice Ninja' };

      // Serialize matches per booking so two payments ingested in the same poll can't both
      // attach to the same booking (move_approvals.move_request_id is not unique).
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
      if (!locked.length) return { ok: false, code: 'BOOKING_NOT_FOUND', message: 'Booking not found' };

      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return { ok: false, code: 'BOOKING_NOT_FOUND', message: 'Booking not found' };
      if (!MATCHABLE.includes(booking.status)) {
        return { ok: false, code: 'BOOKING_UNAVAILABLE', message: `Cannot match a payment to a ${booking.status.toLowerCase()} booking` };
      }
      const alreadyPaid = await tx.moveApproval.count({ where: { moveRequestId: bookingId } });
      if (alreadyPaid || booking.paymentStatus !== PaymentStatus.NONE) {
        return { ok: false, code: 'ALREADY_PAID', message: 'Booking already has a payment matched' };
      }

      await tx.moveApproval.create({
        data: { moveRequestId: bookingId, clientId: payment.clientId, invoiceId: payment.invoiceId, billingPeriod: payment.billingPeriod },
      });

      const transitioned = OPEN.includes(booking.status);
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PaymentStatus.PAID,
          ...(transitioned && {
            status: BookingStatus.APPROVED,
            approvedAt: new Date(),
            approvedById: source === 'MANUAL' ? actorId : null,
            approvalSource: ApprovalSource.PAYMENT,
          }),
        },
      });

      if (actorId) {
        await logAudit(tx, actorId, source === 'AUTO' ? 'PAYMENT_AUTO_MATCHED' : 'PAYMENT_MANUALLY_MATCHED', bookingId, {
          invoiceId: payment.invoiceId,
          amountPaid: payment.amountPaid?.toString() ?? null,
          approvedByPayment: transitioned,
        });
      }
      return { ok: true, booking: updated, payment, transitioned };
    });
  } catch (err) {
    // P2002: unique violation on invoice_id — another worker matched this payment first.
    // P2034: write conflict/deadlock — another worker was matching this booking; the caller
    // can safely retry on its next poll.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2002' || err.code === 'P2034')) {
      return { ok: false, code: 'PAYMENT_UNAVAILABLE', message: 'Payment was matched concurrently' };
    }
    throw err;
  }
}

/** Auto-match one payment if there is a single clear candidate booking. */
export async function autoMatchPayment(payment: PaymentsLedger, actorId?: string | null): Promise<MatchResult | null> {
  const best = selectAutoMatch(await candidateBookingsForPayment(payment));
  if (!best) return null;
  const actor = actorId === undefined ? await getSystemUserId() : actorId;
  return applyMatch({ paymentId: payment.id, bookingId: best.item.id, source: 'AUTO', actorId: actor });
}

type MatchLogger = { error: (obj: object, msg: string) => void };

export interface RetryMatch {
  payment: PaymentsLedger;
  result: Extract<MatchResult, { ok: true }>;
}

/**
 * Re-run automatic matching over every payment still waiting for a booking. Bookings can be
 * submitted after a payment was ingested, and corrections can make a previously unmatched
 * payment matchable — so this is run on every poll instead of matching only once.
 */
export async function retryUnmatchedPayments(log?: MatchLogger): Promise<{ checked: number; matched: number; matches: RetryMatch[] }> {
  const unmatched = await prisma.paymentsLedger.findMany({
    where: { moveApprovals: { none: {} }, dismissed: false, reversedAt: null, feeType: { not: 'unknown' }, unit: { not: null } },
    orderBy: { paidAt: 'desc' },
  });

  const matches: RetryMatch[] = [];
  const actorId = await getSystemUserId();
  for (const payment of unmatched) {
    const result = await autoMatchPayment(payment, actorId).catch((err) => {
      log?.error({ err, paymentId: payment.id }, 'Auto-match retry failed');
      return null;
    });
    if (result?.ok) matches.push({ payment, result });
  }
  return { checked: unmatched.length, matched: matches.length, matches };
}

/** Payment-first flow: auto-match a freshly created booking to an existing unmatched invoice. */
export async function autoMatchBooking(booking: Booking): Promise<MatchResult | null> {
  const best = selectAutoMatch(await candidatePaymentsForBooking(booking));
  if (!best) return null;
  return applyMatch({ paymentId: best.item.id, bookingId: booking.id, source: 'AUTO', actorId: await getSystemUserId() });
}

/** Undo a match (e.g. staff matched the wrong booking). Payments-approved bookings go back to pending. */
export async function unmatchPayment(paymentId: string, actorId: string): Promise<{ ok: true; booking: Booking | null } | { ok: false; message: string }> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.paymentsLedger.findUnique({ where: { id: paymentId }, include: { moveApprovals: true } });
    const approval = payment?.moveApprovals[0];
    if (!payment || !approval) return { ok: false as const, message: 'Payment is not matched' };

    await tx.moveApproval.delete({ where: { id: approval.id } });
    const booking = await tx.booking.findUnique({ where: { id: approval.moveRequestId } });
    let updated: Booking | null = null;
    if (booking) {
      const revert = booking.approvalSource === ApprovalSource.PAYMENT && booking.status === BookingStatus.APPROVED;
      updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: PaymentStatus.NONE,
          ...(revert && { status: BookingStatus.PENDING, approvedAt: null, approvedById: null, approvalSource: null }),
        },
      });
    }
    await logAudit(tx, actorId, 'PAYMENT_UNMATCHED', booking?.id, { invoiceId: payment.invoiceId, revertedApproval: !!updated && updated.status === BookingStatus.PENDING });
    return { ok: true as const, booking: updated };
  });
}

/** Invoice Ninja voided / cancelled / reversed a previously-paid invoice. */
export async function markPaymentReversed(payment: PaymentsLedger): Promise<Booking | null> {
  const actorId = await getSystemUserId();
  return prisma.$transaction(async (tx) => {
    await tx.paymentsLedger.update({ where: { id: payment.id }, data: { reversedAt: new Date() } });
    const approval = await tx.moveApproval.findUnique({ where: { invoiceId: payment.invoiceId } });
    let booking: Booking | null = null;
    if (approval) {
      booking = await tx.booking.update({ where: { id: approval.moveRequestId }, data: { paymentStatus: PaymentStatus.REFUNDED } }).catch(() => null);
    }
    if (actorId) await logAudit(tx, actorId, 'PAYMENT_REVERSED', booking?.id, { invoiceId: payment.invoiceId });
    return booking;
  });
}
