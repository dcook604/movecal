import dayjs from 'dayjs';

// BC Statutory Holidays 2025–2030
// Fixed dates: New Year's Day, Canada Day, Remembrance Day, Christmas, Boxing Day
// Calculated dates: Family Day (3rd Mon Feb), Good Friday, Victoria Day (Mon before May 25),
//   BC Day (1st Mon Aug), Labour Day (1st Mon Sep), Thanksgiving (2nd Mon Oct)
const STATUTORY_HOLIDAYS: string[] = [
  // 2025
  '2025-01-01', // New Year's Day
  '2025-02-17', // Family Day (BC) — 3rd Mon Feb
  '2025-04-18', // Good Friday
  '2025-05-19', // Victoria Day
  '2025-07-01', // Canada Day
  '2025-08-04', // BC Day — 1st Mon Aug
  '2025-09-01', // Labour Day — 1st Mon Sep
  '2025-10-13', // Thanksgiving — 2nd Mon Oct
  '2025-11-11', // Remembrance Day
  '2025-12-25', // Christmas Day
  '2025-12-26', // Boxing Day

  // 2026
  '2026-01-01', // New Year's Day
  '2026-02-16', // Family Day (BC) — 3rd Mon Feb
  '2026-04-03', // Good Friday
  '2026-05-18', // Victoria Day
  '2026-07-01', // Canada Day
  '2026-08-03', // BC Day — 1st Mon Aug
  '2026-09-07', // Labour Day — 1st Mon Sep
  '2026-10-12', // Thanksgiving — 2nd Mon Oct
  '2026-11-11', // Remembrance Day
  '2026-12-25', // Christmas Day
  '2026-12-26', // Boxing Day

  // 2027
  '2027-01-01', // New Year's Day
  '2027-02-15', // Family Day (BC) — 3rd Mon Feb
  '2027-03-26', // Good Friday
  '2027-05-24', // Victoria Day
  '2027-07-01', // Canada Day
  '2027-08-02', // BC Day — 1st Mon Aug
  '2027-09-06', // Labour Day — 1st Mon Sep
  '2027-10-11', // Thanksgiving — 2nd Mon Oct
  '2027-11-11', // Remembrance Day
  '2027-12-25', // Christmas Day
  '2027-12-26', // Boxing Day

  // 2028
  '2028-01-01', // New Year's Day
  '2028-02-21', // Family Day (BC) — 3rd Mon Feb
  '2028-04-14', // Good Friday
  '2028-05-22', // Victoria Day
  '2028-07-01', // Canada Day
  '2028-08-07', // BC Day — 1st Mon Aug
  '2028-09-04', // Labour Day — 1st Mon Sep
  '2028-10-09', // Thanksgiving — 2nd Mon Oct
  '2028-11-11', // Remembrance Day
  '2028-12-25', // Christmas Day
  '2028-12-26', // Boxing Day

  // 2029
  '2029-01-01', // New Year's Day
  '2029-02-19', // Family Day (BC) — 3rd Mon Feb
  '2029-03-30', // Good Friday
  '2029-05-21', // Victoria Day
  '2029-07-01', // Canada Day
  '2029-08-06', // BC Day — 1st Mon Aug
  '2029-09-03', // Labour Day — 1st Mon Sep
  '2029-10-08', // Thanksgiving — 2nd Mon Oct
  '2029-11-11', // Remembrance Day
  '2029-12-25', // Christmas Day
  '2029-12-26', // Boxing Day

  // 2030
  '2030-01-01', // New Year's Day
  '2030-02-18', // Family Day (BC) — 3rd Mon Feb
  '2030-04-19', // Good Friday
  '2030-05-20', // Victoria Day
  '2030-07-01', // Canada Day
  '2030-08-05', // BC Day — 1st Mon Aug
  '2030-09-02', // Labour Day — 1st Mon Sep
  '2030-10-14', // Thanksgiving — 2nd Mon Oct
  '2030-11-11', // Remembrance Day
  '2030-12-25', // Christmas Day
  '2030-12-26', // Boxing Day
];

interface MoveTimeValidationResult {
  valid: boolean;
  error?: string;
}

// Permitted move slots in [startMinutes, endMinutes] pairs
// Monday–Friday: 9am–12pm, 1pm–4pm
const WEEKDAY_SLOTS: [number, number][] = [
  [9 * 60, 12 * 60], // 9:00 AM  – 12:00 PM
  [13 * 60, 16 * 60], // 1:00 PM  – 4:00 PM
];

