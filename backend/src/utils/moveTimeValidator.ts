import dayjs from 'dayjs';

// Canadian Statutory Holidays for 2025-2026
// These should ideally be configurable in the database
const STATUTORY_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-02-17', // Family Day (BC)
  '2025-04-18', // Good Friday
  '2025-05-19', // Victoria Day
  '2025-07-01', // Canada Day
  '2025-08-04', // BC Day
  '2025-09-01', // Labour Day
  '2025-10-13', // Thanksgiving
  '2025-11-11', // Remembrance Day
  '2025-12-25', // Christmas Day
  '2025-12-26', // Boxing Day
];

const STATUTORY_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-02-16', // Family Day (BC)
  '2026-04-03', // Good Friday
  '2026-05-18', // Victoria Day
  '2026-07-01', // Canada Day
  '2026-08-03', // BC Day
  '2026-09-07', // Labour Day
  '2026-10-12', // Thanksgiving
  '2026-11-11', // Remembrance Day
  '2026-12-25', // Christmas Day
  '2026-12-26', // Boxing Day
];

const ALL_STATUTORY_HOLIDAYS = [...STATUTORY_HOLIDAYS_2025, ...STATUTORY_HOLIDAYS_2026];

interface MoveTimeValidationResult {
  valid: boolean;
  error?: string;
}

// Permitted move slots in [startMinutes, endMinutes] pairs
// Monday–Friday: 10am–1pm, 1pm–4pm
const WEEKDAY_SLOTS: [number, number][] = [
  [10 * 60, 13 * 60], // 10:00 AM – 1:00 PM
  [13 * 60, 16 * 60], // 1:00 PM  – 4:00 PM
];

// Saturday–Sunday: 8am–11am, 11am–2pm, 2pm–5pm
const WEEKEND_SLOTS: [number, number][] = [
  [ 8 * 60, 11 * 60], // 8:00 AM  – 11:00 AM
  [11 * 60, 14 * 60], // 11:00 AM – 2:00 PM
  [14 * 60, 17 * 60], // 2:00 PM  – 5:00 PM
];

// Range-based hours for DELIVERY and RENO:
// Weekday: 10am–4pm, Weekend: 8am–5pm
const DELIVERY_RENO_WEEKDAY: [number, number] = [10 * 60, 16 * 60];
const DELIVERY_RENO_WEEKEND: [number, number] = [ 8 * 60, 17 * 60];

function fitsInSlot(startMins: number, endMins: number, slots: [number, number][]): boolean {
  return slots.some(([s, e]) => startMins >= s && endMins <= e);
}

/**
 * Validates move times according to building rules.
 *
 * MOVE_IN / MOVE_OUT:
 *   Monday–Friday: slots 10am–1pm or 1pm–4pm
 *   Saturday–Sunday: slots 8am–11am, 11am–2pm, or 2pm–5pm
 *
 * DELIVERY (30-minute blocks):
 *   Monday–Friday: 10:00 AM – 4:00 PM
 *   Saturday–Sunday: 8:00 AM – 5:00 PM
 *
 * RENO (1-hour slots):
 *   Monday–Friday: 10:00 AM – 4:00 PM
 *   Saturday–Sunday: 8:00 AM – 5:00 PM
 *
 * No bookings on statutory holidays.
 */
export function validateMoveTime(startDatetime: Date, endDatetime: Date, moveType?: string): MoveTimeValidationResult {
  const start = dayjs(startDatetime);
  const end = dayjs(endDatetime);

  // Check if dates are valid
  if (!start.isValid() || !end.isValid()) {
    return { valid: false, error: 'Invalid date/time provided' };
  }

  // Check if start is before end
  if (!start.isBefore(end)) {
    return { valid: false, error: 'Start time must be before end time' };
  }

  // Check if start and end are on the same day
  if (!start.isSame(end, 'day')) {
    return { valid: false, error: 'Booking must start and end on the same day' };
  }

  const dateStr = start.format('YYYY-MM-DD');
  const dayOfWeek = start.day(); // 0 = Sunday, 6 = Saturday

  // Check for statutory holiday
  if (ALL_STATUTORY_HOLIDAYS.includes(dateStr)) {
    return {
      valid: false,
      error: 'Bookings are not permitted on statutory holidays'
    };
  }

  const startMins = start.hour() * 60 + start.minute();
  const endMins   = end.hour()   * 60 + end.minute();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // DELIVERY: 30-minute blocks within allowed range
  if (moveType === 'DELIVERY') {
    const durationMins = end.diff(start, 'minute');
    if (durationMins !== 30) {
      return { valid: false, error: 'Delivery bookings must be exactly 30 minutes' };
    }
    const [rangeStart, rangeEnd] = isWeekend ? DELIVERY_RENO_WEEKEND : DELIVERY_RENO_WEEKDAY;
    const rangeLabel = isWeekend ? '8:00 AM – 5:00 PM' : '10:00 AM – 4:00 PM';
    if (startMins < rangeStart || endMins > rangeEnd) {
      return {
        valid: false,
        error: `Delivery bookings must be within ${isWeekend ? 'weekend' : 'weekday'} hours: ${rangeLabel}`
      };
    }
    return { valid: true };
  }

  // RENO: 1-hour slots within allowed range
  if (moveType === 'RENO') {
    const durationMins = end.diff(start, 'minute');
    if (durationMins !== 60) {
      return { valid: false, error: 'Renovation bookings must be exactly 1 hour' };
    }
    const [rangeStart, rangeEnd] = isWeekend ? DELIVERY_RENO_WEEKEND : DELIVERY_RENO_WEEKDAY;
    const rangeLabel = isWeekend ? '8:00 AM – 5:00 PM' : '10:00 AM – 4:00 PM';
    if (startMins < rangeStart || endMins > rangeEnd) {
      return {
        valid: false,
        error: `Renovation bookings must be within ${isWeekend ? 'weekend' : 'weekday'} hours: ${rangeLabel}`
      };
    }
    return { valid: true };
  }

  // MOVE_IN / MOVE_OUT (and fallback): fixed 3-hour slot validation
  if (isWeekend) {
    if (!fitsInSlot(startMins, endMins, WEEKEND_SLOTS)) {
      return {
        valid: false,
        error: 'Weekend moves must fit within one permitted slot: 8am–11am, 11am–2pm, or 2pm–5pm'
      };
    }
    return { valid: true };
  }

  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    if (!fitsInSlot(startMins, endMins, WEEKDAY_SLOTS)) {
      return {
        valid: false,
        error: 'Weekday moves must fit within one permitted slot: 10am–1pm or 1pm–4pm'
      };
    }
    return { valid: true };
  }

  return { valid: false, error: 'Invalid day of week' };
}

/**
 * Get the permitted move times as a human-readable string
 */
export function getPermittedMoveTimes(): string {
  return `Bookings are permitted within the following slots:
• Monday–Friday: 10:00 AM–1:00 PM or 1:00 PM–4:00 PM (moves); 10:00 AM–4:00 PM (deliveries/renos)
• Saturday–Sunday: 8:00 AM–11:00 AM, 11:00 AM–2:00 PM, or 2:00 PM–5:00 PM (moves); 8:00 AM–5:00 PM (deliveries/renos)
• NO BOOKINGS PERMITTED ON STATUTORY HOLIDAYS`;
}

/**
 * Check if a specific date is a statutory holiday
 */
export function isStatutoryHoliday(date: Date): boolean {
  const dateStr = dayjs(date).format('YYYY-MM-DD');
  return ALL_STATUTORY_HOLIDAYS.includes(dateStr);
}
