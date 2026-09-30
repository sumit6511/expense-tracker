import {
  type CreateSplitGroupSchema,
  computeShares,
  groupBalances,
  pairwiseDebts,
  type SplitExpense,
  type SplitExpenseBodySchema,
  type SplitGroup,
  type SplitGroupSummary,
  type SplitSettlement,
  type SplitSettlementBodySchema,
  simplifyDebts,
  type UpdateSplitGroupSchema,
  uuidv7,
} from '@et/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import {
  splitExpenses,
  splitGroups,
  splitMembers,
  splitSettlements,
  splitShares,
  transactionSplits,
  transactions,
  user,
  workspaceMembers,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAccount } from './accounts';
import { withAudit } from './audit';
import { assertCategoriesExist } from './categories';
import { insertTransaction, softDeleteTransactions } from './transactions';

type GroupRow = typeof splitGroups.$inferSelect;
type MemberRow = typeof splitMembers.$inferSelect;

async function requireGroup(db: Executor, ws: WorkspaceCtx, id: string): Promise<GroupRow> {
  const [row] = await db
    .select()
    .from(splitGroups)
    .where(and(eq(splitGroups.workspaceId, ws.id), eq(splitGroups.id, id)))
    .limit(1);
  if (!row) throw notFound('Group');
  return row;
}

async function membersOf(db: Executor, groupIds: string[]) {
  if (groupIds.length === 0) return [];
  return db
    .select()
    .from(splitMembers)
    .where(inArray(splitMembers.groupId, groupIds))
    .orderBy(asc(splitMembers.createdAt), asc(splitMembers.id));
}

/** Everything that moves balances in these groups. */
async function activityOf(db: Executor, groupIds: string[]) {
  if (groupIds.length === 0) return { expenses: [], shares: [], settlements: [] };
  const [expenses, settlements] = await Promise.all([
    db
      .select()
      .from(splitExpenses)
      .where(inArray(splitExpenses.groupId, groupIds))
      .orderBy(desc(splitExpenses.date), desc(splitExpenses.createdAt)),
    db
      .select()
      .from(splitSettlements)
      .where(inArray(splitSettlements.groupId, groupIds))
      .orderBy(desc(splitSettlements.date), desc(splitSettlements.createdAt)),
  ]);
  const shares = expenses.length
    ? await db
        .select()
        .from(splitShares)
        .where(
          inArray(
            splitShares.expenseId,
            expenses.map((e) => e.id),
          ),
        )
    : [];
  return { expenses, shares, settlements };
}

function balancesFor(members: MemberRow[], activity: Awaited<ReturnType<typeof activityOf>>) {
  const sharesByExpense = Map.groupBy(activity.shares, (s) => s.expenseId);
  const expenses = activity.expenses.map((e) => ({
    paidByMemberId: e.paidByMemberId,
    amountMinor: e.amountMinor,
    shares: (sharesByExpense.get(e.id) ?? []).map((s) => ({
      memberId: s.memberId,
      amountMinor: s.amountMinor,
    })),
  }));
  const settlements = activity.settlements.map((s) => ({
    fromMemberId: s.fromMemberId,
    toMemberId: s.toMemberId,
    amountMinor: s.amountMinor,
  }));
  return {
    expenses,
    settlements,
    net: groupBalances(
      members.map((m) => m.id),
      expenses,
      settlements,
    ),
  };
}

export async function listGroups(db: Db, ws: WorkspaceCtx): Promise<SplitGroupSummary[]> {
  const groups = await db
    .select()
    .from(splitGroups)
    .where(eq(splitGroups.workspaceId, ws.id))
    .orderBy(sql`${splitGroups.archivedAt} is not null`, desc(splitGroups.updatedAt));
  const ids = groups.map((g) => g.id);
  const [members, activity] = await Promise.all([membersOf(db, ids), activityOf(db, ids)]);
  const membersByGroup = Map.groupBy(members, (m) => m.groupId);
  return groups.map((g) => {
    const own = membersByGroup.get(g.id) ?? [];
    const scoped = {
      expenses: activity.expenses.filter((e) => e.groupId === g.id),
      shares: activity.shares,
      settlements: activity.settlements.filter((s) => s.groupId === g.id),
    };
    const { net } = balancesFor(own, scoped);
    const you = own.find((m) => m.userId === ws.userId);
    return {
      id: g.id,
      name: g.name,
      currency: g.currency,
      memberCount: own.length,
      yourBalanceMinor: you ? (net.get(you.id) ?? 0) : null,
      totalSpentMinor: scoped.expenses.reduce((s, e) => s + e.amountMinor, 0),
      archived: g.archivedAt !== null,
      updatedAt: g.updatedAt.toISOString(),
    };
  });
}

