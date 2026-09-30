import {
  addDays,
  averageDecimals,
  convertBetween,
  divideRates,
  type ExchangeRate,
  type IsoDate,
  isCurrencyCode,
  type Minor,
} from '@et/shared';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Executor } from '../db/client';
import { exchangeRates, manualRates } from '../db/schema';

/** Published rates are stored against NPR: `rate` = rupees per one unit of `base`. */
export const HOME_CURRENCY = 'NPR';

/** The Indian rupee is pegged: 1 INR = 1.60 NPR. Used whenever no published rate is stored. */
const PEGS: Record<string, string> = { INR: '1.6' };

interface DatedRate {
  date: IsoDate;
  rate: string;
}

/** Rate on the latest date ≤ `date`, else the earliest one after it. Rates are sorted by date. */
function pick(rates: DatedRate[] | undefined, date: IsoDate): string | null {
  if (!rates || rates.length === 0) return null;
  let lo = 0;
  let hi = rates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid]!.date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return (found >= 0 ? rates[found] : rates[0])!.rate;
}

/**
 * Converts money between currencies on a given date. Lookup order: a manual rate for the exact
 * pair (or its inverse), then rupee rates (manual beat published on the same date), crossing
 * through NPR when neither side is NPR, then the INR peg.
 */
export class RateBook {
  private readonly nprPer = new Map<string, DatedRate[]>();
  private readonly pairs = new Map<string, DatedRate[]>();
  readonly missing = new Set<string>();

  constructor(
    published: Array<DatedRate & { base: string }>,
    manual: Array<DatedRate & { base: string; quote: string }>,
  ) {
    const add = (map: Map<string, DatedRate[]>, key: string, rate: DatedRate) => {
      const list = map.get(key) ?? [];
      list.push(rate);
      map.set(key, list);
    };
    for (const r of published) add(this.nprPer, r.base, { date: r.date, rate: r.rate });
    for (const r of manual) {
      if (r.quote === HOME_CURRENCY) add(this.nprPer, r.base, { date: r.date, rate: r.rate });
      else if (r.base === HOME_CURRENCY)
        add(this.nprPer, r.quote, { date: r.date, rate: divideRates('1', r.rate) });
      else add(this.pairs, `${r.base}/${r.quote}`, { date: r.date, rate: r.rate });
    }
    // Sort by date; on the same date manual rates were added last, and a stable sort keeps them
    // after published ones, so `pick` (last ≤ date) prefers them.
    for (const list of [...this.nprPer.values(), ...this.pairs.values()]) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  }

  private rupeesPer(currency: string, date: IsoDate): string | null {
    if (currency === HOME_CURRENCY) return '1';
    return pick(this.nprPer.get(currency), date) ?? PEGS[currency] ?? null;
  }

  /** Units of `to` per one unit of `from` on `date`, or null if unknown. */
  rate(from: string, to: string, date: IsoDate): string | null {
    if (from === to) return '1';
    const direct = pick(this.pairs.get(`${from}/${to}`), date);
    if (direct) return direct;
    const inverse = pick(this.pairs.get(`${to}/${from}`), date);
    if (inverse) return divideRates('1', inverse);
    const a = this.rupeesPer(from, date);
    const b = this.rupeesPer(to, date);
    if (!a || !b) return null;
    return to === HOME_CURRENCY ? a : divideRates(a, b);
  }

  /** Converted amount, or null (and the currency is recorded in `missing`) when no rate exists. */
  convert(minor: Minor, from: string, to: string, date: IsoDate): Minor | null {
    if (from === to || minor === 0) return minor;
    const rate = this.rate(from, to, date);
    if (!rate) {
      this.missing.add(this.rupeesPer(from, date) === null ? from : to);
      return null;
    }
    return convertBetween(minor, from, to, rate);
  }
}

/**
 * Loads the rates needed to convert `currencies` into `baseCurrency` for dates in [from, to].
 * Skips the database entirely when everything is already in the base currency.
 */
export async function loadRateBook(
  db: Executor,
  workspaceId: string,
  currencies: Iterable<string>,
  baseCurrency: string,
  from: IsoDate,
  to: IsoDate,
): Promise<RateBook> {
  const needed = new Set([...currencies, baseCurrency].filter((c) => c !== HOME_CURRENCY));
  const manual = await db
    .select({
      base: manualRates.base,
      quote: manualRates.quote,
      date: manualRates.date,
      rate: manualRates.rate,
    })
    .from(manualRates)
    .where(eq(manualRates.workspaceId, workspaceId));
  const allSame = new Set([...currencies, baseCurrency]).size <= 1;
  if (needed.size === 0 || allSame) return new RateBook([], manual);

  const codes = [...needed];
  const windowStart = addDays(from, -45);
  const inRange = await db
    .select({ base: exchangeRates.base, date: exchangeRates.date, rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.quote, HOME_CURRENCY),
        inArray(exchangeRates.base, codes),
        gte(exchangeRates.date, windowStart),
        lte(exchangeRates.date, to),
      ),
    );
  // Latest rate before the window, for dates that fall into a gap (holidays, outages).
  const before = await db.execute<{ base: string; date: string; rate: string }>(sql`
    select distinct on (base) base, date, rate
    from ${exchangeRates}
    where quote = ${HOME_CURRENCY} and base = any(${sql.param(codes)}::text[]) and date < ${windowStart}
    order by base, date desc, source asc
  `);
  return new RateBook([...before.rows, ...inRange], manual);
}

