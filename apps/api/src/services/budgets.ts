import {
  type BudgetMonth,
  getCurrency,
  getMonthPeriod,
  type IsoDate,
  type MonthPeriod,
  shiftMonthPeriod,
  uuidv7,
} from '@et/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { budgets, categories, categoryGroups } from '../db/schema';
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

export async function getBudgetMonth(
  db: Db,
  ws: WorkspaceCtx,
  date: IsoDate,
): Promise<BudgetMonth> {
  const settings = periodSettings(ws);
  const period = getMonthPeriod(date, settings);
  const history = [1, 2, 3].map((n) => shiftMonthPeriod(period, -n, settings));
  const [current, ...previous] = await spendingByPeriod(db, ws, [period, ...history]);

  const rows = await db
    .select({ categoryId: budgets.categoryId, amount: budgets.amountMinor })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, ws.id), eq(budgets.periodStart, period.start)));
  const budgeted = new Map(rows.map((r) => [r.categoryId, r.amount]));
  const ids = await expenseCategoryIds(db, ws.id);

  const lines = ids.map((categoryId) => {
    const spent = current!.get(categoryId) ?? 0;
    const amount = budgeted.get(categoryId) ?? 0;
    const history3 = previous.reduce((s, m) => s + (m.get(categoryId) ?? 0), 0);
    return {
      categoryId,
      budgetedMinor: amount,
      spentMinor: spent,
      remainingMinor: amount - spent,
      averageMinor: Math.round(history3 / 3),
      lastPeriodSpentMinor: previous[0]!.get(categoryId) ?? 0,
    };
  });

  const totalSpent = [...current!.values()].reduce((s, v) => s + v, 0);
  const budgetedSpent = lines
    .filter((l) => l.budgetedMinor > 0)
    .reduce((s, l) => s + l.spentMinor, 0);
  const totalBudgeted = lines.reduce((s, l) => s + l.budgetedMinor, 0);
  const { flows } = await loadFlows(db, ws, {
    from: period.start,
    to: period.end,
    onBudgetOnly: true,
  });

  return {
    period: toPeriodDto(period),
    currency: ws.baseCurrency,
    totals: {
      budgetedMinor: totalBudgeted,
      spentMinor: totalSpent,
      remainingMinor: totalBudgeted - totalSpent,
      unbudgetedSpentMinor: totalSpent - budgetedSpent,
      incomeMinor: flows.reduce((s, f) => s + f.income, 0),
    },
    lines,
  };
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
