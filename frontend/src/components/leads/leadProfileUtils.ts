import { formatISTCompact, formatISTDateTime, formatISTTooltip, formatRelativeIST } from '@/lib/date';

export function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return text !== '' && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' && text.toLowerCase() !== 'undefined';
}

export const formatDateTime = formatISTDateTime;
export const formatRelativeTime = formatRelativeIST;
export const formatCompactDateTime = formatISTCompact;
export const formatDateTimeTooltip = formatISTTooltip;

export function getLeadCategoryLabel(category?: string | null): string {
  if (category === 'trader') return 'Trader Lead';
  if (category === 'partner') return 'Partner Lead';
  return 'Unknown';
}

export function getStatusBadgeVariant(status?: string | null): string {
  const value = String(status || '').toLowerCase();
  if (['converted', 'won', 'completed', 'connected', 'talk_response', 'interested'].includes(value)) return 'chip-green';
  if (['follow_up', 'callback_requested', 'busy'].includes(value)) return 'chip-amber';
  if (['lost', 'dropped', 'not_interested', 'wrong_number', 'invalid_number'].includes(value)) return 'chip-red';
  if (['new', 'assigned', 'contacted', 'qualified'].includes(value)) return 'chip-blue';
  return 'chip-slate';
}
