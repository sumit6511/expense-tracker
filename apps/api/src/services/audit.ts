import { type TransactionChange, uuidv7 } from '@et/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { auditLog, transactions, user } from '../db/schema';
import { notFound } from '../lib/errors';
import { isHidden, type Scope } from './visibility';

/** The parts of a transaction people care about when asking "who changed this?". */
interface Snapshot {
  date: string;
  amount: number;
  account: string;
  payee: string | null;
  notes: string;
  status: string;
  review: boolean;
  /** [[categoryId]] for a single category, [[categoryId, amount], …] for a split. */
  categories: Array<[string | null] | [string | null, number]>;
  tags: string[];
}

type Action = 'update' | 'delete' | 'restore' | 'reconcile';

async function snapshots(db: Executor, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, Snapshot>();
  const result = await db.execute<{
    id: string;
    date: string;
    amount_minor: number;
    account_id: string;
    payee: string | null;
    notes: string;
    status: string;
    needs_review: boolean;
    splits: Array<[string | null, number]>;
    tag_ids: string[];
  }>(sql`
    select t.id, t.date, t.amount_minor, t.account_id, p.name as payee, t.notes, t.status,
      t.needs_review,
      coalesce((select json_agg(json_build_array(s.category_id, s.amount_minor)
        order by s.sort_order, s.id) from transaction_splits s where s.transaction_id = t.id),
        '[]'::json) as splits,
      coalesce((select array_agg(tt.tag_id::text order by tt.tag_id)
        from transaction_tags tt where tt.transaction_id = t.id), '{}') as tag_ids
    from transactions t
    left join payees p on p.id = t.payee_id
    where t.workspace_id = ${workspaceId} and t.id = any(${sql.param(ids)}::uuid[])
  `);
  return new Map(
    result.rows.map((r) => [
      r.id,
      {
        date: r.date,
        amount: Number(r.amount_minor),
        account: r.account_id,
        payee: r.payee,
        notes: r.notes,
        status: r.status,
        review: r.needs_review,
        // One line is always the whole amount, so only its category matters; splits keep amounts.
        categories:
          r.splits.length === 1
            ? [[r.splits[0]![0]] as [string | null]]
            : r.splits.map(([c, a]) => [c, Number(a)] as [string | null, number]),
        tags: r.tag_ids,
      },
    ]),
  );
}

function diff(before: Snapshot, after: Snapshot) {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(before) as Array<keyof Snapshot>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      changes[key] = [before[key], after[key]];
  }
  return changes;
}

/**
 * Runs `fn` and records what it changed on the given transactions. Only real changes are
 * logged, so saving an unchanged form leaves no trace.
 */
export async function withAudit<T>(
  db: Executor,
  workspaceId: string,
  userId: string | null,
  ids: string[],
  fn: () => Promise<T>,
  action: Action = 'update',
): Promise<T> {
  const before = await snapshots(db, workspaceId, ids);
  const result = await fn();
  const after = await snapshots(db, workspaceId, ids);
  const rows = [...before].flatMap(([id, b]) => {
    const a = after.get(id);
    const changes = a ? diff(b, a) : {};
    return Object.keys(changes).length
      ? [{ id: uuidv7(), workspaceId, transactionId: id, action, userId, changes }]
      : [];
  });
  if (rows.length) await db.insert(auditLog).values(rows);
  return result;
}

/** Records an action with no field changes (deleting or restoring). */
export async function logAction(
  db: Executor,
  workspaceId: string,
  userId: string | null,
  ids: string[],
  action: Action,
) {
  if (ids.length === 0) return;
  await db
    .insert(auditLog)
    .values(
      ids.map((transactionId) => ({ id: uuidv7(), workspaceId, transactionId, action, userId })),
    );
}

export async function transactionHistory(
  db: Db,
  scope: Scope,
  transactionId: string,
): Promise<TransactionChange[]> {
  const [tx] = await db
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, scope.id), eq(transactions.id, transactionId)));
  if (!tx || isHidden(scope, tx.accountId)) throw notFound('Transaction');
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      changes: auditLog.changes,
      at: auditLog.createdAt,
      userName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.userId))
    .where(eq(auditLog.transactionId, transactionId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    at: r.at.toISOString(),
    userName: r.userName,
    changes: r.changes as TransactionChange['changes'],
  }));
}
