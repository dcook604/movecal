import { FormEvent, useState } from 'react';
import { api } from '../api';
import '../styles/resident.css';

export function ResidentSubmissionPage() {
  const [form, setForm] = useState<any>({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !form.residentName || !form.residentEmail || !form.residentPhone ||
      !form.unit || !form.moveDate || !form.startDatetime || !form.endDatetime
    ) {
      setError('Please fill in all required fields');
      setMessage('');
      return;
    }
    if (!accepted) {
      setError('You must accept the strata bylaws and move rules before submitting');
      setMessage('');
      return;
    }
    setIsSubmitting(true);
    setError('');
    setMessage('');
    try {
      await api.post('/api/bookings', form);
      setMessage('Move request submitted successfully! Check your email for confirmation.');
      setForm({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
      setAccepted(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="resident-form-card">
        <h2 className="resident-form-title">Move Request</h2>

        <div className="move-times-notice">
          <h3 className="move-times-heading">Permitted Move Times</h3>
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
          <p className="move-times-holiday">No Moves Permitted on Statutory Holidays</p>
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
            <legend className="form-group-legend">Move Details</legend>

            <div className="form-field">
              <label htmlFor="move-type" className="required">Move Type</label>
              <select id="move-type" value={form.moveType}
                onChange={(e) => setForm({ ...form, moveType: e.target.value })}>
                <option value="MOVE_IN">Move In</option>
                <option value="MOVE_OUT">Move Out</option>
                <option value="DELIVERY">Delivery</option>
                <option value="RENO">Renovation</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="move-date" className="required">Move Date</label>
              <input id="move-date" type="date"
                value={form.moveDate ?? ''}
                onChange={(e) => setForm({ ...form, moveDate: e.target.value })} />
            </div>

            <div className="form-row">
              <div className="form-field">
                <label htmlFor="start-datetime" className="required">Start Time</label>
                <input id="start-datetime" type="datetime-local"
                  value={form.startDatetime ?? ''}
                  onChange={(e) => setForm({ ...form, startDatetime: e.target.value })} />
              </div>
              <div className="form-field">
                <label htmlFor="end-datetime" className="required">End Time</label>
                <input id="end-datetime" type="datetime-local"
                  value={form.endDatetime ?? ''}
                  onChange={(e) => setForm({ ...form, endDatetime: e.target.value })} />
              </div>
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
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                I confirm that I have read and will comply with the strata bylaws and move
                rules, and that all required move fees/deposits have been or will be paid
                prior to the move. I accept responsibility for any damage caused during
                the move.
              </span>
            </label>
          </div>

          <button className="btn-full" disabled={isSubmitting || !accepted} type="submit">
            {isSubmitting ? 'Submitting…' : 'Submit Move Request'}
          </button>

          {error   && <p className="error-message">{error}</p>}
          {message && <p className="success-message">{message}</p>}
        </form>
      </div>
    </div>
  );
}
