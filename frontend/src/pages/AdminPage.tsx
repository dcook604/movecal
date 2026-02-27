import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { api, setToken } from '../api';
import '../styles/admin.css';
import dayjs from 'dayjs';

// ── Time slot helpers (mirrors ResidentSubmissionPage) ────────
type Slot = { label: string; start: string; end: string };

const MOVE_WEEKDAY_SLOTS: Slot[] = [
  { label: '10:00 AM – 1:00 PM', start: '10:00', end: '13:00' },
  { label: '1:00 PM – 4:00 PM',  start: '13:00', end: '16:00' },
];

const MOVE_WEEKEND_SLOTS: Slot[] = [
  { label: '8:00 AM – 11:00 AM', start: '08:00', end: '11:00' },
  { label: '11:00 AM – 2:00 PM', start: '11:00', end: '14:00' },
  { label: '2:00 PM – 5:00 PM',  start: '14:00', end: '17:00' },
];

const STATUTORY_HOLIDAYS = new Set([
  '2025-01-01','2025-02-17','2025-04-18','2025-05-19',
  '2025-07-01','2025-08-04','2025-09-01','2025-10-13',
  '2025-11-11','2025-12-25','2025-12-26',
  '2026-01-01','2026-02-16','2026-04-03','2026-05-18',
  '2026-07-01','2026-08-03','2026-09-07','2026-10-12',
  '2026-11-11','2026-12-25','2026-12-26',
  '2027-01-01','2027-02-15','2027-03-26','2027-05-24',
  '2027-07-01','2027-08-02','2027-09-06','2027-10-11',
  '2027-11-11','2027-12-25','2027-12-26',
  '2028-01-01','2028-02-21','2028-04-14','2028-05-22',
  '2028-07-01','2028-08-07','2028-09-04','2028-10-09',
  '2028-11-11','2028-12-25','2028-12-26',
  '2029-01-01','2029-02-19','2029-03-30','2029-05-21',
  '2029-07-01','2029-08-06','2029-09-03','2029-10-08',
  '2029-11-11','2029-12-25','2029-12-26',
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

function getSlotsForDateAndType(dateStr: string, moveType: string): Slot[] | null {
  if (!dateStr) return null;
  if (STATUTORY_HOLIDAYS.has(dateStr)) return [];
  const dow = dayjs(dateStr).day();
  const isWeekend = dow === 0 || dow === 6;
  if (moveType === 'DELIVERY') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 30);
  }
  if (moveType === 'RENO') {
    const [rangeStart, rangeEnd] = isWeekend ? [8 * 60, 17 * 60] : [10 * 60, 16 * 60];
    return generateTimeSlots(rangeStart, rangeEnd, 60);
  }
  return isWeekend ? MOVE_WEEKEND_SLOTS : MOVE_WEEKDAY_SLOTS;
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

const emptyRecipient = { name: '', email: '', enabled: true, notifyOn: ['APPROVED', 'REJECTED', 'SUBMITTED'] };
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

function decodeEmailFromToken(token?: string | null): string {
  if (!token) return '';
  const parts = token.split('.');
  if (parts.length < 2) return '';
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.email ?? '';
  } catch { return ''; }
}

const ROLE_LABELS: Record<string, string> = {
  CONCIERGE: 'Concierge',
  COUNCIL: 'Council',
  PROPERTY_MANAGER: 'Property Manager',
};

