import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { api, setToken } from '../api';
import dayjs from 'dayjs';
import '../styles/payments.css';

type UserRole = 'CONCIERGE' | 'COUNCIL' | 'PROPERTY_MANAGER';

function decodeRoleFromToken(token?: string): UserRole | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const role = payload?.role;
    if (role === 'CONCIERGE' || role === 'COUNCIL' || role === 'PROPERTY_MANAGER') return role;
  } catch { return null; }
  return null;
}

interface Payment {
  id: string;
  clientId: string;
  invoiceId: string;
  billingPeriod: string;
  feeType: string;
  unit: string | null;
  paidAt: string;
  createdAt: string;
  dismissed: boolean;
  dismissedReason: string | null;
  dismissedAt: string | null;
  moveApprovals?: { moveRequestId: string; approvedAt: string }[];
}

function FeeTypeBadge({ feeType }: { feeType: string }) {
  if (feeType === 'move_in') return <span className="fee-type-badge move-in">Move In</span>;
  if (feeType === 'move_out') return <span className="fee-type-badge move-out">Move Out</span>;
  return <span className="fee-type-badge unknown">Unknown</span>;
}

export function PaymentsLedgerPage() {
  const [token, updateToken] = useState(() => localStorage.getItem('movecal_token') ?? '');
  const [role, setRole] = useState<UserRole | null>(() => {
    const storedRole = localStorage.getItem('movecal_role');
    if (storedRole === 'CONCIERGE' || storedRole === 'COUNCIL' || storedRole === 'PROPERTY_MANAGER') return storedRole as UserRole;
    return decodeRoleFromToken(localStorage.getItem('movecal_token') ?? undefined);
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [selectedMonth, setSelectedMonth] = useState(() => dayjs().format('YYYY-MM'));
  const [unmatched, setUnmatched] = useState<Payment[]>([]);
  const [matched, setMatched] = useState<Payment[]>([]);
  const [dismissed, setDismissed] = useState<Payment[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  // Dismiss state
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState<Record<string, string>>({});
  const [dismissSaving, setDismissSaving] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // Inline fee-type edit state: { [paymentId]: 'move_in' | 'move_out' }
  const [pendingFeeType, setPendingFeeType] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const canManageSettings = role === 'COUNCIL' || role === 'PROPERTY_MANAGER';

  const handleAuthError = (error: unknown): boolean => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      updateToken('');
      setRole(null);
      setToken();
      localStorage.removeItem('movecal_token');
      localStorage.removeItem('movecal_role');
      setLoginError('Your session has expired. Please log in again.');
      return true;
    }
    return false;
  };

  const refresh = async (month = selectedMonth) => {
    setLoadError('');
    try {
      // Auto-retry matching on every refresh so unmatched payments resolve without manual action
      await api.post('/api/admin/payments-ledger/retry-match').catch(() => {});
      const { data } = await api.get(`/api/admin/payments-ledger?month=${month}`);
      setUnmatched(data.unmatched ?? []);
      setMatched(data.matched ?? []);
      setDismissed(data.dismissed ?? []);
    } catch (error) {
      if (handleAuthError(error)) return;
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        setLoadError('You do not have permission to access this page.');
        return;
      }
      setLoadError('Failed to load payments data. Please refresh the page.');
    }
  };

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const { data } = await api.post('/api/auth/login', { email: email.trim(), password });
      updateToken(data.token);
      setToken(data.token);
      localStorage.setItem('movecal_token', data.token);
      const nextRole = (data.user?.role as UserRole | undefined) ?? decodeRoleFromToken(data.token) ?? null;
      setRole(nextRole);
      if (nextRole) localStorage.setItem('movecal_role', nextRole);
      window.dispatchEvent(new CustomEvent('movecal-auth'));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          setLoginError('Invalid email or password.');
          return;
        }
        if (error.response?.status === 429) {
          setLoginError('Too many login attempts. Please wait 15 minutes and try again.');
          return;
        }
      }
      setLoginError('Login failed. Please try again.');
    }
  };

  useEffect(() => { if (!token) return; refresh(); }, [token]);
  useEffect(() => { if (!token) return; refresh(selectedMonth); }, [selectedMonth]);

  const retryMatch = async () => {
    setActionMessage('');
    try {
      const { data } = await api.post('/api/admin/payments-ledger/retry-match');
      setActionMessage(data.matched > 0 ? `Matched ${data.matched} payment(s).` : 'No new matches found.');
      await refresh();
    } catch (error) {
      if (handleAuthError(error)) return;
      setActionMessage('Retry match failed.');
    }
  };

  const saveFeeType = async (payment: Payment) => {
    const newFeeType = pendingFeeType[payment.id];
    if (!newFeeType) return;
    setSaving(payment.id);
    setActionMessage('');
    try {
      const { data } = await api.patch(`/api/admin/payments-ledger/${payment.id}/fee-type`, { feeType: newFeeType });
      setActionMessage(data.approved ? 'Fee type saved and booking auto-approved.' : 'Fee type saved.');
      await refresh();
    } catch (error) {
      if (handleAuthError(error)) return;
      setActionMessage('Failed to save fee type.');
    } finally {
      setSaving(null);
    }
  };

  const dismissPayment = async (payment: Payment) => {
    const reason = dismissReason[payment.id]?.trim();
    if (!reason) return;
    setDismissSaving(payment.id);
    setActionMessage('');
    try {
      await api.patch(`/api/admin/payments-ledger/${payment.id}/dismiss`, { reason });
      setDismissingId(null);
      setDismissReason(prev => { const n = { ...prev }; delete n[payment.id]; return n; });
      await refresh();
    } catch (error) {
      if (handleAuthError(error)) return;
      setActionMessage('Failed to dismiss payment.');
    } finally {
      setDismissSaving(null);
    }
  };

  const restorePayment = async (payment: Payment) => {
    setActionMessage('');
    try {
      await api.patch(`/api/admin/payments-ledger/${payment.id}/restore`);
      await refresh();
    } catch (error) {
      if (handleAuthError(error)) return;
      setActionMessage('Failed to restore payment.');
    }
  };

  // ── Login gate ──────────────────────────────────────────────────
  if (!token || !role) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">
          <h2>Admin Login</h2>
          {loginError && <p className="form-error">{loginError}</p>}
          <form onSubmit={login}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit">Log In</button>
          </form>
        </div>
      </div>
    );
  }

  if (!canManageSettings) {
    return (
      <div className="payments-page">
        <h1>Payments Ledger</h1>
        <p className="payments-error">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="payments-page">
      <h1>Payments Ledger</h1>

      <div className="page-actions">
        <button onClick={() => refresh()}>Refresh</button>
        <button onClick={retryMatch}>Retry Match</button>
        {actionMessage && <span style={{ color: actionMessage.includes('failed') || actionMessage.includes('Failed') ? '#dc2626' : '#166534' }}>{actionMessage}</span>}
      </div>

      {loadError && <p className="payments-error">{loadError}</p>}

      <h2>Unmatched Payments</h2>
      {unmatched.length === 0
        ? <p className="payments-empty">No unmatched payments.</p>
        : (
          <div className="table-scroll">
          <table className="payments-table">
            <thead>
              <tr>
                <th className="col-hide-mobile">Client ID</th>
                <th className="col-hide-mobile">Invoice ID</th>
                <th>Unit</th>
                <th>Fee Type</th>
                <th className="col-hide-mobile">Billing Period</th>
                <th>Paid At</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map(p => (
                <>
                  <tr key={p.id} className={p.feeType === 'unknown' ? 'row-unknown' : undefined}>
                    <td className="col-hide-mobile">{p.clientId}</td>
                    <td className="col-hide-mobile">{p.invoiceId}</td>
                    <td>{p.unit ?? '—'}</td>
                    <td>
                      {p.feeType === 'unknown'
                        ? (
                          <div className="inline-fee-form">
                            <select
                              value={pendingFeeType[p.id] ?? ''}
                              onChange={e => setPendingFeeType(prev => ({ ...prev, [p.id]: e.target.value }))}
                            >
                              <option value="">Select…</option>
                              <option value="move_in">Move In</option>
                              <option value="move_out">Move Out</option>
                            </select>
                            <button
                              disabled={!pendingFeeType[p.id] || saving === p.id}
                              onClick={() => saveFeeType(p)}
                            >
                              {saving === p.id ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        )
                        : <FeeTypeBadge feeType={p.feeType} />
                      }
                    </td>
                    <td className="col-hide-mobile">{p.billingPeriod}</td>
                    <td>{dayjs(p.paidAt).format('MMM D, YYYY')}</td>
                    <td>
                      {p.feeType === 'unknown'
                        ? <span className="status-badge needs-review">Needs Manual Review</span>
                        : <span className="status-badge awaiting">Awaiting Move Booking</span>
                      }
                    </td>
                    <td>
                      {dismissingId === p.id
                        ? <button className="btn-dismiss-cancel" onClick={() => setDismissingId(null)}>Cancel</button>
                        : <button className="btn-dismiss" onClick={() => setDismissingId(p.id)}>Dismiss</button>
                      }
                    </td>
                  </tr>
                  {dismissingId === p.id && (
                    <tr key={`${p.id}-dismiss`} className="dismiss-row">
                      <td colSpan={8}>
                        <div className="dismiss-form">
                          <label>Reason for dismissal</label>
                          <input
                            type="text"
                            placeholder="e.g. No move request submitted, refund issued…"
                            value={dismissReason[p.id] ?? ''}
                            onChange={e => setDismissReason(prev => ({ ...prev, [p.id]: e.target.value }))}
                            autoFocus
                          />
                          <button
                            className="btn-dismiss-confirm"
                            disabled={!dismissReason[p.id]?.trim() || dismissSaving === p.id}
                            onClick={() => dismissPayment(p)}
                          >
                            {dismissSaving === p.id ? 'Dismissing…' : 'Confirm Dismiss'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          </div>
        )
      }

      <div className="month-nav">
        <button
          className="month-nav-btn"
          onClick={() => setSelectedMonth(m => dayjs(m + '-01').subtract(1, 'month').format('YYYY-MM'))}
        >‹</button>
        <span className="month-nav-label">{dayjs(selectedMonth + '-01').format('MMMM YYYY')}</span>
        <button
          className="month-nav-btn"
          onClick={() => setSelectedMonth(m => dayjs(m + '-01').add(1, 'month').format('YYYY-MM'))}
          disabled={selectedMonth >= dayjs().format('YYYY-MM')}
        >›</button>
      </div>

      <h2>Matched Payments</h2>
      {matched.length === 0
        ? <p className="payments-empty">No matched payments yet.</p>
        : (
          <div className="table-scroll">
          <table className="payments-table">
            <thead>
              <tr>
                <th className="col-hide-mobile">Client ID</th>
                <th className="col-hide-mobile">Invoice ID</th>
                <th>Unit</th>
                <th>Fee Type</th>
                <th className="col-hide-mobile">Billing Period</th>
                <th>Paid At</th>
                <th className="col-hide-mobile">Move Request ID</th>
                <th>Approved At</th>
              </tr>
            </thead>
            <tbody>
              {matched.map(p => (
                <tr key={p.id}>
                  <td className="col-hide-mobile">{p.clientId}</td>
                  <td className="col-hide-mobile">{p.invoiceId}</td>
                  <td>{p.unit ?? '—'}</td>
                  <td><FeeTypeBadge feeType={p.feeType} /></td>
                  <td className="col-hide-mobile">{p.billingPeriod}</td>
                  <td>{dayjs(p.paidAt).format('MMM D, YYYY')}</td>
                  <td className="col-hide-mobile" style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>
                    {p.moveApprovals?.[0]?.moveRequestId ?? '—'}
                  </td>
                  <td>{p.moveApprovals?.[0] ? dayjs(p.moveApprovals[0].approvedAt).format('MMM D, YYYY') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )
      }

      <div className="dismissed-section">
        <button className="dismissed-toggle" onClick={() => setShowDismissed(v => !v)}>
          {showDismissed ? '▾' : '▸'} Dismissed Payments ({dismissed.length})
        </button>
        {showDismissed && (
          dismissed.length === 0
            ? <p className="payments-empty">No dismissed payments.</p>
            : (
              <div className="table-scroll">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th className="col-hide-mobile">Client ID</th>
                    <th className="col-hide-mobile">Invoice ID</th>
                    <th>Unit</th>
                    <th>Fee Type</th>
                    <th className="col-hide-mobile">Billing Period</th>
                    <th>Paid At</th>
                    <th className="col-hide-mobile">Dismissed At</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dismissed.map(p => (
                    <tr key={p.id} className="row-dismissed">
                      <td className="col-hide-mobile">{p.clientId}</td>
                      <td className="col-hide-mobile">{p.invoiceId}</td>
                      <td>{p.unit ?? '—'}</td>
                      <td><FeeTypeBadge feeType={p.feeType} /></td>
                      <td className="col-hide-mobile">{p.billingPeriod}</td>
                      <td>{dayjs(p.paidAt).format('MMM D, YYYY')}</td>
                      <td className="col-hide-mobile">{p.dismissedAt ? dayjs(p.dismissedAt).format('MMM D, YYYY') : '—'}</td>
                      <td className="dismissed-reason">{p.dismissedReason}</td>
                      <td>
                        <button className="btn-restore" onClick={() => restorePayment(p)}>Restore</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )
        )}
      </div>
    </div>
  );
}
