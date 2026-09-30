import {
  type BudgetMonth,
  carryForward,
  getCurrency,
  getMonthPeriod,
  type IsoDate,
  listMonthPeriods,
  type MonthPeriod,
  maxDate,
  type SetRolloverSchema,
  shiftMonthPeriod,
  todayIn,
  uuidv7,
} from '@et/shared';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { budgetCaps, budgets, categories, categoryGroups } from '../db/schema';
import { badRequest } from '../lib/errors';
import { loadFlows, periodSettings, toPeriodDto } from './reports';

/** Budget periods are identified by their first day; reject dates that aren't one. */
function requirePeriodStart(ws: WorkspaceCtx, start: IsoDate): MonthPeriod {
  const period = getMonthPeriod(start, periodSettings(ws));
  if (period.start !== start) {
    throw badRequest(
      `${start} is not the first day of a budget month (that month starts ${period.start})`,
    );
  }
  return period;
}

async function expenseCategoryIds(db: Executor, workspaceId: string) {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(eq(categories.workspaceId, workspaceId), eq(categoryGroups.kind, 'expense')));
  return rows.map((r) => r.id);
}

/** Spending per category for each period, from budgeted (on-budget) accounts only. */
async function spendingByPeriod(db: Executor, ws: WorkspaceCtx, periods: MonthPeriod[]) {
  const from = periods.reduce((min, p) => (p.start < min ? p.start : min), periods[0]!.start);
  const to = periods.reduce((max, p) => (p.end > max ? p.end : max), periods[0]!.end);
  const { flows } = await loadFlows(db, ws, { from, to, onBudgetOnly: true });
  return periods.map((p) => {
    const totals = new Map<string | null, number>();
    for (const f of flows) {
      if (f.date < p.start || f.date > p.end || f.expense === 0) continue;
      totals.set(f.categoryId, (totals.get(f.categoryId) ?? 0) + f.expense);
    }
    return totals;
  });
}

// Rollover looks back at most this many months.
const MAX_ROLLOVER_MONTHS = 36;

/** The monthly limit in force in `period` (the latest one set at or before it). */
async function capFor(db: Executor, workspaceId: string, period: MonthPeriod) {
  const [row] = await db
    .select({ amount: budgetCaps.amountMinor, start: budgetCaps.periodStart })
    .from(budgetCaps)
    .where(and(eq(budgetCaps.workspaceId, workspaceId), lte(budgetCaps.periodStart, period.start)))
    .orderBy(desc(budgetCaps.periodStart))
    .limit(1);
  return row && row.amount > 0 ? row : null;
}

/**
 * One budget month: what each category has (assigned + carried over), what was spent, and the
 * overall limit. Shared by the budget page and the dashboard.
 */
