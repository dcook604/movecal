import axios from 'axios';
import { setToken } from '../api';

export type UserRole = 'CONCIERGE' | 'COUNCIL' | 'PROPERTY_MANAGER';

export const ROLE_LABELS: Record<UserRole, string> = {
  CONCIERGE: 'Concierge',
  COUNCIL: 'Council',
  PROPERTY_MANAGER: 'Property Manager',
};

const isRole = (v: unknown): v is UserRole => v === 'CONCIERGE' || v === 'COUNCIL' || v === 'PROPERTY_MANAGER';

function decodePayload(token?: string | null): Record<string, unknown> | null {
  const parts = token?.split('.');
  if (!parts || parts.length < 2) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

export function decodeRoleFromToken(token?: string | null): UserRole | null {
  const role = decodePayload(token)?.role;
  return isRole(role) ? role : null;
}

export function decodeEmailFromToken(token?: string | null): string {
  const email = decodePayload(token)?.email;
  return typeof email === 'string' ? email : '';
}

export function getStoredToken(): string {
  try { return localStorage.getItem('movecal_token') ?? ''; } catch { return ''; }
}

export function getStoredRole(): UserRole | null {
  try {
    const stored = localStorage.getItem('movecal_role');
    if (isRole(stored)) return stored;
  } catch { /* fall through */ }
  return decodeRoleFromToken(getStoredToken());
}

export function saveSession(token: string, role?: UserRole | null) {
  setToken(token);
  localStorage.setItem('movecal_token', token);
  if (role) localStorage.setItem('movecal_role', role);
  window.dispatchEvent(new CustomEvent('movecal-auth'));
}

export function clearSession() {
  setToken();
  localStorage.removeItem('movecal_token');
  localStorage.removeItem('movecal_role');
  window.dispatchEvent(new CustomEvent('movecal-auth'));
}

export function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    return data?.message ?? data?.error ?? fallback;
  }
  return fallback;
}
