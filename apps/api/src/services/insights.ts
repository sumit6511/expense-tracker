import {
  type AccountType,
  addDays,
  CADENCE_SCHEDULE,
  type ChargePattern,
  detectPattern,
  diffDays,
  type Forecast,
  formatAdDate,
  formatBsDate,
  formatMoney,
  getMonthPeriod,
  type Insight,
  type Insights,
  type IsoDate,
  LIABILITY_ACCOUNT_TYPES,
  meanAndSd,
  notablyLow,
  projectBalance,
  type RecurringSuggestion,
  shiftMonthPeriod,
  unusuallyHigh,
} from '@et/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { budgets, insightDismissals, recurring } from '../db/schema';
import type { Logger } from '../logger';
import { listAccounts } from './accounts';
import { type Candidate, deliver } from './notifications';
import { loadRateBook } from './rates';
import { scheduledOccurrences } from './recurring';
import { type Flow, loadFlows, periodSettings } from './reports';
import { workspaceToday } from './transactions';
import { memberContexts, visibleAccountSql } from './visibility';

// ---------------------------------------------------------------------------------------------
// Dismissals (per person)
// ---------------------------------------------------------------------------------------------

async function dismissedKeys(db: Executor, ws: WorkspaceCtx): Promise<Set<string>> {
  const rows = await db
    .select({ key: insightDismissals.key })
    .from(insightDismissals)
    .where(and(eq(insightDismissals.workspaceId, ws.id), eq(insightDismissals.userId, ws.userId)));
  return new Set(rows.map((r) => r.key));
}

