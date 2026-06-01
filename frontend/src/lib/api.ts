/**
 * Singleton axios instance for the CRM API.
 *
 * Token storage — strict per-tab isolation:
 *   Tokens and the cached user live ONLY in sessionStorage (scoped to one
 *   browser tab). Three browser windows can each log in as a different role
 *   (admin / RM / partner) and refreshing any one of them keeps that tab's
 *   role intact. A brand-new tab starts empty and must log in.
 *
 *   We deliberately do NOT mirror to localStorage. Any localStorage fallback
 *   leaks the most recent login into other tabs and corrupts refresh state.
 *   On boot we sweep any legacy localStorage tokens from earlier builds.
 *
 * On 401: automatically attempts a refresh-token rotation and replays.
 * On refresh failure: clears tokens and redirects to /login.
 */
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE,
  withCredentials: false,
  timeout: 30000,
  headers: { 'Accept': 'application/json' },
});

const ACCESS_KEY  = 'dab.access';
const REFRESH_KEY = 'dab.refresh';
const USER_KEY    = 'dab.user';

// One-time sweep: prior builds wrote tokens to localStorage under these keys.
// They poison new tabs (each tab would pick up the last login regardless of
// role). Clear any leftovers on module load so the bug can't resurface.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('dab.access');
    localStorage.removeItem('dab.refresh');
    localStorage.removeItem('dab.user');
    localStorage.removeItem('dab.last.access');
    localStorage.removeItem('dab.last.refresh');
    localStorage.removeItem('dab.last.user');
  } catch { /* private mode */ }
}

export const tokens = {
  get access()  { return typeof window === 'undefined' ? null : sessionStorage.getItem(ACCESS_KEY);  },
  get refresh() { return typeof window === 'undefined' ? null : sessionStorage.getItem(REFRESH_KEY); },
  set({ accessToken, refreshToken }: { accessToken: string; refreshToken: string }) {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(ACCESS_KEY,  accessToken);
    sessionStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
  },
};

export const userStorage = {
  get(): any | null {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set(u: any) {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(USER_KEY, JSON.stringify(u));
  },
};

api.interceptors.request.use((config) => {
  const t = tokens.access;
  if (t) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${t}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  const r = tokens.refresh;
  if (!r) return null;
  try {
    const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken: r });
    tokens.set({ accessToken: data.data.accessToken, refreshToken: data.data.refreshToken });
    return data.data.accessToken;
  } catch {
    tokens.clear();
    return null;
  }
}

api.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    const status   = error.response?.status;

    if (status === 401 && !original?._retried && !original?.url?.includes('/auth/')) {
      original._retried = true;
      if (!refreshing) refreshing = attemptRefresh().finally(() => { refreshing = null; });
      const newToken = await refreshing;
      if (newToken) {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
        return api(original);
      }
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

/** Convenience wrappers — extract `.data.data` automatically. */
export async function apiGet<T = any>(url: string, params?: any): Promise<T> {
  const { data } = await api.get(url, { params });
  return data.data;
}
export async function apiPost<T = any>(url: string, body?: any): Promise<T> {
  const { data } = await api.post(url, body);
  return data.data;
}
export async function apiPatch<T = any>(url: string, body?: any): Promise<T> {
  const { data } = await api.patch(url, body);
  return data.data;
}
export async function apiDelete<T = any>(url: string): Promise<T> {
  const { data } = await api.delete(url);
  return data.data;
}
