import { type Tag, uuidv7 } from '@et/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { tags, transactions, transactionTags } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { type Scope, visibleAccount } from './visibility';

export async function listTags(db: Db, scope: Scope): Promise<Tag[]> {
  const workspaceId = scope.id;
  const rows = await db
    .select({
      tag: tags,
      count: sql<number>`count(${transactions.id}) filter (where ${transactions.deletedAt} is null)::int`,
    })
    .from(tags)
    .leftJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .leftJoin(
      transactions,
      and(
        eq(transactions.id, transactionTags.transactionId),
        visibleAccount(scope, transactions.accountId),
      ),
    )
    .where(eq(tags.workspaceId, workspaceId))
    .groupBy(tags.id)
    .orderBy(sql`lower(${tags.name})`);
  return rows.map(({ tag, count }) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    transactionCount: Number(count),
  }));
}

async function nameTaken(db: Executor, workspaceId: string, name: string, exceptId?: string) {
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), sql`lower(${tags.name}) = lower(${name})`))
    .limit(1);
  return row !== undefined && row.id !== exceptId;
}

export async function createTag(
  db: Db,
  workspaceId: string,
  input: { name: string; color: string },
) {
  if (await nameTaken(db, workspaceId, input.name))
    throw conflict(`Tag "${input.name}" already exists`);
  const id = uuidv7();
  await db.insert(tags).values({ id, workspaceId, ...input });
  return id;
}

export async function updateTag(
  db: Db,
  workspaceId: string,
  id: string,
  input: { name?: string | undefined; color?: string | undefined },
) {
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), eq(tags.id, id)));
  if (!row) throw notFound('Tag');
  if (input.name && (await nameTaken(db, workspaceId, input.name, id))) {
    throw conflict(`Tag "${input.name}" already exists`);
  }
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length > 0) await db.update(tags).set(patch).where(eq(tags.id, id));
}

export async function deleteTag(db: Db, workspaceId: string, id: string) {
  const deleted = await db
    .delete(tags)
    .where(and(eq(tags.workspaceId, workspaceId), eq(tags.id, id)))
    .returning({ id: tags.id });
  if (deleted.length === 0) throw notFound('Tag');
}

export async function assertTagsExist(db: Executor, workspaceId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.id, unique)));
  if (found.length !== unique.length) throw badRequest('Unknown tag');
}
