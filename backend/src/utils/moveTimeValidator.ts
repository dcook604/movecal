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

/**
 * Validates move times according to building rules:
 * - Monday-Friday: 10:00 AM - 4:00 PM
 * - Saturday-Sunday: 8:00 AM - 5:00 PM
 * - No moves on statutory holidays
 */
export function validateMoveTime(startDatetime: Date, endDatetime: Date): MoveTimeValidationResult {
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
    return { valid: false, error: 'Move must start and end on the same day' };
  }

  const dateStr = start.format('YYYY-MM-DD');
  const dayOfWeek = start.day(); // 0 = Sunday, 6 = Saturday

  // Check for statutory holiday
  if (ALL_STATUTORY_HOLIDAYS.includes(dateStr)) {
    return {
      valid: false,
      error: 'Moves are not permitted on statutory holidays'
    };
  }

  const startHour = start.hour();
  const startMinute = start.minute();
  const endHour = end.hour();
  const endMinute = end.minute();

  // Weekend rules (Saturday = 6, Sunday = 0)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    // Saturday & Sunday: 8:00 AM - 5:00 PM
    const minTime = 8 * 60; // 8:00 AM in minutes
    const maxTime = 17 * 60; // 5:00 PM in minutes

    const startInMinutes = startHour * 60 + startMinute;
    const endInMinutes = endHour * 60 + endMinute;

    if (startInMinutes < minTime) {
      return {
        valid: false,
        error: 'Weekend moves must start at or after 8:00 AM'
      };
    }

    if (endInMinutes > maxTime) {
      return {
        valid: false,
        error: 'Weekend moves must end by 5:00 PM'
      };
    }

    return { valid: true };
  }

  // Weekday rules (Monday-Friday)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // Monday-Friday: 10:00 AM - 4:00 PM
    const minTime = 10 * 60; // 10:00 AM in minutes
    const maxTime = 16 * 60; // 4:00 PM in minutes

    const startInMinutes = startHour * 60 + startMinute;
    const endInMinutes = endHour * 60 + endMinute;

    if (startInMinutes < minTime) {
      return {
        valid: false,
        error: 'Weekday moves must start at or after 10:00 AM'
      };
    }

    if (endInMinutes > maxTime) {
      return {
        valid: false,
        error: 'Weekday moves must end by 4:00 PM'
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
  return `Moves are permitted:
• Monday-Friday: 10:00 AM - 4:00 PM
• Saturday-Sunday: 8:00 AM - 5:00 PM
• NO MOVES PERMITTED ON STATUTORY HOLIDAYS`;
}

/**
 * Check if a specific date is a statutory holiday
 */
export function isStatutoryHoliday(date: Date): boolean {
  const dateStr = dayjs(date).format('YYYY-MM-DD');
  return ALL_STATUTORY_HOLIDAYS.includes(dateStr);
}
