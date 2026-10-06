import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { api } from '../api';
import { parseBookingTime } from '../utils/bookingTime';
import '../styles/history.css';

type Strength = 'strong' | 'weak';
interface LinkedUnit { unit: string; strength: Strength; via: string[]; bookingCount: number }
interface Result {
  id: string; unit: string; residentName: string; residentEmail: string; residentPhone: string;
  moveType: string; status: string; moveDate: string; startDatetime: string; endDatetime: string;
  matchedOn: string[]; linkedUnits: LinkedUnit[]; linkStrength: Strength | null; sharedContact: boolean;
}
interface Related extends Omit<Result, 'matchedOn' | 'linkedUnits' | 'linkStrength' | 'sharedContact'> {
  link: { via: string[]; strength: Strength };
}
interface RelatedResponse {
  booking: { id: string; unit: string; residentName: string };
  contacts: { email: string | null; phone: string | null; emailShared: boolean; phoneShared: boolean };
  related: Related[];
}
interface Details extends Omit<Result, 'matchedOn' | 'linkedUnits' | 'linkStrength' | 'sharedContact'> {
  companyName: string | null; elevatorRequired: boolean; loadingBayRequired: boolean; notes: string | null;
  createdAt: string; updatedAt: string; approvedAt: string | null;
  createdBy: { name: string; role: string }; approvedBy: { name: string; role: string } | null;
  paymentMatched: boolean; paymentInvoiceId: string | null;
  documents: { id: string; originalName: string; mimeType: string }[];
  auditLogs: { id: string; action: string; timestamp: string; actor: { name: string } }[];
}
interface SharedContact { id: string; kind: 'EMAIL' | 'PHONE'; value: string; label: string | null }