export async function getGroup(db: Executor, ws: WorkspaceCtx, id: string): Promise<SplitGroup> {
  const g = await requireGroup(db, ws, id);
  const [members, activity] = await Promise.all([membersOf(db, [id]), activityOf(db, [id])]);
  const { expenses, settlements, net } = balancesFor(members, activity);
  const paid = new Map<string, number>();
  const owes = new Map<string, number>();
  for (const e of expenses) {
    paid.set(e.paidByMemberId, (paid.get(e.paidByMemberId) ?? 0) + e.amountMinor);
    for (const s of e.shares) owes.set(s.memberId, (owes.get(s.memberId) ?? 0) + s.amountMinor);
  }
  const sharesByExpense = Map.groupBy(activity.shares, (s) => s.expenseId);
  const items: Array<SplitExpense | SplitSettlement> = [
    ...activity.expenses.map(
      (e): SplitExpense => ({
        type: 'expense',
        id: e.id,
        date: e.date,
        description: e.description,
        amountMinor: e.amountMinor,
        paidByMemberId: e.paidByMemberId,
        method: e.method,
        shares: (sharesByExpense.get(e.id) ?? []).map((s) => ({
          memberId: s.memberId,
          amountMinor: s.amountMinor,
          value: s.value,
        })),
        linkedTransactionId: e.linkedTransactionId,
        createdAt: e.createdAt.toISOString(),
      }),
    ),
    ...activity.settlements.map(
      (s): SplitSettlement => ({
        type: 'settlement',
        id: s.id,
        date: s.date,
        fromMemberId: s.fromMemberId,
        toMemberId: s.toMemberId,
        amountMinor: s.amountMinor,
        notes: s.notes,
        linkedTransactionId: s.linkedTransactionId,
        createdAt: s.createdAt.toISOString(),
      }),
    ),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return {
    id: g.id,
    name: g.name,
    currency: g.currency,
    simplifyDebts: g.simplifyDebts,
    categoryId: g.categoryId,
    archived: g.archivedAt !== null,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      userId: m.userId,
      you: m.userId === ws.userId,
      balanceMinor: net.get(m.id) ?? 0,
      paidMinor: paid.get(m.id) ?? 0,
      shareMinor: owes.get(m.id) ?? 0,
    })),
    suggested: g.simplifyDebts ? simplifyDebts(net) : pairwiseDebts(expenses, settlements),
    totalSpentMinor: expenses.reduce((s, e) => s + e.amountMinor, 0),
    activity: items,
  };
}

// ---------------------------------------------------------------------------------------------
// Groups and members
// ---------------------------------------------------------------------------------------------

/** People in the workspace a member can be linked to. */
async function assertWorkspaceUsers(db: Executor, ws: WorkspaceCtx, userIds: string[]) {
  if (userIds.length === 0) return;
  const found = await db
    .select({ id: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ws.id), inArray(workspaceMembers.userId, userIds)));
  if (found.length !== new Set(userIds).size)
    throw badRequest('Only people in this workspace can be linked');
}

export async function createGroup(
  db: Db,
  ws: WorkspaceCtx,
  input: z.output<typeof CreateSplitGroupSchema>,
): Promise<SplitGroup> {
  const linked = input.members.flatMap((m) => (m.userId ? [m.userId] : []));
  if (linked.includes(ws.userId)) throw badRequest('You’re added to the group automatically');
  await assertWorkspaceUsers(db, ws, linked);
  if (new Set(linked).size !== linked.length) throw badRequest('Someone is listed twice');
  if (input.categoryId) await assertCategoriesExist(db, ws.id, [input.categoryId]);
  const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, ws.userId));
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(splitGroups).values({
      id,
      workspaceId: ws.id,
      name: input.name,
      currency: input.currency,
      simplifyDebts: input.simplifyDebts,
      categoryId: input.categoryId,
      createdBy: ws.userId,
    });
    // Distinct timestamps keep members in the order they were entered (you first).
    const now = Date.now();
    await tx.insert(splitMembers).values(
      [{ name: me?.name ?? 'You', userId: ws.userId }, ...input.members].map((m, i) => ({
        id: uuidv7(),
        groupId: id,
        name: m.name,
        userId: m.userId ?? null,
        createdAt: new Date(now + i),
      })),
    );
  });
  return getGroup(db, ws, id);
}

