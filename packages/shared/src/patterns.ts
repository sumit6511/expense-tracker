import { addDays, diffDays, type IsoDate } from './dates';
import type { Minor } from './money';

/**
 * Finding the rhythm in someone's history: the internet bill every month, a streaming service
 * that went up in price, the insurance premium once a year. Pure functions over plain numbers,
 * so the API and tests share them.
 */

export const CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];

/** How a cadence maps onto a recurring schedule. */
export const CADENCE_SCHEDULE: Record<
  Cadence,
  { frequency: 'weekly' | 'monthly' | 'yearly'; interval: number }
> = {
  weekly: { frequency: 'weekly', interval: 1 },
  monthly: { frequency: 'monthly', interval: 1 },
  quarterly: { frequency: 'monthly', interval: 3 },
  yearly: { frequency: 'yearly', interval: 1 },
};

/**
 * Gaps (in days) that count as each cadence: the median gap must fall in `median` and every
 * recent gap in `each`. Bikram Sambat months run 29 to 32 days, and bills are often paid a few
 * days early or late.
 */
const RHYTHMS: Array<{
  cadence: Cadence;
  median: [number, number];
  each: [number, number];
  /** Charges needed before calling it a pattern. */
  minCount: number;
}> = [
  { cadence: 'weekly', median: [6, 8], each: [5, 9], minCount: 4 },
  { cadence: 'monthly', median: [26, 35], each: [20, 40], minCount: 3 },
  { cadence: 'quarterly', median: [84, 98], each: [75, 105], minCount: 3 },
  { cadence: 'yearly', median: [350, 380], each: [330, 400], minCount: 2 },
];

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Charge {
  date: IsoDate;
  /** Positive. */
  amountMinor: Minor;
}

export interface PriceChange {
  fromMinor: Minor;
  toMinor: Minor;
  /** The first charge at the new price. */
  date: IsoDate;
}

export interface ChargePattern {
  cadence: Cadence;
  /** Median days between charges. */
  gapDays: number;
  count: number;
  lastDate: IsoDate;
  /** When the next one is expected (today or later). */
  nextDate: IsoDate;
  /** The latest amount. */
  amountMinor: Minor;
  /** The same amount every time (a subscription), rather than a bill that varies. */
  fixed: boolean;
  /** A fixed price that changed recently. */
  change: PriceChange | null;
}

/** Within `pct` of each other (relative to the larger). */
const near = (a: number, b: number, pct: number) =>
  Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * pct;

/** Fixed amounts allow a rounding-sized wobble (card fees, exchange rates). */
const FIXED_TOLERANCE = 0.01;
/** A bill that varies (electricity, phone) still counts if it stays within this of its median. */
const VARIABLE_TOLERANCE = 0.2;

/**
 * Looks for a steady rhythm in one payee's charges (one account, one direction). Returns null
 * when there's no clear cadence, the amounts jump around, or it seems to have stopped.
 */
export function detectPattern(charges: readonly Charge[], today: IsoDate): ChargePattern | null {
  // Oldest first, one per day (a bill paid in two parts on one day counts once).
  const byDay = [
    ...new Map(
      [...charges].sort((a, b) => a.date.localeCompare(b.date)).map((c) => [c.date, c]),
    ).values(),
  ].filter((c) => c.date <= today);
  if (byDay.length < 2) return null;

  const gaps = byDay.slice(1).map((c, i) => diffDays(byDay[i]!.date, c.date));
  const recent = gaps.slice(-5);
  const gap = median(recent);
  const rhythm = RHYTHMS.find(
    (r) =>
      gap >= r.median[0] &&
      gap <= r.median[1] &&
      recent.every((g) => g >= r.each[0] && g <= r.each[1]),
  );
  if (!rhythm || byDay.length < rhythm.minCount) return null;

  const last = byDay.at(-1)!;
  // Still going: seen within one and a half cycles.
  if (diffDays(last.date, today) > gap * 1.5) return null;

  // The latest run at one price, and the charges before it.
  const amounts = byDay.slice(-6).map((c) => c.amountMinor);
  let tailStart = amounts.length - 1;
  while (tailStart > 0 && near(amounts[tailStart - 1]!, last.amountMinor, FIXED_TOLERANCE))
    tailStart--;
  const tail = amounts.slice(tailStart);
  const head = amounts.slice(0, tailStart);
  const headPrice = head.at(-1);
  const headFixed = head.length > 0 && head.every((a) => near(a, headPrice!, FIXED_TOLERANCE));

  let fixed: boolean;
  let change: PriceChange | null = null;
  if (head.length === 0) {
    // The same price every time.
    fixed = true;
  } else if (headFixed && (head.length >= 2 || tail.length >= 2 || rhythm.minCount <= 2)) {
    // A steady price, then a new one.
    fixed = true;
    const firstNew = byDay[byDay.length - tail.length]!;
    change = { fromMinor: headPrice!, toMinor: last.amountMinor, date: firstNew.date };
  } else {
    // A bill that varies: accept it if the recent amounts stay close to their median.
    const lastFew = amounts.slice(-4);
    const typical = median(lastFew);
    if (lastFew.some((a) => !near(a, typical, VARIABLE_TOLERANCE))) return null;
    fixed = false;
  }

  const step = Math.round(gap);
  let nextDate = addDays(last.date, step);
  while (nextDate < today) nextDate = addDays(nextDate, step);
  return {
    cadence: rhythm.cadence,
    gapDays: gap,
    count: byDay.length,
    lastDate: last.date,
    nextDate,
    amountMinor: last.amountMinor,
    fixed,
    change,
  };
}

