import { cleanPayeeName, normalizePayeeName, type Payee, uuidv7 } from '@et/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { payees, transactions } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { assertCategoriesExist } from './categories';

/**
 * Returns the id of the payee with this name (matching case- and punctuation-insensitively),
 * creating it if needed. Blank names mean "no payee".
 */
export async function findOrCreatePayee(
  db: Executor,
  workspaceId: string,
  name: string | null | undefined,
) {
  const clean = name ? cleanPayeeName(name) : '';
  const normalized = normalizePayeeName(clean);
  if (!normalized) return null;
  const [existing] = await db
    .select({ id: payees.id })
    .from(payees)
    .where(and(eq(payees.workspaceId, workspaceId), eq(payees.normalizedName, normalized)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(payees)
    .values({ id: uuidv7(), workspaceId, name: clean, normalizedName: normalized })
    .onConflictDoUpdate({
      // Another request created it concurrently: reuse it.
      target: [payees.workspaceId, payees.normalizedName],
      set: { updatedAt: sql`${payees.updatedAt}` },
    })
    .returning({ id: payees.id });
  return created!.id;
}

/**
 * Payee id → the category used most often with it (ties go to the most recent), learned from
 * the workspace's own history. Powers category suggestions on quick add and import.
 */
export async function learnedCategories(db: Executor, workspaceId: string, payeeIds?: string[]) {
  if (payeeIds && payeeIds.length === 0) return new Map<string, string>();
  const filter = payeeIds ? sql`and t.payee_id = any(${sql.param(payeeIds)}::uuid[])` : sql``;
  const result = await db.execute<{ payee_id: string; category_id: string }>(sql`
    select distinct on (t.payee_id) t.payee_id, s.category_id
    from transactions t
    join transaction_splits s on s.transaction_id = t.id
    where t.workspace_id = ${workspaceId}
      and t.deleted_at is null
      and t.payee_id is not null
      and s.category_id is not null
      ${filter}
    group by t.payee_id, s.category_id
    order by t.payee_id, count(*) desc, max(t.date) desc
  `);
  return new Map(result.rows.map((r) => [r.payee_id, r.category_id]));
}

export async function listPayees(db: Db, workspaceId: string): Promise<Payee[]> {
  const rows = await db
    .select({
      payee: payees,
      count: sql<number>`count(${transactions.id}) filter (where ${transactions.deletedAt} is null)::int`,
      lastUsed: sql<
        string | null
      >`max(${transactions.date}) filter (where ${transactions.deletedAt} is null)::text`,
    })
    .from(payees)
    .leftJoin(transactions, eq(transactions.payeeId, payees.id))
    .where(eq(payees.workspaceId, workspaceId))
    .groupBy(payees.id)
    .orderBy(sql`max(${transactions.date}) desc nulls last`, payees.name);
  const learned = await learnedCategories(db, workspaceId);
  return rows.map(({ payee, count, lastUsed }) => ({
    id: payee.id,
    name: payee.name,
    defaultCategoryId: payee.defaultCategoryId,
    suggestedCategoryId: payee.defaultCategoryId ?? learned.get(payee.id) ?? null,
    transactionCount: Number(count),
    lastUsed,
  }));
}

async function requirePayee(db: Executor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.workspaceId, workspaceId), eq(payees.id, id)))
    .limit(1);
  if (!row) throw notFound('Payee');
  return row;
}

export async function updatePayee(
  db: Db,
  workspaceId: string,
  id: string,
  input: { name?: string | undefined; defaultCategoryId?: string | null | undefined },
) {
  await requirePayee(db, workspaceId, id);
  const patch: Partial<typeof payees.$inferInsert> = {};
  if (input.name !== undefined) {
    const clean = cleanPayeeName(input.name);
    const normalized = normalizePayeeName(clean);
    if (!normalized) throw badRequest('Payee name must contain letters or numbers');
    const [clash] = await db
      .select({ id: payees.id })
      .from(payees)
      .where(and(eq(payees.workspaceId, workspaceId), eq(payees.normalizedName, normalized)));
    if (clash && clash.id !== id) {
      // Renaming onto an existing payee is really a merge.
      await mergePayees(db, workspaceId, id, clash.id);
      return clash.id;
    }
    patch.name = clean;
    patch.normalizedName = normalized;
  }
  if (input.defaultCategoryId !== undefined) {
    await assertCategoriesExist(db, workspaceId, [input.defaultCategoryId]);
    patch.defaultCategoryId = input.defaultCategoryId;
  }
  if (Object.keys(patch).length > 0) await db.update(payees).set(patch).where(eq(payees.id, id));
  return id;
}

/** Moves every transaction from `sourceId` to `targetId` and deletes the source payee. */
export async function mergePayees(db: Db, workspaceId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw badRequest('Choose a different payee to merge into');
  const [source, target] = await Promise.all([
    requirePayee(db, workspaceId, sourceId),
    requirePayee(db, workspaceId, targetId),
  ]);
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ payeeId: target.id })
      .where(eq(transactions.payeeId, source.id));
    if (!target.defaultCategoryId && source.defaultCategoryId) {
      await tx
        .update(payees)
        .set({ defaultCategoryId: source.defaultCategoryId })
        .where(eq(payees.id, target.id));
    }
    await tx.delete(payees).where(eq(payees.id, source.id));
  });
}

/** Deletes a payee; its transactions keep their amounts but lose the payee. */
export async function deletePayee(db: Db, workspaceId: string, id: string) {
  await requirePayee(db, workspaceId, id);
  await db.delete(payees).where(and(eq(payees.workspaceId, workspaceId), eq(payees.id, id)));
}

export async function payeeNames(db: Executor, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: payees.id, name: payees.name })
    .from(payees)
    .where(inArray(payees.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
