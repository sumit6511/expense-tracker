import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { WorkspaceCtx } from '../context';
import type { Executor } from '../db/client';
import { accounts, workspaceMembers, workspaces } from '../db/schema';

/**
 * Private accounts: an account can be private to the member who owns it. Everyone else in the
 * workspace doesn't see it, its transactions, or anything built from them (balances, reports,
 * budgets, recurring items, goals, exports). The person asking carries the list of accounts
 * hidden from them; every query over accounts or transactions filters them out.
 *
 * Background jobs, which act for nobody in particular, use `systemScope`, which sees everything.
 */
export type Scope = Pick<WorkspaceCtx, 'id' | 'hiddenAccountIds'>;

/** Everything in a workspace: only for system work, never for a person's request. */
export const systemScope = (workspaceId: string): Scope => ({
  id: workspaceId,
  hiddenAccountIds: [],
});

export const scopeId = (scope: Scope) => scope.id;
export const hiddenIds = (scope: Scope): readonly string[] => scope.hiddenAccountIds;
export const isHidden = (scope: Scope, accountId: string | null | undefined) =>
  !!accountId && hiddenIds(scope).includes(accountId);

/** A condition keeping rows whose account `column` is visible (undefined = no filter needed). */
export function visibleAccount(scope: Scope, column: AnyPgColumn | SQL): SQL | undefined {
  const hidden = hiddenIds(scope);
  // Rows without an account (e.g. a manual goal) are kept: `null <> all(…)` would drop them.
  return hidden.length
    ? sql`(${column} is null or ${column} <> all(${sql.param([...hidden])}::uuid[]))`
    : undefined;
}

/** The same for hand-written SQL: `and <column> is not a hidden account`, or nothing. */
export function visibleAccountSql(scope: Scope, column: SQL): SQL {
  const hidden = hiddenIds(scope);
  return hidden.length
    ? sql` and (${column} is null or ${column} <> all(${sql.param([...hidden])}::uuid[]))`
    : sql``;
}

/** Other members' private accounts in a workspace: what `userId` must not see. */
export async function loadHiddenAccountIds(db: Executor, workspaceId: string, userId: string) {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.workspaceId, workspaceId),
        eq(accounts.visibility, 'private'),
        sql`${accounts.ownerUserId} is distinct from ${userId}`,
      ),
    );
  return rows.map((r) => r.id);
}

/** What a background job sees when it acts for one member (their view, private accounts and all). */
export async function memberContexts(db: Executor): Promise<WorkspaceCtx[]> {
  const rows = await db
    .select({ w: workspaces, userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id));
  const out: WorkspaceCtx[] = [];
  for (const { w, userId, role } of rows) {
    out.push({
      id: w.id,
      name: w.name,
      baseCurrency: w.baseCurrency,
      calendar: w.calendar,
      monthStartDay: w.monthStartDay,
      weekStart: w.weekStart,
      timezone: w.timezone,
      budgetMode: w.budgetMode,
      envelopeSince: w.envelopeSince,
      aiEnabled: w.aiEnabled,
      userId,
      role,
      hiddenAccountIds: await loadHiddenAccountIds(db, w.id, userId),
      createdAt: w.createdAt,
    });
  }
  return out;
}
