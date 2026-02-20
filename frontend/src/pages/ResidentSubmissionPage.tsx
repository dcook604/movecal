import { FormEvent, useState } from 'react';
import { api } from '../api';

export function ResidentSubmissionPage() {
  const [form, setForm] = useState<any>({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();

    // Client-side validation
    if (!form.residentName || !form.residentEmail || !form.residentPhone ||
        !form.unit || !form.moveDate || !form.startDatetime || !form.endDatetime) {
      setError('Please fill in all required fields');
      setMessage('');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setMessage('');

    try {
      await api.post('/api/bookings', form);
      setMessage('Move request submitted successfully! Check your email for confirmation.');
      // Reset form after successful submission
      setForm({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || 'Failed to submit request. Please try again.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <h2>Move Request</h2>
      <div className="form-field">
        <label htmlFor="resident-name">Resident Name</label>
        <input id="resident-name" placeholder="e.g. Jane Smith" onChange={(e) => setForm({ ...form, residentName: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="resident-email">Resident Email</label>
        <input id="resident-email" type="email" placeholder="name@example.com" onChange={(e) => setForm({ ...form, residentEmail: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="resident-phone">Resident Phone</label>
        <input id="resident-phone" placeholder="e.g. 604-555-1234" onChange={(e) => setForm({ ...form, residentPhone: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="unit">Unit</label>
        <input id="unit" placeholder="e.g. 1204" onChange={(e) => setForm({ ...form, unit: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="move-type">Move Type</label>
        <select id="move-type" onChange={(e) => setForm({ ...form, moveType: e.target.value })}>
          <option>MOVE_IN</option>
          <option>MOVE_OUT</option>
          <option>DELIVERY</option>
        </select>
      </div>

      <div className="form-field">
        <label htmlFor="move-date">Move Date</label>
        <input id="move-date" type="date" onChange={(e) => setForm({ ...form, moveDate: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="start-datetime">Start Date & Time</label>
        <input id="start-datetime" type="datetime-local" onChange={(e) => setForm({ ...form, startDatetime: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="end-datetime">End Date & Time</label>
        <input id="end-datetime" type="datetime-local" onChange={(e) => setForm({ ...form, endDatetime: e.target.value })} />
      </div>

      <div className="form-field">
        <label htmlFor="notes">Notes</label>
        <input id="notes" placeholder="Optional details" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>

      <label className="checkbox-label">
        <input type="checkbox" checked={form.elevatorRequired} onChange={(e) => setForm({ ...form, elevatorRequired: e.target.checked })} />
        Elevator Required
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={form.loadingBayRequired} onChange={(e) => setForm({ ...form, loadingBayRequired: e.target.checked })} />
        Loading Bay Required
      </label>
      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Submitting...' : 'Submit Move Request'}
      </button>
      {error && <p className="error-message">{error}</p>}
      {message && <p className="success-message">{message}</p>}
    </form>
  );
}