const STATUSES = ['SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const MOVE_TYPES = ['MOVE_IN', 'MOVE_OUT', 'DELIVERY', 'RENO', 'OPEN_HOUSE', 'FURNISHED_MOVE', 'SUITCASE_MOVE'];
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
// moveDate is a date-only column; slice avoids timezone shifts
const fmtDate = (iso: string) => iso.slice(0, 10);
const fmtTime = (r: { startDatetime: string; endDatetime: string }) =>
  `${parseBookingTime(r.startDatetime).format('h:mm A')} – ${parseBookingTime(r.endDatetime).format('h:mm A')}`;

function errMsg(e: unknown) {
  return axios.isAxiosError(e) ? e.response?.data?.message ?? e.message : 'Something went wrong';
}

export function HistoryPage() {
  const role = localStorage.getItem('movecal_role');
  const canManage = role === 'COUNCIL' || role === 'PROPERTY_MANAGER';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [moveType, setMoveType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Result[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [drawer, setDrawer] = useState<RelatedResponse | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [contacts, setContacts] = useState<SharedContact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [newContact, setNewContact] = useState({ kind: 'PHONE', value: '', label: '' });
  const reqId = useRef(0);

  const runSearch = useCallback(async (p = 1) => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setError(''); return; }
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/api/admin/bookings/search', {
        q: term, page: p,
        ...(status && { status }), ...(moveType && { moveType }),
        ...(from && { from }), ...(to && { to }),
      });
      if (id !== reqId.current) return; // stale response
      setResults(data.results); setTotal(data.total); setPage(data.page); setPageSize(data.pageSize);
    } catch (e) {
      if (id === reqId.current) setError(errMsg(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [q, status, moveType, from, to]);

  // Debounced search-as-you-type; resets to page 1 whenever the query or filters change.
  useEffect(() => {
    const t = setTimeout(() => runSearch(1), 300);
    return () => clearTimeout(t);
  }, [runSearch]);

  const loadContacts = async () => {
    try { setContacts((await api.get('/api/admin/shared-contacts')).data); } catch (e) { setError(errMsg(e)); }
  };
  useEffect(() => { if (showContacts) loadContacts(); }, [showContacts]);

  const openDrawer = async (bookingId: string) => {
    setDrawerLoading(true); setDrawer(null);
    try { setDrawer((await api.get(`/api/admin/bookings/${bookingId}/related`)).data); }
    catch (e) { setError(errMsg(e)); }
    finally { setDrawerLoading(false); }
  };

  const openDetails = async (bookingId: string) => {
    setDetailsLoading(true); setDetails(null);
    try { setDetails((await api.get(`/api/admin/bookings/${bookingId}/details`)).data); }
    catch (e) { setError(errMsg(e)); }
    finally { setDetailsLoading(false); }
  };

  const downloadDocument = async (docId: string, name: string) => {
    try {
      const res = await api.get(`/api/admin/documents/${docId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(errMsg(e)); }
  };

  const addContact = async (kind: string, value: string, lbl?: string) => {
    try {
      await api.post('/api/admin/shared-contacts', { kind, value, ...(lbl && { label: lbl }) });
      setNewContact({ kind: 'PHONE', value: '', label: '' });
      await loadContacts(); await runSearch(page);
      setDrawer(null);
    } catch (e) { setError(errMsg(e)); }
  };
  const removeContact = async (id: string) => {
    try { await api.delete(`/api/admin/shared-contacts/${id}`); await loadContacts(); await runSearch(page); }
    catch (e) { setError(errMsg(e)); }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); runSearch(1); };
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="history-page">
      <h1>Move History</h1>
      <form className="history-search" onSubmit={onSubmit}>
        <input
          type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, unit, phone, or email" aria-label="Search move history" maxLength={100}
        />
        <div className="history-filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select value={moveType} onChange={(e) => setMoveType(e.target.value)} aria-label="Move type">
            <option value="">All move types</option>
            {MOVE_TYPES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </form>

      {error && <p className="history-error" role="alert">{error}</p>}
      {loading && <p className="history-hint">Searching…</p>}
      {results === null && !loading && <p className="history-hint">Type at least 2 characters. Phone numbers match in any format.</p>}
      {results && !results.length && !loading && <p className="history-hint">No bookings found.</p>}

      {results && results.length > 0 && (
        <>
          <p className="history-hint">{total} booking{total === 1 ? '' : 's'} found</p>
          <div className="history-table-wrap">
            <table className="history-table">
              <thead><tr><th>Date</th><th>Unit</th><th>Resident</th><th>Contact</th><th>Type</th><th>Status</th><th>Other units</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td><button type="button" className="history-link" onClick={() => openDetails(r.id)} title="Open move details">{fmtDate(r.moveDate)}</button><div className="history-sub">{fmtTime(r)}</div></td>
                    <td><button type="button" className="history-link" onClick={() => openDetails(r.id)} title="Open move details"><strong>{r.unit}</strong></button></td>
                    <td><button type="button" className="history-link" onClick={() => openDetails(r.id)} title="Open move details">{r.residentName || '—'}</button>
                      <div className="history-sub">{r.matchedOn.length ? `matched on ${r.matchedOn.join(', ')}` : ''}</div></td>
                    <td className="history-contact">{r.residentEmail || '—'}<div className="history-sub">{r.residentPhone || ''}</div>
                      {r.sharedContact && <span className="history-badge shared" title="On the shared-contact list">shared contact</span>}</td>
                    <td>{label(r.moveType)}</td>
                    <td><span className={`history-status ${r.status.toLowerCase()}`}>{label(r.status)}</span></td>
                    <td>
                      {r.linkedUnits.length > 0 && (
                        <button type="button" className={`history-badge ${r.linkStrength}`} onClick={() => openDrawer(r.id)}>
                          {r.linkStrength === 'strong' ? 'Linked' : 'Possible match'}: {r.linkedUnits.map((l) => l.unit).join(', ')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="history-pager">
              <button type="button" disabled={page <= 1} onClick={() => runSearch(page - 1)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => runSearch(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      <section className="history-shared">
        <button type="button" className="history-link" onClick={() => setShowContacts((v) => !v)}>
          {showContacts ? 'Hide' : 'Manage'} shared contacts
        </button>
        {showContacts && (
          <div>
            <p className="history-hint">Movers, agents or property managers who appear across many units. These are ignored when linking bookings to the same resident.</p>
            {canManage && (
              <form className="history-contact-form" onSubmit={(e) => { e.preventDefault(); addContact(newContact.kind, newContact.value, newContact.label); }}>
                <select value={newContact.kind} onChange={(e) => setNewContact({ ...newContact, kind: e.target.value })}>
                  <option value="PHONE">Phone</option><option value="EMAIL">Email</option>
                </select>
                <input required value={newContact.value} onChange={(e) => setNewContact({ ...newContact, value: e.target.value })} placeholder="Phone or email" />
                <input value={newContact.label} onChange={(e) => setNewContact({ ...newContact, label: e.target.value })} placeholder="Label (optional)" />
                <button type="submit">Add</button>
              </form>
            )}
            <ul>
              {contacts.map((c) => (
                <li key={c.id}>{c.kind === 'PHONE' ? 'Phone' : 'Email'}: {c.value}{c.label ? ` — ${c.label}` : ''}
                  {canManage && <button type="button" className="history-link" onClick={() => removeContact(c.id)}>Remove</button>}</li>
              ))}
              {!contacts.length && <li>None yet.</li>}
            </ul>
          </div>
        )}
      </section>

      {(details || detailsLoading) && (
        <aside className="history-drawer wide" role="dialog" aria-label="Move details">
          <button type="button" className="history-link close" onClick={() => setDetails(null)}>Close</button>
          {detailsLoading && <p>Loading…</p>}
          {details && (
            <>
              <h2>{label(details.moveType)} · Unit {details.unit}</h2>
              <p><span className={`history-status ${details.status.toLowerCase()}`}>{label(details.status)}</span></p>
              <dl className="history-details">
                <dt>Date</dt><dd>{fmtDate(details.moveDate)}, {fmtTime(details)}</dd>
                <dt>Resident</dt><dd>{details.residentName || '—'}</dd>
                <dt>Email</dt><dd>{details.residentEmail || '—'}</dd>
                <dt>Phone</dt><dd>{details.residentPhone || '—'}</dd>
                {details.companyName && (<><dt>Company</dt><dd>{details.companyName}</dd></>)}
                <dt>Elevator</dt><dd>{details.elevatorRequired ? 'Yes' : 'No'}</dd>
                <dt>Loading bay</dt><dd>{details.loadingBayRequired ? 'Yes' : 'No'}</dd>
                <dt>Payment</dt><dd>{details.paymentMatched ? `Matched${details.paymentInvoiceId ? ` (invoice ${details.paymentInvoiceId})` : ''}` : 'Not matched'}</dd>
                <dt>Notes</dt><dd>{details.notes || '—'}</dd>
                <dt>Created</dt><dd>{new Date(details.createdAt).toLocaleString()} by {details.createdBy.name}</dd>
                {details.approvedAt && (<><dt>Approved</dt><dd>{new Date(details.approvedAt).toLocaleString()}{details.approvedBy ? ` by ${details.approvedBy.name}` : ''}</dd></>)}
                <dt>Last updated</dt><dd>{new Date(details.updatedAt).toLocaleString()}</dd>
              </dl>
              <h3>Documents</h3>
              {details.documents.length ? (
                <ul>{details.documents.map((d) => (
                  <li key={d.id}><button type="button" className="history-link" onClick={() => downloadDocument(d.id, d.originalName)}>{d.originalName}</button></li>
                ))}</ul>
              ) : <p className="history-hint">None.</p>}
              <h3>Activity</h3>
              {details.auditLogs.length ? (
                <ul>{details.auditLogs.map((a) => (
                  <li key={a.id}>{new Date(a.timestamp).toLocaleString()} · {label(a.action)} · {a.actor.name}</li>
                ))}</ul>
              ) : <p className="history-hint">No recorded activity.</p>}
              <button type="button" onClick={() => { const id = details.id; setDetails(null); openDrawer(id); }}>View linked bookings in other units</button>
            </>
          )}
        </aside>
      )}

      {(drawer || drawerLoading) && (
        <aside className="history-drawer" role="dialog" aria-label="Related bookings">
          <button type="button" className="history-link close" onClick={() => setDrawer(null)}>Close</button>
          {drawerLoading && <p>Loading…</p>}
          {drawer && (
            <>
              <h2>{drawer.booking.residentName || 'Resident'} · Unit {drawer.booking.unit}</h2>
              <p className="history-hint">Bookings in other units that share contact details or a full name.</p>
              {Object.entries(
                drawer.related.reduce<Record<string, Related[]>>((acc, r) => { (acc[r.unit] ||= []).push(r); return acc; }, {})
              ).map(([unit, rows]) => (
                <div key={unit} className="history-drawer-group">
                  <h3>Unit {unit}
                    <span className={`history-badge ${rows[0].link.strength}`}>
                      {rows[0].link.strength === 'strong' ? 'Linked' : 'Possible match'} via {[...new Set(rows.flatMap((x) => x.link.via))].join(', ')}
                    </span></h3>
                  <ul>{rows.map((r) => (
                    <li key={r.id}>{fmtDate(r.moveDate)} · {label(r.moveType)} · {label(r.status)} · {r.residentName}</li>
                  ))}</ul>
                </div>
              ))}
              {!drawer.related.length && <p>No other linked bookings.</p>}
              {canManage && (drawer.contacts.phone || drawer.contacts.email) && (
                <div className="history-drawer-actions">
                  <p className="history-hint">Not the same person (e.g. a mover or agent)? Ignore this contact when linking:</p>
                  {drawer.contacts.phone && !drawer.contacts.phoneShared && (
                    <button type="button" onClick={() => addContact('PHONE', drawer.contacts.phone!)}>Mark phone as shared</button>
                  )}
                  {drawer.contacts.email && !drawer.contacts.emailShared && (
                    <button type="button" onClick={() => addContact('EMAIL', drawer.contacts.email!)}>Mark email as shared</button>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
