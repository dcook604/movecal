import nodemailer from 'nodemailer';
import { MoveType, NotifyEvent, PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import { decrypt } from '../utils/crypto.js';

// ─── Shared email template helpers ───────────────────────────────────────────

const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  MOVE_IN: 'Move In',
  MOVE_OUT: 'Move Out',
  DELIVERY: 'Delivery',
  RENO: 'Renovation'
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

export function emailWrapper(title: string, intro: string, body: string, footer?: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif">
    <div style="background:#1a1a2e;padding:20px 28px">
      <h1 style="margin:0;color:#fff;font-size:20px">${title}</h1>
    </div>
    <div style="padding:24px 28px">
      <p style="margin-top:0;color:#333">${intro}</p>
      ${body}
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
