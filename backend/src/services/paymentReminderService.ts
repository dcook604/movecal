import { BookingStatus, UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import { sendPaymentReminderEmail } from './emailService.js';
import { logAudit } from './auditService.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export async function runPaymentReminders() {
  const settings = await prisma.appSetting.findFirst();
  if (!settings?.unpaidPaymentReminderEnabled) return;

  const systemUser = await prisma.user.findFirst({ where: { role: UserRole.CONCIERGE } });
  if (!systemUser) return;

  // Collect booking IDs that already have a matched payment
  const paidIds = new Set(
    (await prisma.moveApproval.findMany({ select: { moveRequestId: true } }))
      .map(a => a.moveRequestId)
  );

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: [BookingStatus.SUBMITTED, BookingStatus.PENDING] },
      moveDate: { gte: today },
      OR: [
        { lastPaymentReminderSentAt: null },
        { lastPaymentReminderSentAt: { lte: cutoff } },
      ],
    },
  });

  for (const booking of bookings.filter(b => !paidIds.has(b.id))) {
    try {
      await sendPaymentReminderEmail(prisma, booking);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { lastPaymentReminderSentAt: new Date() },
      });
      await logAudit(prisma, systemUser.id, 'PAYMENT_REMINDER_SENT', booking.id);
    } catch {
      // continue processing remaining bookings
    }
  }
}

export function startPaymentReminderJob() {
  setTimeout(() => {
    runPaymentReminders().catch(() => {});
    setInterval(() => runPaymentReminders().catch(() => {}), CHECK_INTERVAL_MS);
  }, 15_000);
}