// Saturday–Sunday: 8am–11am, 12pm–3pm, 4pm–7pm
const WEEKEND_SLOTS: [number, number][] = [
  [ 8 * 60, 11 * 60], // 8:00 AM  – 11:00 AM
  [12 * 60, 15 * 60], // 12:00 PM – 3:00 PM
  [16 * 60, 19 * 60], // 4:00 PM  – 7:00 PM
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
 * MOVE_IN / MOVE_OUT / FURNISHED_MOVE:
 *   Monday–Friday: slots 9am–12pm or 1pm–4pm
 *   Saturday–Sunday: slots 8am–11am, 12pm–3pm, or 4pm–7pm
 *
 * DELIVERY (30-minute blocks):
 *   Monday–Friday: 10:00 AM – 4:00 PM
 *   Saturday–Sunday: 8:00 AM – 5:00 PM
 *
 * RENO (1-hour slots):
 *   Monday–Friday: 10:00 AM – 4:00 PM
 *   Saturday–Sunday: 8:00 AM – 5:00 PM
 *
 * SUITCASE_MOVE (1-hour slots):
 *   Monday–Friday: same fixed 3-hour slots as moves (9am–12pm or 1pm–4pm)
 *   Saturday–Sunday: same fixed 3-hour slots as moves (8am–11am, 12pm–3pm, or 4pm–7pm)
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
  if (STATUTORY_HOLIDAYS.includes(dateStr)) {
    return {
      valid: false,
      error: 'Bookings are not permitted on statutory holidays'
    };
  }

  const startMins = start.hour() * 60 + start.minute();
  const endMins   = end.hour()   * 60 + end.minute();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // OPEN_HOUSE: fixed 2pm–5pm slot, weekends only
  if (moveType === 'OPEN_HOUSE') {
    if (!isWeekend) {
      return { valid: false, error: 'Open House bookings are only permitted on Saturdays and Sundays' };
    }
    if (startMins !== 14 * 60 || endMins !== 17 * 60) {
      return { valid: false, error: 'Open House bookings must be from 2:00 PM to 5:00 PM' };
    }
    return { valid: true };
  }

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

  // SUITCASE_MOVE: 1-hour slots within the same fixed 3-hour move windows
  if (moveType === 'SUITCASE_MOVE') {
    const durationMins = end.diff(start, 'minute');
    if (durationMins !== 60) {
      return { valid: false, error: 'Suitcase Move bookings must be exactly 1 hour' };
    }
    if (isWeekend) {
      if (!fitsInSlot(startMins, endMins, WEEKEND_SLOTS)) {
        return {
          valid: false,
          error: 'Suitcase Move bookings must fit within one permitted slot: 8am–11am, 12pm–3pm, or 4pm–7pm'
        };
      }
      return { valid: true };
    }
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      if (!fitsInSlot(startMins, endMins, WEEKDAY_SLOTS)) {
        return {
          valid: false,
          error: 'Suitcase Move bookings must fit within one permitted slot: 9am–12pm or 1pm–4pm'
        };
      }
      return { valid: true };
    }
    return { valid: false, error: 'Invalid day of week' };
  }

  // MOVE_IN / MOVE_OUT / FURNISHED_MOVE (and fallback): fixed 3-hour slot validation
  if (isWeekend) {
    if (!fitsInSlot(startMins, endMins, WEEKEND_SLOTS)) {
      return {
        valid: false,
        error: 'Weekend moves must fit within one permitted slot: 8am–11am, 12pm–3pm, or 4pm–7pm'
      };
    }
    return { valid: true };
  }

  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    if (!fitsInSlot(startMins, endMins, WEEKDAY_SLOTS)) {
      return {
        valid: false,
        error: 'Weekday moves must fit within one permitted slot: 9am–12pm or 1pm–4pm'
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
• Monday–Friday: 9:00 AM–12:00 PM or 1:00 PM–4:00 PM (moves); 10:00 AM–4:00 PM (deliveries/renos)
• Saturday–Sunday: 8:00 AM–11:00 AM, 12:00 PM–3:00 PM, or 4:00 PM–7:00 PM (moves); 8:00 AM–5:00 PM (deliveries/renos)
• Open House: Saturday or Sunday only, 2:00 PM–5:00 PM
• Suitcase Move: 1-hour slots within move windows (same hours as moves)
• NO BOOKINGS PERMITTED ON STATUTORY HOLIDAYS`;
}

/**
 * Check if a specific date is a statutory holiday
 */
export function isStatutoryHoliday(date: Date): boolean {
  const dateStr = dayjs(date).format('YYYY-MM-DD');
  return STATUTORY_HOLIDAYS.includes(dateStr);
}
