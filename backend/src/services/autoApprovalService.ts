import { BookingStatus, NotifyEvent, UserRole } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../prisma.js';
import { sendEmail, sendNotificationRecipients } from './emailService.js';
import { logAudit } from './auditService.js';

const AUTO_APPROVE_HOURS = 24;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export async function runAutoApproval() {
  const cutoff = dayjs().subtract(AUTO_APPROVE_HOURS, 'hour').toDate();

  const systemUser = await prisma.user.findFirst({ where: { role: UserRole.CONCIERGE } });
  if (!systemUser) return;

  const pending = await prisma.booking.findMany({
    where: {
      status: BookingStatus.SUBMITTED,
      createdAt: { lt: cutoff }
    }
  });

  for (const booking of pending) {
    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.APPROVED,
          approvedById: systemUser.id,
          approvedAt: new Date()
        }
      });

      const details = `${booking.residentName} (${booking.unit}) ${dayjs(booking.startDatetime).format('MMM D h:mm A')} – ${dayjs(booking.endDatetime).format('h:mm A')}`;
      await sendEmail(
        prisma,
        booking.residentEmail,
        'Booking request approved',
        `<p>Your booking request has been automatically approved.</p><p>${details}</p>`
      ).catch(() => {});

      await sendNotificationRecipients(
        prisma,
        NotifyEvent.APPROVED,
        'Booking auto-approved',
        `<p>${details} — auto-approved after 24h.</p>`
      ).catch(() => {});

      await logAudit(prisma, systemUser.id, 'BOOKING_AUTO_APPROVED', booking.id, { reason: '24h_no_action' });
    } catch {
      // continue processing remaining bookings
    }
  }
}

export function startAutoApprovalJob() {
  // Initial run shortly after startup
  setTimeout(() => runAutoApproval().catch(() => {}), 15_000);
  // Recurring check every 5 minutes
  setInterval(() => runAutoApproval().catch(() => {}), CHECK_INTERVAL_MS);
}
