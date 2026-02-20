import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { api, setToken } from '../api';
import '../styles/admin.css';

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
  const [settings, setSettings] = useState<any>({ smtpSecure: false, includeResidentContactInApprovalEmails: false, reminderEnabled: true });
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [accountMessage, setAccountMessage] = useState('');

  const [users, setUsers] = useState<any[]>([]);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'CONCIERGE' });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userMessage, setUserMessage] = useState('');

  const canManageSettings = role === 'COUNCIL' || role === 'PROPERTY_MANAGER';

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

  useEffect(() => { if (!token) return; refresh(); }, [token]);

  const updateStatus = async (id: string, status: string) => {
    if (!confirm(`Are you sure you want to ${status.toLowerCase()} this booking?`)) return;
    setIsUpdating(id);
    setActionMessage('');
    try {
      await api.patch(`/api/admin/bookings/${id}`, { status });
      setActionMessage(`Booking ${status.toLowerCase()}d successfully`);
      await refresh();
    } catch (error: any) {
      setActionMessage(error.response?.data?.message || `Failed to ${status.toLowerCase()} booking.`);
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
      setActionMessage(error.response?.data?.message || 'Failed to save settings.');
    }
  };

  const sendTestEmail = async () => {
    setActionMessage('');
    try {
      await api.post('/api/admin/settings/test-email', { to: email });
      setActionMessage('Test email sent successfully');
    } catch (error: any) {
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
      setAccountMessage(error.response?.data?.message || 'Failed to change password');
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
      setAccountMessage(error.response?.data?.message || 'Failed to change email');
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
      setUserMessage(error.response?.data?.message || 'Failed to create user');
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
      setUserMessage(error.response?.data?.message || 'Failed to update user');
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
      setUserMessage(error.response?.data?.message || 'Failed to delete user');
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

  /* ── Login screen ────────────────────────────────────────── */
  if (!token) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">
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
      <div className="admin-section">
        <h3>Bookings</h3>
        <div className="bookings-list">
          {bookings.length === 0 && <p className="admin-section-desc">No bookings found.</p>}
          {bookings.map((b) => (
            <div key={b.id} className="booking-card">
              <div className="booking-info">
                <div className="booking-name">{b.residentName} — Unit {b.unit}</div>
                <div className="booking-meta">{b.moveType?.replace('_', ' ')} · {b.moveDate ? new Date(b.moveDate).toLocaleDateString() : ''}</div>
              </div>
              <span className={`booking-status ${b.status}`}>{b.status}</span>
              <div className="booking-actions">
                <button className="btn-sm btn-green" onClick={() => updateStatus(b.id, 'APPROVED')} disabled={isUpdating === b.id}>
                  {isUpdating === b.id ? '…' : 'Approve'}
                </button>
                <button className="btn-sm btn-red" onClick={() => updateStatus(b.id, 'REJECTED')} disabled={isUpdating === b.id}>
                  {isUpdating === b.id ? '…' : 'Reject'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

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
