export const MIN_NOTICE_HOURS = 48;
export const MIN_NOTICE_MESSAGE =
  'Move in and move out bookings require at least 48 hours notice, not including weekends. Under no conditions will a move in or move out be permitted with less notice.';

const BUILDING_TZ = process.env.REPORT_TIMEZONE ?? 'America/Vancouver';
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// Current building-local wall-clock time, expressed the same way booking datetimes are stored:
// local digits mislabeled as UTC.
export function nowAsBuildingWallClock(now: Date = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: BUILDING_TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

// Hours between two wall-clock instants, not counting any time that falls on a Saturday or Sunday.
export function weekdayHoursBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from.getTime();
  const end = to.getTime();
  while (cursor < end) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    const next = Math.min(dayStart + DAY_MS, end);
    const dow = new Date(dayStart).getUTCDay();
    if (dow !== 0 && dow !== 6) total += next - cursor;
    cursor = next;
  }
  return total / HOUR_MS;
}

export function hasMinimumNotice(startDatetime: Date, now: Date = new Date()): boolean {
  return weekdayHoursBetween(nowAsBuildingWallClock(now), startDatetime) >= MIN_NOTICE_HOURS;
}
