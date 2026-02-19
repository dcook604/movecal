import { FastifyInstance } from 'fastify';
import { NotifyEvent, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { requireRole } from '../middleware/auth.js';
import { encrypt } from '../utils/crypto.js';
import { sendEmail } from '../services/emailService.js';
import { logAudit } from '../services/auditService.js';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/stats', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => {
    const now = new Date();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [upcoming, pending, monthly] = await Promise.all([
      prisma.booking.count({ where: { startDatetime: { gte: now, lte: in30 } } }),
      prisma.booking.count({ where: { status: 'PENDING' } }),
      prisma.booking.count({ where: { moveDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } })
    ]);
    return { upcoming30Days: upcoming, pendingApprovals: pending, monthlyStats: monthly };
  });

  app.get('/api/admin/settings', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => {
    const s = await prisma.appSetting.findFirst();
    return { ...s, smtpPasswordEncrypted: undefined };
  });

  app.put('/api/admin/settings', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const body = z.object({ smtpHost: z.string().nullable(), smtpPort: z.number().nullable(), smtpSecure: z.boolean(), smtpUsername: z.string().nullable(), smtpPassword: z.string().optional(), fromName: z.string().nullable(), fromEmail: z.string().nullable(), includeResidentContactInApprovalEmails: z.boolean(), reminderEnabled: z.boolean() }).parse(req.body);
    const existing = await prisma.appSetting.findFirst();
    const updated = existing
      ? await prisma.appSetting.update({ where: { id: existing.id }, data: { ...body, smtpPasswordEncrypted: body.smtpPassword ? encrypt(body.smtpPassword) : undefined } })
      : await prisma.appSetting.create({ data: { ...body, smtpPasswordEncrypted: body.smtpPassword ? encrypt(body.smtpPassword) : undefined } });
    await logAudit(prisma, req.user.id, 'SETTINGS_UPDATED', undefined, { smtpHost: body.smtpHost, fromEmail: body.fromEmail });
    return { ...updated, smtpPasswordEncrypted: undefined };
  });

  app.post('/api/admin/settings/test-email', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = z.object({ to: z.string().email() }).parse(req.body);
    try {
      await sendEmail(prisma, body.to, 'MoveCal SMTP Test', '<p>SMTP settings are working.</p>');
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ ok: false, message: 'SMTP test failed' });
    }
  });

  app.get('/api/admin/recipients', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => prisma.notificationRecipient.findMany());
  app.post('/api/admin/recipients', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const body = z.object({ name: z.string().optional(), email: z.string().email(), enabled: z.boolean().default(true), notifyOn: z.array(z.nativeEnum(NotifyEvent)) }).parse(req.body);
    const r = await prisma.notificationRecipient.create({ data: body });
    await logAudit(prisma, req.user.id, 'RECIPIENT_CREATED', undefined, { recipientId: r.id });
    return r;
  });
  app.patch('/api/admin/recipients/:id', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const body = z.object({ name: z.string().optional(), email: z.string().email().optional(), enabled: z.boolean().optional(), notifyOn: z.array(z.nativeEnum(NotifyEvent)).optional() }).parse(req.body);
    const r = await prisma.notificationRecipient.update({ where: { id: (req.params as any).id }, data: body });
    await logAudit(prisma, req.user.id, 'RECIPIENT_UPDATED', undefined, { recipientId: r.id });
    return r;
  });
  app.delete('/api/admin/recipients/:id', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const id = (req.params as any).id;
    await prisma.notificationRecipient.delete({ where: { id } });
    await logAudit(prisma, req.user.id, 'RECIPIENT_DELETED', undefined, { recipientId: id });
    return { ok: true };
  });
}
