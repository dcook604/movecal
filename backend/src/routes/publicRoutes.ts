import { FastifyInstance } from 'fastify';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/public/taken-slots', async (req) => {
    const { date } = req.query as { date?: string };
    if (!date) return [];
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd   = new Date(`${date}T23:59:59`);
    const bookings = await prisma.booking.findMany({
      where: {
        startDatetime: { gte: dayStart, lte: dayEnd },
        status: { notIn: [BookingStatus.REJECTED, BookingStatus.CANCELLED] },
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
    return bookings.map((b) => ({ ...b, unit: b.publicUnitMask ?? b.unit }));
  });
}
