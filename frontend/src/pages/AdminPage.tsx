import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { api, setToken } from '../api';

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

  // Account settings state
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [accountMessage, setAccountMessage] = useState('');

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

  const toggleRecipientEnabled = async (id: string, enabled: boolean) => {
    if (!canManageSettings) return;
    setActionMessage('');
    try {
      await api.patch(`/api/admin/recipients/${id}`, { enabled });
      setActionMessage(`Recipient ${enabled ? 'enabled' : 'disabled'} successfully`);
      await refresh();
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to update recipient.';
      setActionMessage(errorMsg);
    }
  };

  const deleteRecipient = async (id: string, email: string) => {
    if (!canManageSettings) return;
    if (!confirm(`Are you sure you want to delete recipient ${email}?`)) return;

    setActionMessage('');
    try {
      await api.delete(`/api/admin/recipients/${id}`);
      setActionMessage('Recipient deleted successfully');
      await refresh();
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to delete recipient.';
      setActionMessage(errorMsg);
    }
  };

  const toggleRecipientEvent = (event: string) => {
    const current = recipientForm.notifyOn || [];
    const updated = current.includes(event)
      ? current.filter((e: string) => e !== event)
      : [...current, event];
    setRecipientForm({ ...recipientForm, notifyOn: updated });
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

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setAccountMessage('');

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setAccountMessage('New passwords do not match');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setAccountMessage('Password must be at least 8 characters');
      return;
    }

    try {
      await api.post('/api/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
        confirmPassword: passwordForm.confirmPassword
      });
      setAccountMessage('Password changed successfully');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to change password';
      setAccountMessage(errorMsg);
    }
  };

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    setAccountMessage('');

    try {
      const response = await api.post('/api/auth/change-email', {
        newEmail: emailForm.newEmail,
        password: emailForm.password
      });

      // Update token and email
      if (response.data.token) {
        updateToken(response.data.token);
        setToken(response.data.token);
        localStorage.setItem('movecal_token', response.data.token);
        setEmail(response.data.user.email);
      }

      setAccountMessage('Email changed successfully');
      setEmailForm({ newEmail: '', password: '' });
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || 'Failed to change email';
      setAccountMessage(errorMsg);
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

      {/* Account Settings */}
      <div style={{ marginTop: '32px', marginBottom: '32px' }}>
        <h3>Account Settings</h3>
        {accountMessage && <p className={accountMessage.includes('success') ? 'success-message' : 'error-message'}>{accountMessage}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
          {/* Change Password */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ marginTop: 0 }}>Change Password</h4>
            <form onSubmit={changePassword}>
              <div className="form-field">
                <label htmlFor="current-password">Current Password</label>
                <input
                  id="current-password"
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="new-password">New Password</label>
                <input
                  id="new-password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  minLength={8}
                  required
                />
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Minimum 8 characters</small>
              </div>
              <div className="form-field">
                <label htmlFor="confirm-password">Confirm New Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  required
                />
              </div>
              <button type="submit">Change Password</button>
            </form>
          </div>

          {/* Change Email */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ marginTop: 0 }}>Change Email</h4>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '16px' }}>
              Current: <strong>{email}</strong>
            </p>
            <form onSubmit={changeEmail}>
              <div className="form-field">
                <label htmlFor="new-email">New Email</label>
                <input
                  id="new-email"
                  type="email"
                  value={emailForm.newEmail}
                  onChange={(e) => setEmailForm({ ...emailForm, newEmail: e.target.value })}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="confirm-password-email">Confirm Password</label>
                <input
                  id="confirm-password-email"
                  type="password"
                  value={emailForm.password}
                  onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                  required
                />
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Enter your current password to confirm</small>
              </div>
              <button type="submit">Change Email</button>
            </form>
          </div>
        </div>
      </div>

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
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '16px' }}>
            Configure who receives email notifications for different booking events
          </p>

          {recipients.length === 0 ? (
            <p style={{ color: '#64748b', fontStyle: 'italic' }}>No recipients configured yet</p>
          ) : (
            <div style={{ marginBottom: '24px' }}>
              {recipients.map((r) => (
                <div key={r.id} style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '12px',
                  backgroundColor: r.enabled ? '#ffffff' : '#f8fafc'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>
                        {r.name || r.email}
                      </div>
                      {r.name && (
                        <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{r.email}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => toggleRecipientEnabled(r.id, !r.enabled)}
                        style={{
                          padding: '4px 12px',
                          fontSize: '0.875rem',
                          background: r.enabled ? '#10b981' : '#64748b',
                          minHeight: 'auto',
                          width: 'auto'
                        }}
                      >
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRecipient(r.id, r.email)}
                        style={{
                          padding: '4px 12px',
                          fontSize: '0.875rem',
                          background: '#dc2626',
                          minHeight: 'auto',
                          width: 'auto'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    <strong>Notify on:</strong>{' '}
                    {r.notifyOn && r.notifyOn.length > 0
                      ? r.notifyOn.map((e: string) => {
                          const labels: Record<string, string> = {
                            'APPROVED': 'Approvals',
                            'REJECTED': 'Rejections',
                            'SUBMITTED': 'New Submissions'
                          };
                          return labels[e] || e;
                        }).join(', ')
                      : 'No events selected'
                    }
                  </div>
                </div>
              ))}
            </div>
          )}

          <h4>Add New Recipient</h4>
          <form onSubmit={createRecipient} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
            <div className="form-field">
              <label htmlFor="recipient-name">Name (optional)</label>
              <input
                id="recipient-name"
                placeholder="e.g. John Smith"
                value={recipientForm.name}
                onChange={(e) => setRecipientForm({ ...recipientForm, name: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label htmlFor="recipient-email" className="required">Email</label>
              <input
                id="recipient-email"
                type="email"
                placeholder="john@example.com"
                value={recipientForm.email}
                onChange={(e) => setRecipientForm({ ...recipientForm, email: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label>Notify on events:</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={recipientForm.notifyOn?.includes('SUBMITTED')}
                    onChange={() => toggleRecipientEvent('SUBMITTED')}
                  />
                  <span>New Submissions - When residents submit move requests</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={recipientForm.notifyOn?.includes('APPROVED')}
                    onChange={() => toggleRecipientEvent('APPROVED')}
                  />
                  <span>Approvals - When bookings are approved</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={recipientForm.notifyOn?.includes('REJECTED')}
                    onChange={() => toggleRecipientEvent('REJECTED')}
                  />
                  <span>Rejections - When bookings are rejected</span>
                </label>
              </div>
            </div>
            <button type="submit">Add Recipient</button>
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
