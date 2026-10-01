import {
  adToBs,
  BS_MONTH_NAMES,
  BS_MONTH_NAMES_NE,
  bsDaysInMonth,
  bsToAd,
  toDevanagariDigits,
} from './bs';
import {
  AD_MONTH_NAMES,
  AD_MONTH_NAMES_NE,
  addDays,
  dayOfWeek,
  type IsoDate,
  parseIsoDate,
  toIsoDate,
} from './dates';

export type CalendarSystem = 'bs' | 'ad';

export interface PeriodSettings {
  calendar: CalendarSystem;
  /** Day of the AD month a budget month starts on (1–28). Ignored for BS. */
  monthStartDay: number;
}

export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = { calendar: 'bs', monthStartDay: 1 };

/** A budget month. `start` and `end` are inclusive AD dates. */
export interface MonthPeriod {
  calendar: CalendarSystem;
  start: IsoDate;
  end: IsoDate;
  /** Year and month in the period's own calendar (BS year/month for BS). */
  year: number;
  month: number;
}

export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

function adMonthPeriod(year: number, month: number, startDay: number): MonthPeriod {
  const start = toIsoDate({ year, month, day: startDay });
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = addDays(toIsoDate({ year: nextYear, month: nextMonth, day: startDay }), -1);
  return { calendar: 'ad', start, end, year, month };
}

function bsMonthPeriod(year: number, month: number): MonthPeriod {
  const start = bsToAd({ year, month, day: 1 });
  const end = bsToAd({ year, month, day: bsDaysInMonth(year, month) });
  return { calendar: 'bs', start, end, year, month };
}

/** The budget month containing `date`. */
export function getMonthPeriod(date: IsoDate, settings: PeriodSettings): MonthPeriod {
  if (settings.calendar === 'bs') {
    const { year, month } = adToBs(date);
    return bsMonthPeriod(year, month);
  }
  const startDay = clampStartDay(settings.monthStartDay);
  const { year, month, day } = parseIsoDate(date);
  if (day >= startDay) return adMonthPeriod(year, month, startDay);
  return month === 1
    ? adMonthPeriod(year - 1, 12, startDay)
    : adMonthPeriod(year, month - 1, startDay);
}

/** The budget month `delta` months before (negative) or after (positive) `period`. */
export function shiftMonthPeriod(
  period: MonthPeriod,
  delta: number,
  settings: PeriodSettings,
): MonthPeriod {
  const index = period.year * 12 + (period.month - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return period.calendar === 'bs'
    ? bsMonthPeriod(year, month)
    : adMonthPeriod(year, month, clampStartDay(settings.monthStartDay));
}

/** All budget months overlapping [from, to], oldest first. */
export function listMonthPeriods(
  from: IsoDate,
  to: IsoDate,
  settings: PeriodSettings,
): MonthPeriod[] {
  const periods: MonthPeriod[] = [];
  let period = getMonthPeriod(from, settings);
  while (period.start <= to) {
    periods.push(period);
    period = shiftMonthPeriod(period, 1, settings);
  }
  return periods;
}

function clampStartDay(day: number): number {
  return Math.min(Math.max(Math.trunc(day) || 1, 1), 28);
}

/**
 * "Asoj 2083", "September 2026", or "25 Sep – 24 Oct 2026" for a custom AD start day; in Nepali,
 * "असोज २०८३".
 */
export function formatMonthPeriod(
  period: MonthPeriod,
  style: 'long' | 'short' = 'long',
  lang: 'en' | 'ne' = 'en',
): string {
  const ne = lang === 'ne';
  const out = (text: string) => (ne ? toDevanagariDigits(text) : text);
  if (period.calendar === 'bs') {
    const name = (ne ? BS_MONTH_NAMES_NE : BS_MONTH_NAMES)[period.month - 1]!;
    return out(style === 'short' ? name : `${name} ${period.year}`);
  }
  const months = ne ? AD_MONTH_NAMES_NE : AD_MONTH_NAMES;
  const abbr = (m: number) => (ne ? months[m - 1]! : months[m - 1]!.slice(0, 3));
  const start = parseIsoDate(period.start);
  const end = parseIsoDate(period.end);
  if (start.day === 1) {
    const name = months[start.month - 1]!;
    return out(style === 'short' ? abbr(start.month) : `${name} ${start.year}`);
  }
  const s = `${start.day} ${abbr(start.month)}`;
  const e = `${end.day} ${abbr(end.month)}`;
  return out(style === 'short' ? s : `${s} – ${e} ${end.year}`);
}

export interface FiscalYear extends DateRange {
  /** BS year the fiscal year starts in, e.g. 2083 for FY 2083/84. */
  startYear: number;
  label: string;
}

/** Nepal's fiscal year runs from 1 Shrawan to the last day of Asar (mid-July to mid-July). */
export function getFiscalYear(date: IsoDate): FiscalYear {
  const { year, month } = adToBs(date);
  const startYear = month >= 4 ? year : year - 1;
  const start = bsToAd({ year: startYear, month: 4, day: 1 });
  const end = addDays(bsToAd({ year: startYear + 1, month: 4, day: 1 }), -1);
  return {
    start,
    end,
    startYear,
    label: `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

/** The calendar year containing `date`: Baisakh–Chaitra for BS, January–December for AD. */
export function getYearRange(
  date: IsoDate,
  calendar: CalendarSystem,
): DateRange & { year: number } {
  if (calendar === 'bs') {
    const { year } = adToBs(date);
    return {
      year,
      start: bsToAd({ year, month: 1, day: 1 }),
      end: bsToAd({ year, month: 12, day: bsDaysInMonth(year, 12) }),
    };
  }
  const { year } = parseIsoDate(date);
  return { year, start: `${year}-01-01`, end: `${year}-12-31` };
}

/** The week containing `date`. `weekStart` 0 = Sunday (Nepal's week starts on Sunday). */
export function getWeekRange(date: IsoDate, weekStart = 0): DateRange {
  const offset = (dayOfWeek(date) - weekStart + 7) % 7;
  const start = addDays(date, -offset);
  return { start, end: addDays(start, 6) };
}

/** Number of days in a range, inclusive of both ends. */
export function rangeLength({ start, end }: DateRange): number {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  return (
    Math.round(
      (Date.UTC(e.year, e.month - 1, e.day) - Date.UTC(s.year, s.month - 1, s.day)) / 86_400_000,
    ) + 1
  );
}

/** Days left in the period counting today, or 0 if the period is over. */
export function daysLeftInPeriod(period: DateRange, today: IsoDate): number {
  if (today > period.end) return 0;
  if (today < period.start) return rangeLength(period);
  return rangeLength({ start: today, end: period.end });
}