export async function updateGroup(
  db: Db,
  ws: WorkspaceCtx,
  id: string,
  input: z.output<typeof UpdateSplitGroupSchema>,
) {
  await requireGroup(db, ws, id);
  if (input.categoryId) await assertCategoriesExist(db, ws.id, [input.categoryId]);
  const { archived, ...rest } = input;
  await db
    .update(splitGroups)
    .set({
      ...rest,
      ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
    })
    .where(eq(splitGroups.id, id));
  return getGroup(db, ws, id);
}

/** Deletes a group and its history. Transactions recorded in your accounts stay. */
export async function deleteGroup(db: Db, ws: WorkspaceCtx, id: string) {
  await requireGroup(db, ws, id);
  await db.delete(splitGroups).where(eq(splitGroups.id, id));
}

async function requireMember(db: Executor, groupId: string, memberId: string) {
  const [row] = await db
    .select()
    .from(splitMembers)
    .where(and(eq(splitMembers.groupId, groupId), eq(splitMembers.id, memberId)));
  if (!row) throw notFound('Member');
  return row;
}

export async function addMember(
  db: Db,
  ws: WorkspaceCtx,
  groupId: string,
  input: { name: string; userId?: string | null },
) {
  await requireGroup(db, ws, groupId);
  if (input.userId) {
    await assertWorkspaceUsers(db, ws, [input.userId]);
    const [taken] = await db
      .select({ id: splitMembers.id })
      .from(splitMembers)
      .where(and(eq(splitMembers.groupId, groupId), eq(splitMembers.userId, input.userId)));
    if (taken) throw conflict('They’re already in this group');
  }
  await db
    .insert(splitMembers)
    .values({ id: uuidv7(), groupId, name: input.name, userId: input.userId ?? null });
  await touch(db, groupId);
  return getGroup(db, ws, groupId);
}

export async function renameMember(
  db: Db,
  ws: WorkspaceCtx,
  groupId: string,
  memberId: string,
  name: string,
) {
  await requireGroup(db, ws, groupId);
  await requireMember(db, groupId, memberId);
  await db.update(splitMembers).set({ name }).where(eq(splitMembers.id, memberId));
  return getGroup(db, ws, groupId);
}

export async function removeMember(db: Db, ws: WorkspaceCtx, groupId: string, memberId: string) {
  await requireGroup(db, ws, groupId);
  await requireMember(db, groupId, memberId);
  const [used] = await db
    .execute<{ n: number }>(sql`
    select (
      (select count(*) from ${splitExpenses} where paid_by_member_id = ${memberId}) +
      (select count(*) from ${splitShares} where member_id = ${memberId}) +
      (select count(*) from ${splitSettlements}
        where from_member_id = ${memberId} or to_member_id = ${memberId})
    )::int as n
  `)
    .then((r) => r.rows);
  if (Number(used?.n) > 0)
    throw conflict('They’re part of expenses or payments here. Remove those first.');
  await db.delete(splitMembers).where(eq(splitMembers.id, memberId));
  await touch(db, groupId);
  return getGroup(db, ws, groupId);
}

const touch = (db: Executor, groupId: string) =>
  db.update(splitGroups).set({ updatedAt: new Date() }).where(eq(splitGroups.id, groupId));

// ---------------------------------------------------------------------------------------------
// Expenses and settlements
// ---------------------------------------------------------------------------------------------

async function assertMembers(db: Executor, groupId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await db
    .select({ id: splitMembers.id, userId: splitMembers.userId })
    .from(splitMembers)
    .where(and(eq(splitMembers.groupId, groupId), inArray(splitMembers.id, unique)));
  if (found.length !== unique.length) throw badRequest('Choose people from this group');
  return new Map(found.map((m) => [m.id, m.userId]));
}

