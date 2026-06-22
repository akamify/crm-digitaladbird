'use client';

const PREF_KEY = 'dab_notification_sound_preferences';

export type NotificationSoundPreferences = {
  browserNotifications: boolean;
  soundEnabled: boolean;
  volume: number;
};

const DEFAULT_PREFS: NotificationSoundPreferences = {
  browserNotifications: false,
  soundEnabled: false,
  volume: 0.85,
};

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;
let unlockMessageShown = false;

function safeWindow() {
  return typeof window !== 'undefined' ? window : null;
}

export function getNotificationSoundPreferences(): NotificationSoundPreferences {
  const win = safeWindow();
  if (!win) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(win.localStorage.getItem(PREF_KEY) || '{}');
    return {
      browserNotifications: Boolean(parsed.browserNotifications),
      soundEnabled: Boolean(parsed.soundEnabled),
      volume: Number.isFinite(Number(parsed.volume)) ? Math.min(1, Math.max(0, Number(parsed.volume))) : DEFAULT_PREFS.volume,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveNotificationSoundPreferences(next: Partial<NotificationSoundPreferences>) {
  const win = safeWindow();
  if (!win) return getNotificationSoundPreferences();
  const merged = { ...getNotificationSoundPreferences(), ...next };
  win.localStorage.setItem(PREF_KEY, JSON.stringify(merged));
  return merged;
}

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) audioContext = new AudioCtor();
  return audioContext;
}

export async function unlockNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx.state === 'running';
}

export async function playNotificationSound({ force = false }: { force?: boolean } = {}) {
  const prefs = getNotificationSoundPreferences();
  if (!force && !prefs.soundEnabled) return { played: false, reason: 'disabled' };
  const now = Date.now();
  if (!force && now - lastPlayedAt < 2000) return { played: false, reason: 'debounced' };

  const ctx = getAudioContext();
  if (!ctx) return { played: false, reason: 'unsupported' };
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') return { played: false, reason: 'blocked' };

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, prefs.volume), ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.24);
    lastPlayedAt = now;
    return { played: true };
  } catch {
    if (!unlockMessageShown) unlockMessageShown = true;
    return { played: false, reason: 'blocked' };
  }
}

export async function requestBrowserNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body?: string | null) {
  const prefs = getNotificationSoundPreferences();
  if (!prefs.browserNotifications) return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title || 'DigitalADbird CRM', {
      body: body || 'New notification received.',
      icon: '/favicon.ico',
    });
  } catch {
    // Browser notification display is best effort.
  }
}
