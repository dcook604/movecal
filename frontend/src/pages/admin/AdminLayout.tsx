import { FormEvent, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { api } from '../../api';
import { AdminLogin, LoginResult } from '../../auth/AdminLogin';
import {
  clearSession, decodeEmailFromToken, errorMessage, getStoredRole, getStoredToken,
  isUnauthorized, ROLE_LABELS, saveSession, UserRole,
} from '../../auth/session';
import { UiProvider } from '../../components/ui';
import '../../styles/admin.css';

export interface AdminContext {
  role: UserRole;
  email: string;
  canManage: boolean;
  /** Returns true (and logs the user out) when the error is an expired session. */
  handleAuthError: (error: unknown) => boolean;
  /** Store a refreshed token (password/email change invalidates older sessions). */
  adoptToken: (token: string) => void;
}

export const useAdmin = () => useOutletContext<AdminContext>();

/** Authenticated shell for every /admin route: login gate, sub-navigation, forced password change. */
export function AdminLayout() {
  const [token, setTokenState] = useState(getStoredToken);
  const [role, setRole] = useState<UserRole | null>(getStoredRole);
  const [notice, setNotice] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [msg, setMsg] = useState('');

  // Keep in sync if another tab logs in/out.
  useEffect(() => {
    const sync = () => { setTokenState(getStoredToken()); setRole(getStoredRole()); };
    window.addEventListener('movecal-auth', sync);
    return () => window.removeEventListener('movecal-auth', sync);
  }, []);

  const logout = useCallback(() => { clearSession(); setTokenState(''); setRole(null); }, []);

  const handleAuthError = useCallback((error: unknown) => {
    if (!isUnauthorized(error)) return false;
    clearSession();
    setTokenState('');
    setRole(null);
    setNotice('Your session has expired. Please log in again.');
    return true;
  }, []);

  const adoptToken = useCallback((next: string) => { saveSession(next, getStoredRole()); setTokenState(next); }, []);

  const onLoggedIn = (r: LoginResult) => {
    saveSession(r.token, r.role);
    setTokenState(r.token);
    setRole(r.role);
    setNotice('');
    if (r.mustChangePassword) setMustChange(true);
  };

  const submitForcedChange = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (form.newPassword !== form.confirmPassword) return setMsg('Passwords do not match');
    if (form.newPassword.length < 10) return setMsg('Password must be at least 10 characters');
    try {
      const res = await api.post('/api/auth/change-password', form);
      if (res.data?.token) adoptToken(res.data.token);
      setMustChange(false);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      if (handleAuthError(err)) return;
      setMsg(errorMessage(err, 'Failed to change password.'));
    }
  };

  if (!token || !role) return <AdminLogin onLoggedIn={onLoggedIn} notice={notice} />;

  const canManage = role === 'COUNCIL' || role === 'PROPERTY_MANAGER';
  const email = decodeEmailFromToken(token);
  const ctx: AdminContext = { role, email, canManage, handleAuthError, adoptToken };

  return (
    <UiProvider>
    <div className="admin-page">
      {mustChange && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem' }}>Password Change Required</h2>
            <p style={{ margin: '0 0 20px', color: '#475569', fontSize: '0.9rem' }}>
              Your administrator requires you to set a new password before continuing.
            </p>
            {msg && <p className="error-message">{msg}</p>}
            <form onSubmit={submitForcedChange}>
              <div className="form-field">
                <label htmlFor="force-current-password">Current Password</label>
                <input id="force-current-password" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
              </div>
              <div className="form-field">
                <label htmlFor="force-new-password">New Password</label>
                <input id="force-new-password" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} minLength={10} required />
                <small>Minimum 10 characters</small>
              </div>
              <div className="form-field">
                <label htmlFor="force-confirm-password">Confirm New Password</label>
                <input id="force-confirm-password" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
              </div>
              <button className="btn-sm btn-blue" type="submit" style={{ width: '100%', padding: '10px' }}>Set New Password</button>
            </form>
          </div>
        </div>
      )}

      <div className="admin-subnav">
        <nav aria-label="Admin sections">
          <NavLink to="/admin" end>Queue</NavLink>
          {canManage && <NavLink to="/admin/payments">Payments</NavLink>}
          <NavLink to="/admin/history">History</NavLink>
          <NavLink to="/admin/settings">Settings</NavLink>
        </nav>
        <div className="admin-subnav-user">
          <span>{email} · {ROLE_LABELS[role]}</span>
          <button className="btn-sm btn-slate" onClick={logout}>Logout</button>
        </div>
      </div>

      <Outlet context={ctx} />
    </div>
    </UiProvider>
  );
}