/**
 * Records money moving in the person's own account for a group item: what they paid for the
 * group, or paid/received when settling up. With the group's category, their spending there
 * ends up as their share once everyone has settled.
 */
async function recordInLedger(
  tx: Executor,
  ws: WorkspaceCtx,
  group: GroupRow,
  record: { accountId: string; categoryId?: string | null | undefined },
  entry: { date: string; amountMinor: number; notes: string },
) {
  const account = await requireAccount(tx, ws, record.accountId);
  if (account.currency !== group.currency)
    throw badRequest(`Choose an account in ${group.currency}, the group’s currency`);
  const categoryId = record.categoryId === undefined ? group.categoryId : record.categoryId;
  if (categoryId) await assertCategoriesExist(tx, ws.id, [categoryId]);
  return insertTransaction(
    tx,
    ws.id,
    ws.userId,
    account.currency,
    {
      accountId: account.id,
      date: entry.date,
      amountMinor: entry.amountMinor,
      categoryId,
      notes: entry.notes,
    },
    null,
  );
}

function sharesFor(body: z.output<typeof SplitExpenseBodySchema>) {
  const result = computeShares(
    body.amountMinor,
    body.method,
    body.shares.map((s) => ({ memberId: s.memberId, value: s.value ?? null })),
  );
  if (!result.ok) throw badRequest(result.error);
  return result.shares;
}

export async function createExpense(
  db: Db,
  ws: WorkspaceCtx,
  groupId: string,
  body: z.output<typeof SplitExpenseBodySchema>,
) {
  const group = await requireGroup(db, ws, groupId);
  const shares = sharesFor(body);
  await db.transaction(async (tx) => {
    const users = await assertMembers(tx, groupId, [
      body.paidByMemberId,
      ...shares.map((s) => s.memberId),
    ]);
    let linked: string | null = null;
    if (body.record) {
      if (users.get(body.paidByMemberId) !== ws.userId)
        throw badRequest('Only what you paid can be recorded in your accounts');
      linked = await recordInLedger(tx, ws, group, body.record, {
        date: body.date,
        amountMinor: -body.amountMinor,
        notes: `${body.description} · ${group.name}`,
      });
    }
    const id = uuidv7();
    await tx.insert(splitExpenses).values({
      id,
      groupId,
      date: body.date,
      description: body.description,
      amountMinor: body.amountMinor,
      paidByMemberId: body.paidByMemberId,
      method: body.method,
      linkedTransactionId: linked,
      createdBy: ws.userId,
    });
    await tx.insert(splitShares).values(
      shares.map((s) => ({
        expenseId: id,
        memberId: s.memberId,
        amountMinor: s.amountMinor,
        value:
          body.method === 'equal'
            ? null
            : (body.shares.find((i) => i.memberId === s.memberId)?.value ?? null),
      })),
    );
    await touch(tx, groupId);
  });
  return getGroup(db, ws, groupId);
}

/** Keeps a recorded transaction in step with the group item it came from. */
async function syncLinked(
  tx: Executor,
  ws: WorkspaceCtx,
  transactionId: string | null,
  entry: { date: string; amountMinor: number; notes: string },
) {
  if (!transactionId) return;
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)));
  if (!row || ws.hiddenAccountIds.includes(row.accountId)) return;
  const splits = await tx
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId));
  // Only simple, single-category transactions are updated; a split one was edited by hand.
  if (splits.length !== 1) return;
  await withAudit(tx, ws.id, ws.userId, [transactionId], async () => {
    await tx
      .update(transactions)
      .set({
        date: entry.date,
        amountMinor: entry.amountMinor,
        notes: entry.notes,
        updatedBy: ws.userId,
        version: sql`${transactions.version} + 1`,
      })
      .where(eq(transactions.id, transactionId));
    await tx
      .update(transactionSplits)
      .set({ amountMinor: entry.amountMinor })
      .where(eq(transactionSplits.transactionId, transactionId));
  });
}

async function requireExpense(db: Executor, groupId: string, id: string) {
  const [row] = await db
    .select()
    .from(splitExpenses)
    .where(and(eq(splitExpenses.groupId, groupId), eq(splitExpenses.id, id)));
  if (!row) throw notFound('Expense');
  return row;
}

