import { FormEvent, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import '../styles/resident.css';

// ── Time slot definitions ─────────────────────────────────────
type Slot = { label: string; start: string; end: string };

// Fixed 3-hour slots for MOVE_IN / MOVE_OUT
const MOVE_WEEKDAY_SLOTS: Slot[] = [
  { label: '10:00 AM – 1:00 PM', start: '10:00', end: '13:00' },
  { label: '1:00 PM – 4:00 PM',  start: '13:00', end: '16:00' },
];

const MOVE_WEEKEND_SLOTS: Slot[] = [
  { label: '8:00 AM – 11:00 AM', start: '08:00', end: '11:00' },
  { label: '11:00 AM – 2:00 PM', start: '11:00', end: '14:00' },
  { label: '2:00 PM – 5:00 PM',  start: '14:00', end: '17:00' },
];

// BC Statutory Holidays 2025–2030 (mirrors backend list)
const STATUTORY_HOLIDAYS = new Set([
  // 2025
  '2025-01-01','2025-02-17','2025-04-18','2025-05-19',
  '2025-07-01','2025-08-04','2025-09-01','2025-10-13',
  '2025-11-11','2025-12-25','2025-12-26',
  // 2026
  '2026-01-01','2026-02-16','2026-04-03','2026-05-18',
  '2026-07-01','2026-08-03','2026-09-07','2026-10-12',
  '2026-11-11','2026-12-25','2026-12-26',
  // 2027
  '2027-01-01','2027-02-15','2027-03-26','2027-05-24',
  '2027-07-01','2027-08-02','2027-09-06','2027-10-11',
  '2027-11-11','2027-12-25','2027-12-26',
  // 2028
  '2028-01-01','2028-02-21','2028-04-14','2028-05-22',
  '2028-07-01','2028-08-07','2028-09-04','2028-10-09',
  '2028-11-11','2028-12-25','2028-12-26',
  // 2029
  '2029-01-01','2029-02-19','2029-03-30','2029-05-21',
  '2029-07-01','2029-08-06','2029-09-03','2029-10-08',
  '2029-11-11','2029-12-25','2029-12-26',
  // 2030
  '2030-01-01','2030-02-18','2030-04-19','2030-05-20',
  '2030-07-01','2030-08-05','2030-09-02','2030-10-14',
  '2030-11-11','2030-12-25','2030-12-26',
]);

function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minsToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function generateTimeSlots(rangeStartMins: number, rangeEndMins: number, blockMins: number): Slot[] {
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

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function filterAvailableSlots(slots: Slot[], takenRanges: { start: string; end: string }[]): Slot[] {
  return slots.filter(slot => {
    const sS = timeToMins(slot.start), sE = timeToMins(slot.end);
    return !takenRanges.some(r => sS < timeToMins(r.end) && sE > timeToMins(r.start));
  });
}

function getSlotsForDateAndType(dateStr: string, moveType: string): Slot[] | null {
  if (!dateStr) return null;
  if (STATUTORY_HOLIDAYS.has(dateStr)) return []; // holiday — no slots
  const dow = dayjs(dateStr).day(); // 0 Sun, 6 Sat
  const isWeekend = dow === 0 || dow === 6;

  if (moveType === 'DELIVERY') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 30);
  }

  if (moveType === 'RENO') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 60);
  }

  // MOVE_IN / MOVE_OUT: fixed half-day slots
  return isWeekend ? MOVE_WEEKEND_SLOTS : MOVE_WEEKDAY_SLOTS;
}

