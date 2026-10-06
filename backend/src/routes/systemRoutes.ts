import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, UserRole } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { stringify } from 'csv-stringify/sync';
import { prisma } from '../prisma.js';
import { identityFields } from '../utils/identity.js';
import { config } from '../config.js';
import { assertNoConflict, assertNoDuplicateMoveRequest } from '../services/conflictService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateMoveTime } from '../utils/moveTimeValidator.js';
import { sendEmail, emailWrapper } from '../services/emailService.js';
import { BCRYPT_ROUNDS, DUMMY_PASSWORD_HASH, MIN_PASSWORD_LENGTH, safeEqual, sha256Hex, escapeHtml } from '../utils/security.js';

const intakeSchema = z.object({
  residentName: z.string().min(1).max(200),
  residentEmail: z.string().email().max(320),
  residentPhone: z.string().min(1).max(50),
  unit: z.string().min(1).max(20),
  moveType: z.nativeEnum(MoveType),
  moveDate: z.coerce.date(),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  elevatorRequired: z.boolean(),
  loadingBayRequired: z.boolean(),
  notes: z.string().max(2000).optional()
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
    // Always run a bcrypt compare so response time doesn't reveal whether the email exists
    const passwordOk = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      return reply.status(401).send({ message: 'Invalid credentials' });
    }
    const token = await reply.jwtSign({ id: user.id, role: user.role, email: user.email, name: user.name, mustChangePassword: user.mustChangePassword });
    return { token, user: { id: user.id, role: user.role, name: user.name, email: user.email, mustChangePassword: user.mustChangePassword } };
  });

  // Change password endpoint
  app.post('/api/auth/change-password', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
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
    const newPasswordHash = await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS);

    // Update password and clear any forced-change flag
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, mustChangePassword: false, passwordChangedAt: new Date() }
    });

    // Older sessions are now invalid; hand back a fresh token for this one
    const token = await reply.jwtSign({ id: user.id, role: user.role, email: user.email, name: user.name, mustChangePassword: false });
    return { message: 'Password changed successfully', token };
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
      name: user.name,
      mustChangePassword: user.mustChangePassword
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
    // Only a hash is stored so a database leak can't be used to take over accounts
    await prisma.passwordResetToken.create({ data: { userId: user.id, token: sha256Hex(token), expiresAt } });

    const origin = (req.headers.origin as string | undefined) ?? '';
    const allowedOrigin = config.frontendOrigins?.includes(origin) ? origin : config.frontendOrigins?.[0] ?? '';
    const resetLink = `${allowedOrigin}/admin?reset=${token}`;

    await sendEmail(
      prisma,
      user.email,
      'Password Reset Request — MoveCal',
      emailWrapper(
        'Reset Your Password',
        'You requested a password reset for your MoveCal account. Click the button below to set a new password. This link expires in 1 hour.',
        `<p style="margin:24px 0">
          <a href="${escapeHtml(resetLink)}" style="background:#1a1a2e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Reset Password
          </a>
        </p>
        <p style="font-size:12px;color:#888">If you did not request this, you can safely ignore this email. Your password will not change.</p>`
      )
    ).catch(() => { /* silently ignore email errors — don't leak user existence */ });

    return okMsg;
  });

  // Reset password using a valid token
  app.post('/api/auth/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }
  }, async (req, reply) => {
    const body = z.object({
      token: z.string().min(1),
      password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200)
    }).parse(req.body);

    const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: sha256Hex(body.token) } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return reply.status(400).send({ message: 'Reset link is invalid or has expired.' });
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash, passwordChangedAt: new Date() } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } })
    ]);

    return { message: 'Password reset successfully. You can now log in.' };
  });

  app.post('/api/intake/email', async (req, reply) => {
    const secret = req.headers['x-intake-secret'];
    if (typeof secret !== 'string' || !safeEqual(secret, config.intakeSecret)) return reply.status(401).send({ message: 'Invalid secret' });
    const body = intakeSchema.parse(req.body);

    // Validate move time restrictions
    const timeValidation = validateMoveTime(body.startDatetime, body.endDatetime);
    if (!timeValidation.valid) {
      return reply.status(400).send({ message: timeValidation.error });
    }

    const concierge = await prisma.user.findFirstOrThrow({ where: { role: UserRole.CONCIERGE } });
    const booking = await prisma.$transaction(async (tx) => {
      await assertNoDuplicateMoveRequest(tx, { unit: body.unit, moveDate: body.moveDate, moveType: body.moveType, staff: true });
      await assertNoConflict(
        tx,
        { startDatetime: body.startDatetime, endDatetime: body.endDatetime, elevatorRequired: body.elevatorRequired },
        false
      );
      return tx.booking.create({
        data: {
          ...body,
          ...identityFields(body),
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
