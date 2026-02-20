import { FastifyInstance } from 'fastify';
import { BookingStatus, NotifyEvent, UserRole } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { requireRole } from '../middleware/auth.js';
import { encrypt } from '../utils/crypto.js';
import { sendEmail } from '../services/emailService.js';
import { logAudit } from '../services/auditService.js';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/stats', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [total, approved, pending, thisMonth] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.count({ where: { status: BookingStatus.APPROVED } }),
      prisma.booking.count({ where: { status: { in: [BookingStatus.PENDING, BookingStatus.SUBMITTED] } } }),
      prisma.booking.count({ where: { moveDate: { gte: monthStart } } }),
    ]);
    return { totalBookings: total, approvedBookings: approved, pendingBookings: pending, bookingsThisMonth: thisMonth };
  });

  app.get('/api/admin/settings', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => {
    const s = await prisma.appSetting.findFirst();
    return { ...s, smtpPasswordEncrypted: undefined };
  });

  app.put('/api/admin/settings', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const body = z
      .object({
        smtpHost: z.string().nullable(),
        smtpPort: z.union([z.coerce.number().int().positive(), z.null()]),
        smtpSecure: z.boolean(),
        smtpUsername: z.string().nullable(),
        smtpPassword: z.string().optional(),
        fromName: z.string().nullable(),
        fromEmail: z.string().nullable(),
        includeResidentContactInApprovalEmails: z.boolean(),
        reminderEnabled: z.boolean()
      })
      .parse(req.body);
    const existing = await prisma.appSetting.findFirst();
    const { smtpPassword, ...restBody } = body;
    const updatedData = { ...restBody, smtpPasswordEncrypted: smtpPassword ? encrypt(smtpPassword) : undefined };
    const updated = existing
      ? await prisma.appSetting.update({ where: { id: existing.id }, data: updatedData })
      : await prisma.appSetting.create({ data: updatedData });
    await logAudit(prisma, req.user.id, 'SETTINGS_UPDATED', undefined, { smtpHost: body.smtpHost, fromEmail: body.fromEmail });
    return { ...updated, smtpPasswordEncrypted: undefined };
  });

  app.post('/api/admin/settings/test-email', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = z.object({ to: z.string().email() }).parse(req.body);
    try {
      await sendEmail(prisma, body.to, 'MoveCal SMTP Test', '<p>SMTP settings are working.</p>');
      return { ok: true };
    } catch (error) {
      req.log.error(error);
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

  // User Management Routes (only for COUNCIL and PROPERTY_MANAGER)

  // Get all users
  app.get('/api/admin/users', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return users;
  });

  // Create new user
  app.post('/api/admin/users', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1).max(200),
      email: z.string().email().max(320),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      role: z.nativeEnum(UserRole)
    }).parse(req.body);

    const normalizedEmail = body.email.trim().toLowerCase();

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return reply.status(400).send({ message: 'Email already in use' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(body.password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: normalizedEmail,
        passwordHash,
        role: body.role
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    });

    await logAudit(prisma, req.user.id, 'USER_CREATED', undefined, {
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return user;
  });

  // Update user
  app.patch('/api/admin/users/:id', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const userId = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      email: z.string().email().max(320).optional(),
      role: z.nativeEnum(UserRole).optional(),
      password: z.string().min(8).optional()
    }).parse(req.body);

    // Prevent users from modifying themselves to avoid lockout
    if (userId === req.user.id) {
      return reply.status(400).send({
        message: 'Cannot modify your own account from user management. Use Account Settings instead.'
      });
    }

    const updateData: any = {};

    if (body.name) updateData.name = body.name;
    if (body.role) updateData.role = body.role;

    if (body.email) {
      const normalizedEmail = body.email.trim().toLowerCase();
      // Check if email is already in use by another user
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser && existingUser.id !== userId) {
        return reply.status(400).send({ message: 'Email already in use' });
      }
      updateData.email = normalizedEmail;
    }

    if (body.password) {
      updateData.passwordHash = await bcrypt.hash(body.password, 10);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    });

    await logAudit(prisma, req.user.id, 'USER_UPDATED', undefined, {
      userId: user.id,
      changes: Object.keys(updateData)
    });

    return user;
  });

  // Delete user
  app.delete('/api/admin/users/:id', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const userId = z.string().uuid().parse((req.params as { id: string }).id);

    // Prevent users from deleting themselves
    if (userId === req.user.id) {
      return reply.status(400).send({ message: 'Cannot delete your own account' });
    }

    // Get user before deletion for audit log
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true }
    });

    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    await prisma.user.delete({ where: { id: userId } });

    await logAudit(prisma, req.user.id, 'USER_DELETED', undefined, {
      userId,
      email: user.email,
      role: user.role
    });

    return { ok: true, message: 'User deleted successfully' };
  });
}
