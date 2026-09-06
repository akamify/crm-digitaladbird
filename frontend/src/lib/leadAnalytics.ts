import type { LeadAnalyticsScope, LeadViewMode } from '@/types';

export const DISTRIBUTION_FILTER_KEYS = [
  'q', 'category', 'stage', 'call_status', 'source', 'form_id', 'campaign_id', 'campaign',
  'adset', 'assignment', 'assigned_to', 'label_id', 'remark_status', 'workflow_status', 'customer_interest',
  'followup', 'latest_activity',
] as const;

export function businessToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isBusinessDate(value: string | null | undefined) {
  const candidate = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

export function shiftBusinessDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function rangeDays(scope: LeadAnalyticsScope) {
  if (scope.view === 'all_time' || !scope.from || !scope.to) return 0;
  return Math.floor((Date.parse(`${scope.to}T00:00:00Z`) - Date.parse(`${scope.from}T00:00:00Z`)) / 86400000) + 1;
}

export function shiftAnalyticsScope(scope: LeadAnalyticsScope, direction: -1 | 1): LeadAnalyticsScope {
  if (scope.view === 'all_time' || !scope.from || !scope.to) return scope;
  const days = rangeDays(scope);
  const offset = direction * days;
  return { ...scope, from: shiftBusinessDate(scope.from, offset), to: shiftBusinessDate(scope.to, offset) };
}

export function normalizeAnalyticsScope(
  viewValue?: string | null,
  fromValue?: string | null,
  toValue?: string | null,
): LeadAnalyticsScope {
  const view: LeadViewMode = viewValue === 'daily' ? 'daily' : 'all_time';
  if (view === 'all_time') return { view, from: null, to: null };
  const today = businessToday();
  const from = isBusinessDate(fromValue) && String(fromValue) <= today ? String(fromValue) : today;
  const candidateTo = isBusinessDate(toValue) && String(toValue) <= today ? String(toValue) : from;
  const to = candidateTo < from ? from : candidateTo;
  return { view, from, to };
}

export function analyticsScopeParams(scope: LeadAnalyticsScope) {
  const params = new URLSearchParams({ view: scope.view });
  if (scope.view === 'daily' && scope.from && scope.to) {
    params.set('from', scope.from);
    params.set('to', scope.to);
  }
  return params;
}

export function formatAnalyticsPeriod(scope: LeadAnalyticsScope, includeYear = true) {
  if (scope.view === 'all_time' || !scope.from || !scope.to) return 'Complete CRM history';
  const format = (date: string, year: boolean) => new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
  if (scope.from === scope.to) return format(scope.from, includeYear);
  const sameYear = scope.from.slice(0, 4) === scope.to.slice(0, 4);
  return `${format(scope.from, includeYear && !sameYear)} - ${format(scope.to, includeYear)}`;
}

export function copyDistributionFilters(source: URLSearchParams, target: URLSearchParams) {
  DISTRIBUTION_FILTER_KEYS.forEach(key => {
    const value = source.get(key);
    if (value) target.set(key, value);
  });
  return target;
}
