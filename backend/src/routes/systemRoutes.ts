import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, UserRole } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { stringify } from 'csv-stringify/sync';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { assertNoConflict } from '../services/conflictService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateMoveTime } from '../utils/moveTimeValidator.js';
import { sendEmail, emailWrapper } from '../services/emailService.js';

const intakeSchema = z.object({
  residentName: z.string().min(1),
  residentEmail: z.string().email(),
  residentPhone: z.string().min(1),
  unit: z.string().min(1),
  moveType: z.nativeEnum(MoveType),
  moveDate: z.coerce.date(),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  elevatorRequired: z.boolean(),
  loadingBayRequired: z.boolean(),
  notes: z.string().optional()
});

function sanitizeCsvValue(value: string) {
  if (value.startsWith('=') || value.startsWith('+') || value.startsWith('-') || value.startsWith('@')) {
    return `'${value}`;
  }
  return value;
}

export async function systemRoutes(app: FastifyInstance) {
  // Login endpoint with strict rate limiting to prevent brute force attacks
  app.post('/api/auth/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes'
      }
    }
  }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const normalizedEmail = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.status(401).send({ message: 'Invalid credentials' });
    }
    const token = await reply.jwtSign({ id: user.id, role: user.role, email: user.email, name: user.name });
    return { token, user: { id: user.id, role: user.role, name: user.name, email: user.email } };
  });

  // Change password endpoint
  app.post('/api/auth/change-password', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Password must be at least 8 characters'),
      confirmPassword: z.string().min(1)
    }).parse(req.body);

    // Verify passwords match
    if (body.newPassword !== body.confirmPassword) {
      return reply.status(400).send({ message: 'New passwords do not match' });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });

    // Verify current password
    const isValidPassword = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!isValidPassword) {
      return reply.status(401).send({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(body.newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash }
    });

    return { message: 'Password changed successfully' };
  });

  // Change email endpoint
  app.post('/api/auth/change-email', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = z.object({
      newEmail: z.string().email(),
      password: z.string().min(1)
    }).parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });

    // Verify password
    const isValidPassword = await bcrypt.compare(body.password, user.passwordHash);
    if (!isValidPassword) {
      return reply.status(401).send({ message: 'Password is incorrect' });
    }

    // Check if email is already in use
    const normalizedEmail = body.newEmail.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser && existingUser.id !== user.id) {
      return reply.status(400).send({ message: 'Email is already in use' });
    }

    // Update email
    await prisma.user.update({
      where: { id: user.id },
      data: { email: normalizedEmail }
    });

    // Generate new token with updated email
    const token = await reply.jwtSign({
      id: user.id,
      role: user.role,
      email: normalizedEmail,
      name: user.name
    });

    return {
      message: 'Email changed successfully',
      token,
      user: { id: user.id, role: user.role, name: user.name, email: normalizedEmail }
    };
  });

  // Forgot password — sends a reset link to the user's email
  app.post('/api/auth/forgot-password', {
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }
  }, async (req, reply) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const normalizedEmail = body.email.trim().toLowerCase();

    // Always return the same message to prevent email enumeration
    const okMsg = { message: 'If an account exists for that email, a reset link has been sent.' };

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return okMsg;

    // Invalidate any existing tokens for this user
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await prisma.passwordResetToken.create({ data: { userId: user.id, token, expiresAt } });

    const origin = (req.headers.origin as string | undefined) ?? config.frontendOrigins?.[0] ?? '';
    const resetLink = `${origin}/admin?reset=${token}`;

    await sendEmail(
      prisma,
      user.email,
      'Password Reset Request — MoveCal',
      emailWrapper(
        'Reset Your Password',
        'You requested a password reset for your MoveCal account. Click the button below to set a new password. This link expires in 1 hour.',
        `<p style="margin:24px 0">
          <a href="${resetLink}" style="background:#1a1a2e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Reset Password
          </a>
        </p>
        <p style="font-size:12px;color:#888">If you did not request this, you can safely ignore this email. Your password will not change.</p>`
      )
    ).catch(() => { /* silently ignore email errors — don't leak user existence */ });

    return okMsg;
  });

  // Reset password using a valid token
  app.post('/api/auth/reset-password', async (req, reply) => {
    const body = z.object({
      token: z.string().min(1),
      password: z.string().min(8, 'Password must be at least 8 characters')
    }).parse(req.body);

    const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: body.token } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return reply.status(400).send({ message: 'Reset link is invalid or has expired.' });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } })
    ]);

    return { message: 'Password reset successfully. You can now log in.' };
  });

  app.post('/api/intake/email', async (req, reply) => {
    const secret = req.headers['x-intake-secret'];
    if (secret !== config.intakeSecret) return reply.status(401).send({ message: 'Invalid secret' });
    const body = intakeSchema.parse(req.body);

    // Validate move time restrictions
    const timeValidation = validateMoveTime(body.startDatetime, body.endDatetime);
    if (!timeValidation.valid) {
      return reply.status(400).send({ message: timeValidation.error });
    }

    const concierge = await prisma.user.findFirstOrThrow({ where: { role: UserRole.CONCIERGE } });
    const booking = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        { startDatetime: body.startDatetime, endDatetime: body.endDatetime, elevatorRequired: body.elevatorRequired },
        false
      );
      return tx.booking.create({
        data: {
          ...body,
          createdById: concierge.id,
          status: BookingStatus.PENDING
        }
      });
    });

    return booking;
  });

  app.get('/api/admin/bookings/export.csv', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (_, reply) => {
    const rows = await prisma.booking.findMany({ orderBy: { moveDate: 'asc' } });
    const csv = stringify(
      rows.map((r) => ({
        id: r.id,
        resident_name: sanitizeCsvValue(r.residentName),
        unit: sanitizeCsvValue(r.unit),
        move_type: r.moveType,
        status: r.status,
        start_datetime: r.startDatetime.toISOString(),
        end_datetime: r.endDatetime.toISOString()
      })),
      { header: true }
    );
    reply.header('content-type', 'text/csv');
    return csv;
  });
}
