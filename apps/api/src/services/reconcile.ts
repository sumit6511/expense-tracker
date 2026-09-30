import {
  type FinishReconcileSchema,
  type IsoDate,
  type ReconcileState,
  type Reconciliation,
  uuidv7,
} from '@et/shared';
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { reconciliations, transactions } from '../db/schema';
import { ApiError, badRequest } from '../lib/errors';
import { requireAccount } from './accounts';
import { withAudit } from './audit';
import { getTransactions, insertTransaction, workspaceToday } from './transactions';

function toDto(r: typeof reconciliations.$inferSelect): Reconciliation {
  return {
    id: r.id,
    accountId: r.accountId,
    statementDate: r.statementDate,
    statementBalanceMinor: r.statementBalanceMinor,
    adjustmentMinor: r.adjustmentMinor,
    transactionCount: r.transactionCount,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Opening balance plus every live reconciled transaction. */
async function reconciledBalance(db: Executor, accountId: string, opening: number) {
  const [row] = await db
    .select({ sum: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)::bigint` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'reconciled'),
      ),
    );
  return opening + Number(row?.sum ?? 0);
}

async function lastReconciliation(db: Executor, accountId: string) {
  const [row] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.accountId, accountId))
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.createdAt))
    .limit(1);
  return row ? toDto(row) : null;
}

/** What's needed to reconcile an account against a statement ending on `statementDate`. */
export async function reconcileState(
  db: Db,
  ws: WorkspaceCtx,
  accountId: string,
  statementDate?: IsoDate,
): Promise<ReconcileState> {
  const account = await requireAccount(db, ws.id, accountId, { allowArchived: true });
  const until = statementDate ?? workspaceToday(ws);
  const open = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        ne(transactions.status, 'reconciled'),
        lte(transactions.date, until),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.id))
    .limit(2000);
  return {
    currency: account.currency,
    reconciledBalanceMinor: await reconciledBalance(db, accountId, account.openingBalanceMinor),
    candidates: await getTransactions(
      db,
      ws.id,
      open.map((r) => r.id),
    ),
    last: await lastReconciliation(db, accountId),
  };
}

/**
 * Locks in the transactions that appear on a statement. The reconciled balance plus the ticked
 * transactions must equal the statement balance, unless `adjust` adds the difference as a
 * balancing transaction.
 */
export async function finishReconciliation(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  accountId: string,
  input: z.output<typeof FinishReconcileSchema>,
): Promise<Reconciliation> {
  const id = uuidv7();
  await db.transaction(async (tx) => {
    const account = await requireAccount(tx, ws.id, accountId, { allowArchived: true });
    // Serialize reconciliations of the same account.
    await tx.execute(sql`select 1 from accounts where id = ${accountId} for update`);
    const ids = [...new Set(input.transactionIds)];
    const rows = ids.length
      ? await tx
          .select({
            id: transactions.id,
            amount: transactions.amountMinor,
            date: transactions.date,
            status: transactions.status,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, accountId),
              isNull(transactions.deletedAt),
              inArray(transactions.id, ids),
            ),
          )
      : [];
    if (rows.length !== ids.length) throw badRequest('Some transactions are not in this account');
    if (rows.some((r) => r.status === 'reconciled'))
      throw badRequest('Some transactions are already reconciled');
    if (rows.some((r) => r.date > input.statementDate))
      throw badRequest('Some transactions are dated after the statement');

    const base = await reconciledBalance(tx, accountId, account.openingBalanceMinor);
    const cleared = base + rows.reduce((s, r) => s + r.amount, 0);
    const difference = input.statementBalanceMinor - cleared;
    if (difference !== 0 && !input.adjust) {
      throw new ApiError(
        409,
        'reconcile_mismatch',
        'The ticked transactions don’t add up to the statement balance yet.',
        { differenceMinor: difference },
      );
    }
    const lockIds = rows.map((r) => r.id);
    if (difference !== 0) {
      lockIds.push(
        await insertTransaction(
          tx,
          ws.id,
          userId,
          account.currency,
          {
            accountId,
            date: input.statementDate,
            amountMinor: difference,
            categoryId: null,
            notes: 'Reconciliation adjustment',
            status: 'reconciled',
          },
          null,
        ),
      );
    }
    await withAudit(
      tx,
      ws.id,
      userId,
      lockIds,
      async () => {
        if (lockIds.length)
          await tx
            .update(transactions)
            .set({
              status: 'reconciled',
              updatedBy: userId,
              version: sql`${transactions.version} + 1`,
            })
            .where(inArray(transactions.id, lockIds));
      },
      'reconcile',
    );
    await tx.insert(reconciliations).values({
      id,
      workspaceId: ws.id,
      accountId,
      statementDate: input.statementDate,
      statementBalanceMinor: input.statementBalanceMinor,
      adjustmentMinor: difference,
      transactionCount: lockIds.length,
      createdBy: userId,
    });
  });
  const [row] = await db.select().from(reconciliations).where(eq(reconciliations.id, id));
  return toDto(row!);
}

export async function listReconciliations(db: Db, workspaceId: string, accountId: string) {
  const rows = await db
    .select()
    .from(reconciliations)
    .where(
      and(eq(reconciliations.workspaceId, workspaceId), eq(reconciliations.accountId, accountId)),
    )
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.createdAt))
    .limit(50);
  return rows.map(toDto);
}
