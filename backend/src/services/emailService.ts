import nodemailer from 'nodemailer';
import { NotifyEvent, PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/crypto.js';

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
