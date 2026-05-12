import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api';
import '../styles/resident.css';

// ── Time slot definitions (mirrors backend rules) ─────────────
type Slot = { label: string; start: string; end: string };

const MOVE_WEEKDAY_SLOTS: Slot[] = [
  { label: '9:00 AM – 12:00 PM', start: '09:00', end: '12:00' },
  { label: '1:00 PM – 4:00 PM',  start: '13:00', end: '16:00' },
];

const MOVE_WEEKEND_SLOTS: Slot[] = [
  { label: '12:00 PM – 3:00 PM', start: '12:00', end: '15:00' },
  { label: '4:00 PM – 7:00 PM',  start: '16:00', end: '19:00' },
];

const FURNISHED_WEEKDAY_SLOTS: Slot[] = [
  { label: '10:00 AM – 12:00 PM', start: '10:00', end: '12:00' },
  { label: '12:00 PM – 2:00 PM',  start: '12:00', end: '14:00' },
  { label: '2:00 PM – 4:00 PM',   start: '14:00', end: '16:00' },
];

const FURNISHED_WEEKEND_SLOTS: Slot[] = [
  { label: '12:00 PM – 2:00 PM', start: '12:00', end: '14:00' },
  { label: '2:00 PM – 4:00 PM',  start: '14:00', end: '16:00' },
];

const OPEN_HOUSE_SLOT: Slot[] = [
  { label: '2:00 PM – 5:00 PM', start: '14:00', end: '17:00' },
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
  if (STATUTORY_HOLIDAYS.has(dateStr)) return [];
  const dow = dayjs(dateStr).day();
  const isWeekend = dow === 0 || dow === 6;

  if (moveType === 'OPEN_HOUSE') {
    return isWeekend ? OPEN_HOUSE_SLOT : [];
  }
  if (moveType === 'DELIVERY') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 30);
  }
  if (moveType === 'RENO') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 60);
  }
  if (moveType === 'SUITCASE_MOVE') {
    if (isWeekend) {
      return [
        ...generateTimeSlots(8 * 60, 11 * 60, 60),
        ...generateTimeSlots(12 * 60, 15 * 60, 60),
        ...generateTimeSlots(16 * 60, 19 * 60, 60),
      ];
    }
    return [
      ...generateTimeSlots(9 * 60, 12 * 60, 60),
      ...generateTimeSlots(13 * 60, 16 * 60, 60),
    ];
  }
  if (moveType === 'FURNISHED_MOVE') {
    return isWeekend ? FURNISHED_WEEKEND_SLOTS : FURNISHED_WEEKDAY_SLOTS;
  }
  // MOVE_IN / MOVE_OUT
  return isWeekend ? MOVE_WEEKEND_SLOTS : MOVE_WEEKDAY_SLOTS;
}

// ── Types ────────────────────────────────────────────────────
type BookingStatus = 'SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

type Booking = {
  id: string;
  residentName: string;
  residentEmail: string;
  residentPhone: string;
  unit: string;
  moveType: string;
  moveTypeLabel: string;
  moveDate: string;
  startDatetime: string;
  endDatetime: string;
  elevatorRequired: boolean;
  loadingBayRequired: boolean;
  notes: string | null;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
};

const STATUS_CONFIG: Record<BookingStatus, { label: string; className: string }> = {
  SUBMITTED:  { label: 'Pending Review',  className: 'status-submitted' },
  PENDING:    { label: 'Pending Payment', className: 'status-pending' },
  APPROVED:   { label: 'Approved',        className: 'status-approved' },
  REJECTED:   { label: 'Not Approved',    className: 'status-rejected' },
  CANCELLED:  { label: 'Cancelled',       className: 'status-cancelled' },
};

