import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, UserRole } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { assertNoConflict } from '../services/conflictService.js';
import { requireRole } from '../middleware/auth.js';

const intakeSchema = z.object({
  residentName: z.string().min(1),
  residentEmail: z.string().email(),
  residentPhone: z.string().min(1),
  unit: z.string().min(1),
  moveType: z.nativeEnum(MoveType),
  moveDate: z.string(),
  startDatetime: z.string(),
  endDatetime: z.string(),
  elevatorRequired: z.boolean(),
  loadingBayRequired: z.boolean(),
  notes: z.string().optional()
});

export async function systemRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
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

    const concierge = await prisma.user.findFirstOrThrow({ where: { role: UserRole.CONCIERGE } });
    const booking = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        { startDatetime: new Date(body.startDatetime), endDatetime: new Date(body.endDatetime), elevatorRequired: body.elevatorRequired },
        false
      );
      return tx.booking.create({
        data: {
          ...body,
          createdById: concierge.id,
          moveDate: new Date(body.moveDate),
          startDatetime: new Date(body.startDatetime),
          endDatetime: new Date(body.endDatetime),
          status: BookingStatus.PENDING
        }
      });
    });

    return booking;
  });

  app.get('/api/admin/bookings/export.csv', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (_, reply) => {
    const rows = await prisma.booking.findMany({ orderBy: { moveDate: 'asc' } });
    const lines = ['id,resident_name,unit,move_type,status,start_datetime,end_datetime'];
    rows.forEach((r) => {
      lines.push(`${r.id},${r.residentName},${r.unit},${r.moveType},${r.status},${r.startDatetime.toISOString()},${r.endDatetime.toISOString()}`);
    });
    reply.header('content-type', 'text/csv');
    return lines.join('\n');
  });
}