// ---------------------------------------------------------------------------------------------
// Listing and manual rates
// ---------------------------------------------------------------------------------------------

/** The most recent rate (on or before `date`) for each currency, against NPR. */
export async function latestRates(
  db: Db,
  workspaceId: string,
  date: IsoDate,
): Promise<ExchangeRate[]> {
  const published = await db.execute<{
    base: string;
    date: string;
    rate: string;
    source: 'nrb' | 'peg';
  }>(sql`
    select distinct on (base) base, date, rate, source
    from ${exchangeRates}
    where quote = ${HOME_CURRENCY} and date <= ${date}
    order by base, date desc, source asc
  `);
  const manual = await db.execute<{ base: string; quote: string; date: string; rate: string }>(sql`
    select distinct on (base, quote) base, quote, date, rate
    from ${manualRates}
    where workspace_id = ${workspaceId} and date <= ${date}
    order by base, quote, date desc
  `);
  const out: ExchangeRate[] = published.rows.map((r) => ({
    base: r.base,
    quote: HOME_CURRENCY,
    date: r.date,
    rate: trimRate(r.rate),
    source: r.source,
  }));
  if (!out.some((r) => r.base === 'INR')) {
    out.push({ base: 'INR', quote: HOME_CURRENCY, date, rate: PEGS.INR!, source: 'peg' });
  }
  for (const r of manual.rows) {
    out.push({
      base: r.base,
      quote: r.quote,
      date: r.date,
      rate: trimRate(r.rate),
      source: 'manual',
    });
  }
  return out.sort((a, b) => a.base.localeCompare(b.base) || a.source.localeCompare(b.source));
}

function trimRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate;
}

export async function setManualRate(
  db: Db,
  workspaceId: string,
  input: { base: string; quote: string; date: IsoDate; rate: string },
): Promise<void> {
  await db
    .insert(manualRates)
    .values({ workspaceId, ...input })
    .onConflictDoUpdate({
      target: [manualRates.workspaceId, manualRates.base, manualRates.quote, manualRates.date],
      set: { rate: input.rate, createdAt: new Date() },
    });
}

export async function deleteManualRate(
  db: Db,
  workspaceId: string,
  key: { base: string; quote: string; date: IsoDate },
): Promise<boolean> {
  const deleted = await db
    .delete(manualRates)
    .where(
      and(
        eq(manualRates.workspaceId, workspaceId),
        eq(manualRates.base, key.base),
        eq(manualRates.quote, key.quote),
        eq(manualRates.date, key.date),
      ),
    )
    .returning({ base: manualRates.base });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Nepal Rastra Bank
// ---------------------------------------------------------------------------------------------

export const NRB_RATES_URL = 'https://www.nrb.org.np/api/forex/v1/rates';

const NrbResponse = z.object({
  data: z.object({
    payload: z.array(
      z.object({
        date: z.string(),
        rates: z.array(
          z.object({
            currency: z.object({ iso3: z.string(), unit: z.coerce.number().int().positive() }),
            buy: z.union([z.string(), z.number()]).nullable(),
            sell: z.union([z.string(), z.number()]).nullable(),
          }),
        ),
      }),
    ),
  }),
  pagination: z
    .object({ pages: z.number().optional(), page: z.number().optional() })
    .partial()
    .optional(),
});

export interface PublishedRate {
  base: string;
  date: IsoDate;
  rate: string;
}

/**
 * Parses an NRB forex API response into rupees per single unit, using the mid rate. NRB quotes
 * some currencies per 10 or 100 units (INR, JPY, KRW), which `unit` accounts for.
 */
export function parseNrbResponse(body: unknown): PublishedRate[] {
  const parsed = NrbResponse.parse(body);
  const out: PublishedRate[] = [];
  for (const day of parsed.data.payload) {
    const date = day.date.slice(0, 10);
    for (const r of day.rates) {
      const code = r.currency.iso3.toUpperCase();
      if (!isCurrencyCode(code) || r.buy === null || r.sell === null) continue;
      const buy = String(r.buy);
      const sell = String(r.sell);
      if (!(Number(buy) > 0 && Number(sell) > 0)) continue;
      out.push({ base: code, date, rate: averageDecimals(buy, sell, r.currency.unit) });
    }
  }
  return out;
}

export async function fetchNrbRates(
  from: IsoDate,
  to: IsoDate,
  fetchImpl: typeof fetch = fetch,
): Promise<PublishedRate[]> {
  const all: PublishedRate[] = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${NRB_RATES_URL}?from=${from}&to=${to}&per_page=100&page=${page}`;
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`NRB rates request failed with HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    all.push(...parseNrbResponse(body));
    const pages = NrbResponse.parse(body).pagination?.pages ?? 1;
    if (page >= pages) break;
  }
  return all;
}

export async function storePublishedRates(
  db: Executor,
  rates: PublishedRate[],
  source: 'nrb' | 'peg',
): Promise<number> {
  if (rates.length === 0) return 0;
  for (let i = 0; i < rates.length; i += 500) {
    const chunk = rates.slice(i, i + 500).map((r) => ({ ...r, quote: HOME_CURRENCY, source }));
    await db
      .insert(exchangeRates)
      .values(chunk)
      .onConflictDoUpdate({
        target: [exchangeRates.base, exchangeRates.quote, exchangeRates.date, exchangeRates.source],
        set: { rate: sql`excluded.rate`, fetchedAt: new Date() },
      });
  }
  return rates.length;
}