// ---------------------------------------------------------------------------------------------
// Spending that stands out
// ---------------------------------------------------------------------------------------------

export function meanAndSd(xs: readonly number[]): { mean: number; sd: number } {
  if (xs.length === 0) return { mean: 0, sd: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return { mean, sd: Math.sqrt(variance) };
}

export interface Unusual {
  /** The usual amount (the mean of the history). */
  usualMinor: Minor;
  /** How far above the usual (positive) or below it (negative), as a fraction. */
  change: number;
}

/**
 * Is `amount` unusually high for this category? Above the history's mean plus two standard
 * deviations, at least 30% above the mean, and by at least `minDelta` (so small categories
 * don't make noise).
 */
export function unusuallyHigh(
  amount: Minor,
  history: readonly number[],
  minDelta: Minor,
): Unusual | null {
  if (history.length < 3) return null;
  const { mean, sd } = meanAndSd(history);
  if (amount <= mean + 2 * sd || amount < mean * 1.3 || amount - mean < minDelta) return null;
  return { usualMinor: Math.round(mean), change: mean > 0 ? amount / mean - 1 : Infinity };
}

/**
 * Is `amount` well under what this category usually takes? At least 20% below the mean, by at
 * least `minDelta`.
 */
export function notablyLow(
  amount: Minor,
  history: readonly number[],
  minDelta: Minor,
): Unusual | null {
  if (history.length < 3) return null;
  const { mean } = meanAndSd(history);
  if (mean <= 0 || amount > mean * 0.8 || mean - amount < minDelta) return null;
  return { usualMinor: Math.round(mean), change: amount / mean - 1 };
}

// ---------------------------------------------------------------------------------------------
// Where the balance is heading
// ---------------------------------------------------------------------------------------------

export interface ForecastEvent {
  /** Days from today (0 = today). */
  day: number;
  /** Signed change to the balance. */
  amountMinor: Minor;
}

export interface ForecastPoint {
  day: number;
  expectedMinor: Minor;
  lowMinor: Minor;
  highMinor: Minor;
}

/** z for an 80% band. */
const BAND_Z = 1.2816;

/**
 * Projects a balance forward: known (scheduled) changes on their days, plus everyday money in
 * and out at its historical daily average. The band widens with the square root of time, like
 * a random walk with the history's day-to-day spread.
 */
export function projectBalance(
  startMinor: Minor,
  days: number,
  events: readonly ForecastEvent[],
  daily: { mean: number; sd: number },
): ForecastPoint[] {
  const byDay = new Map<number, number>();
  for (const e of events) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.amountMinor);
  const out: ForecastPoint[] = [];
  let scheduled = 0;
  for (let day = 0; day <= days; day++) {
    scheduled += byDay.get(day) ?? 0;
    const expected = startMinor + scheduled + daily.mean * day;
    const spread = BAND_Z * daily.sd * Math.sqrt(day);
    out.push({
      day,
      expectedMinor: Math.round(expected),
      lowMinor: Math.round(expected - spread),
      highMinor: Math.round(expected + spread),
    });
  }
  return out;
}
