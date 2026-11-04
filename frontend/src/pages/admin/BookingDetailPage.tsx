import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { errorMessage } from '../../auth/session';
import { parseBookingTime } from '../../utils/bookingTime';
import { useAdmin } from './AdminLayout';
import '../../styles/admin.css';

const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

type Tone = 'normal' | 'money' | 'warn';
const ACTIONS: Record<string, { title: string; tone?: Tone }> = {
  BOOKING_APPROVED: { title: 'Approved by staff' },
  BOOKING_QUICK_APPROVED: { title: 'Created and approved by staff' },
  BOOKING_REJECTED: { title: 'Rejected', tone: 'warn' },
  BOOKING_UPDATED: { title: 'Details edited' },
  BOOKING_UPDATED_BY_RESIDENT: { title: 'Edited by resident' },
  BOOKING_CANCELLED_BY_RESIDENT: { title: 'Cancelled by resident', tone: 'warn' },
  CONFLICT_OVERRIDE: { title: 'Scheduling conflict overridden', tone: 'warn' },
  PAYMENT_AUTO_MATCHED: { title: 'Payment matched automatically', tone: 'money' },
  PAYMENT_MANUALLY_MATCHED: { title: 'Payment matched by staff', tone: 'money' },
  PAYMENT_UNMATCHED: { title: 'Payment unmatched', tone: 'warn' },
  PAYMENT_REVERSED: { title: 'Payment reversed in Invoice Ninja', tone: 'warn' },
  PAYMENT_REMINDER_SENT: { title: 'Payment reminder sent (automatic)' },
  BOOKING_PAYMENT_REMINDER_SENT: { title: 'Payment reminder sent by staff' },
  DOCUMENT_UPLOADED: { title: 'Document uploaded' },
};

const FIELD_LABELS: Record<string, string> = {
  residentName: 'Name', residentEmail: 'Email', residentPhone: 'Phone', unit: 'Unit', companyName: 'Company',
  moveType: 'Type', startDatetime: 'Start', endDatetime: 'End', elevatorRequired: 'Elevator',
  loadingBayRequired: 'Loading bay', notes: 'Notes',
};

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (field === 'startDatetime' || field === 'endDatetime') return parseBookingTime(String(v)).format('MMM D, YYYY h:mm A');
  if (field === 'moveType') return label(String(v));
  return String(v);
}

function describe(action: string, meta: any): string[] {
  const lines: string[] = [];
  if (meta?.changes) {
    for (const [field, c] of Object.entries<any>(meta.changes)) {
      lines.push(`${FIELD_LABELS[field] ?? field}: ${fmtValue(field, c.from)} → ${fmtValue(field, c.to)}`);
    }
  }
  if (meta?.reason) lines.push(`Reason: ${meta.reason}`);
  if (action === 'BOOKING_APPROVED' && meta?.withoutPayment) lines.push('Approved without a matched payment');
  if (meta?.invoiceId) lines.push(`Invoice ${meta.invoiceId}${meta.amountPaid ? ` · $${Number(meta.amountPaid).toFixed(2)}` : ''}`);
  return lines;
}

