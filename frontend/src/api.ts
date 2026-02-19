import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : undefined);
if (!baseURL) {
  throw new Error('VITE_API_URL is required in production builds');
}

export const api = axios.create({ baseURL });

export function setToken(token?: string) {
  api.defaults.headers.common.Authorization = token ? `Bearer ${token}` : '';
}

const storedToken = localStorage.getItem('movecal_token');
if (storedToken) {
  setToken(storedToken);
}
