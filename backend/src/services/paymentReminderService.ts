import { BookingStatus, MoveType, UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import { sendPaymentReminderEmail, sendEarlyPaymentWarningEmail } from './emailService.js';
import { logAudit } from './auditService.js';
import { config } from '../config.js';

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

  const unpaidBookings = bookings.filter(b => !paidIds.has(b.id));

  // 30-minute early warning: MOVE_IN, MOVE_OUT, DELIVERY bookings with no payment after 30 min
  const earlyWarningTypes = new Set<MoveType>([MoveType.MOVE_IN, MoveType.MOVE_OUT, MoveType.DELIVERY]);
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  for (const booking of unpaidBookings) {
    if (!earlyWarningTypes.has(booking.moveType)) continue;
    if (booking.earlyPaymentReminderSentAt !== null) continue;
    if (booking.createdAt > thirtyMinutesAgo) continue;

    try {
      const manageUrl = booking.editToken ? `${config.frontendOrigins[0]}/booking/${booking.id}?token=${booking.editToken}` : undefined;
      await sendEarlyPaymentWarningEmail(prisma, booking, manageUrl);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { earlyPaymentReminderSentAt: new Date() },
      });
    } catch {
      // continue processing remaining bookings
    }
  }

  for (const booking of unpaidBookings) {
    try {
      const manageUrl = booking.editToken ? `${config.frontendOrigins[0]}/booking/${booking.id}?token=${booking.editToken}` : undefined;
      await sendPaymentReminderEmail(prisma, booking, manageUrl);
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
