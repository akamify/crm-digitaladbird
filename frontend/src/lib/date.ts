const IST_TIME_ZONE = 'Asia/Kolkata';

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateTimeWithSecondsFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function getIstDayKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatISTDateTime(value: DateInput) {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : 'Not available';
}

export function formatISTDateOnly(value: DateInput) {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : 'Not available';
}

export function formatISTTime(value: DateInput) {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : 'Not available';
}

export function formatISTTooltip(value: DateInput) {
  const date = toDate(value);
  return date ? `${dateTimeWithSecondsFormatter.format(date)} IST` : 'Not available';
}

export function formatISTCompact(value: DateInput) {
  const date = toDate(value);
  if (!date) return 'Not available';

  const now = new Date();
  const currentDay = getIstDayKey(now);
  const previousDay = getIstDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const targetDay = getIstDayKey(date);

  if (targetDay === currentDay) return `Today, ${formatISTTime(date)}`;
  if (targetDay === previousDay) return `Yesterday, ${formatISTTime(date)}`;
  return formatISTDateTime(date);
}

export function formatRelativeIST(value: DateInput) {
  const date = toDate(value);
  if (!date) return 'Not available';

  const diffMs = Date.now() - date.getTime();
  const suffix = diffMs >= 0 ? 'ago' : 'from now';
  const absSeconds = Math.abs(Math.round(diffMs / 1000));

  if (absSeconds < 60) return `${absSeconds}s ${suffix}`;
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) return `${absMinutes}m ${suffix}`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${absHours}h ${suffix}`;
  const absDays = Math.round(absHours / 24);
  if (absDays < 7) return `${absDays}d ${suffix}`;

  return formatISTCompact(date);
}

export function formatStageUpdatedAt(value: DateInput) {
  const date = toDate(value);
  return date ? `updated ${formatISTCompact(date)}` : 'updated time unavailable';
}
