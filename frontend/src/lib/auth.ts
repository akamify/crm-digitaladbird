'use client';
import { create } from 'zustand';
import { api, tokens, userStorage, apiPost, apiGet } from './api';

export type Role = 'super_admin' | 'admin' | 'rm' | 'member' | 'partner';
export type MemberType = 'fresher' | 'veteran';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  memberType?: MemberType | null;
  reportToId?: string | null;
  team?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  initialized: boolean;
  init: () => Promise<void>;
  login: (identifier: string, password: string, role?: string) => Promise<AuthUser>;
  requestOtp: (email: string, password: string, role: Role, fullName?: string, phone?: string) => Promise<number>;
  verifyOtp:  (email: string, code: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

let _initP: Promise<void> | null = null;
let _expiryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSessionExpiry(onExpire: () => void) {
  if (typeof window === 'undefined') return;
  if (_expiryTimer) clearTimeout(_expiryTimer);
  const expiresAt = tokens.sessionExpiresAt;
  if (!expiresAt) return;
  const delay = new Date(expiresAt).getTime() - Date.now();
  if (delay <= 0) {
    onExpire();
    return;
  }
  _expiryTimer = setTimeout(onExpire, Math.min(delay, 2_147_483_647));
}

function toUser(me: any): AuthUser {
  return {
    id: me.id, name: me.name, email: me.email, phone: me.phone,
    role: me.role, memberType: me.memberType ?? null,
    reportToId: me.reportToId ?? null, team: me.team ?? null,
  };
}

function userChanged(a: AuthUser | null, b: AuthUser): boolean {
  if (!a) return true;
  return a.id !== b.id || a.name !== b.name || a.email !== b.email
    || a.phone !== b.phone || a.role !== b.role
    || a.memberType !== b.memberType || a.reportToId !== b.reportToId
    || a.team !== b.team;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  init() {
    if (_initP) return _initP;
    _initP = (async () => {
      const cached = userStorage.get();
      if (tokens.isSessionExpired) {
        tokens.clear();
        set({ user: null, initialized: true });
        return;
      }
      if (cached && tokens.access) {
        set({ user: cached, initialized: true });
        scheduleSessionExpiry(() => {
          tokens.clear();
          set({ user: null, initialized: false });
          window.location.href = '/login?expired=1';
        });
        apiGet<AuthUser>('/auth/me').then((me) => {
          const u = toUser(me);
          userStorage.set(u);
          if (userChanged(get().user, u)) set({ user: u });
        }).catch((err) => {
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            tokens.clear();
            set({ user: null });
          }
        });
        return;
      }
      try {
        if (tokens.access) {
          const me = await apiGet<AuthUser>('/auth/me');
          const u = toUser(me);
          userStorage.set(u);
          set({ user: u });
          scheduleSessionExpiry(() => {
            tokens.clear();
            set({ user: null, initialized: false });
            window.location.href = '/login?expired=1';
          });
        }
      } catch { /* token invalid */ }
      finally { set({ initialized: true }); }
    })().finally(() => { _initP = null; });
    return _initP;
  },

  async login(identifier, password, role?) {
    set({ loading: true });
    try {
      const data = await apiPost<{ accessToken: string; refreshToken: string; sessionExpiresAt?: string; user: AuthUser }>(
        '/auth/login', { identifier, password, ...(role ? { role } : {}) }
      );
      tokens.set({ accessToken: data.accessToken, refreshToken: data.refreshToken, sessionExpiresAt: data.sessionExpiresAt });
      userStorage.set(data.user);
      set({ user: data.user });
      scheduleSessionExpiry(() => {
        tokens.clear();
        set({ user: null, initialized: false });
        window.location.href = '/login?expired=1';
      });
      return data.user;
    } finally { set({ loading: false }); }
  },

  async requestOtp(email, password, role, fullName?, phone?) {
    set({ loading: true });
    try {
      const { expiresInSeconds } = await apiPost<{ expiresInSeconds: number }>(
        '/auth/request-otp', { email, password, role, full_name: fullName, phone }
      );
      return expiresInSeconds;
    } finally { set({ loading: false }); }
  },

  async verifyOtp(email, code) {
    set({ loading: true });
    try {
      const data = await apiPost<{ accessToken: string; refreshToken: string; sessionExpiresAt?: string; user: AuthUser }>(
        '/auth/verify-otp', { email, code }
      );
      tokens.set({ accessToken: data.accessToken, refreshToken: data.refreshToken, sessionExpiresAt: data.sessionExpiresAt });
      userStorage.set(data.user);
      set({ user: data.user });
      scheduleSessionExpiry(() => {
        tokens.clear();
        set({ user: null, initialized: false });
        window.location.href = '/login?expired=1';
      });
      return data.user;
    } finally { set({ loading: false }); }
  },

  async logout() {
    try { await api.post('/auth/logout', { refreshToken: tokens.refresh }); } catch {}
    if (_expiryTimer) clearTimeout(_expiryTimer);
    tokens.clear(); // also removes dab.user
    set({ user: null, initialized: false });
    if (typeof window !== 'undefined') window.location.href = '/login';
  },
}));

/** Returns the dashboard path for a given role */
export function dashboardPath(role: Role): string {
  if (role === 'super_admin' || role === 'admin') return '/dashboard/admin';
  if (role === 'rm')          return '/dashboard/rm';
  if (role === 'partner')     return '/dashboard/member';
  return '/dashboard/member';
}

/** Human-readable role label */
export function roleLabel(role: Role | string): string {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin')       return 'Admin';
  if (role === 'rm')          return 'RM';
  if (role === 'member')      return 'Member';
  if (role === 'partner')     return 'Partner';
  return role;
}
