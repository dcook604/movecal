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

const ACTIVE_STATUSES = [BookingStatus.SUBMITTED, BookingStatus.PENDING, BookingStatus.APPROVED];

// Move In / Move Out style bookings are mutually exclusive for a unit on a given day.
const MOVE_FAMILY = ['MOVE_IN', 'MOVE_OUT', 'FURNISHED_MOVE', 'SUITCASE_MOVE'];

// "5-03", " 503 " and "503" are the same unit
function normalizeUnitKey(unit: string) {
  return unit.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// A unit can only have one active move per day (Move In / Move Out / Furnished / Suitcase), and no
// other booking type may be duplicated for the same unit, day and type. Residents must amend their
// existing reservation instead of submitting a new one.
//
// Must run inside the same transaction as the write: it takes a per-unit/day advisory lock so two
// simultaneous submissions can't both pass the check.
export async function assertNoDuplicateMoveRequest(
  prismaTx: Prisma.TransactionClient,
  params: { unit: string; moveDate: Date; moveType: string; excludeId?: string; staff?: boolean }
) {
  const unitKey = normalizeUnitKey(params.unit);
  if (!unitKey) return;
  const dayKey = dayjs(params.moveDate).format('YYYY-MM-DD');

  await prismaTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`move:${unitKey}:${dayKey}`}))`;

  const types = MOVE_FAMILY.includes(params.moveType) ? MOVE_FAMILY : [params.moveType];
  const existing = await prismaTx.booking.findFirst({
    where: {
      ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      unitNorm: unitKey,
      moveType: { in: types as any },
      moveDate: params.moveDate,
      status: { in: ACTIVE_STATUSES },
    },
  });

  if (existing) {
    throw new DuplicateMoveRequestError(
      params.staff
        ? `Unit ${params.unit} already has an active ${existing.moveType.replace(/_/g, ' ').toLowerCase()} booking on ${dayKey}. Edit or cancel that booking instead.`
        : `Unit ${params.unit} already has an active move request for this date. ` +
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
