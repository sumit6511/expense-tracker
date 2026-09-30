import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  adToBs,
  BS_LAST_YEAR,
  BS_MAX_AD,
  BS_MIN_AD,
  bsDaysInMonth,
  bsToAd,
  formatBsDate,
  isValidBsDate,
  parseBsString,
  toBsIsoString,
  toDevanagariDigits,
} from './bs';
import { BS_FIRST_YEAR } from './bs-data';
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  formatAdDate,
  fromEpochDay,
  isIsoDate,
  todayIn,
  toEpochDay,
} from './dates';
import {
  daysLeftInPeriod,
  formatMonthPeriod,
  getFiscalYear,
  getMonthPeriod,
  getWeekRange,
  getYearRange,
  listMonthPeriods,
  rangeLength,
  shiftMonthPeriod,
} from './periods';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-09-30')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-9-30')).toBe(false);
  });

  it('does day and month arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2026-09-01', '2026-09-30')).toBe(29);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(fromEpochDay(toEpochDay('1913-04-13'))).toBe('1913-04-13');
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-09-30')).toBe(3); // Wednesday
    expect(dayOfWeek('1970-01-01')).toBe(4); // Thursday
    expect(dayOfWeek('1913-04-13')).toBe(0); // Sunday
  });

  it("computes today's date in Nepal time (UTC+5:45)", () => {
    // 18:30 UTC on 30 Sep is 00:15 on 1 Oct in Kathmandu.
    expect(todayIn('Asia/Kathmandu', new Date('2026-09-30T18:30:00Z'))).toBe('2026-10-01');
    expect(todayIn('Asia/Kathmandu', new Date('2026-09-30T18:00:00Z'))).toBe('2026-09-30');
    expect(todayIn('UTC', new Date('2026-09-30T18:30:00Z'))).toBe('2026-09-30');
  });

  it('formats AD dates', () => {
    expect(formatAdDate('2026-09-30', 'short')).toBe('30 Sep');
    expect(formatAdDate('2026-09-30')).toBe('30 Sep 2026');
    expect(formatAdDate('2026-09-30', 'long')).toBe('30 September 2026');
  });
});

describe('Bikram Sambat conversion', () => {
  // Nepali New Year (1 Baisakh) dates, from published calendars.
  const newYears: Array<[number, string]> = [
    [2070, '2013-04-14'],
    [2075, '2018-04-14'],
    [2077, '2020-04-13'],
    [2080, '2023-04-14'],
    [2081, '2024-04-13'],
    [2082, '2025-04-14'],
    [2083, '2026-04-14'],
  ];

  it.each(newYears)('1 Baisakh %i BS is %s', (year, ad) => {
    expect(bsToAd({ year, month: 1, day: 1 })).toBe(ad);
    expect(adToBs(ad)).toEqual({ year, month: 1, day: 1 });
  });

  it('converts known dates', () => {
    expect(adToBs('2026-09-30')).toEqual({ year: 2083, month: 6, day: 14 });
    expect(adToBs('1913-04-13')).toEqual({ year: 1970, month: 1, day: 1 });
    // Nepal's constitution day: 3 Asoj 2072 BS = 20 September 2015.
    expect(bsToAd({ year: 2072, month: 6, day: 3 })).toBe('2015-09-20');
  });

  it('round-trips every day in the supported range', () => {
    const start = toEpochDay(BS_MIN_AD);
    const end = toEpochDay(BS_MAX_AD);
    fc.assert(
      fc.property(fc.integer({ min: start, max: end }), (day) => {
        const ad = fromEpochDay(day);
        expect(bsToAd(adToBs(ad))).toBe(ad);
      }),
      { numRuns: 2000 },
    );
  });

  it('has sane month lengths and consecutive days', () => {
    for (let year = BS_FIRST_YEAR; year <= BS_LAST_YEAR; year++) {
      let total = 0;
      for (let month = 1; month <= 12; month++) {
        const len = bsDaysInMonth(year, month);
        expect(len).toBeGreaterThanOrEqual(29);
        expect(len).toBeLessThanOrEqual(32);
        total += len;
      }
      expect(total).toBeGreaterThanOrEqual(365);
      expect(total).toBeLessThanOrEqual(366);
    }
    // The day after the last day of a month is the first of the next.
    const lastOfAsoj = bsToAd({ year: 2083, month: 6, day: bsDaysInMonth(2083, 6) });
    expect(adToBs(addDays(lastOfAsoj, 1))).toEqual({ year: 2083, month: 7, day: 1 });
  });

  it('rejects dates outside the table and invalid BS dates', () => {
    expect(() => adToBs('1900-01-01')).toThrow(RangeError);
    expect(() => adToBs(addDays(BS_MAX_AD, 1))).toThrow(RangeError);
    expect(isValidBsDate({ year: 2083, month: 6, day: 32 })).toBe(false);
    expect(isValidBsDate({ year: 2083, month: 13, day: 1 })).toBe(false);
    expect(() => bsToAd({ year: 2083, month: 2, day: 40 })).toThrow(RangeError);
  });

  it('formats and parses BS strings', () => {
    expect(formatBsDate('2026-09-30')).toBe('14 Asoj 2083');
    expect(formatBsDate('2026-09-30', { style: 'short' })).toBe('14 Asoj');
    expect(formatBsDate('2026-09-30', { lang: 'ne' })).toBe('१४ असोज २०८३');
    expect(toBsIsoString('2026-09-30')).toBe('2083-06-14');
    expect(parseBsString('2083-06-14')).toBe('2026-09-30');
    expect(parseBsString('2083/6/14')).toBe('2026-09-30');
    expect(parseBsString('2083-06-40')).toBeNull();
    expect(toDevanagariDigits(2083)).toBe('२०८३');
  });
});

