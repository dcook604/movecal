import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api';
import { errorMessage } from '../auth/session';
import { useAdmin } from './admin/AdminLayout';
import '../styles/payments.css';

const FEE_TYPES: Record<string, string> = {
  move_in: 'Move In', move_out: 'Move Out', furnished_move: 'Furnished Move',
  suitcase_move: 'Suitcase Move', delivery: 'Delivery', reno: 'Reno',
};
const MOVE_TYPE_LABELS: Record<string, string> = {
  MOVE_IN: 'Move In', MOVE_OUT: 'Move Out', FURNISHED_MOVE: 'Furnished Move',
  SUITCASE_MOVE: 'Suitcase Move', DELIVERY: 'Delivery', RENO: 'Reno', OPEN_HOUSE: 'Open House',
};

interface Suggestion {
  bookingId: string; unit: string; residentName: string; moveType: string; moveDate: string;
  status: string; score: number; unitMatch: 'exact' | 'suffix'; days: number;
}
interface Payment {
  id: string; clientId: string; invoiceId: string; billingPeriod: string; feeType: string;
  unit: string | null; paidAt: string; amountPaid: string | null; dismissed: boolean;
  dismissedReason: string | null; dismissedAt: string | null; reversedAt: string | null;
  suggestions?: Suggestion[];
  moveApprovals?: { moveRequestId: string }[];
  booking?: { id: string; unit: string; residentName: string; moveType: string; moveDate: string; status: string; approvalSource: string | null } | null;
}
interface BookingOption {
  id: string; unit: string; moveType: string; status: string; moveDate: string; residentName: string;
  paymentMatched: boolean; paymentInvoiceId: string | null;
}

