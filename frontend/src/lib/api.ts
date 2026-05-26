/**
 * Singleton axios instance for the CRM API.
 *
 * - Reads access token from localStorage on each request
 * - On 401, automatically attempts a refresh-token rotation and replays
 * - On refresh failure, clears tokens and redirects to /login
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

export const tokens = {
  get access()  { return typeof window !== 'undefined' ? localStorage.getItem(ACCESS_KEY)  : null; },
  get refresh() { return typeof window !== 'undefined' ? localStorage.getItem(REFRESH_KEY) : null; },
  set({ accessToken, refreshToken }: { accessToken: string; refreshToken: string }) {
    localStorage.setItem(ACCESS_KEY,  accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userStorage = {
  get(): any | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set(u: any) { localStorage.setItem(USER_KEY, JSON.stringify(u)); },
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
