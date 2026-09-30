import {
  type CategoryGroup,
  type CreateCategoryGroupSchema,
  type CreateCategorySchema,
  type UpdateCategoryGroupSchema,
  type UpdateCategorySchema,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Executor } from '../db/client';
import {
  budgets,
  categories,
  categoryGroups,
  payees,
  transactionSplits,
  transactions,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';

export async function listCategoryGroups(db: Db, workspaceId: string): Promise<CategoryGroup[]> {
  const groups = await db
    .select()
    .from(categoryGroups)
    .where(eq(categoryGroups.workspaceId, workspaceId))
    .orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.name));
  const cats = await db
    .select({ category: categories, count: sql<number>`count(${transactions.id})::int` })
    .from(categories)
    .leftJoin(transactionSplits, eq(transactionSplits.categoryId, categories.id))
    .leftJoin(
      transactions,
      and(eq(transactions.id, transactionSplits.transactionId), isNull(transactions.deletedAt)),
    )
    .where(eq(categories.workspaceId, workspaceId))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    sortOrder: g.sortOrder,
    archived: g.archivedAt !== null,
    categories: cats
      .filter((c) => c.category.groupId === g.id)
      .map(({ category: c, count }) => ({
        id: c.id,
        groupId: c.groupId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sortOrder: c.sortOrder,
        archived: c.archivedAt !== null,
        transactionCount: Number(count),
      })),
  }));
}

async function requireGroup(db: Executor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(categoryGroups)
    .where(and(eq(categoryGroups.workspaceId, workspaceId), eq(categoryGroups.id, id)))
    .limit(1);
  if (!row) throw notFound('Category group');
  return row;
}

async function requireCategory(db: Executor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.id, id)))
    .limit(1);
  if (!row) throw notFound('Category');
  return row;
}

/** Checks every id is a category in this workspace. */
export async function assertCategoriesExist(
  db: Executor,
  workspaceId: string,
  ids: Iterable<string | null>,
) {
  const unique = [...new Set([...ids].filter((id): id is string => id !== null))];
  if (unique.length === 0) return;
  const found = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), inArray(categories.id, unique)));
  if (found.length !== unique.length) throw badRequest('Unknown category');
}

export async function createCategoryGroup(
  db: Db,
  workspaceId: string,
  input: z.output<typeof CreateCategoryGroupSchema>,
) {
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${categoryGroups.sortOrder}) + 1, 0)::int` })
    .from(categoryGroups)
    .where(eq(categoryGroups.workspaceId, workspaceId));
  const id = uuidv7();
  await db
    .insert(categoryGroups)
    .values({ id, workspaceId, name: input.name, kind: input.kind, sortOrder: Number(next) });
  return id;
}

export async function updateCategoryGroup(
  db: Db,
  workspaceId: string,
  id: string,
  input: z.output<typeof UpdateCategoryGroupSchema>,
) {
  await requireGroup(db, workspaceId, id);
  const { archived, ...rest } = input;
  const patch: Partial<typeof categoryGroups.$inferInsert> = { ...rest };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  if (Object.keys(patch).length === 0) return;
  await db.update(categoryGroups).set(patch).where(eq(categoryGroups.id, id));
}

export async function deleteCategoryGroup(db: Db, workspaceId: string, id: string) {
  await requireGroup(db, workspaceId, id);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.groupId, id));
  if (Number(row?.n) > 0) throw conflict('Move or delete the categories in this group first');
  await db.delete(categoryGroups).where(eq(categoryGroups.id, id));
}

export async function createCategory(
  db: Db,
  workspaceId: string,
  input: z.output<typeof CreateCategorySchema>,
) {
  await requireGroup(db, workspaceId, input.groupId);
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${categories.sortOrder}) + 1, 0)::int` })
    .from(categories)
    .where(eq(categories.groupId, input.groupId));
  const id = uuidv7();
  await db.insert(categories).values({ id, workspaceId, ...input, sortOrder: Number(next) });
  return id;
}

export async function updateCategory(
  db: Db,
  workspaceId: string,
  id: string,
  input: z.output<typeof UpdateCategorySchema>,
) {
  const current = await requireCategory(db, workspaceId, id);
  if (input.groupId && input.groupId !== current.groupId) {
    const [from, to] = await Promise.all([
      requireGroup(db, workspaceId, current.groupId),
      requireGroup(db, workspaceId, input.groupId),
    ]);
    if (from.kind !== to.kind)
      throw badRequest('A category can only move to a group of the same kind');
  }
  const { archived, ...rest } = input;
  const patch: Partial<typeof categories.$inferInsert> = { ...rest };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  if (Object.keys(patch).length === 0) return;
  await db.update(categories).set(patch).where(eq(categories.id, id));
}

/**
 * Deletes a category. If transactions use it, `reassignTo` must say where they go: another
 * category id, or null to leave them uncategorized.
 */
export async function deleteCategory(
  db: Db,
  workspaceId: string,
  id: string,
  reassignTo: string | null | undefined,
) {
  await requireCategory(db, workspaceId, id);
  if (reassignTo === id) throw badRequest('Choose a different category to move transactions to');
  if (reassignTo) await requireCategory(db, workspaceId, reassignTo);
  await db.transaction(async (tx) => {
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactionSplits)
      .where(eq(transactionSplits.categoryId, id));
    if (Number(used?.n) > 0) {
      if (reassignTo === undefined) {
        throw conflict('This category has transactions. Choose where to move them.', {
          transactionCount: Number(used?.n),
        });
      }
      await tx
        .update(transactionSplits)
        .set({ categoryId: reassignTo })
        .where(eq(transactionSplits.categoryId, id));
    }
    await tx
      .update(payees)
      .set({ defaultCategoryId: reassignTo ?? null })
      .where(eq(payees.defaultCategoryId, id));
    await tx.delete(budgets).where(eq(budgets.categoryId, id));
    await tx.delete(categories).where(eq(categories.id, id));
  });
}

/** Category id → kind, for classifying splits as income or spending. */
export async function categoryKinds(
  db: Executor,
  workspaceId: string,
): Promise<Map<string, 'expense' | 'income'>> {
  const rows = await db
    .select({ id: categories.id, kind: categoryGroups.kind })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(eq(categories.workspaceId, workspaceId));
  return new Map(rows.map((r) => [r.id, r.kind]));
}
