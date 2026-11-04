import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { errorMessage } from '../../auth/session';
import { useAdmin } from './AdminLayout';
import { parseBookingTime, selectedSlotRange } from '../../utils/bookingTime';
import {
  filterAvailableSlots, getSlotsForDateAndType, minsToLabel, timeToMins,
} from '../../utils/slots';
import '../../styles/admin.css';

type Tab = 'action' | 'today' | 'upcoming' | 'past' | 'closed';

const MOVE_TYPE_LABELS: Record<string, string> = {
  MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', DELIVERY: 'Delivery', RENO: 'Renovation',
  FURNISHED_MOVE: 'Furnished Move', SUITCASE_MOVE: 'Suitcase Move', OPEN_HOUSE: 'Open House',
};
const REJECT_REASONS = ['Payment not received', 'Time slot unavailable', 'Duplicate request', 'Information incomplete'];

const emptyQuickEntry = {
  residentName: '', residentEmail: '', residentPhone: '', unit: '',
  moveType: 'MOVE_IN', companyName: '', moveDate: '', elevatorRequired: true,
  loadingBayRequired: false, notes: '', publicUnitMask: '',
};

const COMMON_TLDS_ADMIN = new Set([
  'com','net','org','edu','gov','mil','int','info','biz','name','pro','aero','coop','museum',
  'io','co','app','dev','ai','gg','me','tv','fm','ac','cc','xyz','online','site','store',
  'tech','cloud','digital','media','news','live','shop','web','blog','design','email',
  'ca','uk','au','nz','us','ie','de','fr','es','it','nl','be','ch','at','se','no','dk',
  'fi','pl','pt','cz','sk','hu','ro','gr','hr','bg','lt','lv','ee','si','rs','mk','al',
  'ba','by','ua','ru','kz','uz','ge','am','az','md','kg','tj','af','bd','in','pk','lk',
  'np','mm','kh','th','vn','my','sg','id','ph','jp','cn','tw','kr','hk','mo','mn','la',
  'bn','bt','mv','cx','gi','im','je','vg','ky','tc','ms','dm','gd','lc','vc','bb','tt',
  'ag','kn','jm','ht','do','pr','cu','bs','bm','aw','cw','sx','re','yt','nc','pf','mq',
  'gp','tf','pm','sh','gs','fk','ar','br','cl','ec','pe','uy','ve','mx','gt','hn','sv',
  'ni','cr','pa','tz','ke','ng','gh','za','eg','ma','dz','tn','ly','sd','et','ug','rw',
  'mz','zm','zw','bw','na','ls','sz','mw','mg','mu','sc','km','dj','so','er','sa','ae',
  'qa','kw','bh','om','ye','iq','ir','sy','lb','jo','il','ps','tr','cy','mt','is','li',
  'lu','mc','sm','va','ad','fo','gl','nu','tk','to','ws','fj','pg','sb','vu','ki','pw',
  'nr','as','mp','gu','wf','arpa',
]);
const BLOCKED_AREA_CODES_ADMIN = new Set(['000', '111', '911']);

function validateEditEmail(v: string): string {
  if (!v.trim()) return '';  // email is optional in admin context
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Enter a valid email address';
  const domain = v.slice(v.lastIndexOf('@') + 1).toLowerCase();
  const dotIdx = domain.lastIndexOf('.');
  const tld = dotIdx >= 0 ? domain.slice(dotIdx + 1) : '';
  if (!COMMON_TLDS_ADMIN.has(tld)) return `Unrecognized email extension: .${tld}`;
  return '';
}

function validateEditPhone(v: string): string {
  if (!v.trim()) return '';  // phone is optional in admin context
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10) return 'Phone number must have at least 10 digits';
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.slice(0, 10);
  const area = ten.slice(0, 3);
  if (BLOCKED_AREA_CODES_ADMIN.has(area)) return `Area code ${area} is not valid`;
  if (/^(\d)\1{9}$/.test(ten)) return 'Phone number appears invalid';
  return '';
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

