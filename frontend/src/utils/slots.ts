import dayjs from 'dayjs';

// ── Time slot helpers (mirrors ResidentSubmissionPage) ────────
export type Slot = { label: string; start: string; end: string };

const MOVE_WEEKDAY_SLOTS: Slot[] = [
  { label: '9:00 AM – 12:00 PM',  start: '09:00', end: '12:00' },
  { label: '10:00 AM – 1:00 PM',  start: '10:00', end: '13:00' },
  { label: '1:00 PM – 4:00 PM',   start: '13:00', end: '16:00' },
];

const MOVE_WEEKEND_SLOTS: Slot[] = [
  { label: '10:00 AM – 1:00 PM',  start: '10:00', end: '13:00' },
  { label: '12:00 PM – 3:00 PM',  start: '12:00', end: '15:00' },
  { label: '1:00 PM – 4:00 PM',   start: '13:00', end: '16:00' },
  { label: '4:00 PM – 7:00 PM',   start: '16:00', end: '19:00' },
];

const STATUTORY_HOLIDAYS = new Set([
  '2025-01-01','2025-02-17','2025-04-18','2025-05-19',
  '2025-07-01','2025-08-04','2025-09-01','2025-10-13',
  '2025-11-11','2025-12-25','2025-12-26',
  '2026-01-01','2026-02-16','2026-04-03','2026-05-18',
  '2026-07-01','2026-08-03','2026-09-07','2026-10-12',
  '2026-11-11','2026-12-25','2026-12-26',
  '2027-01-01','2027-02-15','2027-03-26','2027-05-24',
  '2027-07-01','2027-08-02','2027-09-06','2027-10-11',
  '2027-11-11','2027-12-25','2027-12-26',
  '2028-01-01','2028-02-21','2028-04-14','2028-05-22',
  '2028-07-01','2028-08-07','2028-09-04','2028-10-09',
  '2028-11-11','2028-12-25','2028-12-26',
  '2029-01-01','2029-02-19','2029-03-30','2029-05-21',
  '2029-07-01','2029-08-06','2029-09-03','2029-10-08',
  '2029-11-11','2029-12-25','2029-12-26',
  '2030-01-01','2030-02-18','2030-04-19','2030-05-20',
  '2030-07-01','2030-08-05','2030-09-02','2030-10-14',
  '2030-11-11','2030-12-25','2030-12-26',
]);

export function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function minsToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function generateTimeSlots(rangeStartMins: number, rangeEndMins: number, blockMins: number): Slot[] {
  const slots: Slot[] = [];
  for (let s = rangeStartMins; s + blockMins <= rangeEndMins; s += blockMins) {
    slots.push({
      label: `${minsToLabel(s)} – ${minsToLabel(s + blockMins)}`,
      start: minsToTimeStr(s),
      end:   minsToTimeStr(s + blockMins),
    });
  }
  return slots;
}

export function getSlotsForDateAndType(dateStr: string, moveType: string): Slot[] | null {
  if (!dateStr) return null;
  if (STATUTORY_HOLIDAYS.has(dateStr)) return [];
  const dow = dayjs(dateStr).day();
  const isWeekend = dow === 0 || dow === 6;
  if (moveType === 'DELIVERY') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 30);
  }
  if (moveType === 'RENO') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 60);
  }
  if (moveType === 'SUITCASE_MOVE') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 20 * 60] : [9 * 60, 17 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 60);
  }
  return isWeekend ? MOVE_WEEKEND_SLOTS : MOVE_WEEKDAY_SLOTS;
}

export function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function filterAvailableSlots(slots: Slot[], takenRanges: { start: string; end: string }[]): Slot[] {
  return slots.filter(slot => {
    const sS = timeToMins(slot.start), sE = timeToMins(slot.end);
    return !takenRanges.some(r => sS < timeToMins(r.end) && sE > timeToMins(r.start));
  });
}
