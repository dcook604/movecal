import { FastifyInstance } from 'fastify';
import { BookingStatus, MoveType, NotifyEvent, UserRole } from '@prisma/client';
import dayjs from 'dayjs';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { prisma } from '../prisma.js';
import { assertNoConflict } from '../services/conflictService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendEmail, sendNotificationRecipients } from '../services/emailService.js';
import { logAudit } from '../services/auditService.js';
import { config } from '../config.js';
import { validateMoveTime } from '../utils/moveTimeValidator.js';

const createSchema = z.object({
  residentName: z.string().min(1).max(200),
  residentEmail: z.string().email().max(320), // RFC 5321 max email length
  residentPhone: z.string().min(1).max(50),
  unit: z.string().min(1).max(20),
  moveType: z.nativeEnum(MoveType),
  companyName: z.string().max(200).optional(),
  moveDate: z.coerce.date(),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  elevatorRequired: z.boolean(),
  loadingBayRequired: z.boolean(),
  notes: z.string().max(2000).optional(),
  publicUnitMask: z.string().max(20).optional()
});

// UUID validation schema for ID parameters
const uuidSchema = z.string().uuid();

export async function bookingRoutes(app: FastifyInstance) {
  app.post('/api/bookings', async (req, reply) => {
    const body = createSchema.parse(req.body);

    // Validate move time restrictions
    const timeValidation = validateMoveTime(body.startDatetime, body.endDatetime, body.moveType);
    if (!timeValidation.valid) {
      return reply.status(400).send({ message: timeValidation.error });
    }

    const systemUser = await prisma.user.findFirst({ where: { role: UserRole.CONCIERGE } });
    if (!systemUser) return reply.status(500).send({ message: 'Seed concierge user first' });

    const booking = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        { startDatetime: body.startDatetime, endDatetime: body.endDatetime, elevatorRequired: body.elevatorRequired },
        false
      );
      return tx.booking.create({
        data: {
          createdById: systemUser.id,
          residentName: body.residentName,
          residentEmail: body.residentEmail,
          residentPhone: body.residentPhone,
          unit: body.unit,
          companyName: body.companyName,
          moveType: body.moveType,
          moveDate: body.moveDate,
          startDatetime: body.startDatetime,
          endDatetime: body.endDatetime,
          elevatorRequired: body.elevatorRequired,
          loadingBayRequired: body.loadingBayRequired,
          notes: body.notes,
          publicUnitMask: body.publicUnitMask,
          status: BookingStatus.SUBMITTED
        }
      });
    });

    await sendNotificationRecipients(prisma, NotifyEvent.SUBMITTED, 'New booking submitted', `<p>Booking ${booking.id} submitted.</p>`)
      .catch((err) => {
        app.log.error({ err, bookingId: booking.id, event: 'SUBMITTED' }, 'Failed to send notification email');
      });
    await sendEmail(prisma, body.residentEmail, 'Booking request submitted', `<p>Your booking request ${booking.id} has been submitted and will be reviewed. If no action is taken within 24 hours, it will be automatically approved.</p>`)
      .catch((err) => {
        app.log.error({ err, bookingId: booking.id, email: body.residentEmail }, 'Failed to send booking confirmation email');
      });

    return booking;
  });

  app.post('/api/admin/quick-entry/approve', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = createSchema.parse(req.body);

    // Validate move time restrictions (admins can override with proper role)
    const user = req.user;
    const overrideRoles: UserRole[] = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
    const allowOverride = overrideRoles.includes(user.role);

    if (!allowOverride) {
      const timeValidation = validateMoveTime(body.startDatetime, body.endDatetime, body.moveType);
      if (!timeValidation.valid) {
        return reply.status(400).send({ message: timeValidation.error });
      }
    }

    const booking = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        { startDatetime: body.startDatetime, endDatetime: body.endDatetime, elevatorRequired: body.elevatorRequired },
        allowOverride
      );

      return tx.booking.create({
        data: {
          createdById: user.id,
          residentName: body.residentName,
          residentEmail: body.residentEmail,
          residentPhone: body.residentPhone,
          unit: body.unit,
          companyName: body.companyName,
          moveType: body.moveType,
          moveDate: body.moveDate,
          startDatetime: body.startDatetime,
          endDatetime: body.endDatetime,
          elevatorRequired: body.elevatorRequired,
          loadingBayRequired: body.loadingBayRequired,
          notes: body.notes,
          publicUnitMask: body.publicUnitMask,
          status: BookingStatus.APPROVED,
          approvedById: user.id,
          approvedAt: new Date()
        }
      });
    });

    await logAudit(prisma, user.id, 'BOOKING_QUICK_APPROVED', booking.id, { source: 'concierge_quick_entry' });
    return booking;
  });

  app.get('/api/bookings/:id', { preHandler: [requireAuth] }, async (req) => {
    const id = uuidSchema.parse((req.params as { id: string }).id);
    return prisma.booking.findUnique({ where: { id } });
  });

  app.get(
    '/api/admin/bookings',
    { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] },
    async () => prisma.booking.findMany({ include: { documents: true }, orderBy: { startDatetime: 'asc' } })
  );

  app.patch('/api/admin/bookings/:id', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req, reply) => {
    const body = z
      .object({
        status: z.nativeEnum(BookingStatus).optional(),
        startDatetime: z.coerce.date().optional(),
        endDatetime: z.coerce.date().optional(),
        overrideConflict: z.boolean().optional()
      })
      .parse(req.body);

    const user = req.user;
    const bookingId = uuidSchema.parse((req.params as { id: string }).id);
    const existing = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const overrideRoles: UserRole[] = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER];
    const allowOverride = overrideRoles.includes(user.role) && !!body.overrideConflict;

    // Validate move time restrictions if times are being updated
    if ((body.startDatetime || body.endDatetime) && !allowOverride) {
      const newStart = body.startDatetime ?? existing.startDatetime;
      const newEnd = body.endDatetime ?? existing.endDatetime;
      const timeValidation = validateMoveTime(newStart, newEnd, existing.moveType);
      if (!timeValidation.valid) {
        return reply.status(400).send({ message: timeValidation.error });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await assertNoConflict(
        tx,
        {
          id: existing.id,
          startDatetime: body.startDatetime ?? existing.startDatetime,
          endDatetime: body.endDatetime ?? existing.endDatetime,
          elevatorRequired: existing.elevatorRequired
        },
        allowOverride
      );

      return tx.booking.update({
        where: { id: existing.id },
        data: {
          status: body.status ?? existing.status,
          startDatetime: body.startDatetime ?? undefined,
          endDatetime: body.endDatetime ?? undefined,
          approvedById: body.status === BookingStatus.APPROVED ? user.id : undefined,
          approvedAt: body.status === BookingStatus.APPROVED ? new Date() : undefined
        }
      });
    });

    if (allowOverride) await logAudit(prisma, user.id, 'CONFLICT_OVERRIDE', updated.id, { old: existing, new: updated });

    if (body.status === BookingStatus.APPROVED) {
      const settings = await prisma.appSetting.findFirst();
      const includeContact = settings?.includeResidentContactInApprovalEmails;
      const details = `${updated.residentName} (${updated.unit}) ${dayjs(updated.startDatetime).format('MMM D h:mm A')} - ${dayjs(updated.endDatetime).format('h:mm A')}`;
      const contact = includeContact ? `<p>${updated.residentEmail} ${updated.residentPhone}</p>` : '';
      await sendEmail(prisma, updated.residentEmail, 'Booking approved', `<p>Approved: ${details}</p>${contact}`)
        .catch((err) => {
          app.log.error({ err, bookingId: updated.id, email: updated.residentEmail }, 'Failed to send booking approval email');
        });
      await sendNotificationRecipients(prisma, NotifyEvent.APPROVED, 'Booking approved', `<p>${details}</p>${contact}`)
        .catch((err) => {
          app.log.error({ err, bookingId: updated.id, event: 'APPROVED' }, 'Failed to send approval notification');
        });
      await logAudit(prisma, user.id, 'BOOKING_APPROVED', updated.id, { status: updated.status });
    }

    if (body.status === BookingStatus.REJECTED) {
      await sendNotificationRecipients(prisma, NotifyEvent.REJECTED, 'Booking rejected', `<p>Booking ${updated.id} rejected.</p>`)
        .catch((err) => {
          app.log.error({ err, bookingId: updated.id, event: 'REJECTED' }, 'Failed to send rejection notification');
        });
      await logAudit(prisma, user.id, 'BOOKING_REJECTED', updated.id, { status: updated.status });
    }

    return updated;
  });

  app.post('/api/admin/bookings/:id/documents', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const data = await req.file();
    if (!data) throw new Error('No file');
    const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    if (!allowedMime.has(data.mimetype)) {
      throw new Error('Unsupported file type');
    }
    const id = uuidSchema.parse((req.params as { id: string }).id);
    const uploadsRoot = path.resolve(config.uploadsDir);
    await fs.mkdir(uploadsRoot, { recursive: true });
    const safeName = path.basename(data.filename);
    const ext = path.extname(safeName);
    const name = `${Date.now()}-${nanoid(8)}${ext}`;
    const storagePath = path.join(uploadsRoot, name);
    await fs.writeFile(storagePath, await data.toBuffer());
    return prisma.document.create({ data: { bookingId: id, originalName: safeName, storagePath, mimeType: data.mimetype } });
  });
}
