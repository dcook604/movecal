import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import '../styles/resident.css';

export function FindBookingPage() {
  const [unit, setUnit] = useState('');
  const [residentEmail, setResidentEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!unit.trim() || !residentEmail.trim()) {
      setError('Please enter both your unit number and email address');
      setMessage('');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const res = await api.post('/api/public/bookings/request-link', { unit, residentEmail });
      setMessage(res.data.message);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="resident-form-card">
        <h2 className="resident-form-title">Find My Booking</h2>
        <p style={{ color: '#64748b', fontSize: '0.9375rem', marginTop: -8, marginBottom: 20 }}>
          Enter the unit number and email address used when you submitted your booking request,
          and we&apos;ll email you the link(s) to view or manage it.
        </p>

        <form onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="find-unit" className="required">Unit</label>
            <input id="find-unit" placeholder="e.g. 1204"
              inputMode="numeric"
              value={unit}
              onChange={(e) => setUnit(e.target.value.replace(/\D/g, ''))} />
          </div>

          <div className="form-field">
            <label htmlFor="find-email" className="required">Email Address</label>
            <input id="find-email" type="email" placeholder="name@example.com"
              value={residentEmail}
              onChange={(e) => setResidentEmail(e.target.value)} />
          </div>

          <button className="btn-full" disabled={submitting} type="submit">
            {submitting ? 'Sending…' : 'Email My Booking Link'}
          </button>

          {error   && <p className="error-message">{error}</p>}
          {message && <p className="success-message">{message}</p>}
        </form>

        <p style={{ marginTop: 20, fontSize: '0.875rem', textAlign: 'center' }}>
          <Link to="/submit">Back to booking request form</Link>
        </p>
      </div>
    </div>
  );
}
