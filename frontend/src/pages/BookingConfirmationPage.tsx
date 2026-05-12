import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api';
import '../styles/resident.css';

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
  status: string;
};

const MOVE_TYPE_LABELS: Record<string, string> = {
  MOVE_IN: 'Move In',
  MOVE_OUT: 'Move Out',
  DELIVERY: 'Delivery',
  RENO: 'Renovation',
  OPEN_HOUSE: 'Open House',
  FURNISHED_MOVE: 'Furnished Move',
  SUITCASE_MOVE: 'Suitcase Move',
};

export function BookingConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBooking = useCallback(async () => {
    if (!id || !token) return;
    try {
      const res = await api.get(`/api/public/bookings/${id}?token=${token}`);
      setBooking(res.data);
    } catch {
      setError('Could not load booking details.');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="resident-form-card">
          <p style={{ textAlign: 'center', color: '#64748b' }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="page-container">
        <div className="resident-form-card">
          <h2 className="resident-form-title">Booking Submitted</h2>
          <p className="success-message">Your booking request has been submitted! Check your email for confirmation and updates.</p>
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            You can also <Link to="/submit">submit another booking</Link>.
          </p>
        </div>
      </div>
    );
  }

  const manageUrl = `/booking/${booking.id}?token=${token}`;

  return (
    <div className="page-container">
      <div className="resident-form-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', background: '#dcfce7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 28
          }}>✓</div>
          <h2 className="resident-form-title" style={{ margin: '0 0 4px' }}>Booking Submitted!</h2>
          <p style={{ color: '#16a34a', fontWeight: 600, margin: 0, fontSize: '0.9375rem' }}>
            Your booking request has been received and is pending review.
          </p>
        </div>

        <fieldset className="form-group">
          <legend className="form-group-legend">Booking Summary</legend>
          <table style={{ borderCollapse: 'collapse', fontFamily: 'Arial, sans-serif', fontSize: '0.9375rem', width: '100%' }}>
            <tbody>
              {[
                ['Resident', booking.residentName],
                ['Unit', booking.unit],
                ['Type', MOVE_TYPE_LABELS[booking.moveType] ?? booking.moveType],
                ['Date', dayjs(booking.startDatetime).format('dddd, MMMM D, YYYY')],
                ['Time', `${dayjs(booking.startDatetime).format('h:mm A')} – ${dayjs(booking.endDatetime).format('h:mm A')}`],
                ['Elevator', booking.elevatorRequired ? 'Yes' : 'No'],
                ['Loading Bay', booking.loadingBayRequired ? 'Yes' : 'No'],
                ...(booking.notes ? [['Notes', booking.notes] as [string, string]] : []),
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

        <p style={{ fontSize: '0.875rem', color: '#555', marginBottom: 16, lineHeight: 1.5 }}>
          You'll receive an email once your booking is reviewed. You can also check the status or make changes anytime.
        </p>

        <Link to={manageUrl} style={{ textDecoration: 'none' }}>
          <button className="btn-full" style={{ marginBottom: 8 }}>
            View / Manage Booking
          </button>
        </Link>

        <Link to="/submit" style={{ textDecoration: 'none' }}>
          <button className="btn-full" style={{ background: '#64748b' }}>
            Submit Another Booking
          </button>
        </Link>
      </div>
    </div>
  );
}