export function BookingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canManage, handleAuthError } = useAdmin();
  const [b, setB] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reasonMode, setReasonMode] = useState<'REJECTED' | 'CANCELLED' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setB((await api.get(`/api/admin/bookings/${id}/details`)).data);
      setError('');
    } catch (e: any) {
      if (handleAuthError(e)) return;
      setError(e.response?.status === 404 ? 'Booking not found.' : errorMessage(e, 'Failed to load booking.'));
    }
  }, [id, handleAuthError]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage('');
    try { await fn(); setMessage(success); await load(); }
    catch (e: any) {
      if (handleAuthError(e)) return;
      if (e.response?.data?.code === 'PAYMENT_REQUIRED' && confirm('No payment is matched to this booking.\n\nApprove it WITHOUT payment? This is recorded in the history.')) {
        setBusy(false);
        return act(() => api.patch(`/api/admin/bookings/${id}`, { status: 'APPROVED', approveWithoutPayment: true }), success);
      }
      setMessage(errorMessage(e, 'Action failed.'));
    } finally { setBusy(false); }
  };

  const downloadDocument = async (docId: string, name: string) => {
    try {
      const res = await api.get(`/api/admin/documents/${docId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { if (!handleAuthError(e)) setMessage('Could not download the document.'); }
  };

  if (error) return <><p className="error-message">{error}</p><Link to="/admin">← Back to queue</Link></>;
  if (!b) return <p>Loading…</p>;

  const open = b.status === 'SUBMITTED' || b.status === 'PENDING';
  const closed = b.status === 'REJECTED' || b.status === 'CANCELLED';
  const when = `${parseBookingTime(b.startDatetime).format('dddd, MMM D, YYYY')} · ${parseBookingTime(b.startDatetime).format('h:mm A')} – ${parseBookingTime(b.endDatetime).format('h:mm A')}`;

  const approvalNote =
    b.approvalSource === 'PAYMENT' ? 'Approved by matched payment' :
    b.approvalSource === 'AUTO' ? 'Auto-approved (no fee)' :
    b.approvalSource === 'MANUAL' ? 'Approved manually' : null;

  const events: { key: string; at: string; title: string; who?: string; tone: Tone; lines: string[] }[] = [
    { key: 'created', at: b.createdAt, title: 'Booking submitted', who: b.createdBy?.name, tone: 'normal', lines: [] },
    ...b.auditLogs.map((a: any) => ({
      key: a.id, at: a.timestamp, title: ACTIONS[a.action]?.title ?? label(a.action), who: a.actor?.name,
      tone: ACTIONS[a.action]?.tone ?? 'normal', lines: describe(a.action, a.metadataJson),
    })),
  ].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

  return (
    <>
      <div className="admin-title-row">
        <h2>{label(b.moveType)} · Unit {b.unit}</h2>
        <button className="btn-sm btn-slate" onClick={() => navigate(-1)}>← Back</button>
      </div>
      {message && <p className={/(fail|could not|no payment|cannot|required|only)/i.test(message) ? 'error-message' : 'success-message'}>{message}</p>}

      <div className="detail-grid">
        <div>
          <div className="detail-card">
            <h3>Booking <span className={`booking-status ${b.status}`} style={{ marginLeft: 8 }}>{b.status}</span></h3>
            <dl className="detail-dl">
              <dt>When</dt><dd>{when}</dd>
              <dt>Resident</dt><dd>{b.residentName}</dd>
              <dt>Email</dt><dd>{b.residentEmail || '—'}</dd>
              <dt>Phone</dt><dd>{b.residentPhone || '—'}</dd>
              {b.companyName && (<><dt>Company</dt><dd>{b.companyName}</dd></>)}
              <dt>Elevator</dt><dd>{b.elevatorRequired ? 'Yes' : 'No'}</dd>
              <dt>Loading bay</dt><dd>{b.loadingBayRequired ? 'Yes' : 'No'}</dd>
              <dt>Notes</dt><dd>{b.notes || '—'}</dd>
              {b.statusReason && (<><dt>Reason</dt><dd>{b.statusReason}</dd></>)}
              {approvalNote && (<><dt>Approval</dt><dd>{approvalNote}{b.approvedBy ? ` by ${b.approvedBy.name}` : ''}{b.approvedAt ? ` · ${new Date(b.approvedAt).toLocaleString()}` : ''}</dd></>)}
            </dl>
          </div>

          <div className="detail-card">
            <h3>History</h3>
            <ul className="timeline">
              {events.map((ev) => (
                <li key={ev.key} className={ev.tone === 'money' ? 'timeline--money' : ev.tone === 'warn' ? 'timeline--warn' : undefined}>
                  <div className="timeline-title">{ev.title}</div>
                  <div className="timeline-meta">{new Date(ev.at).toLocaleString()}{ev.who ? ` · ${ev.who}` : ''}</div>
                  {ev.lines.map((l, i) => <div key={i} className="timeline-detail">{l}</div>)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <div className="detail-card">
            <h3>Payment</h3>
            {b.paymentStatus === 'PAID' && b.payment ? (
              <dl className="detail-dl" style={{ gridTemplateColumns: '90px 1fr' }}>
                <dt>Status</dt><dd><span className="pay-badge pay-badge--paid">Paid</span></dd>
                <dt>Invoice</dt><dd>{b.payment.invoiceId}</dd>
                <dt>Amount</dt><dd>{b.payment.amountPaid != null ? `$${Number(b.payment.amountPaid).toFixed(2)}` : '—'}</dd>
                <dt>Paid</dt><dd>{new Date(b.payment.paidAt).toLocaleDateString()}</dd>
              </dl>
            ) : b.paymentStatus === 'REFUNDED' ? (
              <p><span className="pay-badge pay-badge--refunded">Payment reversed</span><br /><small>The invoice was cancelled or reversed in Invoice Ninja after being matched.</small></p>
            ) : (
              <p>
                <span className={`pay-badge ${b.status === 'APPROVED' ? 'pay-badge--manual' : 'pay-badge--unpaid'}`}>
                  {b.status === 'APPROVED' ? (b.approvalSource === 'AUTO' ? 'No fee' : 'Approved without payment') : 'Awaiting payment'}
                </span>
              </p>
            )}
            {canManage && <Link to="/admin/payments">Open payments →</Link>}
          </div>

          <div className="detail-card">
            <h3>Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {open && (
                <button className={`btn-sm ${b.paymentStatus === 'PAID' ? 'btn-green' : 'btn-amber'}`} disabled={busy}
                  onClick={() => act(() => api.patch(`/api/admin/bookings/${id}`, { status: 'APPROVED' }), 'Booking approved.')}>
                  {b.paymentStatus === 'PAID' ? 'Approve' : 'Approve without payment'}
                </button>
              )}
              {open && b.paymentStatus === 'NONE' && (
                <button className="btn-sm btn-slate" disabled={busy}
                  onClick={() => confirm(`Send a payment reminder to ${b.residentName}?`) && act(() => api.post(`/api/admin/bookings/${id}/payment-due-reminder`), 'Payment reminder sent.')}>
                  Send payment reminder
                </button>
              )}
              {open && <button className="btn-sm btn-red" disabled={busy} onClick={() => { setReasonMode('REJECTED'); setReason(''); }}>Reject…</button>}
              {b.status === 'APPROVED' && <button className="btn-sm btn-red" disabled={busy} onClick={() => { setReasonMode('CANCELLED'); setReason(''); }}>Cancel booking…</button>}
              {canManage && closed && b.paymentStatus === 'NONE' && (
                <button className="btn-sm btn-slate" disabled={busy}
                  onClick={() => confirm('Permanently delete this booking? Its history entries will be detached.') && act(async () => { await api.delete(`/api/admin/bookings/${id}`); navigate('/admin'); }, 'Deleted.')}>
                  Delete permanently
                </button>
              )}
              <Link to={`/admin/history?related=${id}`} className="btn-sm btn-slate" style={{ textAlign: 'center', textDecoration: 'none' }}>View linked bookings in other units</Link>
            </div>
            {reasonMode && (
              <div style={{ marginTop: 12 }}>
                <textarea rows={3} style={{ width: '100%' }} maxLength={500} autoFocus placeholder={`Reason for ${reasonMode === 'REJECTED' ? 'rejecting' : 'cancelling'}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn-sm btn-red" disabled={!reason.trim() || busy}
                    onClick={() => { const status = reasonMode; setReasonMode(null); act(() => api.patch(`/api/admin/bookings/${id}`, { status, reason: reason.trim() }), status === 'REJECTED' ? 'Booking rejected.' : 'Booking cancelled.'); }}>
                    Confirm
                  </button>
                  <button className="btn-sm btn-slate" onClick={() => setReasonMode(null)}>Back</button>
                </div>
              </div>
            )}
          </div>

          {b.documents.length > 0 && (
            <div className="detail-card">
              <h3>Documents</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {b.documents.map((d: any) => (
                  <li key={d.id}><button type="button" className="forgot-link" onClick={() => downloadDocument(d.id, d.originalName)}>{d.originalName}</button></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