export async function updateExpense(
  db: Db,
  ws: WorkspaceCtx,
  groupId: string,
  id: string,
  body: z.output<typeof SplitExpenseBodySchema>,
) {
  const group = await requireGroup(db, ws, groupId);
  const existing = await requireExpense(db, groupId, id);
  const shares = sharesFor(body);
  await db.transaction(async (tx) => {
    await assertMembers(tx, groupId, [body.paidByMemberId, ...shares.map((s) => s.memberId)]);
    await tx
      .update(splitExpenses)
      .set({
        date: body.date,
        description: body.description,
        amountMinor: body.amountMinor,
        paidByMemberId: body.paidByMemberId,
        method: body.method,
      })
      .where(eq(splitExpenses.id, id));
    await tx.delete(splitShares).where(eq(splitShares.expenseId, id));
    await tx.insert(splitShares).values(
      shares.map((s) => ({
        expenseId: id,
        memberId: s.memberId,
        amountMinor: s.amountMinor,
        value:
          body.method === 'equal'
            ? null
            : (body.shares.find((i) => i.memberId === s.memberId)?.value ?? null),
      })),
    );
    await syncLinked(tx, ws, existing.linkedTransactionId, {
      date: body.date,
      amountMinor: -body.amountMinor,
      notes: `${body.description} · ${group.name}`,
    });
    await touch(tx, groupId);
  });
  return getGroup(db, ws, groupId);
}

/** Removes an expense; a transaction recorded for it goes to the trash (restorable). */
export async function deleteExpense(db: Db, ws: WorkspaceCtx, groupId: string, id: string) {
  await requireGroup(db, ws, groupId);
  const existing = await requireExpense(db, groupId, id);
  await db.transaction(async (tx) => {
    await tx.delete(splitExpenses).where(eq(splitExpenses.id, id));
    await trashLinked(tx, ws, existing.linkedTransactionId);
    await touch(tx, groupId);
  });
  return getGroup(db, ws, groupId);
}

async function trashLinked(tx: Executor, ws: WorkspaceCtx, transactionId: string | null) {
  if (!transactionId) return;
  const [row] = await tx
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  if (!row || ws.hiddenAccountIds.includes(row.accountId)) return;
  await softDeleteTransactions(tx, ws.id, ws.userId, [transactionId]);
}

export async function createSettlement(
  db: Db,
  ws: WorkspaceCtx,
  groupId: string,
  body: z.output<typeof SplitSettlementBodySchema>,
) {
  const group = await requireGroup(db, ws, groupId);
  await db.transaction(async (tx) => {
    const users = await assertMembers(tx, groupId, [body.fromMemberId, body.toMemberId]);
    let linked: string | null = null;
    if (body.record) {
      const paying = users.get(body.fromMemberId) === ws.userId;
      const receiving = users.get(body.toMemberId) === ws.userId;
      if (!paying && !receiving)
        throw badRequest('Only payments you made or received can be recorded in your accounts');
      linked = await recordInLedger(tx, ws, group, body.record, {
        date: body.date,
        amountMinor: paying ? -body.amountMinor : body.amountMinor,
        notes: `Settled up · ${group.name}${body.notes ? ` · ${body.notes}` : ''}`,
      });
    }
    await tx.insert(splitSettlements).values({
      id: uuidv7(),
      groupId,
      date: body.date,
      fromMemberId: body.fromMemberId,
      toMemberId: body.toMemberId,
      amountMinor: body.amountMinor,
      notes: body.notes,
      linkedTransactionId: linked,
      createdBy: ws.userId,
    });
    await touch(tx, groupId);
  });
  return getGroup(db, ws, groupId);
}

export async function deleteSettlement(db: Db, ws: WorkspaceCtx, groupId: string, id: string) {
  await requireGroup(db, ws, groupId);
  const [row] = await db
    .select()
    .from(splitSettlements)
    .where(and(eq(splitSettlements.groupId, groupId), eq(splitSettlements.id, id)));
  if (!row) throw notFound('Payment');
  await db.transaction(async (tx) => {
    await tx.delete(splitSettlements).where(eq(splitSettlements.id, id));
    await trashLinked(tx, ws, row.linkedTransactionId);
    await touch(tx, groupId);
  });
  return getGroup(db, ws, groupId);
}
