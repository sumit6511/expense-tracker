import {
  addDays,
  type BudgetVsActual,
  type CashFlow,
  type CategoryTrends,
  type Dashboard,
  daysLeftInPeriod,
  formatMonthPeriod,
  getMonthPeriod,
  type IsoDate,
  listMonthPeriods,
  type MonthPeriod,
  type PeriodDto,
  type PeriodSettings,
  rangeLength,
  type SpendingByCategory,
  shiftMonthPeriod,
  todayIn,
} from '@et/shared';
import { and, eq, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import {
  accounts,
  budgets,
  categories,
  categoryGroups,
  transactionSplits,
  transactions,
} from '../db/schema';
import { badRequest } from '../lib/errors';
import { budgetOverview } from './budgets';
import { loadRateBook } from './rates';

export function periodSettings(ws: WorkspaceCtx): PeriodSettings {
  return { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
}

export function toPeriodDto(p: MonthPeriod): PeriodDto {
  return { ...p, label: formatMonthPeriod(p) };
}

/** Money movement on one day for one category, in the base currency. */
export interface Flow {
  date: IsoDate;
  categoryId: string | null;
  /** Spending (positive = money spent; refunds make it smaller, possibly negative). */
  expense: number;
  /** Income (positive = money received). */
  income: number;
  count: number;
}

export interface FlowOptions {
  from: IsoDate;
  to: IsoDate;
  accountIds?: string[] | undefined;
  /** Only accounts marked "include in budget". */
  onBudgetOnly?: boolean;
}

/**
 * Sums split lines per day, category and currency, then converts each day's totals to the base
 * currency at that day's rate. Transfers are excluded (they have no splits). A split counts as
 * spending or income by its category group; uncategorized lines count by their sign.
 */
export async function loadFlows(
  db: Executor,
  ws: WorkspaceCtx,
  options: FlowOptions,
): Promise<{ flows: Flow[]; missingRates: string[] }> {
  if (options.from > options.to) throw badRequest('"from" must not be after "to"');
  const where: SQL[] = [
    eq(transactions.workspaceId, ws.id),
    isNull(transactions.deletedAt),
    isNull(transactions.transferGroupId),
    gte(transactions.date, options.from),
    lte(transactions.date, options.to),
  ];
  const ids = options.accountIds?.filter((id) => id !== 'none');
  if (ids?.length) where.push(inArray(transactions.accountId, ids));
  if (options.onBudgetOnly) where.push(eq(accounts.onBudget, true));

  const rows = await db
    .select({
      date: transactions.date,
      currency: accounts.currency,
      categoryId: transactionSplits.categoryId,
      kind: categoryGroups.kind,
      amount: sql<number>`sum(${transactionSplits.amountMinor})::bigint`,
      negative: sql<number>`coalesce(sum(${transactionSplits.amountMinor}) filter (where ${transactionSplits.amountMinor} < 0), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactionSplits)
    .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactionSplits.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(...where))
    .groupBy(
      transactions.date,
      accounts.currency,
      transactionSplits.categoryId,
      categoryGroups.kind,
    );

  const rates = await loadRateBook(
    db,
    ws.id,
    rows.map((r) => r.currency),
    ws.baseCurrency,
    options.from,
    options.to,
  );
  const flows: Flow[] = [];
  for (const r of rows) {
    const toBase = (minor: number) => rates.convert(minor, r.currency, ws.baseCurrency, r.date);
    const amount = toBase(Number(r.amount));
    if (amount === null) continue;
    let expense = 0;
    let income = 0;
    if (r.kind === 'expense') expense = -amount;
    else if (r.kind === 'income') income = amount;
    else {
      // Uncategorized: money out is spending, money in is income.
      const out = toBase(Number(r.negative)) ?? 0;
      expense = -out;
      income = amount - out;
    }
    flows.push({ date: r.date, categoryId: r.categoryId, expense, income, count: Number(r.count) });
  }
  return { flows, missingRates: [...rates.missing] };
}

function sumBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number) {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + value(item));
  return out;
}

const NULL_KEY = '∅';

export async function spendingByCategory(
  db: Db,
  ws: WorkspaceCtx,
  options: FlowOptions,
): Promise<SpendingByCategory> {
  const { flows, missingRates } = await loadFlows(db, ws, options);
  const categoryKey = (f: Flow) => f.categoryId ?? NULL_KEY;
  const counts = sumBy(flows, categoryKey, (f) => f.count);
  const toList = (totals: Map<string, number>) =>
    [...totals]
      .filter(([, amount]) => amount !== 0)
      .map(([key, amount]) => ({
        categoryId: key === NULL_KEY ? null : key,
        amountMinor: amount,
        count: counts.get(key) ?? 0,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);
  const expense = toList(sumBy(flows, categoryKey, (f) => f.expense));
  const income = toList(sumBy(flows, categoryKey, (f) => f.income));
  return {
    currency: ws.baseCurrency,
    expense,
    income,
    totalExpenseMinor: expense.reduce((s, e) => s + e.amountMinor, 0),
    totalIncomeMinor: income.reduce((s, e) => s + e.amountMinor, 0),
    missingRates,
  };
}

function periodIndexer(periods: MonthPeriod[]) {
  return (date: IsoDate) => periods.findIndex((p) => date >= p.start && date <= p.end);
}

export async function cashFlow(db: Db, ws: WorkspaceCtx, options: FlowOptions): Promise<CashFlow> {
  const periods = listMonthPeriods(options.from, options.to, periodSettings(ws));
  if (periods.length > 120) throw badRequest('Choose a range of at most 10 years');
  const range = { ...options, from: periods[0]!.start, to: periods.at(-1)!.end };
  const { flows, missingRates } = await loadFlows(db, ws, range);
  const indexOf = periodIndexer(periods);
  const totals = periods.map(() => ({ income: 0, expense: 0 }));
  for (const f of flows) {
    const t = totals[indexOf(f.date)];
    if (!t) continue;
    t.income += f.income;
    t.expense += f.expense;
  }
  return {
    currency: ws.baseCurrency,
    periods: periods.map((p, i) => ({
      ...toPeriodDto(p),
      incomeMinor: totals[i]!.income,
      expenseMinor: totals[i]!.expense,
      netMinor: totals[i]!.income - totals[i]!.expense,
    })),
    missingRates,
  };
}

export async function categoryTrends(
  db: Db,
  ws: WorkspaceCtx,
  options: FlowOptions,
): Promise<CategoryTrends> {
  const periods = listMonthPeriods(options.from, options.to, periodSettings(ws));
  if (periods.length > 60) throw badRequest('Choose a range of at most 5 years');
  const { flows, missingRates } = await loadFlows(db, ws, {
    ...options,
    from: periods[0]!.start,
    to: periods.at(-1)!.end,
  });
  const indexOf = periodIndexer(periods);
  const series = new Map<string, number[]>();
  for (const f of flows) {
    if (f.expense === 0) continue;
    const key = f.categoryId ?? NULL_KEY;
    const values = series.get(key) ?? periods.map(() => 0);
    const i = indexOf(f.date);
    if (i >= 0) values[i]! += f.expense;
    series.set(key, values);
  }
  return {
    currency: ws.baseCurrency,
    periods: periods.map(toPeriodDto),
    series: [...series]
      .map(([key, valuesMinor]) => ({ categoryId: key === NULL_KEY ? null : key, valuesMinor }))
      .sort(
        (a, b) =>
          b.valuesMinor.reduce((s, v) => s + v, 0) - a.valuesMinor.reduce((s, v) => s + v, 0),
      ),
    missingRates,
  };
}

export async function budgetTotalsByPeriod(db: Executor, workspaceId: string, starts: IsoDate[]) {
  if (starts.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ start: budgets.periodStart, total: sql<number>`sum(${budgets.amountMinor})::bigint` })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, workspaceId), inArray(budgets.periodStart, starts)))
    .groupBy(budgets.periodStart);
  return new Map(rows.map((r) => [r.start, Number(r.total)]));
}

export async function budgetVsActual(
  db: Db,
  ws: WorkspaceCtx,
  date: IsoDate,
  count: number,
): Promise<BudgetVsActual> {
  const settings = periodSettings(ws);
  const current = getMonthPeriod(date, settings);
  const periods = Array.from({ length: count }, (_, i) =>
    shiftMonthPeriod(current, i - count + 1, settings),
  );
  const { flows } = await loadFlows(db, ws, {
    from: periods[0]!.start,
    to: current.end,
    onBudgetOnly: true,
  });
  const indexOf = periodIndexer(periods);
  const spent = periods.map(() => 0);
  for (const f of flows) {
    const i = indexOf(f.date);
    if (i >= 0) spent[i]! += f.expense;
  }
  const budgeted = await budgetTotalsByPeriod(
    db,
    ws.id,
    periods.map((p) => p.start),
  );
  return {
    currency: ws.baseCurrency,
    periods: periods.map((p, i) => ({
      ...toPeriodDto(p),
      budgetedMinor: budgeted.get(p.start) ?? 0,
      spentMinor: spent[i]!,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

export async function dashboard(
  db: Db,
  ws: WorkspaceCtx,
  requestedDate?: IsoDate,
): Promise<Dashboard> {
  const today = todayIn(ws.timezone);
  const date = requestedDate ?? today;
  const settings = periodSettings(ws);
  const period = getMonthPeriod(date, settings);
  const previous = shiftMonthPeriod(period, -1, settings);

  const { flows, missingRates } = await loadFlows(db, ws, { from: previous.start, to: period.end });
  const { flows: budgetFlows } = await loadFlows(db, ws, {
    from: period.start,
    to: period.end,
    onBudgetOnly: true,
  });

  const inPeriod = flows.filter((f) => f.date >= period.start && f.date <= period.end);
  const inPrevious = flows.filter((f) => f.date >= previous.start && f.date <= previous.end);
  // Compare against the same number of days into the previous period.
  const elapsed =
    today >= period.start && today <= period.end
      ? rangeLength({ start: period.start, end: today })
      : null;
  const previousCutoff = elapsed ? addDays(previous.start, elapsed - 1) : previous.end;

  const sum = (list: Flow[], pick: (f: Flow) => number) => list.reduce((s, f) => s + pick(f), 0);
  const income = sum(inPeriod, (f) => f.income);
  const expense = sum(inPeriod, (f) => f.expense);

  const byCategory = sumBy(
    inPeriod,
    (f) => f.categoryId ?? NULL_KEY,
    (f) => f.expense,
  );
  const counts = sumBy(
    inPeriod,
    (f) => f.categoryId ?? NULL_KEY,
    (f) => f.count,
  );
  const topCategories = [...byCategory]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, amountMinor]) => ({
      categoryId: key === NULL_KEY ? null : key,
      amountMinor,
      count: counts.get(key) ?? 0,
    }));

  const daily = sumBy(
    inPeriod,
    (f) => f.date,
    (f) => f.expense,
  );
  const dailyExpense: Dashboard['dailyExpense'] = [];
  for (
    let d = period.start;
    d <= period.end && d <= (today > period.end ? period.end : today);
    d = addDays(d, 1)
  ) {
    dailyExpense.push({ date: d, amountMinor: daily.get(d) ?? 0 });
  }

  // "Left to spend" follows the monthly limit when there is one, else the category budgets
  // (including what rolled over from earlier months).
  const overview = await budgetOverview(db, ws, period);
  const categoryBudget = overview.totals.budgetedMinor + overview.totals.carryInMinor;
  const source = overview.cap ? 'cap' : categoryBudget > 0 ? 'categories' : 'none';
  const budgeted = overview.cap ? overview.cap.amountMinor : Math.max(0, categoryBudget);
  const budgetSpent = sum(budgetFlows, (f) => f.expense);
  const remaining = budgeted - budgetSpent;
  const daysLeft = daysLeftInPeriod(period, today);

  const [counters] = await db
    .execute<{ uncategorized: number; review: number }>(sql`
    select
      count(*) filter (where exists (
        select 1 from ${transactionSplits} s where s.transaction_id = t.id and s.category_id is null
      ))::int as uncategorized,
      count(*) filter (where t.needs_review)::int as review
    from ${transactions} t
    where t.workspace_id = ${ws.id} and t.deleted_at is null and t.transfer_group_id is null
  `)
    .then((r) => r.rows);

  return {
    today,
    currency: ws.baseCurrency,
    period: toPeriodDto(period),
    daysLeft,
    budget: {
      budgetedMinor: budgeted,
      spentMinor: budgetSpent,
      remainingMinor: remaining,
      source,
      safePerDayMinor:
        budgeted > 0 && daysLeft > 0 ? Math.max(0, Math.floor(remaining / daysLeft)) : null,
    },
    cashFlow: { incomeMinor: income, expenseMinor: expense, netMinor: income - expense },
    previousPeriodExpenseMinor: sum(inPrevious, (f) => f.expense),
    previousPeriodToDateExpenseMinor: sum(
      inPrevious.filter((f) => f.date <= previousCutoff),
      (f) => f.expense,
    ),
    topCategories,
    dailyExpense,
    netWorthMinor: await netWorth(db, ws, today),
    uncategorizedCount: Number(counters?.uncategorized ?? 0),
    needsReviewCount: Number(counters?.review ?? 0),
    missingRates,
  };
}

/** Sum of balances of accounts included in net worth, in the base currency at `date`'s rates. */
export async function netWorth(db: Executor, ws: WorkspaceCtx, date: IsoDate): Promise<number> {
  const rows = await db
    .select({
      currency: accounts.currency,
      balance: sql<number>`(${accounts.openingBalanceMinor} + coalesce(sum(${transactions.amountMinor}), 0))::bigint`,
    })
    .from(accounts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, accounts.id),
        isNull(transactions.deletedAt),
        lte(transactions.date, date),
      ),
    )
    .where(and(eq(accounts.workspaceId, ws.id), eq(accounts.inNetWorth, true)))
    .groupBy(accounts.id);
  const rates = await loadRateBook(
    db,
    ws.id,
    rows.map((r) => r.currency),
    ws.baseCurrency,
    date,
    date,
  );
  return rows.reduce(
    (total, r) =>
      total + (rates.convert(Number(r.balance), r.currency, ws.baseCurrency, date) ?? 0),
    0,
  );
}