export async function budgetOverview(db: Executor, ws: WorkspaceCtx, period: MonthPeriod) {
  const settings = periodSettings(ws);
  const cats = await db
    .select({
      id: categories.id,
      rollover: categories.budgetRollover,
      since: categories.rolloverSince,
    })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(eq(categories.workspaceId, ws.id), eq(categoryGroups.kind, 'expense')));

  // Look back far enough for the 3-month average and every rollover category's history.
  const oldestAllowed = shiftMonthPeriod(period, -MAX_ROLLOVER_MONTHS, settings).start;
  let from = shiftMonthPeriod(period, -3, settings).start;
  for (const c of cats) {
    if (c.rollover !== 'none' && c.since && c.since < from) from = maxDate(c.since, oldestAllowed);
  }
  const periods = listMonthPeriods(from, period.start, settings);
  const spending = await spendingByPeriod(db, ws, periods);
  const index = periods.length - 1; // `period` itself
  const current = spending[index]!;

  const budgetRows = await db
    .select({
      categoryId: budgets.categoryId,
      start: budgets.periodStart,
      amount: budgets.amountMinor,
    })
    .from(budgets)
    .where(
      and(
        eq(budgets.workspaceId, ws.id),
        gte(budgets.periodStart, periods[0]!.start),
        lte(budgets.periodStart, period.start),
      ),
    );
  const budgetOf = new Map(budgetRows.map((b) => [`${b.categoryId}|${b.start}`, b.amount]));

  const lines = cats.map((c) => {
    const budgeted = budgetOf.get(`${c.id}|${period.start}`) ?? 0;
    const spent = current.get(c.id) ?? 0;
    let carryIn = 0;
    if (c.rollover !== 'none' && c.since && c.since < period.start) {
      const history = periods
        .slice(0, index)
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.end >= c.since!)
        .map(({ p, i }) => ({
          budgetedMinor: budgetOf.get(`${c.id}|${p.start}`) ?? 0,
          spentMinor: spending[i]!.get(c.id) ?? 0,
        }));
      carryIn = carryForward(c.rollover, history);
    }
    const previous = [1, 2, 3].map((n) => spending[index - n]?.get(c.id) ?? 0);
    return {
      categoryId: c.id,
      budgetedMinor: budgeted,
      spentMinor: spent,
      carryInMinor: carryIn,
      availableMinor: budgeted + carryIn,
      remainingMinor: budgeted + carryIn - spent,
      rollover: c.rollover,
      averageMinor: Math.round(previous.reduce((a, b) => a + b, 0) / 3),
      lastPeriodSpentMinor: previous[0]!,
    };
  });

  const totalSpent = [...current.values()].reduce((s, v) => s + v, 0);
  const coveredSpent = lines
    .filter((l) => l.availableMinor !== 0)
    .reduce((s, l) => s + l.spentMinor, 0);
  const totalBudgeted = lines.reduce((s, l) => s + l.budgetedMinor, 0);
  const totalCarry = lines.reduce((s, l) => s + l.carryInMinor, 0);
  const cap = await capFor(db, ws.id, period);
  return {
    lines,
    totals: {
      budgetedMinor: totalBudgeted,
      carryInMinor: totalCarry,
      spentMinor: totalSpent,
      remainingMinor: totalBudgeted + totalCarry - totalSpent,
      unbudgetedSpentMinor: totalSpent - coveredSpent,
    },
    cap: cap
      ? {
          amountMinor: cap.amount,
          sincePeriodStart: cap.start,
          spentMinor: totalSpent,
          remainingMinor: cap.amount - totalSpent,
        }
      : null,
  };
}

export async function getBudgetMonth(
  db: Db,
  ws: WorkspaceCtx,
  date: IsoDate,
): Promise<BudgetMonth> {
  const period = getMonthPeriod(date, periodSettings(ws));
  const overview = await budgetOverview(db, ws, period);
  const { flows } = await loadFlows(db, ws, {
    from: period.start,
    to: period.end,
    onBudgetOnly: true,
  });
  return {
    period: toPeriodDto(period),
    currency: ws.baseCurrency,
    totals: { ...overview.totals, incomeMinor: flows.reduce((s, f) => s + f.income, 0) },
    cap: overview.cap,
    lines: overview.lines,
  };
}

/** Turns rollover on or off for a category. */
export async function setRollover(
  db: Db,
  ws: WorkspaceCtx,
  input: z.output<typeof SetRolloverSchema>,
) {
  const [row] = await db
    .select({
      id: categories.id,
      rollover: categories.budgetRollover,
      since: categories.rolloverSince,
    })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(
      and(
        eq(categories.workspaceId, ws.id),
        eq(categories.id, input.categoryId),
        eq(categoryGroups.kind, 'expense'),
      ),
    );
  if (!row) throw badRequest('Rollover can only be set for expense categories');
  const settings = periodSettings(ws);
  const since =
    input.mode === 'none'
      ? null
      : input.fromPeriodStart
        ? requirePeriodStart(ws, input.fromPeriodStart).start
        : row.rollover !== 'none' && row.since
          ? row.since
          : getMonthPeriod(todayIn(ws.timezone), settings).start;
  await db
    .update(categories)
    .set({ budgetRollover: input.mode, rolloverSince: since })
    .where(eq(categories.id, row.id));
}

/** Sets the overall monthly limit from `periodStart` on (0 removes it from then on). */
export async function setBudgetCap(
  db: Db,
  ws: WorkspaceCtx,
  periodStart: IsoDate,
  amountMinor: number,
) {
  requirePeriodStart(ws, periodStart);
  await db
    .insert(budgetCaps)
    .values({ id: uuidv7(), workspaceId: ws.id, periodStart, amountMinor })
    .onConflictDoUpdate({
      target: [budgetCaps.workspaceId, budgetCaps.periodStart],
      set: { amountMinor, updatedAt: new Date() },
    });
}