export function PaymentBadge({ b }: { b: any }) {
  if (b.paymentStatus === 'PAID') return <span className="pay-badge pay-badge--paid">Paid{b.paymentInvoiceId ? ` · ${b.paymentInvoiceId}` : ''}</span>;
  if (b.paymentStatus === 'REFUNDED') return <span className="pay-badge pay-badge--refunded">Payment reversed</span>;
  if (b.status === 'APPROVED') {
    if (b.approvalSource === 'AUTO') return <span className="pay-badge pay-badge--exempt">No fee</span>;
    return <span className="pay-badge pay-badge--manual">Approved without payment</span>;
  }
  if (b.status === 'SUBMITTED' || b.status === 'PENDING') return <span className="pay-badge pay-badge--unpaid">Awaiting payment</span>;
  return null;
}

function ReasonDialog({ title, confirmLabel, suggestions, onConfirm, onClose }: {
  title: string; confirmLabel: string; suggestions?: string[]; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 440 }}>
        <h3 style={{ margin: '0 0 12px' }}>{title}</h3>
        <p className="admin-section-desc" style={{ marginTop: 0 }}>The reason is recorded in the booking history and included in the resident's email.</p>
        {suggestions && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {suggestions.map((s) => <button key={s} type="button" className="queue-tab" onClick={() => setReason(s)}>{s}</button>)}
          </div>
        )}
        <textarea rows={3} value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Reason" style={{ width: '100%' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-sm btn-red" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</button>
          <button className="btn-sm btn-slate" onClick={onClose}>Back</button>
        </div>
      </div>
    </div>
  );
}

