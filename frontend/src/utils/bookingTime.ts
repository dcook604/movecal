import dayjs, { Dayjs } from 'dayjs';

// Booking start/end times are submitted as timezone-naive strings (e.g. "2026-07-29T13:00:00")
// representing the building's local wall-clock time. The backend always runs with TZ=UTC, so
// that naive string round-trips through the database as "2026-07-29T13:00:00.000Z" — the digits
// are the intended local time, mislabeled as UTC. Stripping the trailing Z before parsing recovers
// those intended wall-clock digits regardless of the viewer's real browser timezone.
export function parseBookingTime(iso: string): Dayjs {
  return dayjs(iso.replace('Z', ''));
}
