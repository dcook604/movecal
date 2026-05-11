import { FormEvent, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import '../styles/resident.css';

// ── Time slot definitions ─────────────────────────────────────
type Slot = { label: string; start: string; end: string };

// Fixed slots for MOVE_IN / MOVE_OUT
const MOVE_WEEKDAY_SLOTS: Slot[] = [
  { label: '9:00 AM – 12:00 PM', start: '09:00', end: '12:00' },
  { label: '1:00 PM – 4:00 PM',  start: '13:00', end: '16:00' },
];

const MOVE_WEEKEND_SLOTS: Slot[] = [
  { label: '12:00 PM – 3:00 PM', start: '12:00', end: '15:00' },
  { label: '4:00 PM – 7:00 PM',  start: '16:00', end: '19:00' },
];

// 2-hour slots for FURNISHED_MOVE
const FURNISHED_WEEKDAY_SLOTS: Slot[] = [
  { label: '10:00 AM – 12:00 PM', start: '10:00', end: '12:00' },
  { label: '12:00 PM – 2:00 PM',  start: '12:00', end: '14:00' },
  { label: '2:00 PM – 4:00 PM',   start: '14:00', end: '16:00' },
];

const FURNISHED_WEEKEND_SLOTS: Slot[] = [
  { label: '12:00 PM – 2:00 PM', start: '12:00', end: '14:00' },
  { label: '2:00 PM – 4:00 PM',  start: '14:00', end: '16:00' },
];

// Fixed slot for OPEN_HOUSE (weekends only)
const OPEN_HOUSE_SLOT: Slot[] = [
  { label: '2:00 PM – 5:00 PM', start: '14:00', end: '17:00' },
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

  if (moveType === 'OPEN_HOUSE') {
    return isWeekend ? OPEN_HOUSE_SLOT : []; // weekends only
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

  // MOVE_IN / MOVE_OUT: fixed slots
  return isWeekend ? MOVE_WEEKEND_SLOTS : MOVE_WEEKDAY_SLOTS;
}

// ── Validation helpers ─────────────────────────────────────────
const COMMON_TLDS = new Set([
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

const BLOCKED_AREA_CODES = new Set(['000', '111', '911']);

function validateName(v: string) {
  if (!v.trim()) return 'Name is required';
  if (v.trim().length < 2) return 'Name must be at least 2 characters';
  return '';
}
function validateEmail(v: string) {
  if (!v.trim()) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Enter a valid email address';
  const atIdx = v.lastIndexOf('@');
  const domain = v.slice(atIdx + 1).toLowerCase();
  const dotIdx = domain.lastIndexOf('.');
  const tld = dotIdx >= 0 ? domain.slice(dotIdx + 1) : '';
  if (!COMMON_TLDS.has(tld)) return `Email domain does not appear to be valid (unrecognized extension: .${tld})`;
  return '';
}
function validatePhone(v: string) {
  if (!v.trim()) return 'Phone number is required';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10) return 'Enter a valid phone number (at least 10 digits)';
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.slice(0, 10);
  const area = ten.slice(0, 3);
  if (BLOCKED_AREA_CODES.has(area)) return `Phone number area code (${area}) is not valid`;
  if (/^(\d)\1{9}$/.test(ten)) return 'Phone number appears invalid';
  return '';
}
function validateUnit(v: string) {
  if (!v.trim()) return 'Unit number is required';
  if (!/^\d{1,4}[A-Za-z]?$/.test(v.trim())) return 'Enter a valid unit number (e.g. 1204)';
  return '';
}
function validateDate(v: string) {
  if (!v) return 'Please select a date';
  const today = dayjs().format('YYYY-MM-DD');
  if (v < today) return 'Date cannot be in the past';
  return '';
}
const NOTES_MAX = 500;

type FieldErrors = Partial<Record<'residentName' | 'residentEmail' | 'residentPhone' | 'unit' | 'moveDate' | 'notes', string>>;

export function ResidentSubmissionPage() {
  const [form, setForm] = useState<any>({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
  const [slot, setSlot] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [acceptedFees, setAcceptedFees] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [takenRanges, setTakenRanges] = useState<{ start: string; end: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  function getFieldError(field: keyof FieldErrors, value: string): string {
    if (field === 'residentName') return validateName(value);
    if (field === 'residentEmail') return validateEmail(value);
    if (field === 'residentPhone') return validatePhone(value);
    if (field === 'unit') return validateUnit(value);
    if (field === 'moveDate') return validateDate(value);
    if (field === 'notes') return value.length > NOTES_MAX ? `Notes cannot exceed ${NOTES_MAX} characters` : '';
    return '';
  }

  function handleBlur(field: keyof FieldErrors, value: string) {
    setTouched(prev => new Set(prev).add(field));
    setFieldErrors(prev => ({ ...prev, [field]: getFieldError(field, value) }));
  }

  function handleFieldChange(field: keyof FieldErrors, value: string, extra?: object) {
    setForm((prev: any) => ({ ...prev, [field]: value, ...extra }));
    if (touched.has(field)) {
      setFieldErrors(prev => ({ ...prev, [field]: getFieldError(field, value) }));
    }
  }

  useEffect(() => {
    if (!form.moveDate) { setTakenRanges([]); return; }
    api.get(`/api/public/taken-slots?date=${form.moveDate}`)
      .then(res => setTakenRanges(res.data))
      .catch(() => setTakenRanges([]));
  }, [form.moveDate]);

  const isHoliday = !!form.moveDate && STATUTORY_HOLIDAYS.has(form.moveDate);
  const isOpenHouseWeekday = form.moveType === 'OPEN_HOUSE' && !!form.moveDate && !isHoliday &&
    (() => { const d = dayjs(form.moveDate).day(); return d !== 0 && d !== 6; })();
  const rawSlots = getSlotsForDateAndType(form.moveDate ?? '', form.moveType ?? 'MOVE_IN');
  const availableSlots = rawSlots ? filterAvailableSlots(rawSlots, takenRanges) : rawSlots;

  const handleDateChange = (dateStr: string) => {
    setSlot('');
    // form state is set by handleFieldChange
  };

  const handleMoveTypeChange = (moveType: string) => {
    setForm({ ...form, moveType });
    setSlot('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();

    // Run all field validations
    const allErrors: FieldErrors = {
      residentName:  validateName(form.residentName ?? ''),
      residentEmail: validateEmail(form.residentEmail ?? ''),
      residentPhone: validatePhone(form.residentPhone ?? ''),
      unit:          validateUnit(form.unit ?? ''),
      moveDate:      validateDate(form.moveDate ?? ''),
      notes:         (form.notes ?? '').length > NOTES_MAX ? `Notes cannot exceed ${NOTES_MAX} characters` : '',
    };
    const hasFieldErrors = Object.values(allErrors).some(v => v);
    if (hasFieldErrors) {
      setFieldErrors(allErrors);
      setTouched(new Set(['residentName', 'residentEmail', 'residentPhone', 'unit', 'moveDate', 'notes']));
      setError('Please fix the errors above before submitting');
      setMessage('');
      return;
    }

    if (isHoliday) {
      setError('Bookings are not permitted on statutory holidays');
      setMessage('');
      return;
    }
    if (isOpenHouseWeekday) {
      setError('Open House bookings are only available on Saturdays and Sundays');
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
    if (!acceptedFees && form.moveType !== 'OPEN_HOUSE') {
      setError('You must acknowledge the move-in fee/deposit requirement before submitting');
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
      setAcceptedFees(false);
      setFieldErrors({});
      setTouched(new Set());
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDeliveryOrReno = form.moveType === 'DELIVERY' || form.moveType === 'RENO';
  const isOpenHouseType = form.moveType === 'OPEN_HOUSE';
  const isSuitcaseMove = form.moveType === 'SUITCASE_MOVE';
  const isFurnishedMove = form.moveType === 'FURNISHED_MOVE';
  const blockLabel = form.moveType === 'DELIVERY' ? '30-minute blocks' : '1-hour slots';

  return (
    <div className="page-container">
      <div className="resident-form-card">
        <h2 className="resident-form-title">Booking Request</h2>

        <div className="move-times-notice">
          <h3 className="move-times-heading">Permitted Times</h3>
          {isOpenHouseType ? (
            <div className="move-times-grid">
              <div>
                <strong>Saturday &amp; Sunday only</strong>
                <ul className="move-times-list">
                  <li>2:00 PM – 5:00 PM</li>
                </ul>
              </div>
            </div>
          ) : isDeliveryOrReno ? (
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
          ) : isSuitcaseMove ? (
            <div className="move-times-grid">
              <div>
                <strong>Monday – Friday</strong>
                <ul className="move-times-list">
                  <li>9:00 AM – 12:00 PM</li>
                  <li>1:00 PM – 4:00 PM</li>
                </ul>
                <small>1-hour slots</small>
              </div>
              <div>
                <strong>Saturday &amp; Sunday</strong>
                <ul className="move-times-list">
                  <li>8:00 AM – 11:00 AM</li>
                  <li>12:00 PM – 3:00 PM</li>
                  <li>4:00 PM – 7:00 PM</li>
                </ul>
                <small>1-hour slots</small>
              </div>
            </div>
          ) : isFurnishedMove ? (
            <div className="move-times-grid">
              <div>
                <strong>Monday – Friday</strong>
                <ul className="move-times-list">
                  <li>10:00 AM – 12:00 PM</li>
                  <li>12:00 PM – 2:00 PM</li>
                  <li>2:00 PM – 4:00 PM</li>
                </ul>
              </div>
              <div>
                <strong>Saturday &amp; Sunday</strong>
                <ul className="move-times-list">
                  <li>12:00 PM – 2:00 PM</li>
                  <li>2:00 PM – 4:00 PM</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="move-times-grid">
              <div>
                <strong>Monday – Friday</strong>
                <ul className="move-times-list">
                  <li>9:00 AM – 12:00 PM</li>
                  <li>1:00 PM – 4:00 PM</li>
                </ul>
              </div>
              <div>
                <strong>Saturday &amp; Sunday</strong>
                <ul className="move-times-list">
                  <li>12:00 PM – 3:00 PM</li>
                  <li>4:00 PM – 7:00 PM</li>
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
                className={fieldErrors.residentName ? 'input-error' : ''}
                value={form.residentName ?? ''}
                onChange={(e) => handleFieldChange('residentName', e.target.value)}
                onBlur={(e) => handleBlur('residentName', e.target.value)} />
              {fieldErrors.residentName && <span className="field-error">{fieldErrors.residentName}</span>}
            </div>

            <div className="form-field">
              <label htmlFor="resident-email" className="required">Resident Email</label>
              <input id="resident-email" type="email" placeholder="name@example.com"
                className={fieldErrors.residentEmail ? 'input-error' : ''}
                value={form.residentEmail ?? ''}
                onChange={(e) => handleFieldChange('residentEmail', e.target.value)}
                onBlur={(e) => handleBlur('residentEmail', e.target.value)} />
              {fieldErrors.residentEmail && <span className="field-error">{fieldErrors.residentEmail}</span>}
            </div>

            <div className="form-field">
              <label htmlFor="resident-phone" className="required">Resident Phone</label>
              <input id="resident-phone" type="tel" placeholder="e.g. 604-555-1234"
                className={fieldErrors.residentPhone ? 'input-error' : ''}
                value={form.residentPhone ?? ''}
                onChange={(e) => handleFieldChange('residentPhone', e.target.value)}
                onBlur={(e) => handleBlur('residentPhone', e.target.value)} />
              {fieldErrors.residentPhone && <span className="field-error">{fieldErrors.residentPhone}</span>}
            </div>

            <div className="form-field">
              <label htmlFor="unit" className="required">Unit</label>
              <input id="unit" placeholder="e.g. 1204"
                className={fieldErrors.unit ? 'input-error' : ''}
                inputMode="numeric"
                value={form.unit ?? ''}
                onChange={(e) => handleFieldChange('unit', e.target.value.replace(/\D/g, ''))}
                onBlur={(e) => handleBlur('unit', e.target.value)} />
              {fieldErrors.unit && <span className="field-error">{fieldErrors.unit}</span>}
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
                <option value="FURNISHED_MOVE">Furnished Move</option>
                <option value="SUITCASE_MOVE">Suitcase Move ($50)</option>
                <option value="DELIVERY">Delivery</option>
                <option value="RENO">Renovation</option>
                <option value="OPEN_HOUSE">Open House</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="move-date" className="required">Date</label>
              <input id="move-date" type="date"
                min={dayjs().format('YYYY-MM-DD')}
                className={fieldErrors.moveDate ? 'input-error' : ''}
                value={form.moveDate ?? ''}
                onChange={(e) => { handleDateChange(e.target.value); handleFieldChange('moveDate', e.target.value); }}
                onBlur={(e) => handleBlur('moveDate', e.target.value)} />
              {fieldErrors.moveDate && <span className="field-error">{fieldErrors.moveDate}</span>}
            </div>

            {isHoliday && (
              <p className="error-message slot-holiday-msg">
                This date is a statutory holiday — no bookings are permitted.
              </p>
            )}
            {isOpenHouseWeekday && (
              <p className="error-message slot-holiday-msg">
                Open House bookings are only available on Saturdays and Sundays.
              </p>
            )}

            <div className="form-field">
              <label htmlFor="time-slot" className="required">Time Slot</label>
              <select
                id="time-slot"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                disabled={!form.moveDate || isHoliday || isOpenHouseWeekday || availableSlots?.length === 0}
              >
                <option value="">
                  {!form.moveDate ? 'Select a date first' : availableSlots?.length === 0 ? 'No slots available' : 'Select a time slot'}
                </option>
                {(availableSlots ?? []).map((s) => (
                  <option key={s.start} value={s.start}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" rows={3} placeholder="Optional details"
                className={fieldErrors.notes ? 'input-error' : ''}
                maxLength={NOTES_MAX + 1}
                value={form.notes ?? ''}
                onChange={(e) => handleFieldChange('notes', e.target.value)}
                onBlur={(e) => handleBlur('notes', e.target.value)} />
              <span className={`notes-counter${(form.notes ?? '').length > NOTES_MAX ? ' notes-counter--over' : ''}`}>
                {(form.notes ?? '').length}/{NOTES_MAX}
              </span>
              {fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
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
            {!isOpenHouseType && (
              <label className="bylaws-label bylaws-label--warning">
                <input type="checkbox" checked={acceptedFees}
                  onChange={(e) => setAcceptedFees(e.target.checked)} />
                <span>
                  I acknowledge that my request will be declined if the move-in fees/deposits
                  have not been paid. If you do not make payment to the Concierge within
                  24 hours, it will be declined and your move will not be processed, forgoing
                  the timeslot requested.
                </span>
              </label>
            )}
          </div>

          <button className="btn-full" disabled={isSubmitting || !accepted || (!isOpenHouseType && !acceptedFees)} type="submit">
            {isSubmitting ? 'Submitting…' : 'Submit Booking Request'}
          </button>

          {error   && <p className="error-message">{error}</p>}
          {message && <p className="success-message">{message}</p>}
        </form>
      </div>
    </div>
  );
}