export function QueuePage() {
  const { handleAuthError, canManage } = useAdmin();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<any[]>([]);
  const [stats, setStats] = useState<any>();
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('action');
  const [search, setSearch] = useState('');
  const [reasonFor, setReasonFor] = useState<{ booking: any; status: 'REJECTED' | 'CANCELLED' } | null>(null);

  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickForm, setQuickForm] = useState<any>(emptyQuickEntry);
  const [quickSlots, setQuickSlots] = useState<string[]>([]);
  const [quickError, setQuickError] = useState('');
  const [isQuickSubmitting, setIsQuickSubmitting] = useState(false);
  const [quickTakenRanges, setQuickTakenRanges] = useState<{ start: string; end: string }[]>([]);

  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editSlots, setEditSlots] = useState<string[]>([]);
  const [editOriginalStartDatetime, setEditOriginalStartDatetime] = useState('');
  const [editOriginalEndDatetime, setEditOriginalEndDatetime] = useState('');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editTakenRanges, setEditTakenRanges] = useState<{ start: string; end: string }[]>([]);

  const refresh = async () => {
    setLoadError('');
    try {
      const [b, s] = await Promise.all([api.get('/api/admin/bookings'), api.get('/api/admin/stats')]);
      setBookings(b.data);
      setStats(s.data);
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setLoadError(error.response?.status === 403 ? 'You do not have permission to access admin data.' : 'Failed to load admin data. Please refresh the page.');
    }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!quickForm.moveDate) { setQuickTakenRanges([]); return; }
    api.get(`/api/public/taken-slots?date=${quickForm.moveDate}`)
      .then((res: any) => setQuickTakenRanges(res.data))
      .catch(() => setQuickTakenRanges([]));
  }, [quickForm.moveDate]);

  useEffect(() => {
    if (!editingBookingId || !editForm.moveDate) { setEditTakenRanges([]); return; }
    api.get(`/api/public/taken-slots?date=${editForm.moveDate}&excludeId=${editingBookingId}`)
      .then((res: any) => setEditTakenRanges(res.data))
      .catch(() => setEditTakenRanges([]));
  }, [editingBookingId, editForm.moveDate]);

  // ── Actions ──────────────────────────────────────────────────
  const patchStatus = async (b: any, payload: Record<string, unknown>, success: string) => {
    setIsUpdating(b.id);
    setActionMessage('');
    try {
      await api.patch(`/api/admin/bookings/${b.id}`, payload);
      setActionMessage(success);
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      if (error.response?.data?.code === 'PAYMENT_REQUIRED') {
        if (confirm(`No payment is matched to ${b.residentName}'s booking (Unit ${b.unit}).\n\nApprove it WITHOUT payment? This is recorded in the booking history.`)) {
          setIsUpdating(null);
          return patchStatus(b, { ...payload, approveWithoutPayment: true }, success);
        }
        return;
      }
      setActionMessage(errorMessage(error, 'Action failed.'));
    } finally { setIsUpdating(null); }
  };

  const approve = (b: any) => patchStatus(b, { status: 'APPROVED' }, `Booking approved for ${b.residentName}`);

  const sendPaymentReminder = async (b: any) => {
    if (!confirm(`Send a payment due reminder email to ${b.residentName}?`)) return;
    setIsUpdating(b.id);
    setActionMessage('');
    try {
      await api.post(`/api/admin/bookings/${b.id}/payment-due-reminder`);
      setActionMessage('Payment reminder sent.');
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(errorMessage(error, 'Failed to send payment reminder.'));
    } finally { setIsUpdating(null); }
  };

  const submitQuickEntry = async (e: FormEvent) => {
    e.preventDefault();
    setQuickError('');
    const slots = getSlotsForDateAndType(quickForm.moveDate, quickForm.moveType);
    const range = slots ? selectedSlotRange(slots, quickSlots) : null;
    if (!range) { setQuickError('Please select a valid time slot.'); return; }
    const startDatetime = `${quickForm.moveDate}T${range.start}:00`;
    const endDatetime   = `${quickForm.moveDate}T${range.end}:00`;
    setIsQuickSubmitting(true);
    try {
      await api.post('/api/admin/quick-entry/approve', { ...quickForm, startDatetime, endDatetime });
      setQuickForm(emptyQuickEntry);
      setQuickSlots([]);
      setShowQuickEntry(false);
      await refresh();
      setActionMessage('Booking created and approved successfully');
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setQuickError(error.response?.data?.message || 'Failed to create booking.');
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  const openEditBooking = (b: any) => {
    const dt = parseBookingTime(b.startDatetime);
    const moveDate = dt.format('YYYY-MM-DD');
    const hh = dt.format('HH');
    const mm = dt.format('mm');
    setEditingBookingId(b.id);
    setEditForm({
      residentName: b.residentName ?? '',
      residentEmail: b.residentEmail ?? '',
      residentPhone: b.residentPhone ?? '',
      unit: b.unit ?? '',
      companyName: b.companyName ?? '',
      moveType: b.moveType ?? 'MOVE_IN',
      moveDate,
      elevatorRequired: !!b.elevatorRequired,
      loadingBayRequired: !!b.loadingBayRequired,
      notes: b.notes ?? '',
    });
    const startHHmm = `${hh}:${mm}`;
    const endHHmm = parseBookingTime(b.endDatetime).format('HH:mm');
    if (b.moveType === 'RENO') {
      // Preselect every 1-hour slot covered by the existing renovation booking.
      const rawSlots = getSlotsForDateAndType(moveDate, b.moveType);
      const covered = (rawSlots ?? [])
        .filter((s) => s.start >= startHHmm && s.end <= endHHmm)
        .map((s) => s.start);
      setEditSlots(covered.length ? covered : [startHHmm]);
    } else {
      setEditSlots([startHHmm]);
    }
    setEditOriginalStartDatetime(b.startDatetime);
    setEditOriginalEndDatetime(b.endDatetime);
    setEditError('');
    setEditTakenRanges([]);
  };

  const closeEditBooking = () => {
    setEditingBookingId(null);
    setEditForm({});
    setEditSlots([]);
    setEditOriginalStartDatetime('');
    setEditOriginalEndDatetime('');
    setEditError('');
  };

  const saveEditBooking = async () => {
    const emailErr = validateEditEmail(editForm.residentEmail);
    if (emailErr) { setEditError(emailErr); return; }
    const phoneErr = validateEditPhone(editForm.residentPhone);
    if (phoneErr) { setEditError(phoneErr); return; }

    const slots = getSlotsForDateAndType(editForm.moveDate, editForm.moveType);
    const range = slots ? selectedSlotRange(slots, editSlots) : null;
    // Keep the original times when the existing booking's range doesn't line up with
    // standard slots (e.g. an admin override) and the date wasn't changed.
    const originalDate = editOriginalStartDatetime
      ? parseBookingTime(editOriginalStartDatetime).format('YYYY-MM-DD')
      : '';
    const isKeepingOriginalSlot = !range && !!editOriginalStartDatetime && editForm.moveDate === originalDate;
    if (!range && !isKeepingOriginalSlot) { setEditError('Please select a valid time slot.'); return; }
    const startDatetime = range ? `${editForm.moveDate}T${range.start}:00` : editOriginalStartDatetime;
    const endDatetime   = range ? `${editForm.moveDate}T${range.end}:00`   : editOriginalEndDatetime;

    setIsSavingEdit(true);
    setEditError('');
    try {
      await api.patch(`/api/admin/bookings/${editingBookingId}`, {
        residentName: editForm.residentName,
        residentEmail: editForm.residentEmail,
        residentPhone: editForm.residentPhone,
        unit: editForm.unit,
        companyName: editForm.companyName || null,
        moveType: editForm.moveType,
        startDatetime,
        endDatetime,
        elevatorRequired: editForm.elevatorRequired,
        loadingBayRequired: editForm.loadingBayRequired,
        notes: editForm.notes || null,
      });
      closeEditBooking();
      await refresh();
      setActionMessage('Booking updated successfully');
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setEditError(error.response?.data?.message || 'Failed to update booking.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // ── Derived lists ────────────────────────────────────────────
  const { groups, counts } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const when = (b: any) => parseBookingTime(b.startDatetime).toDate();
    const isOpen = (b: any) => b.status === 'SUBMITTED' || b.status === 'PENDING';
    const isClosed = (b: any) => b.status === 'REJECTED' || b.status === 'CANCELLED';
    const g: Record<Tab, any[]> = {
      action: bookings.filter((b) => when(b) >= today && (isOpen(b) || b.paymentStatus === 'REFUNDED')),
      today: bookings.filter((b) => !isClosed(b) && when(b) >= today && when(b) < tomorrow),
      upcoming: bookings.filter((b) => b.status === 'APPROVED' && when(b) >= tomorrow),
      past: bookings.filter((b) => !isClosed(b) && when(b) < today).sort((a, b) => when(b).valueOf() - when(a).valueOf()),
      closed: bookings.filter(isClosed).sort((a, b) => when(b).valueOf() - when(a).valueOf()),
    };
    return { groups: g, counts: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.length])) as Record<Tab, number> };
  }, [bookings]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? bookings.filter((b) => [b.residentName, b.unit, b.residentEmail, b.companyName].some((v) => (v ?? '').toLowerCase().includes(q)))
    : groups[tab];

  const TAB_LABELS: Record<Tab, string> = { action: 'Needs action', today: 'Today', upcoming: 'Upcoming', past: 'Past', closed: 'Rejected / cancelled' };
  const EMPTY: Record<Tab, string> = {
    action: 'Nothing needs action — all caught up.', today: 'No moves today.', upcoming: 'No approved upcoming bookings.',
    past: 'No past bookings.', closed: 'No rejected or cancelled bookings.',
  };

  const qRawSlots = getSlotsForDateAndType(quickForm.moveDate, quickForm.moveType);
  const qIsHoliday = quickForm.moveDate && qRawSlots !== null && qRawSlots.length === 0;
  const qSlots = qRawSlots ? filterAvailableSlots(qRawSlots, quickTakenRanges) : qRawSlots;
  const qIsReno = quickForm.moveType === 'RENO';
  const qRange = qRawSlots ? selectedSlotRange(qRawSlots, quickSlots) : null;

  const renderBooking = (b: any) => {
    const open = b.status === 'SUBMITTED' || b.status === 'PENDING';
    const busy = isUpdating === b.id;
    return (
      <div key={b.id} className={`booking-card booking-card--${b.status?.toLowerCase()}`}>
        <div className="booking-card-body">
          <div className="booking-card-top">
            <span className={`move-type-chip move-type-chip--${b.moveType?.toLowerCase()}`}>{MOVE_TYPE_LABELS[b.moveType] ?? b.moveType}</span>
            <span className={`booking-status ${b.status}`}>{b.status}</span>
            <PaymentBadge b={b} />
          </div>
          <div className="booking-name">
            <Link className="booking-link" to={`/admin/bookings/${b.id}`}>{b.residentName} — Unit {b.unit}</Link>
          </div>
          {b.startDatetime && (
            <div className="booking-meta">
              {fmtDate(b.startDatetime)}{b.endDatetime ? ` · ${fmtTime(b.startDatetime)} – ${fmtTime(b.endDatetime)}` : ''}
            </div>
          )}
          {(b.residentEmail || b.residentPhone) && (
            <div className="booking-contact">
              {b.residentEmail && <span>{b.residentEmail}</span>}
              {b.residentPhone && <span>{b.residentPhone}</span>}
            </div>
          )}
          <div className="booking-tags">
            {b.elevatorRequired && <span className="booking-tag">Elevator</span>}
            {b.loadingBayRequired && <span className="booking-tag">Loading Bay</span>}
          </div>
          {b.notes && <div className="booking-notes">{b.notes}</div>}
          {b.statusReason && <div className="booking-reason">Reason: {b.statusReason}</div>}
        </div>
        <div className="booking-actions">
          {open && (
            <button className={`btn-sm ${b.paymentStatus === 'PAID' ? 'btn-green' : 'btn-amber'}`} onClick={() => approve(b)} disabled={busy}>
              {busy ? '…' : b.paymentStatus === 'PAID' ? 'Approve' : 'Approve without payment'}
            </button>
          )}
          {open && b.paymentStatus === 'NONE' && (
            <button className="btn-sm btn-slate" onClick={() => sendPaymentReminder(b)} disabled={busy}>Send reminder</button>
          )}
          {(open || b.status === 'APPROVED') && (
            <button className="btn-sm btn-blue" onClick={() => openEditBooking(b)} disabled={busy}>Edit</button>
          )}
          {open && <button className="btn-sm btn-red" onClick={() => setReasonFor({ booking: b, status: 'REJECTED' })} disabled={busy}>Reject</button>}
          {b.status === 'APPROVED' && <button className="btn-sm btn-red" onClick={() => setReasonFor({ booking: b, status: 'CANCELLED' })} disabled={busy}>Cancel</button>}
          <button className="btn-sm btn-slate" onClick={() => navigate(`/admin/bookings/${b.id}`)}>Details</button>
        </div>
      </div>
    );
  };

  return (
    <>
      {reasonFor && (
        <ReasonDialog
          title={reasonFor.status === 'REJECTED' ? `Reject booking for ${reasonFor.booking.residentName}?` : `Cancel booking for ${reasonFor.booking.residentName}?`}
          confirmLabel={reasonFor.status === 'REJECTED' ? 'Reject booking' : 'Cancel booking'}
          suggestions={reasonFor.status === 'REJECTED' ? REJECT_REASONS : undefined}
          onClose={() => setReasonFor(null)}
          onConfirm={(reason) => {
            const { booking, status } = reasonFor;
            setReasonFor(null);
            patchStatus(booking, { status, reason }, status === 'REJECTED' ? 'Booking rejected' : 'Booking cancelled');
          }}
        />
      )}

      {editingBookingId && (() => {
        const eRawSlots = getSlotsForDateAndType(editForm.moveDate, editForm.moveType);
        const eIsHoliday = editForm.moveDate && eRawSlots !== null && eRawSlots.length === 0;
        const eSlots = eRawSlots ? filterAvailableSlots(eRawSlots, editTakenRanges) : eRawSlots;
        const eIsReno = editForm.moveType === 'RENO';
        const eRange = eRawSlots ? selectedSlotRange(eRawSlots, editSlots) : null;
        // Ensure currently selected slots are always shown, even if they were filtered out
        // because they overlap another booking (e.g. date unchanged, or an override).
        const eSelectedToShow = eIsReno ? editSlots : editSlots.slice(0, 1);
        const allESlots = (() => {
          const options = [...(eSlots ?? [])];
          for (const start of eSelectedToShow) {
            if (!options.some((s) => s.start === start)) {
              const raw = eRawSlots?.find((s) => s.start === start);
              options.push(raw ?? { label: `${start} (current)`, start, end: '' });
            }
          }
          return options.sort((a, b) => a.start.localeCompare(b.start));
        })();
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '28px 24px', width: '100%', maxWidth: '560px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', marginTop: '16px' }}>
              <h3 style={{ margin: '0 0 20px', fontSize: '1.125rem' }}>Edit Booking</h3>
              <div className="quick-entry-form-grid">
                <div className="form-field">
                  <label>Resident Name</label>
                  <input value={editForm.residentName} onChange={(e) => setEditForm({ ...editForm, residentName: e.target.value })} placeholder="e.g. Jane Smith" />
                </div>
                <div className="form-field">
                  <label>Unit</label>
                  <input value={editForm.unit} inputMode="numeric" onChange={(e) => setEditForm({ ...editForm, unit: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 1204" />
                </div>
                <div className="form-field">
                  <label>Resident Email</label>
                  <input type="email" value={editForm.residentEmail} onChange={(e) => setEditForm({ ...editForm, residentEmail: e.target.value })} placeholder="name@example.com" />
                </div>
                <div className="form-field">
                  <label>Resident Phone</label>
                  <input value={editForm.residentPhone} onChange={(e) => setEditForm({ ...editForm, residentPhone: e.target.value })} placeholder="e.g. 604-555-1234" />
                </div>
                <div className="form-field">
                  <label>Booking Type</label>
                  <select value={editForm.moveType} onChange={(e) => { setEditForm({ ...editForm, moveType: e.target.value }); setEditSlots([]); }}>
                    <option value="MOVE_IN">Move In</option>
                    <option value="MOVE_OUT">Move Out</option>
                    <option value="FURNISHED_MOVE">Furnished Move</option>
                    <option value="SUITCASE_MOVE">Suitcase Move ($50)</option>
                    <option value="DELIVERY">Delivery</option>
                    <option value="RENO">Renovation</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Date</label>
                  <input type="date" value={editForm.moveDate} onChange={(e) => { setEditForm({ ...editForm, moveDate: e.target.value }); setEditSlots([]); }} />
                </div>
                <div className="form-field">
                  {eIsReno ? (
                    <>
                      <label className="required">Time Slots</label>
                      <div className="slot-checkbox-grid">
                        {allESlots.map((s) => (
                          <label
                            key={s.start}
                            className={`slot-checkbox${editSlots.includes(s.start) ? ' slot-checkbox--selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={editSlots.includes(s.start)}
                              onChange={() => setEditSlots((prev) =>
                                prev.includes(s.start) ? prev.filter((x) => x !== s.start) : [...prev, s.start]
                              )}
                            />
                            <span>{s.label}</span>
                          </label>
                        ))}
                      </div>
                      {(!editForm.moveDate || eIsHoliday || allESlots.length === 0) && (
                        <small>
                          {!editForm.moveDate ? 'Select a date first' : eIsHoliday ? 'No slots on holidays' : 'No slots available'}
                        </small>
                      )}
                      {eRange && (
                        <small className="slot-selection-summary">
                          Booked time: {minsToLabel(timeToMins(eRange.start))} – {minsToLabel(timeToMins(eRange.end))}
                          {' '}({(timeToMins(eRange.end) - timeToMins(eRange.start)) / 60} hours)
                        </small>
                      )}
                    </>
                  ) : (
                    <>
                      <label>Time Slot</label>
                      <select value={editSlots[0] ?? ''} onChange={(e) => setEditSlots(e.target.value ? [e.target.value] : [])} disabled={!editForm.moveDate || !!eIsHoliday || allESlots?.length === 0}>
                        <option value="">
                          {!editForm.moveDate ? 'Select a date first' : eIsHoliday ? 'No slots on holidays' : allESlots?.length === 0 ? 'No slots available' : 'Select a time slot'}
                        </option>
                        {(allESlots ?? []).map((s) => (
                          <option key={s.start} value={s.start}>{s.label}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <div className="form-field">
                  <label>Company Name</label>
                  <input value={editForm.companyName} onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })} placeholder="e.g. ABC Movers (optional)" />
                </div>
              </div>
              <div className="form-field" style={{ marginTop: '8px' }}>
                <label>Notes</label>
                <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Optional details" />
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={editForm.elevatorRequired} onChange={(e) => setEditForm({ ...editForm, elevatorRequired: e.target.checked })} />
                  Elevator Required
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={editForm.loadingBayRequired} onChange={(e) => setEditForm({ ...editForm, loadingBayRequired: e.target.checked })} />
                  Loading Bay Required
                </label>
              </div>
              {eIsHoliday && <p className="error-message" style={{ marginTop: '12px' }}>This date is a statutory holiday — no bookings permitted.</p>}
              {editError && <p className="error-message" style={{ marginTop: '12px' }}>{editError}</p>}
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button className="btn-sm btn-green" type="button" onClick={saveEditBooking} disabled={isSavingEdit || !!eIsHoliday}>
                  {isSavingEdit ? 'Saving…' : 'Save Changes'}
                </button>
                <button className="btn-sm btn-slate" type="button" onClick={closeEditBooking} disabled={isSavingEdit}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="admin-title-row"><h2>Booking Queue</h2></div>
      {loadError && <p className="error-message">{loadError}</p>}
      {actionMessage && <p className={/(success|approved|rejected|cancelled|sent)/i.test(actionMessage) ? 'success-message' : 'error-message'}>{actionMessage}</p>}

      {stats && (
        <div className="queue-tiles">
          <button className={`queue-tile${counts.action ? ' queue-tile--alert' : ''}`} onClick={() => { setSearch(''); setTab('action'); }}>
            <div className="queue-tile-value">{counts.action}</div><div className="queue-tile-label">Needs action</div>
          </button>
          <button className="queue-tile" onClick={() => { setSearch(''); setTab('action'); }}>
            <div className="queue-tile-value">{stats.awaitingPayment ?? 0}</div><div className="queue-tile-label">Awaiting payment</div>
          </button>
          <button className="queue-tile" onClick={() => { setSearch(''); setTab('today'); }}>
            <div className="queue-tile-value">{stats.movesToday ?? 0}</div><div className="queue-tile-label">Moves today</div>
          </button>
          {canManage && (
            <button className={`queue-tile${stats.unmatchedPayments ? ' queue-tile--alert' : ''}`} onClick={() => navigate('/admin/payments')}>
              <div className="queue-tile-value">{stats.unmatchedPayments ?? 0}</div><div className="queue-tile-label">Unmatched payments</div>
            </button>
          )}
          <div className="queue-tile" style={{ cursor: 'default' }}>
            <div className="queue-tile-value">{stats.approvedBookings ?? 0}<span style={{ fontSize: '1rem', color: '#94a3b8' }}> / {stats.totalBookings ?? 0}</span></div>
            <div className="queue-tile-label">Approved / total in {stats.year}</div>
          </div>
        </div>
      )}

      <div className="admin-section">
        <div className="bookings-section-header">
          <h3>Bookings</h3>
          <button type="button" className="quick-entry-toggle" onClick={() => { setShowQuickEntry((v) => !v); setQuickError(''); }}>
            {showQuickEntry ? 'Cancel' : 'Add Manual Booking ▾'}
          </button>
        </div>

            {showQuickEntry && (
              <div className="admin-form-card" style={{ marginTop: '16px' }}>
                <h4>New Manual Booking</h4>
                <form onSubmit={submitQuickEntry}>
                  <div className="quick-entry-form-grid">
                    <div className="form-field">
                      <label htmlFor="qe-name">Resident Name</label>
                      <input id="qe-name" value={quickForm.residentName}
                        onChange={(e) => setQuickForm({ ...quickForm, residentName: e.target.value })}
                        placeholder="e.g. Jane Smith" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-email">Resident Email</label>
                      <input id="qe-email" type="email" value={quickForm.residentEmail}
                        onChange={(e) => setQuickForm({ ...quickForm, residentEmail: e.target.value })}
                        placeholder="name@example.com" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-phone">Resident Phone</label>
                      <input id="qe-phone" value={quickForm.residentPhone}
                        onChange={(e) => setQuickForm({ ...quickForm, residentPhone: e.target.value })}
                        placeholder="e.g. 604-555-1234" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-unit" className="required">Unit</label>
                      <input id="qe-unit" value={quickForm.unit}
                        inputMode="numeric"
                        onChange={(e) => setQuickForm({ ...quickForm, unit: e.target.value.replace(/\D/g, '') })}
                        placeholder="e.g. 1204" required />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-type" className="required">Booking Type</label>
                      <select id="qe-type" value={quickForm.moveType}
                        onChange={(e) => { setQuickForm({ ...quickForm, moveType: e.target.value }); setQuickSlots([]); }}>
                        <option value="MOVE_IN">Move In</option>
                        <option value="MOVE_OUT">Move Out</option>
                        <option value="FURNISHED_MOVE">Furnished Move</option>
                        <option value="SUITCASE_MOVE">Suitcase Move ($50)</option>
                        <option value="DELIVERY">Delivery</option>
                        <option value="RENO">Renovation</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-date" className="required">Date</label>
                      <input id="qe-date" type="date" value={quickForm.moveDate}
                        onChange={(e) => { setQuickForm({ ...quickForm, moveDate: e.target.value }); setQuickSlots([]); }}
                        required />
                    </div>
                    <div className="form-field">
                      {qIsReno ? (
                        <>
                          <label className="required">Time Slots</label>
                          <div className="slot-checkbox-grid">
                            {(qSlots ?? []).map((s) => (
                              <label
                                key={s.start}
                                className={`slot-checkbox${quickSlots.includes(s.start) ? ' slot-checkbox--selected' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={quickSlots.includes(s.start)}
                                  onChange={() => setQuickSlots((prev) =>
                                    prev.includes(s.start) ? prev.filter((x) => x !== s.start) : [...prev, s.start]
                                  )}
                                />
                                <span>{s.label}</span>
                              </label>
                            ))}
                          </div>
                          {(!quickForm.moveDate || qIsHoliday || qSlots?.length === 0) && (
                            <small>
                              {!quickForm.moveDate ? 'Select a date first' : qIsHoliday ? 'No slots on holidays' : 'No slots available'}
                            </small>
                          )}
                          {qRange && (
                            <small className="slot-selection-summary">
                              Booked time: {minsToLabel(timeToMins(qRange.start))} – {minsToLabel(timeToMins(qRange.end))}
                              {' '}({(timeToMins(qRange.end) - timeToMins(qRange.start)) / 60} hours)
                            </small>
                          )}
                        </>
                      ) : (
                        <>
                          <label htmlFor="qe-slot" className="required">Time Slot</label>
                          <select id="qe-slot" value={quickSlots[0] ?? ''}
                            onChange={(e) => setQuickSlots(e.target.value ? [e.target.value] : [])}
                            disabled={!quickForm.moveDate || !!qIsHoliday || qSlots?.length === 0}
                            required>
                            <option value="">
                              {!quickForm.moveDate ? 'Select a date first' : qIsHoliday ? 'No slots on holidays' : qSlots?.length === 0 ? 'No slots available' : 'Select a time slot'}
                            </option>
                            {(qSlots ?? []).map((s) => (
                              <option key={s.start} value={s.start}>{s.label}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-company">Company Name</label>
                      <input id="qe-company" value={quickForm.companyName}
                        onChange={(e) => setQuickForm({ ...quickForm, companyName: e.target.value })}
                        placeholder="e.g. ABC Movers (optional)" />
                    </div>
                  </div>
                  <div className="form-field" style={{ marginTop: '12px' }}>
                    <label htmlFor="qe-notes">Notes</label>
                    <textarea id="qe-notes" rows={2} value={quickForm.notes}
                      onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })}
                      placeholder="Optional details" />
                  </div>
                  <div className="form-field">
                    <label htmlFor="qe-mask">Public Unit Mask</label>
                    <input id="qe-mask" value={quickForm.publicUnitMask}
                      onChange={(e) => setQuickForm({ ...quickForm, publicUnitMask: e.target.value })}
                      placeholder="e.g. Unit 12xx (optional)" />
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={quickForm.elevatorRequired}
                        onChange={(e) => setQuickForm({ ...quickForm, elevatorRequired: e.target.checked })} />
                      Elevator Required
                    </label>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={quickForm.loadingBayRequired}
                        onChange={(e) => setQuickForm({ ...quickForm, loadingBayRequired: e.target.checked })} />
                      Loading Bay Required
                    </label>
                  </div>
                  {qIsHoliday && <p className="error-message" style={{ marginTop: '12px' }}>This date is a statutory holiday — no bookings permitted.</p>}
                  {quickError && <p className="error-message" style={{ marginTop: '12px' }}>{quickError}</p>}
                  <button className="btn-sm btn-green" type="submit" style={{ marginTop: '16px' }}
                    disabled={isQuickSubmitting || !!qIsHoliday}>
                    {isQuickSubmitting ? 'Creating…' : 'Create Approved Booking'}
                  </button>
                </form>
              </div>
            )}
        <div className="queue-toolbar">
          <div className="queue-tabs">
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button key={t} className={`queue-tab${!q && tab === t ? ' queue-tab--active' : ''}`} onClick={() => { setSearch(''); setTab(t); }}>
                {TAB_LABELS[t]}<span className="queue-tab-count">{counts[t]}</span>
              </button>
            ))}
          </div>
          <input className="queue-search" type="search" placeholder="Search name, unit, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="bookings-list">
          {visible.length === 0
            ? <p className="booking-group-empty">{q ? 'No bookings match your search.' : EMPTY[tab]}</p>
            : visible.map(renderBooking)}
        </div>
      </div>
    </>
  );
}
