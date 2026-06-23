import { formatISTDateTime, formatRelativeIST } from './date';

export function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase();
  return !['', '-', '—', 'n/a', 'null', 'undefined'].includes(text);
}

export function formatUserStatus(status?: string | null): string {
  if (!isMeaningfulValue(status)) return 'Unknown';
  return String(status).replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function getUserStatusBadgeVariant(status?: string | null): string {
  const value = String(status || '').toLowerCase();
  if (value === 'active' || value === 'available') return 'chip-green';
  if (value === 'unavailable') return 'chip-amber';
  if (['blocked', 'disabled', 'deleted'].includes(value)) return 'chip-red';
  return 'chip-slate';
}

export function formatPhone(value?: string | null): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return local.length === 10 ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : value.trim();
}

export function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validatePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local);
}

export const formatDateTime = formatISTDateTime;
export const formatRelativeTime = formatRelativeIST;
