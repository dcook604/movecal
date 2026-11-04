import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { api } from '../api';
import { decodeRoleFromToken, UserRole } from './session';
import '../styles/admin.css';

export interface LoginResult {
  token: string;
  role: UserRole | null;
  mustChangePassword: boolean;
}

/** Login / forgot-password / reset-password screens shared by every admin route. */
export function AdminLogin({ onLoggedIn, notice }: { onLoggedIn: (result: LoginResult) => void; notice?: string }) {
  const [view, setView] = useState<'login' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice ?? '');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  useEffect(() => {
    const tok = new URLSearchParams(window.location.search).get('reset');
    if (tok) { setResetToken(tok); setView('reset'); }
  }, []);

  useEffect(() => { if (notice) setError(notice); }, [notice]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/api/auth/login', { email: email.trim(), password });
      const role = (data.user?.role as UserRole | undefined) ?? decodeRoleFromToken(data.token);
      onLoggedIn({ token: data.token, role, mustChangePassword: !!data.user?.mustChangePassword });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) return setError('Invalid email or password.');
      if (axios.isAxiosError(err) && err.response?.status === 429) return setError('Too many login attempts. Please wait 15 minutes and try again.');
      setError('Login failed. Please try again.');
    }
  };

  const forgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    setForgotMsg('');
    try {
      const { data } = await api.post('/api/auth/forgot-password', { email: forgotEmail.trim() });
      setForgotMsg(data.message);
    } catch {
      setForgotMsg('Failed to send reset email. Please try again.');
    }
  };

  const submitPasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    setResetMsg('');
    if (resetNewPassword !== resetConfirm) { setResetMsg('Passwords do not match.'); return; }
    if (resetNewPassword.length < 10) { setResetMsg('Password must be at least 10 characters.'); return; }
    try {
      const { data } = await api.post('/api/auth/reset-password', { token: resetToken, password: resetNewPassword });
      setResetMsg(data.message);
      window.history.replaceState({}, '', '/admin');
      setTimeout(() => { setView('login'); setResetMsg(''); setResetToken(''); setResetNewPassword(''); setResetConfirm(''); }, 2500);
    } catch (err: any) {
      setResetMsg(err.response?.data?.message || 'Failed to reset password. The link may have expired.');
    }
  };

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card">
        {view === 'login' && (
          <>
            <h2>Admin Login</h2>
            <form onSubmit={login}>
              <div className="form-field">
                <label htmlFor="admin-email">Email</label>
                <input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" required />
              </div>
              <div className="form-field">
                <label htmlFor="admin-password">Password</label>
                <input id="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
              </div>
              {error && <p className="error-message">{error}</p>}
              <button type="submit">Login</button>
            </form>
            <button type="button" className="forgot-link" onClick={() => { setView('forgot'); setError(''); }}>Forgot password?</button>
          </>
        )}

        {view === 'forgot' && (
          <>
            <h2>Reset Password</h2>
            <p className="admin-section-desc">Enter your email address and we'll send you a reset link.</p>
            <form onSubmit={forgotPassword}>
              <div className="form-field">
                <label htmlFor="forgot-email">Email</label>
                <input id="forgot-email" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="admin@example.com" required />
              </div>
              {forgotMsg && <p className={forgotMsg.includes('sent') ? 'success-message' : 'error-message'}>{forgotMsg}</p>}
              <button type="submit">Send Reset Link</button>
            </form>
            <button type="button" className="login-back-link" onClick={() => { setView('login'); setForgotMsg(''); setForgotEmail(''); }}>Back to login</button>
          </>
        )}

        {view === 'reset' && (
          <>
            <h2>Set New Password</h2>
            <form onSubmit={submitPasswordReset}>
              <div className="form-field">
                <label htmlFor="reset-password">New Password</label>
                <input id="reset-password" type="password" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} minLength={10} placeholder="Minimum 10 characters" required />
                <small>Minimum 10 characters</small>
              </div>
              <div className="form-field">
                <label htmlFor="reset-confirm">Confirm Password</label>
                <input id="reset-confirm" type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} required />
              </div>
              {resetMsg && <p className={resetMsg.includes('successfully') ? 'success-message' : 'error-message'}>{resetMsg}</p>}
              <button type="submit">Reset Password</button>
            </form>
            <button type="button" className="login-back-link" onClick={() => { setView('login'); window.history.replaceState({}, '', '/admin'); }}>Back to login</button>
          </>
        )}
      </div>
    </div>
  );
}
