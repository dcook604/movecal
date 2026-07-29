import { BookingStatus, Prisma } from '@prisma/client';
import dayjs from 'dayjs';

// Outermost permitted hours across all day types:
// Earliest start: weekday 9am, weekend 8am → 8
// Latest end: weekday 4pm, weekend 7pm → 19
const MOVE_START_HOUR = 8;
const MOVE_END_HOUR = 19;

export type ConflictCandidate = {
  id?: string;
  startDatetime: Date;
  endDatetime: Date;
  elevatorRequired: boolean;
  moveType?: string;
};

export class DuplicateMoveRequestError extends Error {
  statusCode = 409;
}

const DUPLICATE_CHECK_MOVE_TYPES = [BookingStatus.SUBMITTED, BookingStatus.PENDING, BookingStatus.APPROVED];

// A unit can only have one active Move In / Move Out request per day — residents must amend
// their existing reservation (via the emailed edit link) instead of submitting a new one.
export async function assertNoDuplicateMoveRequest(
  prismaTx: Prisma.TransactionClient,
  params: { unit: string; moveDate: Date; moveType: string }
) {
  if (params.moveType !== 'MOVE_IN' && params.moveType !== 'MOVE_OUT') return;

  const existing = await prismaTx.booking.findFirst({
    where: {
      unit: { equals: params.unit.trim(), mode: 'insensitive' },
      moveType: { in: ['MOVE_IN', 'MOVE_OUT'] },
      moveDate: params.moveDate,
      status: { in: DUPLICATE_CHECK_MOVE_TYPES },
    },
  });

  if (existing) {
    throw new DuplicateMoveRequestError(
      `Unit ${params.unit} already has an active Move In/Move Out request for this date. ` +
      `To change it, use the manage-booking link from your confirmation email. If you can't find it:`
    );
  }
}

export function validateMoveHours(startDatetime: Date, endDatetime: Date) {
  const start = dayjs(startDatetime);
  const end = dayjs(endDatetime);
  if (!end.isAfter(start)) throw new Error('End time must be after start time');
  // Sanity-check against absolute outer bounds (8am–5pm).
  // Detailed slot validation is handled by validateMoveTime in moveTimeValidator.ts.
  if (start.hour() < MOVE_START_HOUR || end.hour() > MOVE_END_HOUR || (end.hour() === MOVE_END_HOUR && end.minute() > 0)) {
    throw new Error('Booking must be within permitted move hours (8:00 AM – 7:00 PM)');
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

  const timeOverlapWhere = {
    id: candidate.id ? { not: candidate.id } : undefined,
    status: { in: [BookingStatus.SUBMITTED, BookingStatus.PENDING, BookingStatus.APPROVED] },
    startDatetime: { lte: candidate.endDatetime },
    endDatetime: { gte: candidate.startDatetime },
  };

  if (candidate.moveType === 'OPEN_HOUSE') {
    // OPEN_HOUSE must not overlap with any booking whatsoever
    const anyConflict = await prismaTx.booking.findFirst({ where: timeOverlapWhere });
    if (!allowOverride && anyConflict) {
      throw new Error('Open House cannot overlap with an existing booking');
    }
    return;
  }

  // For all other types: block if an OPEN_HOUSE booking overlaps
  const openHouseConflict = await prismaTx.booking.findFirst({
    where: { ...timeOverlapWhere, moveType: 'OPEN_HOUSE' as any },
  });
  if (!allowOverride && openHouseConflict) {
    throw new Error('Booking conflicts with an existing Open House');
  }

  // Elevator conflict check
  const existing = await prismaTx.booking.findMany({
    where: { ...timeOverlapWhere, elevatorRequired: true },
    select: { startDatetime: true, endDatetime: true, elevatorRequired: true }
  });
  if (!allowOverride && hasElevatorConflict(existing, candidate)) {
    throw new Error('Elevator conflict detected');
  }
}
