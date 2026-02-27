import { BookingStatus, MoveType } from '@prisma/client';
import { prisma } from '../prisma.js';

export async function checkAndApproveMoveRequest(params: {
  unit: string;
  feeType: string;
  billingPeriod: string;
  bookingId: string;
}): Promise<{ approved: boolean; invoiceId?: string }> {
  const { unit, feeType, billingPeriod, bookingId } = params;

  if (feeType === 'unknown') return { approved: false };

  // Find an unmatched paid ledger record matching unit + fee_type.
  // Also match prefixed variants like "T4-1105" when the booking unit is "1105".
  // Billing period is intentionally not filtered — invoices may be issued in a
  // different month than the actual move date.
  const payment = await prisma.paymentsLedger.findFirst({
    where: {
      OR: [
        { unit },
        { unit: { endsWith: `-${unit}` } },
      ],
      feeType,
      moveApprovals: { none: {} },
      dismissed: false,
    },
  });

  if (!payment) return { approved: false };

  // Check no existing approval for this invoice
  const existing = await prisma.moveApproval.findFirst({
    where: { invoiceId: payment.invoiceId },
  });

  if (existing) return { approved: false };

  // Verify booking exists and is in an approvable state
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { approved: false };
  if (booking.status !== BookingStatus.SUBMITTED && booking.status !== BookingStatus.PENDING) {
    return { approved: false };
  }

  // Create approval record and update booking in a transaction
  await prisma.$transaction([
    prisma.moveApproval.create({
      data: {
        moveRequestId: bookingId,
        clientId: payment.clientId,
        invoiceId: payment.invoiceId,
        billingPeriod,
      },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.APPROVED,
        approvedAt: new Date(),
      },
    }),
  ]);

  return { approved: true, invoiceId: payment.invoiceId };
}