const money = (v: string | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
const fmtDay = (iso: string) => dayjs(iso).format('MMM D, YYYY');
const fmtMoveDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function FeeTypeBadge({ feeType }: { feeType: string }) {
  const label = FEE_TYPES[feeType];
  return <span className={`fee-type-badge ${label ? feeType.replace('_', '-') : 'unknown'}`}>{label ?? 'Unknown'}</span>;
}

export function PaymentsLedgerPage() {
  const { canManage, handleAuthError } = useAdmin();

  const [selectedMonth, setSelectedMonth] = useState(() => dayjs().format('YYYY-MM'));
  const [unmatched, setUnmatched] = useState<Payment[]>([]);
  const [matched, setMatched] = useState<Payment[]>([]);
  const [dismissed, setDismissed] = useState<Payment[]>([]);
  const [reversed, setReversed] = useState<Payment[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const [feeEditId, setFeeEditId] = useState<string | null>(null);
  const [feeValue, setFeeValue] = useState('');

  const [searchId, setSearchId] = useState<string | null>(null);
  const [searchUnit, setSearchUnit] = useState('');
  const [searchResults, setSearchResults] = useState<BookingOption[]>([]);
  const [searching, setSearching] = useState(false);

  const say = (text: string, ok = true) => setActionMessage({ text, ok });

  const refresh = async (month = selectedMonth) => {
    setLoadError('');
    try {
      const { data } = await api.get(`/api/admin/payments-ledger?month=${month}`);
      setUnmatched(data.unmatched ?? []);
      setMatched(data.matched ?? []);
      setDismissed(data.dismissed ?? []);
      setReversed(data.reversed ?? []);
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setLoadError(error.response?.status === 403 ? 'You do not have permission to access this page.' : 'Failed to load payments data. Please refresh the page.');
    }
  };

  useEffect(() => { if (canManage) refresh(selectedMonth); }, [selectedMonth, canManage]);

  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(key);
    setActionMessage(null);
    try { await fn(); await refresh(); }
    catch (error) { if (!handleAuthError(error)) say(errorMessage(error, fallback), false); }
    finally { setBusy(null); }
  };

  const rerunMatching = () => run('retry', async () => {
    const { data } = await api.post('/api/admin/payments-ledger/retry-match');
    say(data.matched > 0 ? `Matched ${data.matched} payment(s).` : `No new automatic matches (${data.checked} checked).`);
  }, 'Matching failed.');

  const match = (p: Payment, bookingId: string) => run(p.id, async () => {
    const { data } = await api.post(`/api/admin/payments-ledger/${p.id}/manual-match`, { bookingId });
    setSearchId(null);
    say(data.approved ? 'Payment matched and booking approved.' : 'Payment linked to the already-approved booking.');
  }, 'Failed to match payment.');

  const unmatch = (p: Payment) => {
    if (!confirm(`Unmatch invoice ${p.invoiceId} from its booking?\n\nIf the payment approved the booking, it goes back to pending.`)) return;
    return run(p.id, async () => { await api.post(`/api/admin/payments-ledger/${p.id}/unmatch`); say('Payment unmatched.'); }, 'Failed to unmatch.');
  };

  const saveFeeType = (p: Payment) => run(p.id, async () => {
    const { data } = await api.patch(`/api/admin/payments-ledger/${p.id}/fee-type`, { feeType: feeValue });
    setFeeEditId(null);
    say(data.approved ? 'Fee type saved and booking auto-approved.' : data.matched ? 'Fee type saved and payment matched.' : 'Fee type saved.');
  }, 'Failed to save fee type.');

  const dismiss = (p: Payment) => run(p.id, async () => {
    await api.patch(`/api/admin/payments-ledger/${p.id}/dismiss`, { reason: dismissReason.trim() });
    setDismissingId(null); setDismissReason('');
  }, 'Failed to dismiss payment.');

  const restore = (p: Payment) => run(p.id, async () => { await api.patch(`/api/admin/payments-ledger/${p.id}/restore`); }, 'Failed to restore payment.');

  const openSearch = async (p: Payment) => {
    const raw = p.unit ?? '';
    const unit = raw.includes('-') ? raw.split('-').pop()! : raw;
    setSearchId(p.id); setSearchUnit(unit);
    await runSearch(unit);
  };

  const runSearch = async (unit: string) => {
    setSearching(true);
    try {
      const { data } = await api.get(`/api/admin/payments-ledger/bookings-search${unit ? `?unit=${encodeURIComponent(unit)}` : ''}`);
      setSearchResults(data ?? []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  if (!canManage) {
    return <div className="payments-page"><h1>Payments</h1><p className="payments-error">You do not have permission to view this page.</p></div>;
  }

  const shiftMonth = (delta: number) => setSelectedMonth(dayjs(`${selectedMonth}-01`).add(delta, 'month').format('YYYY-MM'));

  return (
    <div className="payments-page">
      <h1>Payments</h1>
      <div className="page-actions">
        <button onClick={() => refresh()}>Refresh</button>
        <button onClick={rerunMatching} disabled={busy === 'retry'}>{busy === 'retry' ? 'Matching…' : 'Re-run matching'}</button>
        {actionMessage && <span style={{ color: actionMessage.ok ? '#166534' : '#dc2626' }}>{actionMessage.text}</span>}
      </div>
      {loadError && <p className="payments-error">{loadError}</p>}

      {/* ── Needs review ─────────────────────────────────────── */}
      <h2>Needs review <span className="review-count">{unmatched.length}</span></h2>
      <p className="payments-hint">
        Paid invoices that could not be matched automatically. Matching only runs unattended when exactly one unpaid booking
        fits the unit, fee type and date; anything ambiguous lands here with suggestions.
      </p>
      {unmatched.length === 0 && <p className="payments-empty">Nothing to review — every paid invoice is matched.</p>}
      {unmatched.map((p) => (
        <div key={p.id} className="review-card">
          <div className="review-head">
            <div>
              <div className="review-title">Unit {p.unit ?? '?'} · {money(p.amountPaid)}</div>
              <div className="review-sub">Invoice {p.invoiceId} · paid {fmtDay(p.paidAt)}</div>
            </div>
            <div className="review-fee">
              {feeEditId === p.id ? (
                <span className="inline-fee-form">
                  <select value={feeValue} onChange={(e) => setFeeValue(e.target.value)}>
                    <option value="">Select…</option>
                    {Object.entries(FEE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button className="btn-match" disabled={!feeValue || busy === p.id} onClick={() => saveFeeType(p)}>Save</button>
                  <button className="btn-edit-cancel" onClick={() => setFeeEditId(null)}>Cancel</button>
                </span>
              ) : (
                <>
                  <FeeTypeBadge feeType={p.feeType} />
                  <button className="btn-edit-fee" onClick={() => { setFeeEditId(p.id); setFeeValue(p.feeType === 'unknown' ? '' : p.feeType); }}>
                    {p.feeType === 'unknown' ? 'Set fee type' : 'Edit'}
                  </button>
                </>
              )}
            </div>
          </div>

          {p.feeType === 'unknown' && <p className="review-warn">Fee type could not be determined — set it so MoveCal can look for the booking.</p>}
          {!p.unit && <p className="review-warn">No unit found on the invoice — search for the booking manually.</p>}

          {(p.suggestions?.length ?? 0) > 0 && (
            <div className="suggestions">
              <div className="suggestions-label">Suggested bookings</div>
              {p.suggestions!.map((s, i) => (
                <div key={s.bookingId} className={`suggestion${i === 0 ? ' suggestion--best' : ''}`}>
                  <div>
                    <strong>{s.residentName}</strong> · Unit {s.unit} · {MOVE_TYPE_LABELS[s.moveType] ?? s.moveType} · {fmtMoveDate(s.moveDate)}
                    <div className="review-sub">
                      {s.status.toLowerCase()} · {s.unitMatch === 'exact' ? 'exact unit' : 'unit matches without tower prefix'} · {s.days} day{s.days === 1 ? '' : 's'} from invoice
                    </div>
                  </div>
                  <button className="btn-match-confirm" disabled={busy === p.id} onClick={() => match(p, s.bookingId)}>
                    {s.status === 'APPROVED' ? 'Link payment' : 'Match & approve'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {p.suggestions?.length === 0 && p.feeType !== 'unknown' && p.unit && (
            <p className="review-sub">No unpaid {FEE_TYPES[p.feeType]?.toLowerCase()} booking found for unit {p.unit}. It may not have been submitted yet — the payment will match automatically once it is.</p>
          )}

          <div className="action-btns" style={{ marginTop: 10 }}>
            <button className="btn-match" onClick={() => (searchId === p.id ? setSearchId(null) : openSearch(p))}>
              {searchId === p.id ? 'Close search' : 'Search bookings'}
            </button>
            <button className="btn-dismiss" onClick={() => { setDismissingId(dismissingId === p.id ? null : p.id); setDismissReason(''); }}>Dismiss</button>
          </div>

          {dismissingId === p.id && (
            <div className="dismiss-form">
              <input placeholder="Reason (e.g. key deposit, not a move fee)" value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} autoFocus />
              <button className="btn-dismiss-confirm" disabled={!dismissReason.trim() || busy === p.id} onClick={() => dismiss(p)}>Confirm dismiss</button>
              <button className="btn-dismiss-cancel" onClick={() => setDismissingId(null)}>Cancel</button>
            </div>
          )}

          {searchId === p.id && (
            <div className="match-form">
              <div className="match-search">
                <input placeholder="Unit" value={searchUnit} onChange={(e) => setSearchUnit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch(searchUnit)} />
                <button className="btn-match" onClick={() => runSearch(searchUnit)}>Search</button>
              </div>
              {searching ? <p className="match-empty">Searching…</p> : searchResults.length === 0 ? <p className="match-empty">No bookings found.</p> : (
                <div className="match-booking-list">
                  {searchResults.map((b) => {
                    const blocked = b.paymentMatched || b.status === 'REJECTED' || b.status === 'CANCELLED';
                    return (
                      <div key={b.id} className="match-booking-option">
                        <div className="match-booking-info">
                          <strong>{b.residentName}</strong> · Unit {b.unit} · {MOVE_TYPE_LABELS[b.moveType] ?? b.moveType} · {fmtMoveDate(b.moveDate)}
                          <span className="match-status"> {b.status.toLowerCase()}</span>
                          {b.paymentMatched && <span className="match-already"> payment already matched</span>}
                        </div>
                        <button className="btn-match-confirm" disabled={blocked || busy === p.id} onClick={() => match(p, b.id)}>Match</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* ── Matched ──────────────────────────────────────────── */}
      <h2>Matched payments</h2>
      <div className="month-nav">
        <button className="month-nav-btn" onClick={() => shiftMonth(-1)}>‹</button>
        <span className="month-nav-label">{dayjs(`${selectedMonth}-01`).format('MMMM YYYY')}</span>
        <button className="month-nav-btn" onClick={() => shiftMonth(1)} disabled={selectedMonth >= dayjs().format('YYYY-MM')}>›</button>
      </div>
      <p className="payments-hint">Shows invoices raised in this month and invoices for moves happening in it.</p>
      {matched.length === 0 ? <p className="payments-empty">No matched payments for this month.</p> : (
        <div className="table-scroll">
          <table className="payments-table">
            <thead><tr><th>Invoice</th><th>Unit</th><th>Fee</th><th>Amount</th><th>Paid</th><th>Booking</th><th /></tr></thead>
            <tbody>
              {matched.map((p) => (
                <tr key={p.id}>
                  <td>{p.invoiceId}</td>
                  <td>{p.unit ?? '—'}</td>
                  <td><FeeTypeBadge feeType={p.feeType} /></td>
                  <td>{money(p.amountPaid)}</td>
                  <td>{fmtDay(p.paidAt)}</td>
                  <td>
                    {p.booking
                      ? <Link to={`/admin/bookings/${p.booking.id}`}>{p.booking.residentName} · {fmtMoveDate(p.booking.moveDate)}</Link>
                      : '—'}
                  </td>
                  <td><button className="btn-dismiss" disabled={busy === p.id} onClick={() => unmatch(p)}>Unmatch</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Reversed ─────────────────────────────────────────── */}
      {reversed.length > 0 && (
        <>
          <h2>Reversed in Invoice Ninja</h2>
          <p className="payments-hint">These invoices were cancelled or reversed after being paid. Any booking they were matched to is flagged “Payment reversed” in the queue.</p>
          <div className="table-scroll">
            <table className="payments-table">
              <thead><tr><th>Invoice</th><th>Unit</th><th>Amount</th><th>Reversed</th></tr></thead>
              <tbody>
                {reversed.map((p) => (
                  <tr key={p.id}><td>{p.invoiceId}</td><td>{p.unit ?? '—'}</td><td>{money(p.amountPaid)}</td><td>{p.reversedAt ? fmtDay(p.reversedAt) : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Dismissed ────────────────────────────────────────── */}
      {dismissed.length > 0 && (
        <div className="dismissed-section">
          <button className="dismissed-toggle" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? '▾' : '▸'} Dismissed payments ({dismissed.length})
          </button>
          {showDismissed && (
            <div className="table-scroll">
              <table className="payments-table">
                <thead><tr><th>Invoice</th><th>Unit</th><th>Amount</th><th>Reason</th><th /></tr></thead>
                <tbody>
                  {dismissed.map((p) => (
                    <Fragment key={p.id}>
                      <tr className="row-dismissed">
                        <td>{p.invoiceId}</td><td>{p.unit ?? '—'}</td><td>{money(p.amountPaid)}</td>
                        <td className="dismissed-reason">{p.dismissedReason}</td>
                        <td><button className="btn-restore" disabled={busy === p.id} onClick={() => restore(p)}>Restore</button></td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
