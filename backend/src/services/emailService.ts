import nodemailer from 'nodemailer';
import { MoveType, NotifyEvent, PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import { decrypt } from '../utils/crypto.js';

// ─── Shared email template helpers ───────────────────────────────────────────

const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  MOVE_IN: 'Move In',
  MOVE_OUT: 'Move Out',
  FURNISHED_MOVE: 'Furnished Move',
  DELIVERY: 'Delivery',
  RENO: 'Renovation',
  OPEN_HOUSE: 'Open House',
  SUITCASE_MOVE: 'Suitcase Move',
};

type BookingEmailData = {
  id: string;
  residentName: string;
  residentEmail: string;
  residentPhone: string;
  unit: string;
  moveType: MoveType;
  companyName?: string | null;
  startDatetime: Date;
  endDatetime: Date;
  elevatorRequired: boolean;
  loadingBayRequired: boolean;
  notes?: string | null;
};

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:6px 0;color:#111;font-weight:600">${value}</td>
  </tr>`;
}

export function bookingDetailsHtml(b: BookingEmailData, includeContact = false, paymentConfirmed = false): string {
  const moveLabel = MOVE_TYPE_LABELS[b.moveType] ?? b.moveType;
  const dateStr = dayjs(b.startDatetime).format('dddd, MMMM D, YYYY');
  const timeStr = `${dayjs(b.startDatetime).format('h:mm A')} – ${dayjs(b.endDatetime).format('h:mm A')}`;

  const rows = [
    row('Resident', b.residentName),
    row('Unit', b.unit),
    row('Type', moveLabel),
    row('Date', dateStr),
    row('Time', timeStr),
    row('Elevator', b.elevatorRequired ? 'Yes' : 'No'),
    row('Loading Bay', b.loadingBayRequired ? 'Yes' : 'No'),
    ...(b.companyName ? [row('Company', b.companyName)] : []),
    ...(b.notes ? [row('Notes', b.notes)] : []),
    ...(includeContact ? [row('Email', b.residentEmail), row('Phone', b.residentPhone)] : []),
    ...(paymentConfirmed ? [row('Payment', '<span style="color:#166534;font-weight:700">✓ Move fee confirmed paid</span>')] : [])
  ];

  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
    ${rows.join('\n')}
  </table>
  <p style="font-size:12px;color:#888;margin-top:16px">Reference: ${b.id}</p>`;
}

export function emailWrapper(title: string, intro: string, body: string, footer?: string, manageUrl?: string): string {
  const manageButton = manageUrl
    ? `<p style="margin:24px 0;text-align:center">
        <a href="${manageUrl}" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
          View / Manage Booking
        </a>
       </p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif">
    <div style="background:#1a1a2e;padding:20px 28px">
      <h1 style="margin:0;color:#fff;font-size:20px">${title}</h1>
    </div>
    <div style="padding:24px 28px">
      <p style="margin-top:0;color:#333">${intro}</p>
      ${body}
      ${manageButton}
      ${footer ? `<p style="color:#555;margin-top:24px;font-size:14px">${footer}</p>` : ''}
    </div>
  </div>
  </body></html>`;
}

async function getTransport(prisma: PrismaClient) {
  const settings = await prisma.appSetting.findFirst();
  if (!settings?.smtpHost || !settings.smtpPort || !settings.fromEmail) {
    throw new Error('SMTP settings are incomplete');
  }

  return {
    transport: nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      auth: settings.smtpUsername ? { user: settings.smtpUsername, pass: decrypt(settings.smtpPasswordEncrypted) } : undefined
    }),
    from: `${settings.fromName ?? 'MoveCal'} <${settings.fromEmail}>`,
    settings
  };
}

export async function sendEmail(prisma: PrismaClient, to: string | string[], subject: string, html: string) {
  const { transport, from } = await getTransport(prisma);
  await transport.sendMail({ from, to, subject, html });
}

export async function sendNotificationRecipients(prisma: PrismaClient, event: NotifyEvent, subject: string, html: string) {
  const recipients = await prisma.notificationRecipient.findMany({ where: { enabled: true, notifyOn: { has: event } } });
  if (recipients.length === 0) return;
  await sendEmail(prisma, recipients.map((r) => r.email), subject, html);
}

export async function sendPaymentReminderEmail(prisma: PrismaClient, booking: BookingEmailData, manageUrl?: string) {
  await sendEmail(
    prisma,
    booking.residentEmail,
    'Action Required: Payment Needed for Your Move Booking',
    emailWrapper(
      'Payment Reminder',
      'Your move booking has not been confirmed because a payment has not been received. Please arrange payment as soon as possible — your booking will remain unconfirmed until payment is verified.',
      bookingDetailsHtml(booking),
      'You will receive this reminder every 24 hours until payment is confirmed.',
      manageUrl
    )
  );
}

export async function sendEarlyPaymentWarningEmail(prisma: PrismaClient, booking: BookingEmailData, manageUrl?: string) {
  const moveLabel = MOVE_TYPE_LABELS[booking.moveType] ?? booking.moveType;
  const dateLabel = dayjs(booking.startDatetime).format('MMM D, YYYY');
  await sendEmail(
    prisma,
    booking.residentEmail,
    `Action Required: Payment Not Yet Received — ${moveLabel} on ${dateLabel}`,
    emailWrapper(
      'Payment Required to Confirm Your Booking',
      'Your booking request has been received, but we have not yet received a payment. <strong>If payment is not received, your booking may be cancelled.</strong> Please arrange payment as soon as possible.',
      bookingDetailsHtml(booking),
      'If you have already submitted payment, please disregard this message — confirmation may take a short time to process.',
      manageUrl
    )
  );
}

const DCOOK_EMAIL = 'dcook@spectrum4.ca';

export async function sendPaymentConfirmationToDcook(prisma: PrismaClient, booking: BookingEmailData) {
  const moveLabel = MOVE_TYPE_LABELS[booking.moveType] ?? booking.moveType;
  const dateLabel = dayjs(booking.startDatetime).format('MMM D, YYYY');
  await sendEmail(
    prisma,
    DCOOK_EMAIL,
    `Payment Confirmed — ${moveLabel} for Unit ${booking.unit} on ${dateLabel}`,
    emailWrapper(
      'Payment Confirmed — Booking Approved',
      `Payment has been received and the following booking has been confirmed. The resident (<strong>${booking.residentEmail}</strong>) has been notified of their approval.`,
      bookingDetailsHtml(booking, true, true)
    )
  );
}
