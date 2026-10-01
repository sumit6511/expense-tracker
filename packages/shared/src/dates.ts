/**
 * Calendar-date helpers. A transaction date is a plain calendar date ("2026-09-30") with no time
 * zone, so all arithmetic here works on whole days in UTC and never on local time.
 */
export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface DateParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

export function adDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= adDaysInMonth(year, month);
}

export function parseIsoDate(value: IsoDate): DateParts {
  if (!isIsoDate(value)) throw new RangeError(`Invalid date: ${value}`);
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function toIsoDate({ year, month, day }: DateParts): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days since 1970-01-01. */
export function toEpochDay(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromEpochDay(epochDay: number): IsoDate {
  const d = new Date(epochDay * MS_PER_DAY);
  return toIsoDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** Adds calendar months, clamping the day (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return toIsoDate({ year: y, month: m, day: Math.min(day, adDaysInMonth(y, m)) });
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return (((toEpochDay(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

export const DEFAULT_TIME_ZONE = 'Asia/Kathmandu';

/** Today's calendar date in the given IANA time zone (Nepal by default, UTC+5:45). */
export function todayIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const AD_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const AD_MONTH_NAMES_NE = [
  'जनवरी',
  'फेब्रुअरी',
  'मार्च',
  'अप्रिल',
  'मे',
  'जुन',
  'जुलाई',
  'अगस्ट',
  'सेप्टेम्बर',
  'अक्टोबर',
  'नोभेम्बर',
  'डिसेम्बर',
] as const;

export const WEEKDAY_NAMES_NE = [
  'आइतबार',
  'सोमबार',
  'मंगलबार',
  'बुधबार',
  'बिहीबार',
  'शुक्रबार',
  'शनिबार',
] as const;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type DateStyle = 'short' | 'medium' | 'long';

/** "30 Sep" (short), "30 Sep 2026" (medium), "30 September 2026" (long). */
export function formatAdDate(date: IsoDate, style: DateStyle = 'medium'): string {
  const { year, month, day } = parseIsoDate(date);
  const name = AD_MONTH_NAMES[month - 1]!;
  if (style === 'short') return `${day} ${name.slice(0, 3)}`;
  if (style === 'medium') return `${day} ${name.slice(0, 3)} ${year}`;
  return `${day} ${name} ${year}`;
}
