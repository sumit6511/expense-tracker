import {
  AD_MONTH_NAMES_NE,
  addDays,
  dayOfWeek,
  type FormatMoneyOptions,
  formatAdDate,
  formatBsDate,
  formatMoney,
  formatMoneyCompact,
  formatMonthPeriod,
  getCurrency,
  type IsoDate,
  isBsSupported,
  type Locale,
  type Minor,
  type MonthPeriod,
  parseIsoDate,
  toDevanagariDigits,
  todayIn,
  WEEKDAY_NAMES,
  WEEKDAY_NAMES_NE,
} from '@et/shared';
import { useMemo } from 'react';
import { useSession } from './session';

export interface Formatters {
  base: string;
  calendar: 'bs' | 'ad';
  grouping: 'lakh' | 'international';
  locale: Locale;
  today: IsoDate;
  money: (minor: Minor, currency?: string, options?: FormatMoneyOptions) => string;
  compact: (minor: Minor, currency?: string) => string;
  /** Date in the workspace calendar: "14 Asoj 2083" or "30 Sep 2026" (in Nepali, "१४ असोज २०८३"). */
  date: (date: IsoDate, style?: 'short' | 'medium' | 'long') => string;
  /** The same date in the other calendar, for secondary display. */
  altDate: (date: IsoDate) => string;
  /** "Today", "Yesterday", "Thu, 15 Asoj" within a week, otherwise the date. */
  relativeDate: (date: IsoDate) => string;
  /** A budget month's name: "Asoj 2083" (or "Asoj" short); "असोज २०८३" in Nepali. */
  month: (period: MonthPeriod, style?: 'long' | 'short') => string;
  digits: (currency?: string) => number;
}

/** Nepali numbers: Devanagari digits, "रु." for rupees, लाख/करोड/हजार for compact amounts. */
function nepaliNumbers(text: string) {
  return toDevanagariDigits(
    text
      .replace(/Rs\./g, 'रु.')
      .replace(/(\d)Cr\b/g, '$1 करोड')
      .replace(/(\d)L\b/g, '$1 लाख')
      .replace(/(\d)K\b/g, '$1 हजार'),
  );
}

export function makeFormatters(options: {
  base: string;
  calendar: 'bs' | 'ad';
  grouping: 'lakh' | 'international';
  timezone: string;
  locale?: Locale;
}): Formatters {
  const { base, calendar, grouping, timezone, locale = 'en' } = options;
  const ne = locale === 'ne';
  const today = todayIn(timezone);
  const ad = (d: IsoDate, style: 'short' | 'medium' | 'long' = 'medium') => {
    if (!ne) return formatAdDate(d, style);
    const { year, month, day } = parseIsoDate(d);
    const name = AD_MONTH_NAMES_NE[month - 1]!;
    return toDevanagariDigits(style === 'short' ? `${day} ${name}` : `${day} ${name} ${year}`);
  };
  const bs = (d: IsoDate, style: 'short' | 'medium' | 'long' = 'medium') =>
    isBsSupported(d) ? formatBsDate(d, { style, lang: locale }) : ad(d, style);
  const date = (d: IsoDate, style: 'short' | 'medium' | 'long' = 'medium') =>
    calendar === 'bs' ? bs(d, style) : ad(d, style);
  const numbers = (text: string) => (ne ? nepaliNumbers(text) : text);
  // Short weekday names ("Thu", "बिही") keep relative dates from crowding compact lists.
  const weekday = (d: IsoDate) =>
    ne
      ? WEEKDAY_NAMES_NE[dayOfWeek(d)]!.replace(/बार$/, '')
      : WEEKDAY_NAMES[dayOfWeek(d)]!.slice(0, 3);
  return {
    base,
    calendar,
    grouping,
    locale,
    today,
    money: (minor, currency = base, opts) =>
      numbers(formatMoney(minor, currency, { grouping, ...opts })),
    compact: (minor, currency = base) => numbers(formatMoneyCompact(minor, currency, { grouping })),
    date,
    altDate: (d) =>
      calendar === 'bs' ? `${ad(d)} ${ne ? 'ई.सं.' : 'AD'}` : `${bs(d)} ${ne ? 'वि.सं.' : 'BS'}`,
    relativeDate: (d) => {
      if (d === today) return ne ? 'आज' : 'Today';
      if (d === addDays(today, -1)) return ne ? 'हिजो' : 'Yesterday';
      if (d === addDays(today, 1)) return ne ? 'भोलि' : 'Tomorrow';
      if (d < today && d > addDays(today, -7)) return `${weekday(d)}, ${date(d, 'short')}`;
      return date(d, d.slice(0, 4) === today.slice(0, 4) ? 'short' : 'medium');
    },
    month: (period, style = 'long') => formatMonthPeriod(period, style, locale),
    digits: (currency = base) => getCurrency(currency).digits,
  };
}

export function useFormat(): Formatters {
  const { me, workspace } = useSession();
  return useMemo(
    () =>
      makeFormatters({
        base: workspace.baseCurrency,
        calendar: workspace.calendar,
        grouping: me.user.numberGrouping,
        timezone: workspace.timezone,
        locale: me.user.locale,
      }),
    [
      workspace.baseCurrency,
      workspace.calendar,
      workspace.timezone,
      me.user.numberGrouping,
      me.user.locale,
    ],
  );
}
