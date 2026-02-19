import crypto from 'crypto';
import { config } from '../config.js';

const key = Buffer.from(config.encryptionKey.padEnd(32, '0').slice(0, 32));

export function encrypt(value: string) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(value?: string | null) {
  if (!value) return undefined;
  const [ivHex, dataHex] = value.split(':');
  if (!ivHex || !dataHex) return undefined;
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
