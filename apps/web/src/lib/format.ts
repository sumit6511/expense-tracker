import {
  addDays,
  dayOfWeek,
  type FormatMoneyOptions,
  formatAdDate,
  formatBsDate,
  formatMoney,
  formatMoneyCompact,
  getCurrency,
  type IsoDate,
  isBsSupported,
  type Minor,
  todayIn,
  WEEKDAY_NAMES,
} from '@et/shared';
import { useMemo } from 'react';
import { useSession } from './session';

export interface Formatters {
  base: string;
  calendar: 'bs' | 'ad';
  grouping: 'lakh' | 'international';
  today: IsoDate;
  money: (minor: Minor, currency?: string, options?: FormatMoneyOptions) => string;
  compact: (minor: Minor, currency?: string) => string;
  /** Date in the workspace calendar: "14 Asoj 2083" or "30 Sep 2026". */
  date: (date: IsoDate, style?: 'short' | 'medium' | 'long') => string;
  /** The same date in the other calendar, for secondary display. */
  altDate: (date: IsoDate) => string;
  /** "Today", "Yesterday", weekday within a week, otherwise the date. */
  relativeDate: (date: IsoDate) => string;
  digits: (currency?: string) => number;
}

export function makeFormatters(options: {
  base: string;
  calendar: 'bs' | 'ad';
  grouping: 'lakh' | 'international';
  timezone: string;
}): Formatters {
  const { base, calendar, grouping, timezone } = options;
  const today = todayIn(timezone);
  const bs = (d: IsoDate, style: 'short' | 'medium' | 'long' = 'medium') =>
    isBsSupported(d) ? formatBsDate(d, { style }) : formatAdDate(d, style);
  const date = (d: IsoDate, style: 'short' | 'medium' | 'long' = 'medium') =>
    calendar === 'bs' ? bs(d, style) : formatAdDate(d, style);
  return {
    base,
    calendar,
    grouping,
    today,
    money: (minor, currency = base, opts) => formatMoney(minor, currency, { grouping, ...opts }),
    compact: (minor, currency = base) => formatMoneyCompact(minor, currency, { grouping }),
    date,
    altDate: (d) => (calendar === 'bs' ? `${formatAdDate(d)} AD` : `${bs(d)} BS`),
    relativeDate: (d) => {
      if (d === today) return 'Today';
      if (d === addDays(today, -1)) return 'Yesterday';
      if (d === addDays(today, 1)) return 'Tomorrow';
      if (d < today && d > addDays(today, -7))
        return `${WEEKDAY_NAMES[dayOfWeek(d)]}, ${date(d, 'short')}`;
      return date(d, d.slice(0, 4) === today.slice(0, 4) ? 'short' : 'medium');
    },
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
      }),
    [workspace.baseCurrency, workspace.calendar, workspace.timezone, me.user.numberGrouping],
  );
}
