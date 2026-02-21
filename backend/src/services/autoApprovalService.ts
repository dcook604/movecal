import { BookingStatus, NotifyEvent, UserRole } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '../prisma.js';
import { sendEmail, sendNotificationRecipients, bookingDetailsHtml, emailWrapper } from './emailService.js';
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

      const moveLabel = { MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', DELIVERY: 'Delivery', RENO: 'Renovation' }[booking.moveType] ?? booking.moveType;
      const autoSubject = `Booking Approved — ${moveLabel} on ${dayjs(booking.startDatetime).format('MMM D, YYYY')}`;

      await sendEmail(
        prisma,
        booking.residentEmail,
        autoSubject,
        emailWrapper(
          'Booking Approved',
          'Your booking request has been automatically approved — no action was taken within 24 hours of submission.',
          bookingDetailsHtml(booking)
        )
      ).catch(() => {});

      await sendNotificationRecipients(
        prisma,
        NotifyEvent.APPROVED,
        `Auto-Approved: ${moveLabel} — Unit ${booking.unit} on ${dayjs(booking.startDatetime).format('MMM D, YYYY')}`,
        emailWrapper(
          'Booking Auto-Approved',
          'The following booking was automatically approved after 24 hours with no admin action.',
          bookingDetailsHtml(booking, true)
        )
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
