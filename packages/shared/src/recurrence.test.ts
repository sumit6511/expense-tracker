import { describe, expect, it } from 'vitest';
import { adToBs, bsToAd } from './bs';
import {
  indexOnOrAfter,
  occurrenceAt,
  occurrencesUntil,
  perMonth,
  RecurringBodySchema,
  type Schedule,
} from './recurrence';

const bs = (year: number, month: number, day: number) => bsToAd({ year, month, day });

const monthly = (startDate: string, extra: Partial<Schedule> = {}): Schedule => ({
  frequency: 'monthly',
  interval: 1,
  calendar: 'ad',
  startDate,
  lastDayOfMonth: false,
  ...extra,
});

describe('occurrences', () => {
  it('repeats daily and weekly by fixed steps', () => {
    const daily: Schedule = { ...monthly('2026-10-01'), frequency: 'daily', interval: 3 };
    expect(occurrenceAt(daily, 2)).toBe('2026-10-07');
    const weekly: Schedule = { ...monthly('2026-10-01'), frequency: 'weekly', interval: 2 };
    expect(occurrenceAt(weekly, 1)).toBe('2026-10-15');
  });

  it('keeps the day of the month without drifting after short months', () => {
    const s = monthly('2026-01-31');
    expect([0, 1, 2, 3].map((i) => occurrenceAt(s, i))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    const last = monthly('2026-02-28', { lastDayOfMonth: true });
    expect(occurrenceAt(last, 1)).toBe('2026-03-31');
  });

  it('follows Bikram Sambat months', () => {
    // 1 Kartik 2083 and the 1st of the following BS months.
    const s = monthly(bs(2083, 7, 1), { calendar: 'bs' });
    for (let i = 0; i < 8; i++) {
      const d = adToBs(occurrenceAt(s, i)!);
      expect(d.day).toBe(1);
      expect(d.month).toBe(((6 + i) % 12) + 1);
    }
    // The 32nd of Asar clamps to the length of shorter months, and returns to 32 when possible.
    const long = monthly(bs(2083, 3, 32), { calendar: 'bs' });
    expect(adToBs(occurrenceAt(long, 1)!).day).toBeLessThanOrEqual(32);
    expect(adToBs(occurrenceAt(long, 12)!)).toMatchObject({ year: 2084, month: 3 });
    const lastDay = monthly(bs(2083, 1, 31), { calendar: 'bs', lastDayOfMonth: true });
    const d = occurrenceAt(lastDay, 3)!;
    expect(adToBs(addOne(d))).toMatchObject({ month: 5, day: 1 });
  });

  it('repeats yearly in either calendar', () => {
    const dashain: Schedule = {
      ...monthly(bs(2083, 6, 20), { calendar: 'bs' }),
      frequency: 'yearly',
    };
    expect(adToBs(occurrenceAt(dashain, 2)!)).toEqual({ year: 2085, month: 6, day: 20 });
    const leap: Schedule = { ...monthly('2028-02-29'), frequency: 'yearly' };
    expect(occurrenceAt(leap, 1)).toBe('2029-02-28');
    expect(occurrenceAt(leap, 4)).toBe('2032-02-29');
  });

  it('finds the next occurrence on or after a date', () => {
    const s = monthly('2026-01-15', { interval: 2 });
    expect(indexOnOrAfter(s, '2025-12-01')).toBe(0);
    expect(indexOnOrAfter(s, '2026-01-15')).toBe(0);
    expect(indexOnOrAfter(s, '2026-01-16')).toBe(1);
    expect(occurrenceAt(s, indexOnOrAfter(s, '2027-06-01'))).toBe('2027-07-15');
    const weekly: Schedule = { ...s, frequency: 'weekly', interval: 1 };
    expect(occurrenceAt(weekly, indexOnOrAfter(weekly, '2026-01-23'))).toBe('2026-01-29');
  });

  it('lists occurrences up to a date', () => {
    const s = monthly('2026-01-10');
    expect(occurrencesUntil(s, 1, '2026-04-10').map((o) => o.date)).toEqual([
      '2026-02-10',
      '2026-03-10',
      '2026-04-10',
    ]);
    expect(occurrencesUntil(s, 0, '2030-01-01', 5)).toHaveLength(5);
  });

  it('normalizes to a monthly rate', () => {
    expect(perMonth('monthly', 1)).toBe(1);
    expect(perMonth('yearly', 1)).toBeCloseTo(1 / 12);
    expect(perMonth('weekly', 2)).toBeCloseTo(2.17, 2);
  });
});

describe('RecurringBodySchema', () => {
  const base = {
    name: 'Rent',
    kind: 'expense',
    accountId: '00000000-0000-4000-8000-000000000001',
    amountMinor: 2_500_000,
    frequency: 'monthly',
    calendar: 'bs',
    nextDate: '2026-10-18',
  } as const;

  it('fills defaults', () => {
    expect(RecurringBodySchema.parse(base)).toMatchObject({
      interval: 1,
      mode: 'remind',
      variableAmount: false,
      toAccountId: null,
      remindDaysBefore: 3,
    });
  });

  it('rejects inconsistent settings', () => {
    expect(RecurringBodySchema.safeParse({ ...base, kind: 'transfer' }).success).toBe(false);
    expect(
      RecurringBodySchema.safeParse({ ...base, variableAmount: true, mode: 'auto' }).success,
    ).toBe(false);
    expect(RecurringBodySchema.safeParse({ ...base, endDate: '2026-01-01' }).success).toBe(false);
    expect(RecurringBodySchema.safeParse({ ...base, amountMinor: -5 }).success).toBe(false);
  });
});

function addOne(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
