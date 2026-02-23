import { BookingStatus, Prisma } from '@prisma/client';
import dayjs from 'dayjs';

// Outermost permitted hours across all day types:
// Weekdays start at 10, weekends start at 8 → earliest possible = 8
// Weekdays end at 16, weekends end at 17 → latest possible = 17
const MOVE_START_HOUR = 8;
const MOVE_END_HOUR = 17;

export type ConflictCandidate = {
  id?: string;
  startDatetime: Date;
  endDatetime: Date;
  elevatorRequired: boolean;
};

export function validateMoveHours(startDatetime: Date, endDatetime: Date) {
  const start = dayjs(startDatetime);
  const end = dayjs(endDatetime);
  if (!end.isAfter(start)) throw new Error('End time must be after start time');
  // Sanity-check against absolute outer bounds (8am–5pm).
  // Detailed slot validation is handled by validateMoveTime in moveTimeValidator.ts.
  if (start.hour() < MOVE_START_HOUR || end.hour() > MOVE_END_HOUR || (end.hour() === MOVE_END_HOUR && end.minute() > 0)) {
    throw new Error('Booking must be within permitted move hours (8:00 AM – 5:00 PM)');
  }
}

export function hasElevatorConflict(existing: Array<{ startDatetime: Date; endDatetime: Date; elevatorRequired: boolean }>, candidate: ConflictCandidate) {
  if (!candidate.elevatorRequired) return false;
  const cStart = dayjs(candidate.startDatetime);
  const cEnd = dayjs(candidate.endDatetime);

  return existing.some((booking) => {
    if (!booking.elevatorRequired) return false;
    const bStart = dayjs(booking.startDatetime);
    const bEnd = dayjs(booking.endDatetime);
    return cStart.isBefore(bEnd) && cEnd.isAfter(bStart);
  });
}

export async function assertNoConflict(prismaTx: Prisma.TransactionClient, candidate: ConflictCandidate, allowOverride: boolean) {
  validateMoveHours(candidate.startDatetime, candidate.endDatetime);
  const existing = await prismaTx.booking.findMany({
    where: {
      elevatorRequired: true,
      status: { in: [BookingStatus.SUBMITTED, BookingStatus.PENDING, BookingStatus.APPROVED] },
      id: candidate.id ? { not: candidate.id } : undefined,
      startDatetime: { lte: candidate.endDatetime },
      endDatetime: { gte: candidate.startDatetime }
    },
    select: { startDatetime: true, endDatetime: true, elevatorRequired: true }
  });

  if (!allowOverride && hasElevatorConflict(existing, candidate)) {
    throw new Error('Elevator conflict detected');
  }
}