export function AdminPage() {
  const [token, updateToken] = useState(() => localStorage.getItem('movecal_token') ?? '');
  const [role, setRole] = useState<UserRole | null>(() => {
    const storedRole = localStorage.getItem('movecal_role');
    if (storedRole === 'CONCIERGE' || storedRole === 'COUNCIL' || storedRole === 'PROPERTY_MANAGER') return storedRole as UserRole;
    return decodeRoleFromToken(localStorage.getItem('movecal_token') ?? undefined);
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [bookings, setBookings] = useState<any[]>([]);
  const [stats, setStats] = useState<any>();
  const [recipients, setRecipients] = useState<any[]>([]);
  const [recipientForm, setRecipientForm] = useState<any>(emptyRecipient);
  const [settings, setSettings] = useState<any>({ smtpHost: null, smtpPort: null, smtpSecure: false, smtpUsername: null, fromName: null, fromEmail: null, includeResidentContactInApprovalEmails: false, reminderEnabled: true, invoiceNinjaEnabled: false });
  const [testEmailTo, setTestEmailTo] = useState(() => decodeEmailFromToken(localStorage.getItem('movecal_token')));
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const [showPastBookings, setShowPastBookings] = useState(false);

  const [loginView, setLoginView] = useState<'login' | 'forgot' | 'reset'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [accountMessage, setAccountMessage] = useState('');

  const [users, setUsers] = useState<any[]>([]);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'CONCIERGE' });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userMessage, setUserMessage] = useState('');

  const emptyQuickEntry = {
    residentName: '', residentEmail: '', residentPhone: '', unit: '',
    moveType: 'MOVE_IN', companyName: '', moveDate: '', elevatorRequired: true,
    loadingBayRequired: false, notes: '', publicUnitMask: '',
  };
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickForm, setQuickForm] = useState<any>(emptyQuickEntry);
  const [quickSlot, setQuickSlot] = useState('');
  const [quickError, setQuickError] = useState('');
  const [isQuickSubmitting, setIsQuickSubmitting] = useState(false);
  const [quickTakenRanges, setQuickTakenRanges] = useState<{ start: string; end: string }[]>([]);

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

  const refresh = async () => {
    setLoadError('');
    try {
      const [b, s] = await Promise.all([api.get('/api/admin/bookings'), api.get('/api/admin/stats')]);
      setBookings(b.data);
      setStats(s.data);
      if (canManageSettings) {
        const [r, st, u] = await Promise.all([
          api.get('/api/admin/recipients'),
          api.get('/api/admin/settings'),
          api.get('/api/admin/users'),
        ]);
        setRecipients(r.data);
        if (st.data) setSettings((prev: any) => ({ ...prev, ...st.data, smtpPassword: '' }));
        setUsers(u.data);
      }
    } catch (error) {
      if (handleAuthError(error)) return;
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        setLoadError('You do not have permission to access admin data.');
        return;
      }
      setLoadError('Failed to load admin data. Please refresh the page.');
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
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setLoginError('Invalid email or password.');
        return;
      }
      setLoginError('Login failed. Please try again.');
    }
  };

  useEffect(() => { if (!token) return; refresh(); }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('reset');
    if (tok) { setResetToken(tok); setLoginView('reset'); }
  }, []);

  useEffect(() => {
    if (!quickForm.moveDate) { setQuickTakenRanges([]); return; }
    api.get(`/api/public/taken-slots?date=${quickForm.moveDate}`)
      .then((res: any) => setQuickTakenRanges(res.data))
      .catch(() => setQuickTakenRanges([]));
  }, [quickForm.moveDate]);

  const updateStatus = async (id: string, status: string) => {
    if (!confirm(`Are you sure you want to ${status.toLowerCase()} this booking?`)) return;
    setIsUpdating(id);
    setActionMessage('');
    try {
      await api.patch(`/api/admin/bookings/${id}`, { status });
      const label = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : status.toLowerCase();
      setActionMessage(`Booking ${label} successfully`);
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      const verb = status === 'APPROVED' ? 'approve' : status === 'REJECTED' ? 'reject' : status.toLowerCase();
      setActionMessage(error.response?.data?.message || `Failed to ${verb} booking.`);
    } finally { setIsUpdating(null); }
  };

  const deleteBooking = async (id: string, residentName: string) => {
    if (!confirm(`Delete booking for ${residentName}? This cannot be undone.`)) return;
    setIsUpdating(id);
    setActionMessage('');
    try {
      await api.delete(`/api/admin/bookings/${id}`);
      setActionMessage('Booking deleted successfully');
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(error.response?.data?.message || 'Failed to delete booking.');
    } finally { setIsUpdating(null); }
  };

  const createRecipient = async (e: FormEvent) => {
    e.preventDefault();
    setActionMessage('');
    try {
      await api.post('/api/admin/recipients', recipientForm);
      setRecipientForm(emptyRecipient);
      setActionMessage('Recipient added successfully');
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(error.response?.data?.message || 'Failed to add recipient.');
    }
  };

  const toggleRecipientEnabled = async (id: string, enabled: boolean) => {
    setActionMessage('');
    try {
      await api.patch(`/api/admin/recipients/${id}`, { enabled });
      setActionMessage(`Recipient ${enabled ? 'enabled' : 'disabled'} successfully`);
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(error.response?.data?.message || 'Failed to update recipient.');
    }
  };

  const deleteRecipient = async (id: string, recipientEmail: string) => {
    if (!confirm(`Delete recipient ${recipientEmail}?`)) return;
    setActionMessage('');
    try {
      await api.delete(`/api/admin/recipients/${id}`);
      setActionMessage('Recipient deleted successfully');
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(error.response?.data?.message || 'Failed to delete recipient.');
    }
  };

  const toggleRecipientEvent = (event: string) => {
    const current = recipientForm.notifyOn || [];
    const updated = current.includes(event) ? current.filter((e: string) => e !== event) : [...current, event];
    setRecipientForm({ ...recipientForm, notifyOn: updated });
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setActionMessage('');
    try {
      const portValue = settings.smtpPort === '' || settings.smtpPort === null ? null : Number(settings.smtpPort);
      await api.put('/api/admin/settings', { ...settings, smtpPort: Number.isNaN(portValue) ? null : portValue });
      setActionMessage('Settings saved successfully');
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(error.response?.data?.message || 'Failed to save settings.');
    }
  };

  const sendTestEmail = async () => {
    setActionMessage('');
    try {
      await api.post('/api/admin/settings/test-email', { to: testEmailTo });
      setActionMessage('Test email sent successfully');
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setActionMessage(error.response?.data?.message || 'Failed to send test email.');
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setAccountMessage('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setAccountMessage('New passwords do not match'); return; }
    if (passwordForm.newPassword.length < 8) { setAccountMessage('Password must be at least 8 characters'); return; }
    try {
      await api.post('/api/auth/change-password', passwordForm);
      setAccountMessage('Password changed successfully');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setAccountMessage(error.response?.data?.message || 'Failed to change password.');
    }
  };

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    setAccountMessage('');
    try {
      const response = await api.post('/api/auth/change-email', emailForm);
      if (response.data.token) {
        updateToken(response.data.token);
        setToken(response.data.token);
        localStorage.setItem('movecal_token', response.data.token);
        setEmail(response.data.user.email);
      }
      setAccountMessage('Email changed successfully');
      setEmailForm({ newEmail: '', password: '' });
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setAccountMessage(error.response?.data?.message || 'Failed to change email.');
    }
  };

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    setUserMessage('');
    try {
      await api.post('/api/admin/users', userForm);
      setUserMessage('User created successfully');
      setUserForm({ name: '', email: '', password: '', role: 'CONCIERGE' });
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setUserMessage(error.response?.data?.message || 'Failed to create user.');
    }
  };

  const updateUser = async (userId: string) => {
    setUserMessage('');
    try {
      const updateData: any = { name: userForm.name, email: userForm.email, role: userForm.role };
      if (userForm.password) updateData.password = userForm.password;
      await api.patch(`/api/admin/users/${userId}`, updateData);
      setUserMessage('User updated successfully');
      setEditingUserId(null);
      setUserForm({ name: '', email: '', password: '', role: 'CONCIERGE' });
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setUserMessage(error.response?.data?.message || 'Failed to update user.');
    }
  };

  const deleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Delete user ${userEmail}?`)) return;
    setUserMessage('');
    try {
      await api.delete(`/api/admin/users/${userId}`);
      setUserMessage('User deleted successfully');
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setUserMessage(error.response?.data?.message || 'Failed to delete user.');
    }
  };

  const startEditUser = (user: any) => {
    setEditingUserId(user.id);
    setUserForm({ name: user.name, email: user.email, password: '', role: user.role });
    setUserMessage('');
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setUserForm({ name: '', email: '', password: '', role: 'CONCIERGE' });
    setUserMessage('');
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
    if (resetNewPassword.length < 8) { setResetMsg('Password must be at least 8 characters.'); return; }
    try {
      const { data } = await api.post('/api/auth/reset-password', { token: resetToken, password: resetNewPassword });
      setResetMsg(data.message);
      window.history.replaceState({}, '', '/admin');
      setTimeout(() => { setLoginView('login'); setResetMsg(''); setResetToken(''); setResetNewPassword(''); setResetConfirm(''); }, 2500);
    } catch (error: any) {
      setResetMsg(error.response?.data?.message || 'Failed to reset password. The link may have expired.');
    }
  };

  const submitQuickEntry = async (e: FormEvent) => {
    e.preventDefault();
    setQuickError('');
    const slots = getSlotsForDateAndType(quickForm.moveDate, quickForm.moveType);
    const selected = slots?.find((s) => s.start === quickSlot);
    if (!selected) { setQuickError('Please select a valid time slot.'); return; }
    const startDatetime = `${quickForm.moveDate}T${selected.start}:00`;
    const endDatetime   = `${quickForm.moveDate}T${selected.end}:00`;
    setIsQuickSubmitting(true);
    try {
      await api.post('/api/admin/quick-entry/approve', { ...quickForm, startDatetime, endDatetime });
      setQuickForm(emptyQuickEntry);
      setQuickSlot('');
      setShowQuickEntry(false);
      await refresh();
      setActionMessage('Booking created and approved successfully');
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setQuickError(error.response?.data?.message || 'Failed to create booking.');
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  /* ── Login screen ────────────────────────────────────────── */
  if (!token) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">

          {loginView === 'login' && (
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
                {loginError && <p className="error-message">{loginError}</p>}
                <button type="submit">Login</button>
              </form>
              <button type="button" className="forgot-link" onClick={() => { setLoginView('forgot'); setLoginError(''); }}>
                Forgot password?
              </button>
            </>
          )}

          {loginView === 'forgot' && (
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
              <button type="button" className="login-back-link" onClick={() => { setLoginView('login'); setForgotMsg(''); setForgotEmail(''); }}>
                Back to login
              </button>
            </>
          )}

          {loginView === 'reset' && (
            <>
              <h2>Set New Password</h2>
              <form onSubmit={submitPasswordReset}>
                <div className="form-field">
                  <label htmlFor="reset-password">New Password</label>
                  <input id="reset-password" type="password" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} minLength={8} placeholder="Minimum 8 characters" required />
                  <small>Minimum 8 characters</small>
                </div>
                <div className="form-field">
                  <label htmlFor="reset-confirm">Confirm Password</label>
                  <input id="reset-confirm" type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} required />
                </div>
                {resetMsg && <p className={resetMsg.includes('successfully') ? 'success-message' : 'error-message'}>{resetMsg}</p>}
                <button type="submit">Reset Password</button>
              </form>
              <button type="button" className="login-back-link" onClick={() => { setLoginView('login'); window.history.replaceState({}, '', '/admin'); }}>
                Back to login
              </button>
            </>
          )}

        </div>
      </div>
    );
  }

  /* ── Dashboard ───────────────────────────────────────────── */
  return (
    <div className="admin-page">

      <div className="admin-title-row">
        <h2>Dashboard</h2>
        <button
          className="btn-sm btn-slate btn-logout"
          onClick={() => {
            updateToken(''); setRole(null); setToken();
            localStorage.removeItem('movecal_token');
            localStorage.removeItem('movecal_role');
          }}
        >
          Logout
        </button>
      </div>

      {loadError    && <p className="error-message">{loadError}</p>}
      {actionMessage && <p className={actionMessage.includes('success') ? 'success-message' : 'error-message'}>{actionMessage}</p>}

      {/* ── Stats ── */}
      {stats && (
        <div className="admin-section">
          <h3>Statistics</h3>
          <div className="admin-stats-grid">
            <div className="admin-stat-card"><div className="admin-stat-value">{stats.totalBookings    || 0}</div><div className="admin-stat-label">Total</div></div>
            <div className="admin-stat-card"><div className="admin-stat-value">{stats.approvedBookings || 0}</div><div className="admin-stat-label">Approved</div></div>
            <div className="admin-stat-card"><div className="admin-stat-value">{stats.pendingBookings  || 0}</div><div className="admin-stat-label">Pending</div></div>
            <div className="admin-stat-card"><div className="admin-stat-value">{stats.bookingsThisMonth || 0}</div><div className="admin-stat-label">This Month</div></div>
          </div>
        </div>
      )}

      {/* ── Account Settings ── */}
      <div className="admin-section">
        <h3>Account Settings</h3>
        {accountMessage && <p className={accountMessage.includes('success') ? 'success-message' : 'error-message'}>{accountMessage}</p>}
        <div className="account-grid">
          {/* Change Password */}
          <div className="account-card">
            <h4>Change Password</h4>
            <form onSubmit={changePassword}>
              <div className="form-field">
                <label htmlFor="current-password">Current Password</label>
                <input id="current-password" type="password" value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} required />
              </div>
              <div className="form-field">
                <label htmlFor="new-password">New Password</label>
                <input id="new-password" type="password" value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} minLength={8} required />
                <small>Minimum 8 characters</small>
              </div>
              <div className="form-field">
                <label htmlFor="confirm-password">Confirm New Password</label>
                <input id="confirm-password" type="password" value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} required />
              </div>
              <button className="btn-sm btn-blue" type="submit">Change Password</button>
            </form>
          </div>

          {/* Change Email */}
          <div className="account-card">
            <h4>Change Email</h4>
            <p className="account-card-desc">Current: <strong>{email}</strong></p>
            <form onSubmit={changeEmail}>
              <div className="form-field">
                <label htmlFor="new-email">New Email</label>
                <input id="new-email" type="email" value={emailForm.newEmail}
                  onChange={(e) => setEmailForm({ ...emailForm, newEmail: e.target.value })} required />
              </div>
              <div className="form-field">
                <label htmlFor="confirm-password-email">Confirm Password</label>
                <input id="confirm-password-email" type="password" value={emailForm.password}
                  onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} required />
                <small>Enter your current password to confirm</small>
              </div>
              <button className="btn-sm btn-blue" type="submit">Change Email</button>
            </form>
          </div>
        </div>
      </div>

      {/* ── Bookings ── */}
      {(() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const upcoming = bookings.filter((b) => new Date(b.startDatetime) >= today);
        const past = bookings.filter((b) => new Date(b.startDatetime) < today)
          .sort((a, b) => new Date(b.startDatetime).getTime() - new Date(a.startDatetime).getTime());

        const qRawSlots = getSlotsForDateAndType(quickForm.moveDate, quickForm.moveType);
        const qIsHoliday = quickForm.moveDate && qRawSlots !== null && qRawSlots.length === 0;
        const qSlots = qRawSlots ? filterAvailableSlots(qRawSlots, quickTakenRanges) : qRawSlots;

        const renderBooking = (b: any) => (
          <div key={b.id} className="booking-card">
            <div className="booking-info">
              <div className="booking-name">{b.residentName} — Unit {b.unit}</div>
              <div className="booking-meta">
                {b.moveType?.replace(/_/g, ' ')} · {b.startDatetime ? new Date(b.startDatetime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
              </div>
            </div>
            <span className={`booking-status ${b.status}`}>{b.status}</span>
            <div className="booking-actions">
              <button className="btn-sm btn-green" onClick={() => updateStatus(b.id, 'APPROVED')} disabled={isUpdating === b.id}>
                {isUpdating === b.id ? '…' : 'Approve'}
              </button>
              <button className="btn-sm btn-red" onClick={() => updateStatus(b.id, 'REJECTED')} disabled={isUpdating === b.id}>
                {isUpdating === b.id ? '…' : 'Reject'}
              </button>
              <button className="btn-sm btn-slate" onClick={() => deleteBooking(b.id, b.residentName)} disabled={isUpdating === b.id}>
                {isUpdating === b.id ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        );

        return (
          <div className="admin-section">
            <div className="bookings-section-header">
              <h3>Bookings</h3>
              <button type="button" className="quick-entry-toggle"
                onClick={() => { setShowQuickEntry((v) => !v); setQuickError(''); }}>
                {showQuickEntry ? 'Cancel' : 'Add Manual Booking ▾'}
              </button>
            </div>

            {showQuickEntry && (
              <div className="admin-form-card" style={{ marginTop: '16px' }}>
                <h4>New Manual Booking</h4>
                <form onSubmit={submitQuickEntry}>
                  <div className="quick-entry-form-grid">
                    <div className="form-field">
                      <label htmlFor="qe-name">Resident Name</label>
                      <input id="qe-name" value={quickForm.residentName}
                        onChange={(e) => setQuickForm({ ...quickForm, residentName: e.target.value })}
                        placeholder="e.g. Jane Smith" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-email">Resident Email</label>
                      <input id="qe-email" type="email" value={quickForm.residentEmail}
                        onChange={(e) => setQuickForm({ ...quickForm, residentEmail: e.target.value })}
                        placeholder="name@example.com" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-phone">Resident Phone</label>
                      <input id="qe-phone" value={quickForm.residentPhone}
                        onChange={(e) => setQuickForm({ ...quickForm, residentPhone: e.target.value })}
                        placeholder="e.g. 604-555-1234" />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-unit" className="required">Unit</label>
                      <input id="qe-unit" value={quickForm.unit}
                        onChange={(e) => setQuickForm({ ...quickForm, unit: e.target.value })}
                        placeholder="e.g. 1204" required />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-type" className="required">Booking Type</label>
                      <select id="qe-type" value={quickForm.moveType}
                        onChange={(e) => { setQuickForm({ ...quickForm, moveType: e.target.value }); setQuickSlot(''); }}>
                        <option value="MOVE_IN">Move In</option>
                        <option value="MOVE_OUT">Move Out</option>
                        <option value="DELIVERY">Delivery</option>
                        <option value="RENO">Renovation</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-date" className="required">Date</label>
                      <input id="qe-date" type="date" value={quickForm.moveDate}
                        onChange={(e) => { setQuickForm({ ...quickForm, moveDate: e.target.value }); setQuickSlot(''); }}
                        required />
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-slot" className="required">Time Slot</label>
                      <select id="qe-slot" value={quickSlot}
                        onChange={(e) => setQuickSlot(e.target.value)}
                        disabled={!quickForm.moveDate || !!qIsHoliday || qSlots?.length === 0}
                        required>
                        <option value="">
                          {!quickForm.moveDate ? 'Select a date first' : qIsHoliday ? 'No slots on holidays' : qSlots?.length === 0 ? 'No slots available' : 'Select a time slot'}
                        </option>
                        {(qSlots ?? []).map((s) => (
                          <option key={s.start} value={s.start}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="qe-company">Company Name</label>
                      <input id="qe-company" value={quickForm.companyName}
                        onChange={(e) => setQuickForm({ ...quickForm, companyName: e.target.value })}
                        placeholder="e.g. ABC Movers (optional)" />
                    </div>
                  </div>
                  <div className="form-field" style={{ marginTop: '12px' }}>
                    <label htmlFor="qe-notes">Notes</label>
                    <textarea id="qe-notes" rows={2} value={quickForm.notes}
                      onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })}
                      placeholder="Optional details" />
                  </div>
                  <div className="form-field">
                    <label htmlFor="qe-mask">Public Unit Mask</label>
                    <input id="qe-mask" value={quickForm.publicUnitMask}
                      onChange={(e) => setQuickForm({ ...quickForm, publicUnitMask: e.target.value })}
                      placeholder="e.g. Unit 12xx (optional)" />
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={quickForm.elevatorRequired}
                        onChange={(e) => setQuickForm({ ...quickForm, elevatorRequired: e.target.checked })} />
                      Elevator Required
                    </label>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={quickForm.loadingBayRequired}
                        onChange={(e) => setQuickForm({ ...quickForm, loadingBayRequired: e.target.checked })} />
                      Loading Bay Required
                    </label>
                  </div>
                  {qIsHoliday && <p className="error-message" style={{ marginTop: '12px' }}>This date is a statutory holiday — no bookings permitted.</p>}
                  {quickError && <p className="error-message" style={{ marginTop: '12px' }}>{quickError}</p>}
                  <button className="btn-sm btn-green" type="submit" style={{ marginTop: '16px' }}
                    disabled={isQuickSubmitting || !!qIsHoliday}>
                    {isQuickSubmitting ? 'Creating…' : 'Create Approved Booking'}
                  </button>
                </form>
              </div>
            )}

            <div className="bookings-list">
              {bookings.length === 0 && <p className="admin-section-desc">No bookings found.</p>}

              {upcoming.length > 0 && (
                <>
                  {past.length > 0 && <div className="bookings-section-label">Upcoming</div>}
                  {upcoming.map(renderBooking)}
                </>
              )}

              {upcoming.length === 0 && past.length > 0 && (
                <p className="admin-section-desc">No upcoming bookings.</p>
              )}

              {past.length > 0 && (
                <>
                  <button type="button" className="bookings-past-toggle" onClick={() => setShowPastBookings((v) => !v)}>
                    {showPastBookings ? 'Hide' : 'Show'} past bookings ({past.length})
                  </button>
                  {showPastBookings && (
                    <>
                      <div className="bookings-section-label" style={{ marginTop: '16px' }}>Past</div>
                      {past.map(renderBooking)}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {canManageSettings && (
        <>
          {/* ── Notification Recipients ── */}
          <div className="admin-section">
            <h3>Notification Recipients</h3>
            <p className="admin-section-desc">Configure who receives email notifications for booking events.</p>

            {recipients.length === 0
              ? <p className="admin-section-desc" style={{ fontStyle: 'italic' }}>No recipients configured yet.</p>
              : recipients.map((r) => (
                <div key={r.id} className="admin-card">
                  <div className="recipient-row">
                    <div>
                      <div className="recipient-name">{r.name || r.email}</div>
                      {r.name && <div className="recipient-email">{r.email}</div>}
                    </div>
                    <div className="recipient-actions">
                      <button className={`btn-sm ${r.enabled ? 'btn-toggle-on' : 'btn-toggle-off'}`}
                        type="button" onClick={() => toggleRecipientEnabled(r.id, !r.enabled)}>
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button className="btn-sm btn-red" type="button" onClick={() => deleteRecipient(r.id, r.email)}>Delete</button>
                    </div>
                  </div>
                  <div className="recipient-events">
                    <strong>Notify on:</strong>{' '}
                    {r.notifyOn?.length > 0
                      ? r.notifyOn.map((ev: string) => ({ APPROVED: 'Approvals', REJECTED: 'Rejections', SUBMITTED: 'Submissions' }[ev] || ev)).join(', ')
                      : 'No events selected'}
                  </div>
                </div>
              ))
            }

            <div className="admin-form-card">
              <h4>Add New Recipient</h4>
              <form onSubmit={createRecipient}>
                <div className="form-field">
                  <label htmlFor="recipient-name">Name (optional)</label>
                  <input id="recipient-name" placeholder="e.g. John Smith" value={recipientForm.name}
                    onChange={(e) => setRecipientForm({ ...recipientForm, name: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="recipient-email" className="required">Email</label>
                  <input id="recipient-email" type="email" placeholder="john@example.com" value={recipientForm.email}
                    onChange={(e) => setRecipientForm({ ...recipientForm, email: e.target.value })} required />
                </div>
                <div className="form-field">
                  <label>Notify on events:</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    {[['SUBMITTED', 'New Submissions'], ['APPROVED', 'Approvals'], ['REJECTED', 'Rejections']].map(([val, label]) => (
                      <label key={val} className="checkbox-label">
                        <input type="checkbox" checked={recipientForm.notifyOn?.includes(val)}
                          onChange={() => toggleRecipientEvent(val)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button className="btn-sm btn-blue" type="submit">Add Recipient</button>
              </form>
            </div>
          </div>

          {/* ── User Management ── */}
          <div className="admin-section">
            <h3>User Management</h3>
            <p className="admin-section-desc">Manage system users and their access levels.</p>
            {userMessage && <p className={userMessage.includes('success') ? 'success-message' : 'error-message'}>{userMessage}</p>}

            {users.length === 0
              ? <p className="admin-section-desc" style={{ fontStyle: 'italic' }}>No users found.</p>
              : users.map((u) => (
                <div key={u.id} className={`admin-card ${editingUserId === u.id ? 'editing' : ''}`}>
                  {editingUserId === u.id ? (
                    <div className="user-edit-form">
                      <div className="form-field"><label>Name</label>
                        <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} /></div>
                      <div className="form-field"><label>Email</label>
                        <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></div>
                      <div className="form-field">
                        <label>New Password <small>(leave blank to keep current)</small></label>
                        <input type="password" value={userForm.password}
                          onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder="Leave blank to keep current" />
                      </div>
                      <div className="form-field"><label>Role</label>
                        <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                          <option value="CONCIERGE">Concierge</option>
                          <option value="COUNCIL">Council</option>
                          <option value="PROPERTY_MANAGER">Property Manager</option>
                        </select>
                      </div>
                      <div className="user-edit-actions">
                        <button className="btn-sm btn-green" type="button" onClick={() => updateUser(u.id)}>Save Changes</button>
                        <button className="btn-sm btn-slate" type="button" onClick={cancelEditUser}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="user-row">
                        <div>
                          <div className="user-name">{u.name}</div>
                          <div className="user-email">{u.email}</div>
                        </div>
                        <div className="user-actions">
                          <button className="btn-sm btn-blue" type="button" onClick={() => startEditUser(u)}>Edit</button>
                          <button className="btn-sm btn-red"  type="button" onClick={() => deleteUser(u.id, u.email)}>Delete</button>
                        </div>
                      </div>
                      <div className="user-meta">
                        <span className={`role-badge ${u.role === 'CONCIERGE' ? 'standard' : 'elevated'}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                        <span className="user-created">Created: {new Date(u.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))
            }

            <div className="admin-form-card">
              <h4>Add New User</h4>
              <form onSubmit={createUser}>
                <div className="form-field">
                  <label htmlFor="user-name" className="required">Full Name</label>
                  <input id="user-name" placeholder="e.g. John Smith" value={userForm.name}
                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
                </div>
                <div className="form-field">
                  <label htmlFor="user-email" className="required">Email</label>
                  <input id="user-email" type="email" placeholder="john@strata.local" value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
                </div>
                <div className="form-field">
                  <label htmlFor="user-password" className="required">Password</label>
                  <input id="user-password" type="password" placeholder="Minimum 8 characters" value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} minLength={8} required />
                  <small>Minimum 8 characters</small>
                </div>
                <div className="form-field">
                  <label htmlFor="user-role" className="required">Access Level</label>
                  <select id="user-role" value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} required>
                    <option value="CONCIERGE">Concierge — View &amp; Manage Bookings</option>
                    <option value="COUNCIL">Council — Full Access</option>
                    <option value="PROPERTY_MANAGER">Property Manager — Full Access</option>
                  </select>
                  <small>
                    {userForm.role === 'CONCIERGE'        && 'Can view and manage bookings only'}
                    {userForm.role === 'COUNCIL'          && 'Can manage everything including settings and users'}
                    {userForm.role === 'PROPERTY_MANAGER' && 'Can manage everything including settings and users'}
                  </small>
                </div>
                <button className="btn-sm btn-green" type="submit">Create User</button>
              </form>
            </div>
          </div>

          {/* ── Invoice Ninja Settings ── */}
          <div className="admin-section">
            <h3>Invoice Ninja Integration</h3>
            <div className="admin-form-card">
              <form onSubmit={saveSettings}>
                <p style={{ margin: '0 0 12px', color: '#475569', fontSize: '0.9rem' }}>
                  When enabled, MoveCal polls Invoice Ninja every 5 minutes for paid invoices and automatically approves matching move bookings.
                  Requires <code>INVOICE_NINJA_URL</code> and <code>INVOICE_NINJA_API_TOKEN</code> to be set in your environment variables.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!settings.invoiceNinjaEnabled}
                    onChange={e => setSettings({ ...settings, invoiceNinjaEnabled: e.target.checked })}
                  />
                  Enable Invoice Ninja payment polling
                </label>
                <div style={{ marginTop: '12px' }}>
                  <button className="btn-sm btn-blue" type="submit">Save</button>
                </div>
              </form>
            </div>
          </div>

          {/* ── SMTP Settings ── */}
          <div className="admin-section">
            <h3>SMTP Settings</h3>
            <div className="admin-form-card">
              <form onSubmit={saveSettings} className="smtp-form">
                <div className="smtp-row">
                  <div className="form-field">
                    <label htmlFor="smtp-host">SMTP Host</label>
                    <input id="smtp-host" placeholder="smtp.example.com" value={settings.smtpHost ?? ''}
                      onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="smtp-port">Port</label>
                    <input id="smtp-port" type="number" placeholder="587" value={settings.smtpPort ?? ''}
                      onChange={(e) => setSettings({ ...settings, smtpPort: e.target.value })} />
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="smtp-user">Username</label>
                  <input id="smtp-user" placeholder="username" value={settings.smtpUsername ?? ''}
                    onChange={(e) => setSettings({ ...settings, smtpUsername: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="smtp-pass">Password</label>
                  <input id="smtp-pass" type="password" value={settings.smtpPassword ?? ''}
                    onChange={(e) => setSettings({ ...settings, smtpPassword: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="from-name">From Name</label>
                  <input id="from-name" placeholder="Spectrum 4" value={settings.fromName ?? ''}
                    onChange={(e) => setSettings({ ...settings, fromName: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor="from-email">From Email</label>
                  <input id="from-email" type="email" placeholder="noreply@example.com" value={settings.fromEmail ?? ''}
                    onChange={(e) => setSettings({ ...settings, fromEmail: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button className="btn-sm btn-blue" type="submit">Save Settings</button>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
                  <input
                    type="email"
                    placeholder="Send test email to..."
                    value={testEmailTo}
                    onChange={e => setTestEmailTo(e.target.value)}
                    style={{ flex: '1', minWidth: '200px' }}
                  />
                  <button className="btn-sm btn-slate" type="button" onClick={sendTestEmail}>Send Test Email</button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