async function upsertBudgets(
  db: Executor,
  workspaceId: string,
  periodStart: IsoDate,
  items: Array<{ categoryId: string; amountMinor: number }>,
) {
  const zero = items.filter((i) => i.amountMinor === 0).map((i) => i.categoryId);
  const set = items.filter((i) => i.amountMinor > 0);
  if (zero.length) {
    await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.workspaceId, workspaceId),
          eq(budgets.periodStart, periodStart),
          inArray(budgets.categoryId, zero),
        ),
      );
  }
  if (set.length) {
    await db
      .insert(budgets)
      .values(set.map((i) => ({ id: uuidv7(), workspaceId, periodStart, ...i })))
      .onConflictDoUpdate({
        target: [budgets.workspaceId, budgets.categoryId, budgets.periodStart],
        set: { amountMinor: sql`excluded.amount_minor`, updatedAt: new Date() },
      });
  }
}

export async function setBudgets(
  db: Db,
  ws: WorkspaceCtx,
  periodStart: IsoDate,
  items: Array<{ categoryId: string; amountMinor: number }>,
) {
  requirePeriodStart(ws, periodStart);
  const allowed = new Set(await expenseCategoryIds(db, ws.id));
  if (items.some((i) => !allowed.has(i.categoryId)))
    throw badRequest('Budgets can only be set for expense categories');
  await upsertBudgets(db, ws.id, periodStart, items);
}

async function existingBudgetCategories(db: Executor, workspaceId: string, periodStart: IsoDate) {
  const rows = await db
    .select({ categoryId: budgets.categoryId })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, workspaceId), eq(budgets.periodStart, periodStart)));
  return new Set(rows.map((r) => r.categoryId));
}

/** Copies one month's budgets to another. Existing amounts are kept unless `overwrite`. */
export async function copyBudgets(
  db: Db,
  ws: WorkspaceCtx,
  fromStart: IsoDate,
  toStart: IsoDate,
  overwrite: boolean,
) {
  requirePeriodStart(ws, fromStart);
  requirePeriodStart(ws, toStart);
  if (fromStart === toStart) throw badRequest('Choose a different month to copy from');
  const source = await db
    .select({ categoryId: budgets.categoryId, amountMinor: budgets.amountMinor })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, ws.id), eq(budgets.periodStart, fromStart)));
  const existing = overwrite
    ? new Set<string>()
    : await existingBudgetCategories(db, ws.id, toStart);
  const items = source.filter((s) => !existing.has(s.categoryId));
  await upsertBudgets(db, ws.id, toStart, items);
  return items.length;
}

/** Sets budgets to the average spending of the previous `months` periods. */
export async function fillAverageBudgets(
  db: Db,
  ws: WorkspaceCtx,
  periodStart: IsoDate,
  months: number,
  overwrite: boolean,
) {
  const period = requirePeriodStart(ws, periodStart);
  const settings = periodSettings(ws);
  const history = Array.from({ length: months }, (_, i) =>
    shiftMonthPeriod(period, -(i + 1), settings),
  );
  const spending = await spendingByPeriod(db, ws, history);
  const ids = await expenseCategoryIds(db, ws.id);
  const existing = overwrite
    ? new Set<string>()
    : await existingBudgetCategories(db, ws.id, periodStart);
  const unit = 10 ** getCurrency(ws.baseCurrency).digits;
  const items = ids
    .filter((id) => !existing.has(id))
    .map((categoryId) => {
      const total = spending.reduce((s, m) => s + Math.max(0, m.get(categoryId) ?? 0), 0);
      // Round up to a whole rupee (or dollar) so suggested budgets look like budgets.
      const avg = Math.ceil(total / months / unit) * unit;
      return { categoryId, amountMinor: avg };
    })
    .filter((i) => i.amountMinor > 0);
  await upsertBudgets(db, ws.id, periodStart, items);
  return items.length;
}
