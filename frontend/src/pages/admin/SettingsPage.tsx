import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import { ROLE_LABELS } from '../../auth/session';
import { useAdmin } from './AdminLayout';
import { useUi } from '../../components/ui';
import '../../styles/admin.css';

const emptyRecipient = { name: '', email: '', enabled: true, notifyOn: ['APPROVED', 'REJECTED', 'SUBMITTED'] };
const emptyUser = { name: '', email: '', password: '', role: 'CONCIERGE', mustChangePassword: false };

export function SettingsPage() {
  const { canManage: canManageSettings, email, handleAuthError, adoptToken } = useAdmin();
  const [recipients, setRecipients] = useState<any[]>([]);
  const [recipientForm, setRecipientForm] = useState<any>(emptyRecipient);
  const [settings, setSettings] = useState<any>({ smtpHost: null, smtpPort: null, smtpSecure: false, smtpUsername: null, fromName: null, fromEmail: null, includeResidentContactInApprovalEmails: false, reminderEnabled: true, invoiceNinjaEnabled: false, unpaidPaymentReminderEnabled: false, paymentNotifyEmail: null, paymentInstructions: null });
  const [testEmailTo, setTestEmailTo] = useState(email);
  const [loadError, setLoadError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [users, setUsers] = useState<any[]>([]);
  const [userForm, setUserForm] = useState(emptyUser);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const { toast, confirm } = useUi();
  // All success messages in this page contain "successfully"; anything else is an error.
  const notify = (m: string) => { if (m) toast(m, /successfully/i.test(m) ? 'success' : 'error'); };
  const setActionMessage = notify, setAccountMessage = notify, setUserMessage = notify;

  const refresh = async () => {
    if (!canManageSettings) return;
    setLoadError('');
    try {
      const [r, st, u] = await Promise.all([
        api.get('/api/admin/recipients'),
        api.get('/api/admin/settings'),
        api.get('/api/admin/users'),
      ]);
      setRecipients(r.data);
      if (st.data) setSettings((prev: any) => ({ ...prev, ...st.data, smtpPassword: '' }));
      setUsers(u.data);
    } catch (error) {
      if (handleAuthError(error)) return;
      setLoadError('Failed to load settings. Please refresh the page.');
    }
  };

  useEffect(() => { refresh(); }, [canManageSettings]);

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
    if (!(await confirm({ title: 'Delete recipient?', tone: 'danger', confirmLabel: 'Delete', message: `${recipientEmail} will stop receiving notifications.` }))) return;
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

  // Changing the password/email invalidates older sessions; the server returns a fresh token for this one
  const storeRefreshedToken = (newToken?: string) => { if (newToken) adoptToken(newToken); };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setAccountMessage('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setAccountMessage('New passwords do not match'); return; }
    if (passwordForm.newPassword.length < 10) { setAccountMessage('Password must be at least 10 characters'); return; }
    try {
      const res = await api.post('/api/auth/change-password', passwordForm);
      storeRefreshedToken(res.data?.token);
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
      storeRefreshedToken(response.data.token);
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
      setUserForm(emptyUser);
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setUserMessage(error.response?.data?.message || 'Failed to create user.');
    }
  };

  const updateUser = async (userId: string) => {
    setUserMessage('');
    try {
      const updateData: any = { name: userForm.name, email: userForm.email, role: userForm.role, mustChangePassword: userForm.mustChangePassword };
      if (userForm.password) updateData.password = userForm.password;
      await api.patch(`/api/admin/users/${userId}`, updateData);
      setUserMessage('User updated successfully');
      setEditingUserId(null);
      setUserForm(emptyUser);
      await refresh();
    } catch (error: any) {
      if (handleAuthError(error)) return;
      setUserMessage(error.response?.data?.message || 'Failed to update user.');
    }
  };

  const deleteUser = async (userId: string, userEmail: string) => {
    if (!(await confirm({ title: 'Delete user?', tone: 'danger', confirmLabel: 'Delete user', message: `${userEmail} will no longer be able to sign in. Their bookings and history are kept.` }))) return;
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
    setUserForm({ name: user.name, email: user.email, password: '', role: user.role, mustChangePassword: !!user.mustChangePassword });
    setUserMessage('');
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setUserForm(emptyUser);
    setUserMessage('');
  };

  return (
    <>
      <div className="admin-title-row"><h2>Settings</h2></div>
      {loadError && <p className="error-message">{loadError}</p>}

      {/* ── Account Settings ── */}
      <div className="admin-section">
        <h3>Account Settings</h3>
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
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} minLength={10} required />
                <small>Minimum 10 characters</small>
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


      {canManageSettings && (
        <>

          {/* ── Payment notifications ── */}
          <div className="admin-section">
            <h3>Payment Notifications</h3>
            <div className="admin-form-card">
              <form onSubmit={saveSettings}>
                <div className="form-field">
                  <label htmlFor="payment-notify">Payment confirmation recipient</label>
                  <input id="payment-notify" type="email" placeholder="accounting@example.com" value={settings.paymentNotifyEmail ?? ''}
                    onChange={(e) => setSettings({ ...settings, paymentNotifyEmail: e.target.value || null })} />
                  <small>Receives an email when a payment approves a booking, and when a matched payment is reversed. Leave blank to disable.</small>
                </div>
                <div className="form-field">
                  <label htmlFor="payment-instructions">Payment instructions for residents</label>
                  <textarea id="payment-instructions" rows={5} maxLength={2000} value={settings.paymentInstructions ?? ''}
                    placeholder={'Move-in / move-out fee: $___\nDelivery fee: $___\nPay at the concierge desk or via the invoice link sent by management.'}
                    onChange={(e) => setSettings({ ...settings, paymentInstructions: e.target.value || null })} />
                  <small>Shown on the booking form, the booking page and the "request received" email. Include fee amounts and how to pay.</small>
                </div>
                <button className="btn-sm btn-blue" type="submit">Save</button>
              </form>
            </div>
          </div>
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
                      <div className="form-field">
                        <label className="checkbox-label">
                          <input type="checkbox" checked={userForm.mustChangePassword}
                            onChange={(e) => setUserForm({ ...userForm, mustChangePassword: e.target.checked })} />
                          Require password change on next login
                        </label>
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
                          {(ROLE_LABELS as Record<string, string>)[u.role] || u.role}
                        </span>
                        {u.mustChangePassword && (
                          <span className="role-badge" style={{ background: '#f59e0b' }}>Must Change Password</span>
                        )}
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
                  <input id="user-password" type="password" placeholder="Minimum 10 characters" value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} minLength={10} required />
                  <small>Minimum 10 characters</small>
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

          {/* ── Unpaid Payment Reminders ── */}
          <div className="admin-section">
            <h3>Payment Reminder Emails</h3>
            <div className="admin-form-card">
              <form onSubmit={saveSettings}>
                <p style={{ margin: '0 0 12px', color: '#475569', fontSize: '0.9rem' }}>
                  When enabled, residents with SUBMITTED or PENDING bookings that have no
                  confirmed Invoice Ninja payment will receive an email every 24 hours
                  reminding them that their booking will not be confirmed until payment is
                  received. Reminders stop automatically once the move date passes.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!settings.unpaidPaymentReminderEnabled}
                    onChange={e => setSettings({ ...settings, unpaidPaymentReminderEnabled: e.target.checked })}
                  />
                  Send 24-hour payment reminder emails
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
        </>
      )}
    </>
  );
}
