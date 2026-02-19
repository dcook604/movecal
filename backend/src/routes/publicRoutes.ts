import { FastifyInstance } from 'fastify';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/public/bookings', async () => {
    const bookings = await prisma.booking.findMany({
      where: { status: BookingStatus.APPROVED },
      orderBy: { startDatetime: 'asc' },
      select: { id: true, moveType: true, startDatetime: true, endDatetime: true, moveDate: true, unit: true, publicUnitMask: true, notes: true }
    });
    return bookings.map((b) => ({ ...b, unit: b.publicUnitMask ?? b.unit }));
  });
}
