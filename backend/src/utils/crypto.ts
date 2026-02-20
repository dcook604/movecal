import crypto from 'crypto';
import { config } from '../config.js';

// Parse encryption key from hex string (should be 64 hex chars = 32 bytes)
const key = Buffer.from(config.encryptionKey, 'hex');
if (key.length !== 32) {
  throw new Error(
    `SETTINGS_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). ` +
    `Got ${key.length} bytes. Generate a valid key with: openssl rand -hex 32`
  );
}
const GCM_PREFIX = 'gcm';

export function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${GCM_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptLegacyCbc(value: string) {
  const [ivHex, dataHex] = value.split(':');
  if (!ivHex || !dataHex) return undefined;
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function decrypt(value?: string | null) {
  if (!value) return undefined;
  const parts = value.split(':');
  if (parts[0] !== GCM_PREFIX) {
    return decryptLegacyCbc(value);
  }
  if (parts.length !== 4) return undefined;
  const [, ivHex, tagHex, dataHex] = parts;
  if (!ivHex || !tagHex || !dataHex) return undefined;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