export async function dismissInsight(db: Db, ws: WorkspaceCtx, key: string) {
  await db
    .insert(insightDismissals)
    .values({ workspaceId: ws.id, userId: ws.userId, key })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------------------------
// Rhythms in the history: subscriptions, bills, salary
// ---------------------------------------------------------------------------------------------

interface FoundPattern {
  payeeId: string;
  payeeName: string;
  accountId: string;
  currency: string;
  categoryId: string | null;
  flow: 'expense' | 'income';
  pattern: ChargePattern;
}

/** Long enough to see a yearly payment twice, even one a few months overdue. */
const PATTERN_HISTORY_DAYS = 950;

/** Each payee's payments (per account and direction) that follow a steady rhythm. */
async function findPatterns(db: Executor, ws: WorkspaceCtx, today: IsoDate) {
  const result = await db.execute<{
    payee_id: string;
    payee_name: string;
    account_id: string;
    currency: string;
    date: string;
    amount_minor: number;
    category_id: string | null;
  }>(sql`
    select t.payee_id, p.name as payee_name, t.account_id, a.currency, t.date, t.amount_minor,
      (select s.category_id from transaction_splits s where s.transaction_id = t.id
        order by s.sort_order limit 1) as category_id
    from transactions t
    join payees p on p.id = t.payee_id
    join accounts a on a.id = t.account_id
    where t.workspace_id = ${ws.id}
      and t.deleted_at is null
      and t.transfer_group_id is null
      and t.amount_minor <> 0
      and t.date between ${addDays(today, -PATTERN_HISTORY_DAYS)} and ${today}
      ${visibleAccountSql(ws, sql`t.account_id`)}
    order by t.payee_id, t.account_id, t.date
  `);
  const groups = Map.groupBy(
    result.rows,
    (r) => `${r.payee_id}|${r.account_id}|${Number(r.amount_minor) < 0 ? 'out' : 'in'}`,
  );
  const found: FoundPattern[] = [];
  for (const rows of groups.values()) {
    const pattern = detectPattern(
      rows.map((r) => ({ date: r.date, amountMinor: Math.abs(Number(r.amount_minor)) })),
      today,
    );
    if (!pattern) continue;
    const last = rows.at(-1)!;
    found.push({
      payeeId: last.payee_id,
      payeeName: last.payee_name,
      accountId: last.account_id,
      currency: last.currency,
      categoryId: last.category_id,
      flow: Number(last.amount_minor) < 0 ? 'expense' : 'income',
      pattern,
    });
  }
  return found;
}

/** Recurring series (that haven't ended) by payee. */
async function trackedSeries(db: Executor, ws: WorkspaceCtx) {
  const rows = await db
    .select({
      id: recurring.id,
      payeeId: recurring.payeeId,
      accountId: recurring.accountId,
      amountMinor: recurring.amountMinor,
      variableAmount: recurring.variableAmount,
    })
    .from(recurring)
    .where(and(eq(recurring.workspaceId, ws.id), sql`${recurring.nextDate} is not null`));
  return rows.filter((r) => r.payeeId !== null);
}

const suggestionKey = (p: Pick<FoundPattern, 'payeeId' | 'accountId'>) =>
  `recurring:${p.payeeId}:${p.accountId}`;

function toSuggestion(p: FoundPattern): RecurringSuggestion {
  return {
    payeeId: p.payeeId,
    payeeName: p.payeeName,
    accountId: p.accountId,
    categoryId: p.categoryId,
    kind: p.flow,
    amountMinor: p.pattern.amountMinor,
    currency: p.currency,
    cadence: p.pattern.cadence,
    ...CADENCE_SCHEDULE[p.pattern.cadence],
    fixed: p.pattern.fixed,
    count: p.pattern.count,
    lastDate: p.pattern.lastDate,
    nextDate: p.pattern.nextDate,
    dismissKey: suggestionKey(p),
  };
}

function suggestionsFrom(
  patterns: FoundPattern[],
  tracked: Awaited<ReturnType<typeof trackedSeries>>,
  dismissed: Set<string>,
) {
  const trackedPayees = new Set(tracked.map((r) => r.payeeId));
  return patterns
    .filter((p) => !trackedPayees.has(p.payeeId) && !dismissed.has(suggestionKey(p)))
    .map(toSuggestion)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/**
 * Payments that come (or go) at a steady weekly, monthly, quarterly or yearly rhythm and aren't
 * set up as recurring yet: "Looks like WorldLink bills monthly — track it?"
 */
export async function suggestRecurring(db: Db, ws: WorkspaceCtx): Promise<RecurringSuggestion[]> {
  const today = workspaceToday(ws);
  const [patterns, tracked, dismissed] = await Promise.all([
    findPatterns(db, ws, today),
    trackedSeries(db, ws),
    dismissedKeys(db, ws),
  ]);
  return suggestionsFrom(patterns, tracked, dismissed);
}

/** A fixed price that changed lately. */
function priceChanges(
  patterns: FoundPattern[],
  tracked: Awaited<ReturnType<typeof trackedSeries>>,
  today: IsoDate,
): Insight[] {
  const out: Insight[] = [];
  for (const p of patterns) {
    const change = p.pattern.change;
    if (!change || diffDays(change.date, today) > Math.max(60, p.pattern.gapDays)) continue;
    const series = tracked.find(
      (r) => r.payeeId === p.payeeId && r.accountId === p.accountId && !r.variableAmount,
    );
    const worse = change.toMinor > change.fromMinor === (p.flow === 'expense');
    out.push({
      kind: 'price_change',
      key: `price:${p.payeeId}:${p.accountId}:${change.date}`,
      tone: worse ? 'warning' : 'positive',
      date: change.date,
      flow: p.flow,
      payeeId: p.payeeId,
      payeeName: p.payeeName,
      accountId: p.accountId,
      currency: p.currency,
      fromMinor: change.fromMinor,
      toMinor: change.toMinor,
      cadence: p.pattern.cadence,
      recurringId: series?.id ?? null,
      recurringAmountMinor: series?.amountMinor ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Spending that stands out, good months, budgets kept
// ---------------------------------------------------------------------------------------------

/** Months of history each month is compared with. */
const HISTORY_MONTHS = 6;

async function spendingInsights(
  db: Db,
  ws: WorkspaceCtx,
  today: IsoDate,
): Promise<{ items: Insight[]; missingRates: string[] }> {
  const settings = periodSettings(ws);
  const current = getMonthPeriod(today, settings);
  // Oldest first; the last one is this month (so far).
  const periods = Array.from({ length: HISTORY_MONTHS + 2 }, (_, i) =>
    shiftMonthPeriod(current, i - HISTORY_MONTHS - 1, settings),
  );
  const cur = periods.length - 1;
  const last = cur - 1;
  const [{ flows, missingRates }, budgeted] = await Promise.all([
    loadFlows(db, ws, { from: periods[0]!.start, to: today }),
    loadFlows(db, ws, {
      from: periods[0]!.start,
      to: periods[last]!.end,
      onBudgetOnly: true,
      includeExcluded: true,
    }),
  ]);
  const indexOf = (date: IsoDate) => periods.findIndex((p) => date >= p.start && date <= p.end);

  // Months before the first one with any activity don't count as "spent nothing".
  const firstDate = flows.reduce<IsoDate | null>(
    (min, f) => (min === null || f.date < min ? f.date : min),
    null,
  );
  if (firstDate === null) return { items: [], missingRates };
  const firstIndex = indexOf(firstDate);

  const byCategory = (list: Flow[]) => {
    const out = new Map<string, number[]>();
    for (const f of list) {
      if (f.categoryId === null || f.expense === 0) continue;
      const values = out.get(f.categoryId) ?? periods.map(() => 0);
      const i = indexOf(f.date);
      if (i >= 0) values[i]! += f.expense;
      out.set(f.categoryId, values);
    }
    return out;
  };
  const spending = byCategory(flows);
  const income = periods.map(() => 0);
  const expense = periods.map(() => 0);
  for (const f of flows) {
    const i = indexOf(f.date);
    if (i < 0) continue;
    income[i]! += f.income;
    expense[i]! += f.expense;
  }

  const items: Insight[] = [];
  const complete = (upTo: number) => {
    const from = Math.max(firstIndex, upTo - HISTORY_MONTHS);
    return from < upTo ? { from, to: upTo } : null;
  };
  const historyTotals = complete(cur);
  if (!historyTotals) return { items, missingRates };
  const typicalMonth =
    expense.slice(historyTotals.from, historyTotals.to).reduce((s, v) => s + v, 0) /
    (historyTotals.to - historyTotals.from);
  // Too small to mention: under 5% of a typical month's spending.
  const minDelta = Math.max(1, Math.round(typicalMonth * 0.05));
  const period = (i: number) => ({ periodStart: periods[i]!.start, periodEnd: periods[i]!.end });

  const flagged = new Set<string>();
  for (const [categoryId, values] of spending) {
    // This month so far, compared with the months before.
    const range = complete(cur);
    const high = range && unusuallyHigh(values[cur]!, values.slice(range.from, range.to), minDelta);
    if (high) {
      flagged.add(categoryId);
      items.push({
        kind: 'unusual_spending',
        key: `unusual:${categoryId}:${periods[cur]!.start}`,
        tone: 'warning',
        date: today,
        ...period(cur),
        current: true,
        categoryId,
        amountMinor: values[cur]!,
        usualMinor: high.usualMinor,
        currency: ws.baseCurrency,
      });
    }
  }
  const lowOnes: Insight[] = [];
  for (const [categoryId, values] of spending) {
    // Last month, compared with the months before it.
    const range = complete(last);
    if (!range || last < firstIndex) continue;
    const history = values.slice(range.from, range.to);
    const high = !flagged.has(categoryId) && unusuallyHigh(values[last]!, history, minDelta);
    if (high) {
      items.push({
        kind: 'unusual_spending',
        key: `unusual:${categoryId}:${periods[last]!.start}`,
        tone: 'warning',
        date: periods[last]!.end,
        ...period(last),
        current: false,
        categoryId,
        amountMinor: values[last]!,
        usualMinor: high.usualMinor,
        currency: ws.baseCurrency,
      });
    }
    const low = notablyLow(values[last]!, history, minDelta);
    if (low) {
      lowOnes.push({
        kind: 'spending_down',
        key: `down:${categoryId}:${periods[last]!.start}`,
        tone: 'positive',
        date: periods[last]!.end,
        ...period(last),
        categoryId,
        amountMinor: values[last]!,
        usualMinor: low.usualMinor,
        currency: ws.baseCurrency,
      });
    }
  }
  // The two biggest drops are enough.
  const drop = (i: Insight) => (i.kind === 'spending_down' ? i.usualMinor - i.amountMinor : 0);
  items.push(...lowOnes.sort((a, b) => drop(b) - drop(a)).slice(0, 2));

  // A month with more in than out, and how many in a row.
  if (last >= firstIndex && income[last]! > 0 && income[last]! > expense[last]!) {
    const rate = (income[last]! - expense[last]!) / income[last]!;
    let streak = 0;
    for (let i = last; i >= firstIndex && income[i]! > expense[i]!; i--) streak++;
    if (rate >= 0.05) {
      items.push({
        kind: 'saved',
        key: `saved:${periods[last]!.start}`,
        tone: 'positive',
        date: periods[last]!.end,
        ...period(last),
        incomeMinor: income[last]!,
        expenseMinor: expense[last]!,
        streak,
        currency: ws.baseCurrency,
      });
    }
  }

  // Budgets kept three or more months running.
  if (last >= firstIndex) {
    const rows = await db
      .select({
        categoryId: budgets.categoryId,
        periodStart: budgets.periodStart,
        amountMinor: budgets.amountMinor,
      })
      .from(budgets)
      .where(
        and(
          eq(budgets.workspaceId, ws.id),
          gte(budgets.periodStart, periods[firstIndex]!.start),
          lte(budgets.periodStart, periods[last]!.start),
        ),
      );
    const budgetOf = new Map(rows.map((r) => [`${r.categoryId}|${r.periodStart}`, r.amountMinor]));
    const spent = byCategory(budgeted.flows);
    const streaks: Insight[] = [];
    for (const categoryId of new Set(rows.map((r) => r.categoryId))) {
      let months = 0;
      for (let i = last; i >= firstIndex; i--) {
        const limit = budgetOf.get(`${categoryId}|${periods[i]!.start}`) ?? 0;
        if (limit <= 0 || (spent.get(categoryId)?.[i] ?? 0) > limit) break;
        months++;
      }
      if (months >= 3) {
        streaks.push({
          kind: 'budget_streak',
          key: `streak:${categoryId}:${periods[last]!.start}`,
          tone: 'positive',
          date: periods[last]!.end,
          ...period(last),
          categoryId,
          months,
          currency: ws.baseCurrency,
        });
      }
    }
    const length = (i: Insight) => (i.kind === 'budget_streak' ? i.months : 0);
    items.push(...streaks.sort((a, b) => length(b) - length(a)).slice(0, 2));
  }
  return { items, missingRates };
}

// ---------------------------------------------------------------------------------------------
// Accounts the bills could empty
// ---------------------------------------------------------------------------------------------

const LOW_BALANCE_DAYS = 30;

/**
 * Accounts that the scheduled bills alone would take below zero in the next month (everyday
 * spending comes on top, so this is the optimistic case).
 */
async function lowBalances(db: Db, ws: WorkspaceCtx, today: IsoDate): Promise<Insight[]> {
  const occurrences = await scheduledOccurrences(
    db,
    ws,
    addDays(today, LOW_BALANCE_DAYS),
    LOW_BALANCE_DAYS + 1,
  );
  if (occurrences.length === 0) return [];
  const accounts = (await listAccounts(db, ws)).filter(
    (a) => !a.archived && !LIABILITY_ACCOUNT_TYPES.includes(a.type) && a.balanceMinor >= 0,
  );
  const settings = periodSettings(ws);
  const out: Insight[] = [];
  for (const account of accounts) {
    const changes = occurrences.flatMap((o) => {
      const date = o.date < today ? today : o.date;
      const list: Array<{ date: IsoDate; amount: number }> = [];
      if (o.accountId === account.id)
        list.push({ date, amount: o.kind === 'income' ? o.amountMinor : -o.amountMinor });
      if (o.kind === 'transfer' && o.toAccountId === account.id)
        list.push({ date, amount: o.toAmountMinor ?? o.amountMinor });
      return list;
    });
    if (!changes.some((c) => c.amount < 0)) continue;
    changes.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    let balance = account.balanceMinor;
    let negativeDate: IsoDate | null = null;
    let lowest = { minor: balance, date: today };
    for (const c of changes) {
      balance += c.amount;
      if (balance < 0 && negativeDate === null) negativeDate = c.date;
      if (balance < lowest.minor) lowest = { minor: balance, date: c.date };
    }
    if (negativeDate === null) continue;
    out.push({
      kind: 'low_balance',
      key: `low:${account.id}:${getMonthPeriod(negativeDate, settings).start}`,
      tone: 'warning',
      date: today,
      accountId: account.id,
      currency: account.currency,
      balanceMinor: account.balanceMinor,
      negativeDate,
      lowestMinor: lowest.minor,
      lowestDate: lowest.date,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------

const TONE_ORDER = { warning: 0, info: 1, positive: 2 } as const;

export async function listInsights(db: Db, ws: WorkspaceCtx): Promise<Insights> {
  const today = workspaceToday(ws);
  const [patterns, tracked, dismissed, spending, low] = await Promise.all([
    findPatterns(db, ws, today),
    trackedSeries(db, ws),
    dismissedKeys(db, ws),
    spendingInsights(db, ws, today),
    lowBalances(db, ws, today),
  ]);
  const suggestions = suggestionsFrom(patterns, tracked, dismissed)
    .slice(0, 3)
    .map(
      (suggestion): Insight => ({
        kind: 'new_recurring',
        key: suggestion.dismissKey,
        tone: 'info',
        date: suggestion.lastDate,
        suggestion,
      }),
    );
  const items = [
    ...low,
    ...priceChanges(patterns, tracked, today),
    ...spending.items,
    ...suggestions,
  ]
    .filter((i) => !dismissed.has(i.key))
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.date.localeCompare(a.date));
  return { items, missingRates: spending.missingRates };
}

// ---------------------------------------------------------------------------------------------
// Cash-flow forecast
// ---------------------------------------------------------------------------------------------

/** Money you can spend: what the forecast adds up unless told otherwise. */
const SPENDABLE: readonly AccountType[] = ['cash', 'checking', 'savings', 'e_wallet'];
/** How far back the everyday average looks. */
const EVERYDAY_HISTORY_DAYS = 90;

export async function forecast(
  db: Db,
  ws: WorkspaceCtx,
  query: { days: number; accountIds?: string[] | undefined },
): Promise<Forecast> {
  const today = workspaceToday(ws);
  const until = addDays(today, query.days);
  const all = await listAccounts(db, ws);
  const chosen = query.accountIds?.length
    ? all.filter((a) => query.accountIds!.includes(a.id))
    : all.filter((a) => !a.archived && SPENDABLE.includes(a.type));
  const ids = new Set(chosen.map((a) => a.id));
  const missing = new Set<string>();
  let startMinor = 0;
  for (const a of chosen) {
    if (a.balanceBaseMinor === null) missing.add(a.currency);
    else startMinor += a.balanceBaseMinor;
  }

  // Scheduled items (converted at today's rates).
  const occurrences = ids.size ? await scheduledOccurrences(db, ws, until, query.days + 1) : [];
  const events: Forecast['events'] = [];
  const scheduleRates = await loadRateBook(
    db,
    ws.id,
    occurrences.flatMap((o) => [o.currency, o.toCurrency ?? o.currency]),
    ws.baseCurrency,
    today,
    today,
  );
  const toBase = (minor: number, currency: string) =>
    scheduleRates.convert(minor, currency, ws.baseCurrency, today);
  for (const o of occurrences) {
    let delta = 0;
    if (ids.has(o.accountId)) {
      delta += toBase(o.kind === 'income' ? o.amountMinor : -o.amountMinor, o.currency) ?? 0;
    }
    if (o.kind === 'transfer' && o.toAccountId && ids.has(o.toAccountId)) {
      delta += toBase(o.toAmountMinor ?? o.amountMinor, o.toCurrency ?? o.currency) ?? 0;
    }
    if (delta === 0) continue;
    events.push({
      date: o.date < today ? today : o.date,
      recurringId: o.recurringId,
      name: o.name,
      kind: o.kind,
      amountMinor: delta,
      variableAmount: o.variableAmount,
      overdue: o.overdue,
    });
  }
  for (const c of scheduleRates.missing) missing.add(c);

  // Everyday money in and out: what isn't scheduled (or paid to someone who has a schedule now),
  // and isn't a transfer between the chosen accounts, over the last few months.
  const idList = [...ids];
  let everyday = { mean: 0, sd: 0 };
  let historyDays = 0;
  if (idList.length) {
    const ids = sql.join(
      idList.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const [first] = (
      await db.execute<{ first: string | null }>(sql`
        select min(date)::text as first from transactions
        where workspace_id = ${ws.id} and deleted_at is null and account_id in (${ids})
      `)
    ).rows;
    const from = first?.first
      ? first.first > addDays(today, -EVERYDAY_HISTORY_DAYS)
        ? first.first
        : addDays(today, -EVERYDAY_HISTORY_DAYS)
      : today;
    historyDays = diffDays(from, today);
    if (historyDays >= 7) {
      const rows = (
        await db.execute<{ date: string; currency: string; amount: string }>(sql`
          select t.date::text as date, a.currency, sum(t.amount_minor)::text as amount
          from transactions t
          join accounts a on a.id = t.account_id
          where t.workspace_id = ${ws.id}
            and t.deleted_at is null
            and t.recurring_id is null
            and t.account_id in (${ids})
            -- Past payments to a payee that now has a schedule are in the schedule already.
            and not exists (
              select 1 from recurring r
              where r.workspace_id = t.workspace_id
                and r.active and r.next_date is not null
                and r.payee_id = t.payee_id
            )
            and t.date >= ${from} and t.date < ${today}
            and not exists (
              select 1 from transactions o
              where t.transfer_group_id is not null
                and o.transfer_group_id = t.transfer_group_id
                and o.id <> t.id
                and o.deleted_at is null
                and o.account_id in (${ids})
            )
          group by t.date, a.currency
        `)
      ).rows;
      const rates = await loadRateBook(
        db,
        ws.id,
        rows.map((r) => r.currency),
        ws.baseCurrency,
        from,
        today,
      );
      const daily = Array.from({ length: historyDays }, () => 0);
      for (const r of rows) {
        const minor = rates.convert(Number(r.amount), r.currency, ws.baseCurrency, r.date);
        const i = diffDays(from, r.date);
        if (minor !== null && i >= 0 && i < historyDays) daily[i]! += minor;
      }
      for (const c of rates.missing) missing.add(c);
      everyday = meanAndSd(daily);
    }
  }

  const points = projectBalance(
    startMinor,
    query.days,
    events.map((e) => ({ day: diffDays(today, e.date), amountMinor: e.amountMinor })),
    everyday,
  ).map((p) => ({
    date: addDays(today, p.day),
    expectedMinor: p.expectedMinor,
    lowMinor: p.lowMinor,
    highMinor: p.highMinor,
  }));
  const lowest = points.reduce((min, p) => (p.expectedMinor < min.expectedMinor ? p : min));
  return {
    currency: ws.baseCurrency,
    today,
    accountIds: idList,
    startMinor,
    everydayPerDayMinor: Math.round(everyday.mean),
    historyDays,
    points,
    events,
    lowest: { date: lowest.date, expectedMinor: lowest.expectedMinor },
    missingRates: [...missing],
  };
}

// ---------------------------------------------------------------------------------------------
// Heads-up notifications (daily)
// ---------------------------------------------------------------------------------------------

const money = (minor: number, currency: string) =>
  formatMoney(minor, currency, {
    grouping: currency === 'NPR' || currency === 'INR' ? 'lakh' : 'international',
    trimZeroFraction: true,
  });

/** Low balances ahead and price changes, as notifications for `ws.userId`. */
export async function headsUpCandidates(db: Db, ws: WorkspaceCtx): Promise<Candidate[]> {
  const today = workspaceToday(ws);
  const [patterns, tracked, dismissed, low, accounts] = await Promise.all([
    findPatterns(db, ws, today),
    trackedSeries(db, ws),
    dismissedKeys(db, ws),
    lowBalances(db, ws, today),
    listAccounts(db, ws),
  ]);
  const dateLabel = (date: IsoDate) =>
    ws.calendar === 'bs' ? formatBsDate(date, { style: 'short' }) : formatAdDate(date, 'short');
  const out: Candidate[] = [];
  for (const i of [...low, ...priceChanges(patterns, tracked, today)]) {
    if (dismissed.has(i.key)) continue;
    if (i.kind === 'low_balance') {
      const name = accounts.find((a) => a.id === i.accountId)?.name ?? 'An account';
      out.push({
        kind: 'insight',
        title: `${name} may run short`,
        body: `Upcoming bills would take it to ${money(i.lowestMinor, i.currency)} by ${dateLabel(i.lowestDate)}.`,
        link: '/insights',
        dedupeKey: i.key,
      });
    } else if (i.kind === 'price_change' && i.flow === 'expense') {
      const up = i.toMinor > i.fromMinor;
      out.push({
        kind: 'insight',
        title: `${i.payeeName} ${up ? 'went up' : 'went down'} to ${money(i.toMinor, i.currency)}`,
        body: `It used to be ${money(i.fromMinor, i.currency)}.`,
        link: '/insights',
        dedupeKey: i.key,
      });
    }
  }
  return out;
}

/** Checks every workspace member for heads-ups. Runs once a day. */
export async function runHeadsUp(db: Db, logger?: Logger) {
  let created = 0;
  for (const ws of await memberContexts(db)) {
    try {
      created += await deliver(db, ws.id, await headsUpCandidates(db, ws), [ws.userId]);
    } catch (err) {
      logger?.warn({ err, workspaceId: ws.id }, 'could not check workspace for heads-ups');
    }
  }
  if (created) logger?.info({ created }, 'heads-up notifications created');
  return created;
}
