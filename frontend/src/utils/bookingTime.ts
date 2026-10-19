import dayjs, { Dayjs } from 'dayjs';

// Booking start/end times are submitted as timezone-naive strings (e.g. "2026-07-29T13:00:00")
// representing the building's local wall-clock time. The backend always runs with TZ=UTC, so
// that naive string round-trips through the database as "2026-07-29T13:00:00.000Z" — the digits
// are the intended local time, mislabeled as UTC. Stripping the trailing Z before parsing recovers
// those intended wall-clock digits regardless of the viewer's real browser timezone.
export function parseBookingTime(iso: string): Dayjs {
  return dayjs(iso.replace('Z', ''));
}

// Multi-slot bookings (renovations) submit a single range that runs from the earliest
// selected slot's start to the latest selected slot's end.
export function selectedSlotRange<T extends { start: string; end: string }>(
  slots: T[],
  selectedStarts: string[]
): { start: string; end: string } | null {
  const chosen = slots
    .filter((s) => selectedStarts.includes(s.start))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (chosen.length === 0) return null;
  return { start: chosen[0].start, end: chosen[chosen.length - 1].end };
}

