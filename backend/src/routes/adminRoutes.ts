import { FastifyInstance } from 'fastify';
import { BookingStatus, NotifyEvent, UserRole } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { requireRole } from '../middleware/auth.js';
import { encrypt } from '../utils/crypto.js';
import { sendEmail } from '../services/emailService.js';
import { logAudit } from '../services/auditService.js';
import { checkAndApproveMoveRequest } from '../services/moveApprovalService.js';

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
        reminderEnabled: z.boolean(),
        invoiceNinjaEnabled: z.boolean()
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

  // Payments Ledger — retry matching all unmatched payments (includes already-approved bookings)
  app.post('/api/admin/payments-ledger/retry-match', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async () => {
    const { MoveType, BookingStatus } = await import('@prisma/client');

    const unmatched = await prisma.paymentsLedger.findMany({
      where: { moveApprovals: { none: {} }, dismissed: false, feeType: { not: 'unknown' }, unit: { not: null } },
    });

    let matchedCount = 0;

    for (const payment of unmatched) {
      const unit = payment.unit!;
      const unitVariants = [unit];
      if (unit.includes('-')) unitVariants.push(unit.split('-').pop()!);

      const moveTypeFilter = payment.feeType === 'move_in' ? MoveType.MOVE_IN : MoveType.MOVE_OUT;

      const booking = await prisma.booking.findFirst({
        where: {
          unit: { in: unitVariants },
          moveType: moveTypeFilter,
          status: { in: [BookingStatus.SUBMITTED, BookingStatus.PENDING, BookingStatus.APPROVED] },
        },
      });

      if (!booking) continue;

      const existing = await prisma.moveApproval.findFirst({ where: { invoiceId: payment.invoiceId } });
      if (existing) continue;

      await prisma.moveApproval.create({
        data: {
          moveRequestId: booking.id,
          clientId: payment.clientId,
          invoiceId: payment.invoiceId,
          billingPeriod: payment.billingPeriod,
        },
      });

      if (booking.status !== BookingStatus.APPROVED) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.APPROVED, approvedAt: new Date() },
        });
      }

      matchedCount++;
    }

    return { matched: matchedCount };
  });

  // Payments Ledger
  app.get('/api/admin/payments-ledger', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const { month } = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);

    // Default to current month if not provided
    const now = new Date();
    const activeMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [matched, unmatched, dismissed] = await Promise.all([
      prisma.paymentsLedger.findMany({
        where: { moveApprovals: { some: {} }, billingPeriod: activeMonth },
        include: { moveApprovals: true },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.paymentsLedger.findMany({
        where: { moveApprovals: { none: {} }, dismissed: false },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.paymentsLedger.findMany({
        where: { dismissed: true },
        orderBy: { dismissedAt: 'desc' },
      }),
    ]);
    return { unmatched, matched, dismissed, month: activeMonth };
  });

  app.patch('/api/admin/payments-ledger/:id/dismiss', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const { reason } = z.object({ reason: z.string().min(1, 'Reason is required') }).parse(req.body);

    const payment = await prisma.paymentsLedger.findUnique({ where: { id } });
    if (!payment) return reply.status(404).send({ message: 'Payment not found' });

    const updated = await prisma.paymentsLedger.update({
      where: { id },
      data: { dismissed: true, dismissedReason: reason, dismissedAt: new Date() },
    });
    return { payment: updated };
  });

  app.patch('/api/admin/payments-ledger/:id/restore', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);

    const payment = await prisma.paymentsLedger.findUnique({ where: { id } });
    if (!payment) return reply.status(404).send({ message: 'Payment not found' });

    const updated = await prisma.paymentsLedger.update({
      where: { id },
      data: { dismissed: false, dismissedReason: null, dismissedAt: null },
    });
    return { payment: updated };
  });

  app.patch('/api/admin/payments-ledger/:id/fee-type', { preHandler: [requireRole([UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const { feeType } = z.object({ feeType: z.enum(['move_in', 'move_out']) }).parse(req.body);

    const payment = await prisma.paymentsLedger.findUnique({ where: { id } });
    if (!payment) return reply.status(404).send({ message: 'Payment not found' });

    const updated = await prisma.paymentsLedger.update({ where: { id }, data: { feeType } });

    let approvalResult: { approved: boolean; invoiceId?: string } = { approved: false };

    if (updated.unit) {
      const { BookingStatus, MoveType } = await import('@prisma/client');
      const moveTypeFilter = feeType === 'move_in' ? MoveType.MOVE_IN : MoveType.MOVE_OUT;

      const unitVariants = [updated.unit];
      if (updated.unit.includes('-')) unitVariants.push(updated.unit.split('-').pop()!);

      const matchingBooking = await prisma.booking.findFirst({
        where: {
          unit: { in: unitVariants },
          moveType: moveTypeFilter,
          status: { in: [BookingStatus.SUBMITTED, BookingStatus.PENDING] },
        },
      });

      if (matchingBooking) {
        approvalResult = await checkAndApproveMoveRequest({
          unit: updated.unit,
          feeType,
          billingPeriod: updated.billingPeriod,
          bookingId: matchingBooking.id,
        });
      }
    }

    return { payment: updated, approved: approvalResult.approved };
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

    // Prevent deleting the last CONCIERGE — it is used as the system user for public bookings
    if (user.role === UserRole.CONCIERGE) {
      const conciergeCount = await prisma.user.count({ where: { role: UserRole.CONCIERGE } });
      if (conciergeCount <= 1) {
        return reply.status(400).send({ message: 'Cannot delete the last concierge account — it is required for the system.' });
      }
    }

    // Before deleting, re-home any FK references to this user.
    // bookings.created_by and audit_log.actor_user_id are NOT NULL, so reassign them
    // to the system concierge. bookings.approved_by is nullable so null it out.
    const systemUser = await prisma.user.findFirst({
      where: { role: UserRole.CONCIERGE, id: { not: userId } }
    });
    if (!systemUser) {
      return reply.status(400).send({ message: 'No fallback concierge account found — cannot safely delete this user.' });
    }

    await prisma.$transaction([
      prisma.booking.updateMany({
        where: { createdById: userId },
        data: { createdById: systemUser.id }
      }),
      prisma.booking.updateMany({
        where: { approvedById: userId },
        data: { approvedById: null }
      }),
      prisma.auditLog.updateMany({
        where: { actorUserId: userId },
        data: { actorUserId: systemUser.id }
      }),
      prisma.user.delete({ where: { id: userId } })
    ]);

    await logAudit(prisma, req.user.id, 'USER_DELETED', undefined, {
      userId,
      email: user.email,
      role: user.role
    });

    return { ok: true, message: 'User deleted successfully' };
  });
}
