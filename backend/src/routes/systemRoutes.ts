import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, UserRole } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { stringify } from 'csv-stringify/sync';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { assertNoConflict } from '../services/conflictService.js';
import { requireRole } from '../middleware/auth.js';
import { validateMoveTime } from '../utils/moveTimeValidator.js';

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
