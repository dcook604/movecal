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

const createSchema = z.object({
  residentName: z.string().min(1),
  residentEmail: z.string().email(),
  residentPhone: z.string().min(1),
  unit: z.string().min(1),
  moveType: z.nativeEnum(MoveType),
  companyName: z.string().optional(),
  moveDate: z.coerce.date(),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  elevatorRequired: z.boolean(),
  loadingBayRequired: z.boolean(),
  notes: z.string().optional(),
  publicUnitMask: z.string().optional()
});

export async function bookingRoutes(app: FastifyInstance) {
  app.post('/api/bookings', async (req, reply) => {
    const body = createSchema.parse(req.body);
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

    await sendNotificationRecipients(prisma, NotifyEvent.SUBMITTED, 'New booking submitted', `<p>Booking ${booking.id} submitted.</p>`).catch(() => undefined);
    await sendEmail(prisma, body.residentEmail, 'Booking submitted', `<p>Your booking ${booking.id} has been submitted.</p>`).catch(() => undefined);

    return booking;
  });

  app.post('/api/admin/quick-entry/approve', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const body = createSchema.parse(req.body);
    const user = req.user;
    const allowOverride = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER].includes(user.role);

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

  app.get('/api/bookings/:id', { preHandler: [requireAuth] }, async (req) => prisma.booking.findUnique({ where: { id: (req.params as { id: string }).id } }));

  app.get(
    '/api/admin/bookings',
    { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] },
    async () => prisma.booking.findMany({ include: { documents: true }, orderBy: { startDatetime: 'asc' } })
  );

  app.patch('/api/admin/bookings/:id', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const body = z
      .object({
        status: z.nativeEnum(BookingStatus).optional(),
        startDatetime: z.coerce.date().optional(),
        endDatetime: z.coerce.date().optional(),
        overrideConflict: z.boolean().optional()
      })
      .parse(req.body);

    const user = req.user;
    const bookingId = (req.params as { id: string }).id;
    const existing = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const allowOverride = [UserRole.COUNCIL, UserRole.PROPERTY_MANAGER].includes(user.role) && !!body.overrideConflict;

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
      await sendEmail(prisma, updated.residentEmail, 'Booking approved', `<p>Approved: ${details}</p>${contact}`).catch(() => undefined);
      await sendNotificationRecipients(prisma, NotifyEvent.APPROVED, 'Booking approved', `<p>${details}</p>${contact}`).catch(() => undefined);
      await logAudit(prisma, user.id, 'BOOKING_APPROVED', updated.id, { status: updated.status });
    }

    if (body.status === BookingStatus.REJECTED) {
      await sendNotificationRecipients(prisma, NotifyEvent.REJECTED, 'Booking rejected', `<p>Booking ${updated.id} rejected.</p>`).catch(() => undefined);
      await logAudit(prisma, user.id, 'BOOKING_REJECTED', updated.id, { status: updated.status });
    }

    return updated;
  });

  app.post('/api/admin/bookings/:id/documents', { preHandler: [requireRole([UserRole.CONCIERGE, UserRole.COUNCIL, UserRole.PROPERTY_MANAGER])] }, async (req) => {
    const data = await req.file();
    if (!data) throw new Error('No file');
    const id = (req.params as { id: string }).id;
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
