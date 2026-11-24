import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { sendPaymentConfirmation } from '../services/emailService.js';
import { FEE_TYPES } from '../services/feeClassifier.js';
import { applyMatch, autoMatchPayment, candidateBookingsForPayments, retryUnmatchedPayments, unmatchPayment, MatchResult } from '../services/paymentService.js';

const MANAGERS = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
const idParam = z.string().uuid();

export async function paymentRoutes(app: FastifyInstance) {
  async function notifyIfApproved(result: MatchResult | null) {
    if (result?.ok && result.transitioned) {
      await sendPaymentConfirmation(prisma, result.booking).catch((err) => {
        app.log.error({ err, bookingId: result.booking.id }, 'Failed to send payment confirmation');
      });
    }
  }

  app.get('/api/admin/payments-ledger', { preHandler: [requireRole(MANAGERS)] }, async (req) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const now = new Date();
    const activeMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = activeMonth.split('-').map(Number);

    // A payment belongs to a month if it was invoiced in it OR the move it paid for happens in it.
    const movesInMonth = await prisma.booking.findMany({
      where: { moveDate: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
      select: { id: true },
    });

    const [matchedRaw, unmatchedRaw, dismissed, reversed] = await Promise.all([
      prisma.paymentsLedger.findMany({
        where: {
          moveApprovals: { some: {} },
          OR: [{ billingPeriod: activeMonth }, { moveApprovals: { some: { moveRequestId: { in: movesInMonth.map((b) => b.id) } } } }],
        },
        include: { moveApprovals: true },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.paymentsLedger.findMany({
        where: { moveApprovals: { none: {} }, dismissed: false, reversedAt: null },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.paymentsLedger.findMany({ where: { dismissed: true }, orderBy: { dismissedAt: 'desc' } }),
      prisma.paymentsLedger.findMany({ where: { reversedAt: { not: null } }, orderBy: { reversedAt: 'desc' }, take: 50 }),
    ]);

    const bookingIds = matchedRaw.flatMap((p) => p.moveApprovals.map((a) => a.moveRequestId));
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, unit: true, residentName: true, moveType: true, moveDate: true, status: true, approvalSource: true, paymentStatus: true },
    });
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const matched = matchedRaw.map((p) => ({ ...p, booking: bookingById.get(p.moveApprovals[0]?.moveRequestId) ?? null }));

    // One query for all unpaid bookings instead of one per unmatched payment.
    const suggestionsByPayment = await candidateBookingsForPayments(unmatchedRaw);
    const unmatched = unmatchedRaw.map((p) => ({
      ...p,
      suggestions: (suggestionsByPayment.get(p.id) ?? []).slice(0, 3).map((c) => ({
        bookingId: c.item.id,
        unit: c.item.unit,
        residentName: c.item.residentName,
        moveType: c.item.moveType,
        moveDate: c.item.moveDate,
        status: c.item.status,
        score: c.score,
        unitMatch: c.unitMatch,
        days: c.days,
      })),
    }));

    return { unmatched, matched, dismissed, reversed, month: activeMonth };
  });

  app.patch('/api/admin/payments-ledger/:id/dismiss', { preHandler: [requireRole(MANAGERS)] }, async (req, reply) => {
    const id = idParam.parse((req.params as { id: string }).id);
    const { reason } = z.object({ reason: z.string().trim().min(1, 'Reason is required') }).parse(req.body);
    const payment = await prisma.paymentsLedger.findUnique({ where: { id }, include: { moveApprovals: true } });
    if (!payment) return reply.status(404).send({ message: 'Payment not found' });
    if (payment.moveApprovals.length) return reply.status(409).send({ message: 'Payment is matched to a booking — unmatch it first' });
    const updated = await prisma.paymentsLedger.update({ where: { id }, data: { dismissed: true, dismissedReason: reason, dismissedAt: new Date() } });
    await logAudit(prisma, req.user.id, 'PAYMENT_DISMISSED', undefined, { invoiceId: payment.invoiceId, reason });
    return { payment: updated };
  });

  app.patch('/api/admin/payments-ledger/:id/restore', { preHandler: [requireRole(MANAGERS)] }, async (req, reply) => {
    const id = idParam.parse((req.params as { id: string }).id);
    const payment = await prisma.paymentsLedger.findUnique({ where: { id } });
    if (!payment) return reply.status(404).send({ message: 'Payment not found' });
    const updated = await prisma.paymentsLedger.update({ where: { id }, data: { dismissed: false, dismissedReason: null, dismissedAt: null } });
    await logAudit(prisma, req.user.id, 'PAYMENT_RESTORED', undefined, { invoiceId: payment.invoiceId });
    return { payment: updated };
  });

  app.patch('/api/admin/payments-ledger/:id/fee-type', { preHandler: [requireRole(MANAGERS)] }, async (req, reply) => {
    const id = idParam.parse((req.params as { id: string }).id);
    const { feeType } = z.object({ feeType: z.enum(FEE_TYPES as [string, ...string[]]) }).parse(req.body);
    const payment = await prisma.paymentsLedger.findUnique({ where: { id }, include: { moveApprovals: true } });
    if (!payment) return reply.status(404).send({ message: 'Payment not found' });
    if (payment.moveApprovals.length) return reply.status(409).send({ message: 'Payment is matched to a booking — unmatch it first' });

    const updated = await prisma.paymentsLedger.update({ where: { id }, data: { feeType } });
    await logAudit(prisma, req.user.id, 'PAYMENT_FEE_TYPE_CHANGED', undefined, { invoiceId: payment.invoiceId, from: payment.feeType, to: feeType });

    const result = updated.unit ? await autoMatchPayment(updated) : null;
    await notifyIfApproved(result);
    return { payment: updated, approved: !!(result?.ok && result.transitioned), matched: !!result?.ok };
  });

  // Re-run automatic matching over everything still unmatched.
  app.post('/api/admin/payments-ledger/retry-match', { preHandler: [requireRole(MANAGERS)] }, async (req) => {
    const { checked, matched, matches } = await retryUnmatchedPayments(app.log);
    for (const { result } of matches) await notifyIfApproved(result);
    await logAudit(prisma, req.user.id, 'PAYMENTS_RETRY_MATCH', undefined, { checked, matched });
    return { matched, checked };
  });

  // Search bookings for manual payment matching
  app.get('/api/admin/payments-ledger/bookings-search', { preHandler: [requireRole(MANAGERS)] }, async (req) => {
    const { unit } = z.object({ unit: z.string().optional() }).parse(req.query);
    const where = unit
      ? { OR: [{ unit: { contains: unit, mode: 'insensitive' as const } }, { unit: { endsWith: `-${unit}` } }] }
      : {};
    const bookings = await prisma.booking.findMany({ where, orderBy: { moveDate: 'desc' }, take: 50 });
    const approvals = await prisma.moveApproval.findMany({ where: { moveRequestId: { in: bookings.map((b) => b.id) } } });
    const approvalByBooking = new Map(approvals.map((a) => [a.moveRequestId, a]));
    return bookings.map((b) => ({
      ...b,
      paymentMatched: approvalByBooking.has(b.id),
      paymentInvoiceId: approvalByBooking.get(b.id)?.invoiceId ?? null,
    }));
  });

  app.post('/api/admin/payments-ledger/:id/manual-match', { preHandler: [requireRole(MANAGERS)] }, async (req, reply) => {
    const id = idParam.parse((req.params as { id: string }).id);
    const { bookingId } = z.object({ bookingId: z.string().uuid() }).parse(req.body);
    const result = await applyMatch({ paymentId: id, bookingId, source: 'MANUAL', actorId: req.user.id });
    if (!result.ok) {
      const status = result.code === 'PAYMENT_NOT_FOUND' || result.code === 'BOOKING_NOT_FOUND' ? 404 : 409;
      return reply.status(status).send({ message: result.message });
    }
    await notifyIfApproved(result);
    return { ok: true, approved: result.transitioned };
  });

  // Undo a match made in error.
  app.post('/api/admin/payments-ledger/:id/unmatch', { preHandler: [requireRole(MANAGERS)] }, async (req, reply) => {
    const id = idParam.parse((req.params as { id: string }).id);
    const result = await unmatchPayment(id, req.user.id);
    if (!result.ok) return reply.status(409).send({ message: result.message });
    return { ok: true };
  });
}
