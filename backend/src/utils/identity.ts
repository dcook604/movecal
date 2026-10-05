// Normalization + cross-unit identity matching for the admin history search.

export function normalizePhone(raw?: string | null): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

export function normalizeEmail(raw?: string | null): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v.includes('@') ? v : null;
}

export function normalizeUnit(raw?: string | null): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeName(raw?: string | null): string {
  return (raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Derived columns kept in sync with the raw resident fields. Pass only the fields being written. */
export function identityFields(data: { residentPhone?: string | null; residentEmail?: string | null; unit?: string | null }) {
  return {
    ...(data.residentPhone !== undefined && { residentPhoneNorm: normalizePhone(data.residentPhone) }),
    ...(data.residentEmail !== undefined && { residentEmailNorm: normalizeEmail(data.residentEmail) }),
    ...(data.unit !== undefined && { unitNorm: normalizeUnit(data.unit) }),
  };
}

export type QueryKind = 'email' | 'phone' | 'unit' | 'name';

/** Decide which field(s) a free-text query should search. */
export function classifyQuery(q: string): QueryKind {
  const t = q.trim();
  if (t.includes('@')) return 'email';
  if (/^[\d\s()+.\-]+$/.test(t) && t.replace(/\D/g, '').length >= 7) return 'phone';
  if (/^[A-Za-z]{0,4}[-\s]?\d{1,6}[A-Za-z]?$/.test(t) || /^\d{1,4}-\d{1,5}$/.test(t)) return 'unit';
  return 'name';
}

export interface IdentityRow {
  id: string;
  unitNorm: string | null;
  residentName: string;
  residentEmailNorm: string | null;
  residentPhoneNorm: string | null;
}

export interface IgnoredContacts {
  emails: Set<string>;
  phones: Set<string>;
}

export type LinkVia = 'email' | 'phone' | 'name';
export interface Link {
  via: LinkVia[];
  strength: 'strong' | 'weak';
}

/**
 * Do two bookings in *different units* appear to be the same person?
 * Email/phone matches are strong (unless the contact is on the shared-contact ignore list);
 * a full-name match alone (2+ words) is weak.
 */
export function classifyLink(a: IdentityRow, b: IdentityRow, ignored: IgnoredContacts): Link | null {
  if (!a.unitNorm || !b.unitNorm || a.unitNorm === b.unitNorm) return null;
  const via: LinkVia[] = [];
  if (a.residentEmailNorm && a.residentEmailNorm === b.residentEmailNorm && !ignored.emails.has(a.residentEmailNorm)) via.push('email');
  if (a.residentPhoneNorm && a.residentPhoneNorm === b.residentPhoneNorm && !ignored.phones.has(a.residentPhoneNorm)) via.push('phone');
  if (via.length) return { via, strength: 'strong' };
  const na = normalizeName(a.residentName);
  if (na.includes(' ') && na === normalizeName(b.residentName)) return { via: ['name'], strength: 'weak' };
  return null;
}