describe('budget periods', () => {
  const bs = { calendar: 'bs' as const, monthStartDay: 1 };
  const ad = { calendar: 'ad' as const, monthStartDay: 1 };
  const payday = { calendar: 'ad' as const, monthStartDay: 25 };

  it('uses BS months', () => {
    const p = getMonthPeriod('2026-09-30', bs);
    expect(p).toMatchObject({ calendar: 'bs', year: 2083, month: 6 });
    expect(adToBs(p.start)).toEqual({ year: 2083, month: 6, day: 1 });
    expect(adToBs(p.end)).toEqual({ year: 2083, month: 6, day: bsDaysInMonth(2083, 6) });
    expect(formatMonthPeriod(p)).toBe('Asoj 2083');
  });

  it('uses AD months', () => {
    const p = getMonthPeriod('2026-09-30', ad);
    expect(p).toMatchObject({ start: '2026-09-01', end: '2026-09-30', year: 2026, month: 9 });
    expect(formatMonthPeriod(p)).toBe('September 2026');
    expect(formatMonthPeriod(p, 'short')).toBe('Sep');
  });

  it('supports a custom AD start day', () => {
    expect(getMonthPeriod('2026-09-30', payday)).toMatchObject({
      start: '2026-09-25',
      end: '2026-10-24',
    });
    expect(getMonthPeriod('2026-09-10', payday)).toMatchObject({
      start: '2026-08-25',
      end: '2026-09-24',
    });
    expect(getMonthPeriod('2026-01-10', payday)).toMatchObject({
      start: '2025-12-25',
      end: '2026-01-24',
    });
    expect(formatMonthPeriod(getMonthPeriod('2026-09-30', payday))).toBe('25 Sep – 24 Oct 2026');
  });

  it('shifts across year boundaries', () => {
    const chaitra = getMonthPeriod(bsToAd({ year: 2082, month: 12, day: 5 }), bs);
    const next = shiftMonthPeriod(chaitra, 1, bs);
    expect(next).toMatchObject({ year: 2083, month: 1 });
    expect(next.start).toBe(addDays(chaitra.end, 1));
    expect(shiftMonthPeriod(getMonthPeriod('2026-01-15', ad), -1, ad)).toMatchObject({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('periods tile the timeline without gaps or overlaps', () => {
    for (const settings of [bs, ad, payday]) {
      const periods = listMonthPeriods('2025-01-01', '2026-12-31', settings);
      expect(periods.length).toBeGreaterThanOrEqual(24);
      for (let i = 1; i < periods.length; i++) {
        expect(periods[i]!.start).toBe(addDays(periods[i - 1]!.end, 1));
      }
    }
  });

  it('computes the Nepal fiscal year', () => {
    const fy = getFiscalYear('2026-09-30');
    expect(fy.label).toBe('FY 2083/84');
    expect(adToBs(fy.start)).toEqual({ year: 2083, month: 4, day: 1 });
    expect(adToBs(fy.end)).toEqual({ year: 2084, month: 3, day: bsDaysInMonth(2084, 3) });
    expect(getFiscalYear('2026-05-01').label).toBe('FY 2082/83');
  });

  it('computes years and weeks', () => {
    expect(getYearRange('2026-09-30', 'ad')).toMatchObject({
      start: '2026-01-01',
      end: '2026-12-31',
    });
    const bsYear = getYearRange('2026-09-30', 'bs');
    expect(bsYear.year).toBe(2083);
    expect(bsYear.start).toBe('2026-04-14');
    expect(getWeekRange('2026-09-30', 0)).toEqual({ start: '2026-09-27', end: '2026-10-03' });
    expect(getWeekRange('2026-09-30', 1)).toEqual({ start: '2026-09-28', end: '2026-10-04' });
  });

  it('counts days left', () => {
    const p = { start: '2026-09-01', end: '2026-09-30' };
    expect(rangeLength(p)).toBe(30);
    expect(daysLeftInPeriod(p, '2026-09-30')).toBe(1);
    expect(daysLeftInPeriod(p, '2026-09-01')).toBe(30);
    expect(daysLeftInPeriod(p, '2026-10-01')).toBe(0);
    expect(daysLeftInPeriod(p, '2026-08-01')).toBe(30);
  });
});
