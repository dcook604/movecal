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

  // Find a paid ledger record matching unit + fee_type + billing_period
  const payment = await prisma.paymentsLedger.findFirst({
    where: {
      unit,
      feeType,
      billingPeriod,
    },
  });

  if (!payment) return { approved: false };

  // Check no existing approval for this invoice + billing period
  const existing = await prisma.moveApproval.findFirst({
    where: {
      invoiceId: payment.invoiceId,
      billingPeriod,
    },
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
