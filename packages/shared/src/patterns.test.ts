import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  type Charge,
  detectPattern,
  meanAndSd,
  notablyLow,
  projectBalance,
  unusuallyHigh,
} from './patterns';

/** Charges every `gap` days ending on `last`, with these amounts (oldest first). */
function series(last: string, gap: number, amounts: number[]): Charge[] {
  return amounts.map((amountMinor, i) => ({
    date: addDays(last, -(amounts.length - 1 - i) * gap),
    amountMinor,
  }));
}

describe('detectPattern', () => {
  const today = '2026-09-30';

  it('finds a monthly subscription at a steady price', () => {
    const p = detectPattern(series('2026-09-20', 30, [49_900, 49_900, 49_900, 49_900]), today);
    expect(p).toMatchObject({
      cadence: 'monthly',
      count: 4,
      amountMinor: 49_900,
      fixed: true,
      change: null,
      lastDate: '2026-09-20',
      nextDate: '2026-10-20',
    });
  });

  it('copes with Bikram Sambat month lengths and a day or two of drift', () => {
    const dates = ['2026-05-15', '2026-06-15', '2026-07-17', '2026-08-17', '2026-09-17'];
    const p = detectPattern(
      dates.map((date) => ({ date, amountMinor: 150_000 })),
      today,
    );
    expect(p?.cadence).toBe('monthly');
  });

  it('spots a price rise, even after only one charge at the new price', () => {
    const p = detectPattern(series('2026-09-20', 30, [64_900, 64_900, 64_900, 79_900]), today);
    expect(p?.fixed).toBe(true);
    expect(p?.change).toEqual({ fromMinor: 64_900, toMinor: 79_900, date: '2026-09-20' });
  });

  it('dates a price change from the first charge at the new price', () => {
    const p = detectPattern(series('2026-09-20', 30, [1000, 1000, 1200, 1200]), today);
    expect(p?.change).toEqual({ fromMinor: 1000, toMinor: 1200, date: '2026-08-21' });
  });

  it('accepts a bill that varies a little, without calling it a price change', () => {
    const p = detectPattern(series('2026-09-25', 30, [210_000, 195_000, 230_000, 205_000]), today);
    expect(p).toMatchObject({ cadence: 'monthly', fixed: false, change: null });
  });

  it('ignores amounts that jump around', () => {
    expect(detectPattern(series('2026-09-25', 30, [1000, 5000, 1200, 9000]), today)).toBeNull();
  });

  it('finds weekly, quarterly and yearly rhythms', () => {
    expect(detectPattern(series('2026-09-28', 7, [500, 500, 500, 500]), today)?.cadence).toBe(
      'weekly',
    );
    expect(detectPattern(series('2026-09-01', 91, [9000, 9000, 9000]), today)?.cadence).toBe(
      'quarterly',
    );
    const yearly = detectPattern(series('2026-04-10', 365, [1_800_000, 2_000_000]), today);
    expect(yearly).toMatchObject({ cadence: 'yearly', nextDate: '2027-04-10' });
    expect(yearly?.change).toMatchObject({ fromMinor: 1_800_000, toMinor: 2_000_000 });
  });

  it('needs enough charges, and a rhythm that is still going', () => {
    expect(detectPattern(series('2026-09-20', 30, [100, 100]), today)).toBeNull();
    expect(detectPattern(series('2026-06-01', 30, [100, 100, 100, 100]), today)).toBeNull();
    expect(detectPattern(series('2026-09-20', 12, [100, 100, 100, 100]), today)).toBeNull();
  });

  it('counts two charges on one day once', () => {
    const charges = series('2026-09-20', 30, [100, 100, 100]);
    charges.push({ date: '2026-09-20', amountMinor: 100 });
    expect(detectPattern(charges, today)?.count).toBe(3);
  });
});

describe('spending that stands out', () => {
  it('computes mean and standard deviation', () => {
    expect(meanAndSd([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, sd: 2 });
    expect(meanAndSd([])).toEqual({ mean: 0, sd: 0 });
  });

  it('flags spending above the mean plus two standard deviations', () => {
    const history = [10_000, 11_000, 9_000, 10_000];
    expect(unusuallyHigh(18_000, history, 1_000)).toEqual({ usualMinor: 10_000, change: 0.8 });
    expect(unusuallyHigh(11_500, history, 1_000)).toBeNull();
    // Too small to matter.
    expect(unusuallyHigh(18_000, history, 10_000)).toBeNull();
    // Not enough history.
    expect(unusuallyHigh(18_000, [10_000, 10_000], 1_000)).toBeNull();
  });

  it('flags a category well under its usual', () => {
    const history = [10_000, 12_000, 11_000];
    expect(notablyLow(6_000, history, 1_000)).toMatchObject({ usualMinor: 11_000 });
    expect(notablyLow(10_000, history, 1_000)).toBeNull();
  });
});

describe('projectBalance', () => {
  it('adds scheduled changes on their days and the daily average in between', () => {
    const points = projectBalance(
      100_000,
      4,
      [
        { day: 2, amountMinor: -30_000 },
        { day: 2, amountMinor: -5_000 },
      ],
      { mean: -1_000, sd: 0 },
    );
    expect(points.map((p) => p.expectedMinor)).toEqual([100_000, 99_000, 63_000, 62_000, 61_000]);
    expect(points.every((p) => p.lowMinor === p.expectedMinor)).toBe(true);
  });

  it('widens the band with time', () => {
    const points = projectBalance(0, 9, [], { mean: 0, sd: 1_000 });
    expect(points[0]).toMatchObject({ lowMinor: 0, highMinor: 0 });
    expect(points[9]!.highMinor).toBe(Math.round(1.2816 * 1_000 * 3));
    expect(points[9]!.lowMinor).toBe(-points[9]!.highMinor);
  });
});
