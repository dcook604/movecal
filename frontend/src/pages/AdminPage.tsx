import { FormEvent, useEffect, useState } from 'react';
import { api, setToken } from '../api';

const emptyRecipient = { name: '', email: '', enabled: true, notifyOn: ['APPROVED'] };

export function AdminPage() {
  const [token, updateToken] = useState(() => localStorage.getItem('movecal_token') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bookings, setBookings] = useState<any[]>([]);
  const [stats, setStats] = useState<any>();
  const [recipients, setRecipients] = useState<any[]>([]);
  const [recipientForm, setRecipientForm] = useState<any>(emptyRecipient);
  const [settings, setSettings] = useState<any>({ smtpSecure: false, includeResidentContactInApprovalEmails: false, reminderEnabled: true });

  const refresh = async () => {
    const [b, s, r, st] = await Promise.all([
      api.get('/api/admin/bookings'),
      api.get('/api/admin/stats'),
      api.get('/api/admin/recipients'),
      api.get('/api/admin/settings')
    ]);
    setBookings(b.data);
    setStats(s.data);
    setRecipients(r.data);
    if (st.data) setSettings((prev: any) => ({ ...prev, ...st.data, smtpPassword: '' }));
  };

  const login = async (e: FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/api/auth/login', { email, password });
    updateToken(data.token);
    setToken(data.token);
    localStorage.setItem('movecal_token', data.token);
  };

  useEffect(() => {
    if (!token) return;
    refresh();
  }, [token]);

  const updateStatus = async (id: string, status: string) => {
    await api.patch(`/api/admin/bookings/${id}`, { status });
    refresh();
  };

  const createRecipient = async (e: FormEvent) => {
    e.preventDefault();
    await api.post('/api/admin/recipients', recipientForm);
    setRecipientForm(emptyRecipient);
    refresh();
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    const portValue = settings.smtpPort === '' || settings.smtpPort === null ? null : Number(settings.smtpPort);
    const payload = {
      ...settings,
      smtpPort: Number.isNaN(portValue) ? null : portValue
    };
    await api.put('/api/admin/settings', payload);
    refresh();
  };

  const sendTestEmail = async () => {
    await api.post('/api/admin/settings/test-email', { to: email });
  };

  if (!token) {
    return (
      <form onSubmit={login}>
        <h2>Admin Login</h2>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
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
          setToken();
          localStorage.removeItem('movecal_token');
        }}
      >
        Logout
      </button>
      <pre>{JSON.stringify(stats, null, 2)}</pre>

      <h3>Bookings</h3>
      {bookings.map((b) => (
        <div key={b.id}>
          {b.residentName} ({b.unit}) — {b.status}
          <button onClick={() => updateStatus(b.id, 'APPROVED')}>Approve</button>
          <button onClick={() => updateStatus(b.id, 'REJECTED')}>Reject</button>
        </div>
      ))}

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
    </div>
  );
}
