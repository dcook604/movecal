import { FastifyInstance } from 'fastify';
import { BookingStatus, NotifyEvent } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { sendNotificationRecipients, sendEmail, bookingDetailsHtml, emailWrapper } from '../services/emailService.js';
import { assertNoConflict } from '../services/conflictService.js';
import { validateMoveTime } from '../utils/moveTimeValidator.js';
import { config } from '../config.js';
import dayjs from 'dayjs';

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/public/taken-slots', async (req) => {
    const { date, excludeId } = req.query as { date?: string; excludeId?: string };
    if (!date) return [];
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd   = new Date(`${date}T23:59:59`);
    const bookings = await prisma.booking.findMany({
      where: {
        startDatetime: { gte: dayStart, lte: dayEnd },
        status: { notIn: [BookingStatus.REJECTED, BookingStatus.CANCELLED] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { startDatetime: true, endDatetime: true },
    });
    return bookings.map(b => ({
      start: b.startDatetime.toISOString().slice(11, 16),
      end:   b.endDatetime.toISOString().slice(11, 16),
    }));
  });

  app.get('/api/public/bookings', async () => {
    const bookings = await prisma.booking.findMany({
      where: { status: BookingStatus.APPROVED },
      orderBy: { startDatetime: 'asc' },
      select: { id: true, moveType: true, startDatetime: true, endDatetime: true, moveDate: true, unit: true, publicUnitMask: true }
    });
    return bookings.map((b) => ({ ...b, unit: b.publicUnitMask || b.unit }));
  });

  // ── Token-gated resident booking management ─────────────────────────
  const MOVE_TYPE_LABELS: Record<string, string> = {
    MOVE_IN: 'Move In',
    MOVE_OUT: 'Move Out',
    DELIVERY: 'Delivery',
    RENO: 'Renovation',
    OPEN_HOUSE: 'Open House',
    FURNISHED_MOVE: 'Furnished Move',
    SUITCASE_MOVE: 'Suitcase Move',
  };

  function bookingToResponse(b: any) {
    return {
      id: b.id,
      residentName: b.residentName,
      residentEmail: b.residentEmail,
      residentPhone: b.residentPhone,
      unit: b.unit,
      moveType: b.moveType,
      moveTypeLabel: MOVE_TYPE_LABELS[b.moveType] ?? b.moveType,
      moveDate: b.moveDate,
      startDatetime: b.startDatetime,
      endDatetime: b.endDatetime,
      elevatorRequired: b.elevatorRequired,
      loadingBayRequired: b.loadingBayRequired,
      notes: b.notes,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  // GET resident's booking (token-gated)
  app.get('/api/public/bookings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { token } = req.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ message: 'Token is required' });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return reply.status(404).send({ message: 'Booking not found' });
    }
    if (booking.editToken !== token) {
      return reply.status(403).send({ message: 'Invalid token' });
    }

    return bookingToResponse(booking);
  });

  // PATCH resident's booking (token-gated)
  const updateSchema = z.object({
    notes: z.string().max(2000).optional(),
    elevatorRequired: z.boolean().optional(),
    loadingBayRequired: z.boolean().optional(),
    moveDate: z.coerce.date().optional(),
    startDatetime: z.coerce.date().optional(),
    endDatetime: z.coerce.date().optional(),
  });

  app.patch('/api/public/bookings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { token } = req.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ message: 'Token is required' });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return reply.status(404).send({ message: 'Booking not found' });
    }
    if (booking.editToken !== token) {
      return reply.status(403).send({ message: 'Invalid token' });
    }

    // Can't modify cancelled or rejected bookings
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) {
      return reply.status(400).send({ message: `Cannot modify a ${booking.status.toLowerCase()} booking` });
    }

    const body = updateSchema.parse(req.body);
    if (Object.keys(body).length === 0) {
      return reply.status(400).send({ message: 'No fields to update' });
    }

    const isTimeChange = body.startDatetime !== undefined || body.endDatetime !== undefined || body.moveDate !== undefined;

    if (isTimeChange) {
      // Require both startDatetime and endDatetime when changing time
      const newStart = body.startDatetime ?? booking.startDatetime;
      const newEnd = body.endDatetime ?? booking.endDatetime;

      // Validate move time restrictions
      const timeValidation = validateMoveTime(newStart, newEnd, booking.moveType as string);
      if (!timeValidation.valid) {
        return reply.status(400).send({ message: timeValidation.error });
      }

      // Check for conflicts within a transaction
      const updated = await prisma.$transaction(async (tx) => {
        await assertNoConflict(
          tx,
          {
            id: booking.id,
            startDatetime: newStart,
            endDatetime: newEnd,
            elevatorRequired: body.elevatorRequired ?? booking.elevatorRequired,
            moveType: booking.moveType as string,
          },
          false // no override for residents
        );

        return tx.booking.update({
          where: { id: booking.id },
          data: {
            ...(body.notes !== undefined && { notes: body.notes }),
            ...(body.elevatorRequired !== undefined && { elevatorRequired: body.elevatorRequired }),
            ...(body.loadingBayRequired !== undefined && { loadingBayRequired: body.loadingBayRequired }),
            startDatetime: newStart,
            endDatetime: newEnd,
            moveDate: body.moveDate ?? booking.moveDate,
          },
        });
      });

      await sendUpdateNotification(prisma, updated, app.log);
      return bookingToResponse(updated);
    }

    // Simple field update (no time change)
    const data: Record<string, any> = {};
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.elevatorRequired !== undefined) data.elevatorRequired = body.elevatorRequired;
    if (body.loadingBayRequired !== undefined) data.loadingBayRequired = body.loadingBayRequired;

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ message: 'No fields to update' });
    }

    const updated = await prisma.booking.update({ where: { id: booking.id }, data });

    await sendUpdateNotification(prisma, updated, app.log);
    return bookingToResponse(updated);
  });

  async function sendUpdateNotification(prismaClient: typeof prisma, updated: any, log: any) {
    const moveLabel = MOVE_TYPE_LABELS[updated.moveType] ?? updated.moveType;
    const subject = `Booking Updated by Resident — ${moveLabel} for Unit ${updated.unit}`;
    await sendNotificationRecipients(
      prismaClient,
      NotifyEvent.SUBMITTED,
      subject,
      emailWrapper(
        'Booking Updated by Resident',
        `The resident (${updated.residentEmail}) has updated their booking. The changes have been applied automatically.`,
        bookingDetailsHtml(updated, true)
      )
    ).catch((err) => {
      log.error({ err, bookingId: updated.id }, 'Failed to send update notification to admin');
    });
  }

  // POST cancel booking (token-gated)
  app.post('/api/public/bookings/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { token } = req.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ message: 'Token is required' });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return reply.status(404).send({ message: 'Booking not found' });
    }
    if (booking.editToken !== token) {
      return reply.status(403).send({ message: 'Invalid token' });
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return reply.status(400).send({ message: 'Booking is already cancelled' });
    }
    if (booking.status === BookingStatus.REJECTED) {
      return reply.status(400).send({ message: 'Cannot cancel a rejected booking' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED },
    });

    // Notify admin recipients of cancellation
    const moveLabel = MOVE_TYPE_LABELS[updated.moveType] ?? updated.moveType;
    const subject = `Booking Cancelled by Resident — ${moveLabel} for Unit ${updated.unit}`;
    await sendNotificationRecipients(
      prisma,
      NotifyEvent.REJECTED,
      subject,
      emailWrapper(
        'Booking Cancelled',
        `The resident (${updated.residentEmail}) has cancelled their booking.`,
        bookingDetailsHtml(updated, true)
      )
    ).catch((err) => {
      app.log.error({ err, bookingId: id }, 'Failed to send cancellation notification to admin');
    });

    // Send confirmation to resident
    const manageUrl = updated.editToken
      ? `${config.frontendOrigins[0]}/booking/${updated.id}?token=${updated.editToken}`
      : undefined;
    await sendEmail(
      prisma,
      updated.residentEmail,
      `Booking Cancelled — ${moveLabel} on ${dayjs(updated.startDatetime).format('MMM D, YYYY')}`,
      emailWrapper(
        'Booking Cancelled',
        'Your booking has been successfully cancelled.',
        bookingDetailsHtml(updated),
        'If you did not intend to cancel, please contact building management.',
        manageUrl
      )
    ).catch((err) => {
      app.log.error({ err, bookingId: id, email: updated.residentEmail }, 'Failed to send cancellation confirmation to resident');
    });

    return bookingToResponse(updated);
  });
}
