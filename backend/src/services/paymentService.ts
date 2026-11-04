import { ApprovalSource, BookingStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import type { Booking, PaymentsLedger } from '@prisma/client';
import { prisma } from '../prisma.js';
import { logAudit } from './auditService.js';
import { feeTypeToMoveType, MOVE_TYPE_TO_FEE_TYPE } from './feeClassifier.js';
import { scoreCandidates, selectAutoMatch, ScoredCandidate } from './paymentMatching.js';
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

function unitTail(unit: string): string {
  const parts = unit.split('-');
  return normalizeUnit(parts[parts.length - 1]);
}

/** Unpaid bookings that could be the target of this payment, best first. */
export async function candidateBookingsForPayment(payment: PaymentsLedger): Promise<ScoredCandidate<Booking>[]> {
  const moveType = feeTypeToMoveType(payment.feeType);
  if (!moveType || !payment.unit) return [];
  const tail = unitTail(payment.unit);
  if (!tail) return [];
  const bookings = await prisma.booking.findMany({
    where: {
      moveType,
      status: { in: MATCHABLE },
      paymentStatus: PaymentStatus.NONE,
      OR: [{ unitNorm: normalizeUnit(payment.unit) }, { unitNorm: { endsWith: tail } }],
    },
    take: 50,
  });
  return scoreCandidates(payment.unit, payment.invoiceDate ?? payment.paidAt, bookings, (b) => ({ unit: b.unit, date: b.moveDate }));
}

/** Unmatched paid invoices that could belong to this booking, best first. */
export async function candidatePaymentsForBooking(booking: Pick<Booking, 'unit' | 'moveType' | 'moveDate'>): Promise<ScoredCandidate<PaymentsLedger>[]> {
  const feeType = MOVE_TYPE_TO_FEE_TYPE[booking.moveType];
  if (!feeType) return [];
  const tail = unitTail(booking.unit);
  if (!tail) return [];
  const payments = await prisma.paymentsLedger.findMany({
    where: {
      feeType,
      dismissed: false,
      reversedAt: null,
      moveApprovals: { none: {} },
      unit: { contains: tail, mode: 'insensitive' },
    },
    take: 50,
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
    // Unique violation on invoice_id: another worker matched this payment first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, code: 'PAYMENT_UNAVAILABLE', message: 'Payment was matched concurrently' };
    }
    throw err;
  }
}

/** Auto-match one payment if there is a single clear candidate booking. */
export async function autoMatchPayment(payment: PaymentsLedger): Promise<MatchResult | null> {
  const best = selectAutoMatch(await candidateBookingsForPayment(payment));
  if (!best) return null;
  return applyMatch({ paymentId: payment.id, bookingId: best.item.id, source: 'AUTO', actorId: await getSystemUserId() });
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
