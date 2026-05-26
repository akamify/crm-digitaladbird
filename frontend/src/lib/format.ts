import { formatDistanceToNowStrict, format, parseISO, isToday, isPast } from 'date-fns';

/** Robust date parse — accepts ISO strings or Date, returns null for falsy. */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  try { return parseISO(v); } catch { return null; }
}

export function fmtDate(v: string | null | undefined, pattern = 'dd MMM, h:mm a'): string {
  const d = toDate(v);
  return d ? format(d, pattern) : '—';
}

export function fmtRelative(v: string | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  try { return formatDistanceToNowStrict(d, { addSuffix: true }); } catch { return '—'; }
}

export function isOverdue(v: string | null | undefined): boolean {
  const d = toDate(v);
  return !!d && isPast(d) && !isToday(d);
}

export function isDueToday(v: string | null | undefined): boolean {
  const d = toDate(v);
  return !!d && isToday(d);
}

/** Cleanly format an Indian phone number for display. */
export function fmtPhone(p: string | null | undefined): string {
  if (!p) return '—';
  const trimmed = p.replace(/\s+/g, '');
  if (trimmed.startsWith('+91') && trimmed.length === 13) {
    return `+91 ${trimmed.slice(3, 8)} ${trimmed.slice(8)}`;
  }
  return trimmed;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Map call_status / stage to a chip color class — keeps tone consistent. */
export const callStatusChip: Record<string, string> = {
  not_called:         'chip-amber',
  talk_response:      'chip-blue',
  busy:               'chip-slate',
  callback_requested: 'chip-amber',
  interested:         'chip-blue',
  follow_up:          'chip-amber',
  converted:          'chip-green',
  not_interested:     'chip-red',
  wrong_number:       'chip-red',
  switched_off:       'chip-red',
  nn:                 'chip-red',
  // legacy enum values still in DB
  cnr:            'chip-slate',
  cw:             'chip-slate',
  nc:             'chip-slate',
  ccb:            'chip-slate',
  ni:             'chip-red',
  so:             'chip-red',
  rnr:            'chip-slate',
  invalid_number: 'chip-red',
  custom_remark:  'chip-blue',
};

export const stageChip: Record<string, string> = {
  new:        'chip-blue',
  contacted:  'chip-slate',
  qualified:  'chip-blue',
  follow_up:  'chip-amber',
  won:        'chip-green',
  lost:       'chip-red',
};

const CALL_STATUS_LABELS: Record<string, string> = {
  not_called:         'Not Called',
  talk_response:      'Connected',
  busy:               'Busy',
  callback_requested: 'Call Back Later',
  interested:         'Interested',
  follow_up:          'Follow-up Scheduled',
  converted:          'Converted',
  not_interested:     'Not Interested',
  wrong_number:       'Wrong Number',
  switched_off:       'Switch Off',
  nn:                 'No Network',
  // legacy
  cnr:            'CNR',
  cw:             'CW',
  nc:             'NC',
  ccb:            'CCB',
  ni:             'NI',
  so:             'Switch Off',
  rnr:            'RNR',
  invalid_number: 'Invalid Number',
  custom_remark:  'Remark',
};

export function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  if (CALL_STATUS_LABELS[s]) return CALL_STATUS_LABELS[s];
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
