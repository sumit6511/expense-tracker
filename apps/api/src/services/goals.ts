import {
  type Goal,
  type GoalBody,
  GoalBodySchema,
  getCurrency,
  getMonthPeriod,
  goalPlan,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { categories, categoryGroups, goals } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { listAccounts, requireAccount } from './accounts';
import { budgetOverview, setRollover } from './budgets';
import { periodSettings } from './reports';
import { workspaceToday } from './transactions';
import { isHidden, type Scope, visibleAccount } from './visibility';

type Row = typeof goals.$inferSelect;

async function toDtos(db: Db, ws: WorkspaceCtx, rows: Row[]): Promise<Goal[]> {
  if (rows.length === 0) return [];
  const today = workspaceToday(ws);
  const settings = periodSettings(ws);
  const unit = 10 ** getCurrency(ws.baseCurrency).digits;
  const needsAccounts = rows.some((r) => r.kind === 'account');
  const needsCategories = rows.some((r) => r.kind === 'category');
  const balances = needsAccounts
    ? new Map((await listAccounts(db, ws)).map((a) => [a.id, a.balanceBaseMinor ?? 0]))
    : new Map<string, number>();
  const available = needsCategories
    ? new Map(
        (await budgetOverview(db, ws, getMonthPeriod(today, settings))).lines.map((l) => [
          l.categoryId,
          // What the fund holds now: everything carried in plus this month's budget, less spending.
          l.remainingMinor,
        ]),
      )
    : new Map<string, number>();
  return rows.map((r) => {
    const current =
      r.kind === 'account'
        ? ((r.accountId ? balances.get(r.accountId) : 0) ?? 0)
        : r.kind === 'category'
          ? ((r.categoryId ? available.get(r.categoryId) : 0) ?? 0)
          : r.savedMinor;
    const plan = goalPlan(r.targetMinor, current, today, r.targetDate, settings);
    // Suggest whole rupees (or dollars) a month, rounded up so the target is still met.
    if (plan.monthlyNeededMinor !== null)
      plan.monthlyNeededMinor = Math.ceil(plan.monthlyNeededMinor / unit) * unit;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      targetMinor: r.targetMinor,
      targetDate: r.targetDate,
      accountId: r.accountId,
      categoryId: r.categoryId,
      icon: r.icon,
      color: r.color,
      archived: r.archivedAt !== null,
      currentMinor: current,
      progress: Math.min(1, Math.max(0, current / r.targetMinor)),
      ...plan,
      reached: current >= r.targetMinor,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function requireRow(db: Executor, scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.workspaceId, scope.id), eq(goals.id, id)))
    .limit(1);
  // A goal tracking someone else's private account is private too.
  if (!row || isHidden(scope, row.accountId)) throw notFound('Goal');
  return row;
}

export async function listGoals(db: Db, ws: WorkspaceCtx) {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.workspaceId, ws.id), visibleAccount(ws, goals.accountId)))
    .orderBy(sql`${goals.archivedAt} is not null`, asc(goals.targetDate), asc(goals.createdAt));
  return toDtos(db, ws, rows);
}

export async function getGoal(db: Db, ws: WorkspaceCtx, id: string) {
  const [dto] = await toDtos(db, ws, [await requireRow(db, ws, id)]);
  return dto!;
}

async function checkRefs(db: Executor, ws: WorkspaceCtx, body: GoalBody) {
  if (body.kind === 'account')
    await requireAccount(db, ws, body.accountId!, { allowArchived: true });
  if (body.kind === 'category') {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(
        and(
          eq(categories.workspaceId, ws.id),
          eq(categories.id, body.categoryId!),
          eq(categoryGroups.kind, 'expense'),
        ),
      );
    if (!cat) throw badRequest('Choose an expense category for a savings fund');
  }
}

function columns(body: GoalBody) {
  return {
    name: body.name,
    kind: body.kind,
    targetMinor: body.targetMinor,
    targetDate: body.targetDate,
    accountId: body.kind === 'account' ? body.accountId : null,
    categoryId: body.kind === 'category' ? body.categoryId : null,
    savedMinor: body.kind === 'manual' ? body.savedMinor : 0,
    icon: body.icon,
    color: body.color,
    archivedAt: body.archived ? new Date() : null,
  };
}

export async function createGoal(db: Db, ws: WorkspaceCtx, body: GoalBody) {
  await checkRefs(db, ws, body);
  const id = uuidv7();
  await db.insert(goals).values({ id, workspaceId: ws.id, ...columns(body) });
  // A savings fund keeps what's left each month, so turn on rollover for its category.
  if (body.kind === 'category') await ensureRollover(db, ws, body.categoryId!);
  return getGoal(db, ws, id);
}

async function ensureRollover(db: Db, ws: WorkspaceCtx, categoryId: string) {
  const [cat] = await db
    .select({ rollover: categories.budgetRollover })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (cat?.rollover === 'none') await setRollover(db, ws, { categoryId, mode: 'surplus' });
}

export async function updateGoal(db: Db, ws: WorkspaceCtx, id: string, patch: Partial<GoalBody>) {
  const row = await requireRow(db, ws, id);
  const parsed = GoalBodySchema.safeParse({
    name: row.name,
    kind: row.kind,
    targetMinor: row.targetMinor,
    targetDate: row.targetDate,
    accountId: row.accountId,
    categoryId: row.categoryId,
    savedMinor: row.savedMinor,
    icon: row.icon,
    color: row.color,
    archived: row.archivedAt !== null,
    ...patch,
  });
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid goal');
  await checkRefs(db, ws, parsed.data);
  const { archivedAt, ...rest } = columns(parsed.data);
  await db
    .update(goals)
    .set({
      ...rest,
      // Keep the original archive time when it stays archived.
      archivedAt: parsed.data.archived ? (row.archivedAt ?? archivedAt) : null,
    })
    .where(eq(goals.id, id));
  if (parsed.data.kind === 'category') await ensureRollover(db, ws, parsed.data.categoryId!);
  return getGoal(db, ws, id);
}

export async function deleteGoal(db: Db, scope: Scope, id: string) {
  await requireRow(db, scope, id);
  await db.delete(goals).where(and(eq(goals.workspaceId, scope.id), eq(goals.id, id)));
}

/** Adds to (or takes from) a manual goal's saved amount. */
export async function contribute(db: Db, ws: WorkspaceCtx, id: string, amountMinor: number) {
  const row = await requireRow(db, ws, id);
  if (row.kind !== 'manual')
    throw badRequest('This goal follows an account or category; add money there instead');
  await db
    .update(goals)
    .set({ savedMinor: sql`greatest(0, ${goals.savedMinor} + ${amountMinor})` })
    .where(eq(goals.id, id));
  return getGoal(db, ws, id);
}