export function ResidentSubmissionPage() {
  const [form, setForm] = useState<any>({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
  const [slot, setSlot] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [takenRanges, setTakenRanges] = useState<{ start: string; end: string }[]>([]);

  useEffect(() => {
    if (!form.moveDate) { setTakenRanges([]); return; }
    api.get(`/api/public/taken-slots?date=${form.moveDate}`)
      .then(res => setTakenRanges(res.data))
      .catch(() => setTakenRanges([]));
  }, [form.moveDate]);

  const rawSlots = getSlotsForDateAndType(form.moveDate ?? '', form.moveType ?? 'MOVE_IN');
  const isHoliday = form.moveDate && rawSlots !== null && rawSlots.length === 0;
  const availableSlots = rawSlots ? filterAvailableSlots(rawSlots, takenRanges) : rawSlots;

  const handleDateChange = (dateStr: string) => {
    setForm({ ...form, moveDate: dateStr });
    setSlot('');
  };

  const handleMoveTypeChange = (moveType: string) => {
    setForm({ ...form, moveType });
    setSlot('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();

    if (!form.residentName || !form.residentEmail || !form.residentPhone || !form.unit) {
      setError('Please fill in all required fields');
      setMessage('');
      return;
    }
    if (!form.moveDate) {
      setError('Please select a date');
      setMessage('');
      return;
    }
    if (isHoliday) {
      setError('Bookings are not permitted on statutory holidays');
      setMessage('');
      return;
    }
    if (!slot) {
      setError('Please select a time slot');
      setMessage('');
      return;
    }
    if (!accepted) {
      setError('You must accept the strata bylaws and rules before submitting');
      setMessage('');
      return;
    }

    // Build startDatetime / endDatetime from date + slot
    const selected = availableSlots?.find((s) => s.start === slot);
    if (!selected) {
      setError('Invalid time slot selected');
      return;
    }
    const startDatetime = `${form.moveDate}T${selected.start}:00`;
    const endDatetime   = `${form.moveDate}T${selected.end}:00`;

    setIsSubmitting(true);
    setError('');
    setMessage('');
    try {
      await api.post('/api/bookings', { ...form, startDatetime, endDatetime });
      setMessage('Booking request submitted successfully! Check your email for confirmation.');
      setForm({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
      setSlot('');
      setAccepted(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDeliveryOrReno = form.moveType === 'DELIVERY' || form.moveType === 'RENO';
  const blockLabel = form.moveType === 'DELIVERY' ? '30-minute blocks' : '1-hour slots';

  return (
    <div className="page-container">
      <div className="resident-form-card">
        <h2 className="resident-form-title">Booking Request</h2>

        <div className="move-times-notice">
          <h3 className="move-times-heading">Permitted Times</h3>
          {isDeliveryOrReno ? (
            <div className="move-times-grid">
              <div>
                <strong>Monday – Friday</strong>
                <p style={{ margin: '4px 0 2px' }}>10:00 AM – 4:00 PM</p>
                <small>{blockLabel}</small>
              </div>
              <div>
                <strong>Saturday &amp; Sunday</strong>
                <p style={{ margin: '4px 0 2px' }}>8:00 AM – 5:00 PM</p>
                <small>{blockLabel}</small>
              </div>
            </div>
          ) : (
            <div className="move-times-grid">
              <div>
                <strong>Monday – Friday</strong>
                <ul className="move-times-list">
                  <li>10:00 AM – 1:00 PM</li>
                  <li>1:00 PM – 4:00 PM</li>
                </ul>
              </div>
              <div>
                <strong>Saturday &amp; Sunday</strong>
                <ul className="move-times-list">
                  <li>8:00 AM – 11:00 AM</li>
                  <li>11:00 AM – 2:00 PM</li>
                  <li>2:00 PM – 5:00 PM</li>
                </ul>
              </div>
            </div>
          )}
          <p className="move-times-holiday">No Bookings Permitted on Statutory Holidays</p>
        </div>

        <form onSubmit={submit}>
          <fieldset className="form-group">
            <legend className="form-group-legend">Your Information</legend>

            <div className="form-field">
              <label htmlFor="resident-name" className="required">Resident Name</label>
              <input id="resident-name" placeholder="e.g. Jane Smith"
                value={form.residentName ?? ''}
                onChange={(e) => setForm({ ...form, residentName: e.target.value })} />
            </div>

            <div className="form-field">
              <label htmlFor="resident-email" className="required">Resident Email</label>
              <input id="resident-email" type="email" placeholder="name@example.com"
                value={form.residentEmail ?? ''}
                onChange={(e) => setForm({ ...form, residentEmail: e.target.value })} />
            </div>

            <div className="form-field">
              <label htmlFor="resident-phone" className="required">Resident Phone</label>
              <input id="resident-phone" placeholder="e.g. 604-555-1234"
                value={form.residentPhone ?? ''}
                onChange={(e) => setForm({ ...form, residentPhone: e.target.value })} />
            </div>

            <div className="form-field">
              <label htmlFor="unit" className="required">Unit</label>
              <input id="unit" placeholder="e.g. 1204"
                value={form.unit ?? ''}
                onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
          </fieldset>

          <fieldset className="form-group">
            <legend className="form-group-legend">Booking Details</legend>

            <div className="form-field">
              <label htmlFor="move-type" className="required">Booking Type</label>
              <select id="move-type" value={form.moveType}
                onChange={(e) => handleMoveTypeChange(e.target.value)}>
                <option value="MOVE_IN">Move In</option>
                <option value="MOVE_OUT">Move Out</option>
                <option value="DELIVERY">Delivery</option>
                <option value="RENO">Renovation</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="move-date" className="required">Date</label>
              <input id="move-date" type="date"
                value={form.moveDate ?? ''}
                onChange={(e) => handleDateChange(e.target.value)} />
            </div>

            {isHoliday && (
              <p className="error-message slot-holiday-msg">
                This date is a statutory holiday — no bookings are permitted.
              </p>
            )}

            <div className="form-field">
              <label htmlFor="time-slot" className="required">Time Slot</label>
              <select
                id="time-slot"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                disabled={!form.moveDate || isHoliday}
              >
                <option value="">
                  {!form.moveDate ? 'Select a date first' : 'Select a time slot'}
                </option>
                {(availableSlots ?? []).map((s) => (
                  <option key={s.start} value={s.start}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" rows={3} placeholder="Optional details"
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </fieldset>

          <fieldset className="form-group">
            <legend className="form-group-legend">Resources Required</legend>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.elevatorRequired}
                onChange={(e) => setForm({ ...form, elevatorRequired: e.target.checked })} />
              Elevator Required
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.loadingBayRequired}
                onChange={(e) => setForm({ ...form, loadingBayRequired: e.target.checked })} />
              Loading Bay Required
            </label>
          </fieldset>

          <div className="bylaws-acceptance">
            <label className="bylaws-label">
              <input type="checkbox" checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)} />
              <span>
                I confirm that I have read and will comply with the strata bylaws and move
                rules, and that all required move fees/deposits have been or will be paid
                prior to the move. I accept responsibility for any damage caused during
                the move.
              </span>
            </label>
          </div>

          <button className="btn-full" disabled={isSubmitting || !accepted} type="submit">
            {isSubmitting ? 'Submitting…' : 'Submit Booking Request'}
          </button>

          {error   && <p className="error-message">{error}</p>}
          {message && <p className="success-message">{message}</p>}
        </form>
      </div>
    </div>
  );
}
