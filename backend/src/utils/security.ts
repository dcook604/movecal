import crypto from 'crypto';

export const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 10;

// Valid bcrypt hash of a random value; compared against when a user doesn't exist so
// login takes the same time whether or not the email is registered.
export const DUMMY_PASSWORD_HASH = '$2a$12$fMGyKg6v7yMB.yCc/8iNoOXynZpdjT59U2SL0IeL1NMSkDHoNBjFi';

export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