export function ResidentBookingPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit form state
  const [editNotes, setEditNotes] = useState('');
  const [editElevator, setEditElevator] = useState(false);
  const [editLoadingBay, setEditLoadingBay] = useState(false);

  // Date/time change state
  const [editDate, setEditDate] = useState('');
  const [editSlot, setEditSlot] = useState('');
  const [takenRanges, setTakenRanges] = useState<{ start: string; end: string }[]>([]);
  const [changingTime, setChangingTime] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Cancel state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const fetchBooking = useCallback(async () => {
    if (!id || !token) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/public/bookings/${id}?token=${token}`);
      const b = res.data;
      setBooking(b);
      setEditNotes(b.notes ?? '');
      setEditElevator(b.elevatorRequired);
      setEditLoadingBay(b.loadingBayRequired);
      setEditDate(dayjs(b.startDatetime).format('YYYY-MM-DD'));
      const existing = getSlotsForDateAndType(dayjs(b.startDatetime).format('YYYY-MM-DD'), b.moveType);
      const match = existing?.find(s =>
        s.start === dayjs(b.startDatetime).format('HH:mm') &&
        s.end === dayjs(b.endDatetime).format('HH:mm')
      );
      setEditSlot(match?.start ?? '');
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError('Booking not found.');
      } else if (err.response?.status === 403) {
        setError('Invalid access link. Please check the link from your email.');
      } else {
        setError('Failed to load booking details.');
      }
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  // Fetch taken slots when date changes
  useEffect(() => {
    if (!editDate || !booking) { setTakenRanges([]); return; }
    api.get(`/api/public/taken-slots?date=${editDate}&excludeId=${booking.id}`)
      .then(res => setTakenRanges(res.data))
      .catch(() => setTakenRanges([]));
  }, [editDate, booking]);

  const isHoliday = !!editDate && STATUTORY_HOLIDAYS.has(editDate);
  const isOpenHouseWeekday = booking?.moveType === 'OPEN_HOUSE' && !!editDate && !isHoliday &&
    (() => { const d = dayjs(editDate).day(); return d !== 0 && d !== 6; })();
  const rawSlots = booking ? getSlotsForDateAndType(editDate, booking.moveType) : null;
  const availableSlots = rawSlots ? filterAvailableSlots(rawSlots, takenRanges) : rawSlots;

  const handleDateChange = (dateStr: string) => {
    setEditDate(dateStr);
    setEditSlot('');
  };

  const handleSave = async () => {
    if (!booking) return;
    setSaving(true);
    setSaveMessage('');

    const payload: Record<string, any> = {
      notes: editNotes,
      elevatorRequired: editElevator,
      loadingBayRequired: editLoadingBay,
    };

    if (changingTime) {
      if (isHoliday) {
        setSaveMessage('Bookings are not permitted on statutory holidays');
        setSaving(false);
        return;
      }
      if (!editSlot) {
        setSaveMessage('Please select a time slot');
        setSaving(false);
        return;
      }
      const selected = availableSlots?.find(s => s.start === editSlot);
      if (!selected) {
        setSaveMessage('Invalid time slot selected');
        setSaving(false);
        return;
      }
      payload.moveDate = editDate;
      payload.startDatetime = `${editDate}T${selected.start}:00`;
      payload.endDatetime = `${editDate}T${selected.end}:00`;
    }

    try {
      const res = await api.patch(`/api/public/bookings/${id}?token=${token}`, payload);
      setBooking(res.data);
      setSaveMessage('Changes saved successfully!');
      setChangingTime(false);
    } catch (err: any) {
      setSaveMessage(err.response?.data?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!booking) return;
    setCancelling(true);
    try {
      const res = await api.post(`/api/public/bookings/${id}/cancel?token=${token}`);
      setBooking(res.data);
      setShowCancelConfirm(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to cancel booking.');
      setShowCancelConfirm(false);
    } finally {
      setCancelling(false);
    }
  };

  const hasEdits =
    booking &&
    (editNotes !== (booking.notes ?? '') ||
      editElevator !== booking.elevatorRequired ||
      editLoadingBay !== booking.loadingBayRequired);

  const hasTimeChange = changingTime && editSlot &&
    (editDate !== dayjs(booking?.startDatetime).format('YYYY-MM-DD') ||
     editSlot !== dayjs(booking?.startDatetime).format('HH:mm'));

  const canSave = booking && (hasEdits || hasTimeChange);

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-container">
        <div className="resident-form-card">
          <p style={{ textAlign: 'center', color: '#64748b' }}>Loading booking details…</p>
        </div>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="page-container">
        <div className="resident-form-card">
          <h2 className="resident-form-title">Booking</h2>
          <p className="error-message">{error}</p>
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            If you&apos;re having trouble, please contact building management.
          </p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="page-container">
        <div className="resident-form-card">
          <h2 className="resident-form-title">Booking</h2>
          <p className="error-message">Missing access token. Please use the link from your email.</p>
        </div>
      </div>
    );
  }

  if (!booking) return null;

  const statusCfg = STATUS_CONFIG[booking.status];
  const showTimeOptions = booking.moveType !== 'OPEN_HOUSE';

  return (
    <div className="page-container">
      <div className="resident-form-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 className="resident-form-title" style={{ margin: 0 }}>My Booking</h2>
          <span className={`status-badge ${statusCfg.className}`}>{statusCfg.label}</span>
        </div>

        <style>{`
          .status-badge {
            display: inline-block;
            padding: 4px 14px;
            border-radius: 20px;
            font-size: 0.8125rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .status-submitted { background: #fef9c3; color: #854d0e; }
          .status-pending   { background: #fed7aa; color: #9a3412; }
          .status-approved  { background: #dcfce7; color: #166534; }
          .status-rejected  { background: #fecaca; color: #991b1b; }
          .status-cancelled { background: #e2e8f0; color: #475569; }

          .move-type-notice {
            background: #fefce8;
            border: 1px solid #fde047;
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 16px;
            font-size: 0.875rem;
            color: #713f12;
            line-height: 1.5;
          }
        `}</style>

        {/* ── Booking details ─────────────────────────────── */}
        <fieldset className="form-group">
          <legend className="form-group-legend">Booking Details</legend>
          <table style={{ borderCollapse: 'collapse', fontFamily: 'Arial, sans-serif', fontSize: '0.9375rem', width: '100%' }}>
            <tbody>
              {[
                ['Resident', booking.residentName],
                ['Unit', booking.unit],
                ['Type', booking.moveTypeLabel],
                ['Date', dayjs(booking.startDatetime).format('dddd, MMMM D, YYYY')],
                ['Time', `${dayjs(booking.startDatetime).format('h:mm A')} – ${dayjs(booking.endDatetime).format('h:mm A')}`],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: '6px 12px 6px 0', color: '#555', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>{label}</td>
                  <td style={{ padding: '6px 0', color: '#111' }}>{value}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '6px 12px 6px 0', color: '#555', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>Reference</td>
                <td style={{ padding: '6px 0', color: '#888', fontSize: '0.8125rem' }}>{booking.id}</td>
              </tr>
            </tbody>
          </table>
        </fieldset>

        {!['CANCELLED', 'REJECTED'].includes(booking.status) && (
          <>
            {/* ── Edit form ────────────────────────────────── */}
            <fieldset className="form-group">
              <legend className="form-group-legend">Make Changes</legend>

              <div className="form-field">
                <label htmlFor="edit-elevator">Elevator Required</label>
                <label className="checkbox-label" style={{ marginTop: 4 }}>
                  <input type="checkbox" id="edit-elevator" checked={editElevator}
                    onChange={(e) => setEditElevator(e.target.checked)} />
                  Yes, I need the elevator
                </label>
              </div>

              <div className="form-field">
                <label htmlFor="edit-loading-bay">Loading Bay Required</label>
                <label className="checkbox-label" style={{ marginTop: 4 }}>
                  <input type="checkbox" id="edit-loading-bay" checked={editLoadingBay}
                    onChange={(e) => setEditLoadingBay(e.target.checked)} />
                  Yes, I need the loading bay
                </label>
              </div>

              <div className="form-field">
                <label htmlFor="edit-notes">Notes</label>
                <textarea id="edit-notes" rows={3} placeholder="Optional details"
                  maxLength={2000}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)} />
              </div>

              {/* ── Change date/time ─────────────────────── */}
              {showTimeOptions && (
                <div className="form-field" style={{ marginTop: 16 }}>
                  <label className="checkbox-label" style={{ fontWeight: 600 }}>
                    <input type="checkbox" checked={changingTime}
                      onChange={(e) => { setChangingTime(e.target.checked); if (!e.target.checked) setEditSlot(''); }} />
                    Change date or time slot
                  </label>
                </div>
              )}

              {changingTime && (
                <>
                  <div className="form-field">
                    <label htmlFor="edit-date" className="required">New Date</label>
                    <input id="edit-date" type="date"
                      min={dayjs().format('YYYY-MM-DD')}
                      value={editDate}
                      onChange={(e) => handleDateChange(e.target.value)} />
                  </div>

                  {isHoliday && (
                    <p className="error-message" style={{ margin: '4px 0 8px' }}>
                      This date is a statutory holiday — no bookings are permitted.
                    </p>
                  )}

                  <div className="form-field">
                    <label htmlFor="edit-time-slot" className="required">New Time Slot</label>
                    <select id="edit-time-slot"
                      value={editSlot}
                      onChange={(e) => setEditSlot(e.target.value)}
                      disabled={!editDate || isHoliday || availableSlots?.length === 0}>
                      <option value="">
                        {!editDate ? 'Select a date first' : availableSlots?.length === 0 ? 'No slots available' : 'Select a time slot'}
                      </option>
                      {(availableSlots ?? []).map((s) => (
                        <option key={s.start} value={s.start}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* ── Move type notice ─────────────────────── */}
              <div className="move-type-notice">
                <strong>Changing your move type?</strong> If you need a different type of booking,
                please <strong>cancel this booking</strong> below and submit a new request.
                Move type cannot be changed on an existing booking.
              </div>

              <button className="btn-full" disabled={!canSave || saving} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {saveMessage && (
                <p className={saveMessage.includes('successfully') ? 'success-message' : 'error-message'} style={{ marginTop: 8 }}>
                  {saveMessage}
                </p>
              )}
            </fieldset>

            {/* ── Cancel booking ───────────────────────────── */}
            <fieldset className="form-group" style={{ borderColor: '#fecaca' }}>
              <legend className="form-group-legend" style={{ color: '#dc2626' }}>Cancel Booking</legend>
              <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 12px' }}>
                If you no longer need this booking, you can cancel it here.
              </p>
              {!showCancelConfirm ? (
                <button className="btn-full"
                  style={{ background: '#dc2626' }}
                  onClick={() => setShowCancelConfirm(true)}>
                  Cancel This Booking
                </button>
              ) : (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16 }}>
                  <p style={{ color: '#991b1b', fontWeight: 600, margin: '0 0 12px', fontSize: '0.9375rem' }}>
                    Are you sure you want to cancel this booking?
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={cancelling}
                      style={{ background: '#dc2626', flex: 1 }}
                      onClick={handleCancel}>
                      {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
                    </button>
                    <button disabled={cancelling}
                      style={{ background: '#64748b', flex: 1 }}
                      onClick={() => setShowCancelConfirm(false)}>
                      Keep Booking
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
          </>
        )}

        {booking.status === 'CANCELLED' && (
          <fieldset className="form-group" style={{ borderColor: '#e2e8f0' }}>
            <legend className="form-group-legend" style={{ color: '#475569' }}>Cancelled</legend>
            <p style={{ fontSize: '0.9375rem', color: '#475569', margin: 0 }}>
              This booking has been cancelled. If you need assistance, please contact building management.
            </p>
          </fieldset>
        )}

        {booking.status === 'REJECTED' && (
          <fieldset className="form-group" style={{ borderColor: '#fecaca' }}>
            <legend className="form-group-legend" style={{ color: '#dc2626' }}>Not Approved</legend>
            <p style={{ fontSize: '0.9375rem', color: '#991b1b', margin: 0 }}>
              Unfortunately this booking request could not be approved. Please contact building management if you have any questions.
            </p>
          </fieldset>
        )}

        {error && <p className="error-message" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}
