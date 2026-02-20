import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { api, setToken } from '../api';

const emptyRecipient = { name: '', email: '', enabled: true, notifyOn: ['APPROVED'] };
type UserRole = 'CONCIERGE' | 'COUNCIL' | 'PROPERTY_MANAGER';

function decodeRoleFromToken(token?: string): UserRole | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const role = payload?.role;
    if (role === 'CONCIERGE' || role === 'COUNCIL' || role === 'PROPERTY_MANAGER') return role;
  } catch {
    return null;
  }
  return null;
}

export function AdminPage() {
  const [token, updateToken] = useState(() => localStorage.getItem('movecal_token') ?? '');
  const [role, setRole] = useState<UserRole | null>(() => {
    const storedRole = localStorage.getItem('movecal_role');
    if (storedRole === 'CONCIERGE' || storedRole === 'COUNCIL' || storedRole === 'PROPERTY_MANAGER') return storedRole;
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
  const [settings, setSettings] = useState<any>({ smtpSecure: false, includeResidentContactInApprovalEmails: false, reminderEnabled: true });
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const canManageSettings = role === 'COUNCIL' || role === 'PROPERTY_MANAGER';

  const refresh = async () => {
    setLoadError('');
    try {
      const [b, s] = await Promise.all([
        api.get('/api/admin/bookings'),
        api.get('/api/admin/stats')
      ]);
      setBookings(b.data);
      setStats(s.data);

      if (canManageSettings) {
        const [r, st] = await Promise.all([
          api.get('/api/admin/recipients'),
          api.get('/api/admin/settings')
        ]);
        setRecipients(r.data);
        if (st.data) setSettings((prev: any) => ({ ...prev, ...st.data, smtpPassword: '' }));
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        setLoadError('You do not have permission for one or more admin actions.');
        return;
      }
      setLoadError('Failed to load admin data.');
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

  useEffect(() => {
    if (!token) return;
    refresh();
  }, [token]);

  const updateStatus = async (id: string, status: string) => {
    const action = status.toLowerCase();
    if (!confirm(`Are you sure you want to ${action} this booking?`)) {
      return;
    }

    setIsUpdating(id);
    setActionMessage('');

    try {
      await api.patch(`/api/admin/bookings/${id}`, { status });
      setActionMessage(`Booking ${action}d successfully`);
      await refresh();
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || `Failed to ${action} booking. Please try again.`;
      setActionMessage(errorMsg);
    } finally {
      setIsUpdating(null);
    }
  };

  const createRecipient = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) {
      setLoadError('You do not have permission to manage recipients.');
      return;
    }

    setActionMessage('');
    try {
      await api.post('/api/admin/recipients', recipientForm);
      setRecipientForm(emptyRecipient);
      setActionMessage('Recipient added successfully');
      await refresh();
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to add recipient. Please try again.';
      setActionMessage(errorMsg);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) {
      setLoadError('You do not have permission to update settings.');
      return;
    }

    setActionMessage('');
    try {
      const portValue = settings.smtpPort === '' || settings.smtpPort === null ? null : Number(settings.smtpPort);
      const payload = {
        ...settings,
        smtpPort: Number.isNaN(portValue) ? null : portValue
      };
      await api.put('/api/admin/settings', payload);
      setActionMessage('Settings saved successfully');
      await refresh();
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to save settings. Please try again.';
      setActionMessage(errorMsg);
    }
  };

  const sendTestEmail = async () => {
    if (!canManageSettings) {
      setLoadError('You do not have permission to send test email.');
      return;
    }

    setActionMessage('');
    try {
      await api.post('/api/admin/settings/test-email', { to: email });
      setActionMessage('Test email sent successfully');
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to send test email. Please check SMTP settings.';
      setActionMessage(errorMsg);
    }
  };

  if (!token) {
    return (
      <form onSubmit={login}>
        <h2>Admin Login</h2>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        {loginError ? <p>{loginError}</p> : null}
        <button>Login</button>
      </form>
    );
  }

  return (
    <div>
      <h2>Dashboard</h2>
      <button
        onClick={() => {
          updateToken('');
          setRole(null);
          setToken();
          localStorage.removeItem('movecal_token');
          localStorage.removeItem('movecal_role');
        }}
      >
        Logout
      </button>
      {loadError ? <p className="error-message">{loadError}</p> : null}
      {actionMessage && <p className={actionMessage.includes('success') ? 'success-message' : 'error-message'}>{actionMessage}</p>}

      <div className="stats-section">
        <h3>Statistics</h3>
        {stats && (
          <div>
            <p><strong>Total Bookings:</strong> {stats.totalBookings || 0}</p>
            <p><strong>Approved:</strong> {stats.approvedBookings || 0}</p>
            <p><strong>Pending:</strong> {stats.pendingBookings || 0}</p>
            <p><strong>This Month:</strong> {stats.bookingsThisMonth || 0}</p>
          </div>
        )}
      </div>

      <h3>Bookings</h3>
      {bookings.map((b) => (
        <div key={b.id}>
          {b.residentName} ({b.unit}) — {b.status}
          <button
            onClick={() => updateStatus(b.id, 'APPROVED')}
            disabled={isUpdating === b.id}
          >
            {isUpdating === b.id ? 'Processing...' : 'Approve'}
          </button>
          <button
            onClick={() => updateStatus(b.id, 'REJECTED')}
            disabled={isUpdating === b.id}
          >
            {isUpdating === b.id ? 'Processing...' : 'Reject'}
          </button>
        </div>
      ))}

      {canManageSettings ? (
        <>
          <h3>Notification Recipients</h3>
          {recipients.map((r) => (
            <div key={r.id}>{r.email} ({r.enabled ? 'enabled' : 'disabled'})</div>
          ))}
          <form onSubmit={createRecipient}>
            <input placeholder="Name" value={recipientForm.name} onChange={(e) => setRecipientForm({ ...recipientForm, name: e.target.value })} />
            <input placeholder="Email" value={recipientForm.email} onChange={(e) => setRecipientForm({ ...recipientForm, email: e.target.value })} />
            <button>Add Recipient</button>
          </form>

          <h3>SMTP Settings</h3>
          <form onSubmit={saveSettings}>
            <input placeholder="SMTP Host" value={settings.smtpHost ?? ''} onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })} />
            <input type="number" placeholder="SMTP Port" value={settings.smtpPort ?? ''} onChange={(e) => setSettings({ ...settings, smtpPort: e.target.value })} />
            <input placeholder="SMTP Username" value={settings.smtpUsername ?? ''} onChange={(e) => setSettings({ ...settings, smtpUsername: e.target.value })} />
            <input type="password" placeholder="SMTP Password" value={settings.smtpPassword ?? ''} onChange={(e) => setSettings({ ...settings, smtpPassword: e.target.value })} />
            <input placeholder="From Name" value={settings.fromName ?? ''} onChange={(e) => setSettings({ ...settings, fromName: e.target.value })} />
            <input placeholder="From Email" value={settings.fromEmail ?? ''} onChange={(e) => setSettings({ ...settings, fromEmail: e.target.value })} />
            <button>Save Settings</button>
          </form>
          <button onClick={sendTestEmail}>Send Test Email</button>
        </>
      ) : null}
    </div>
  );
}
