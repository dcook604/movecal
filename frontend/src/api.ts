import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000' });

export function setToken(token?: string) {
  api.defaults.headers.common.Authorization = token ? `Bearer ${token}` : '';
}
