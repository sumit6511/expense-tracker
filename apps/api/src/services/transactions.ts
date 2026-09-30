import {
  type BulkTransactionAction,
  type CreateTransactionSchema,
  type CreateTransferSchema,
  evaluateRules,
  type ListTransactionsQuerySchema,
  type SplitInput,
  type Transaction,
  type TransactionPage,
  todayIn,
  type UpdateTransactionSchema,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, inArray, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import {
  accounts,
  attachments,
  payees,
  transactionSplits,
  transactions,
  transactionTags,
} from '../db/schema';
import { ApiError, badRequest, conflict, notFound } from '../lib/errors';
import { requireAccount } from './accounts';
import { logAction, withAudit } from './audit';
import { assertCategoriesExist } from './categories';
import { findOrCreatePayee } from './payees';
import { loadRateBook } from './rates';
import { loadActiveRules, recordHits } from './rules';
import { assertTagsExist } from './tags';

type TxRow = typeof transactions.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** Turns transaction rows into API objects, loading splits, tags, payees and transfer peers. */
async function hydrate(
  db: Executor,
  rows: TxRow[],
  runningBalances?: Map<string, number>,
): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const payeeIds = [...new Set(rows.map((r) => r.payeeId).filter((p): p is string => p !== null))];
  const groups = [
    ...new Set(rows.map((r) => r.transferGroupId).filter((g): g is string => g !== null)),
  ];

  const [splits, tagRows, payeeRows, accountRows, peerRows, attachmentRows] = await Promise.all([
    db
      .select()
      .from(transactionSplits)
      .where(inArray(transactionSplits.transactionId, ids))
      .orderBy(asc(transactionSplits.sortOrder), asc(transactionSplits.id)),
    db.select().from(transactionTags).where(inArray(transactionTags.transactionId, ids)),
    payeeIds.length
      ? db
          .select({ id: payees.id, name: payees.name })
          .from(payees)
          .where(inArray(payees.id, payeeIds))
      : Promise.resolve([]),
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(inArray(accounts.id, accountIds)),
    groups.length
      ? db
          .select({
            id: transactions.id,
            accountId: transactions.accountId,
            amountMinor: transactions.amountMinor,
            group: transactions.transferGroupId,
          })
          .from(transactions)
          .where(inArray(transactions.transferGroupId, groups))
      : Promise.resolve([]),
    db
      .select({ id: attachments.transactionId, n: sql<number>`count(*)::int` })
      .from(attachments)
      .where(inArray(attachments.transactionId, ids))
      .groupBy(attachments.transactionId),
  ]);

  const splitsByTx = Map.groupBy(splits, (s) => s.transactionId);
  const tagsByTx = Map.groupBy(tagRows, (t) => t.transactionId);
  const payeeName = new Map(payeeRows.map((p) => [p.id, p.name]));
  const currency = new Map(accountRows.map((a) => [a.id, a.currency]));
  const attachmentCount = new Map(attachmentRows.map((a) => [a.id, Number(a.n)]));

  return rows.map((r) => {
    const peer = r.transferGroupId
      ? peerRows.find((p) => p.group === r.transferGroupId && p.id !== r.id)
      : undefined;
    return {
      id: r.id,
      accountId: r.accountId,
      date: r.date,
      amountMinor: r.amountMinor,
      currency: currency.get(r.accountId) ?? '',
      payeeId: r.payeeId,
      payeeName: r.payeeId ? (payeeName.get(r.payeeId) ?? null) : null,
      notes: r.notes,
      rawDescription: r.rawDescription,
      status: r.status,
      needsReview: r.needsReview,
      transfer:
        r.transferGroupId && peer
          ? {
              groupId: r.transferGroupId,
              peerTransactionId: peer.id,
              peerAccountId: peer.accountId,
              peerAmountMinor: peer.amountMinor,
            }
          : null,
      splits: (splitsByTx.get(r.id) ?? []).map((s) => ({
        id: s.id,
        categoryId: s.categoryId,
        amountMinor: s.amountMinor,
        memo: s.memo,
      })),
      tagIds: (tagsByTx.get(r.id) ?? []).map((t) => t.tagId),
      original:
        r.originalAmountMinor !== null && r.originalCurrency
          ? { amountMinor: r.originalAmountMinor, currency: r.originalCurrency }
          : null,
      importBatchId: r.importBatchId,
      attachmentCount: attachmentCount.get(r.id) ?? 0,
      recurringId: r.recurringId,
      createdBy: r.createdBy,
      deleted: r.deletedAt !== null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      runningBalanceMinor: runningBalances?.get(r.id) ?? null,
    };
  });
}

async function requireTransactionRow(
  db: Executor,
  workspaceId: string,
  id: string,
): Promise<TxRow> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, id)))
    .limit(1);
  if (!row) throw notFound('Transaction');
  return row;
}

export async function getTransaction(
  db: Executor,
  workspaceId: string,
  id: string,
): Promise<Transaction> {
  const row = await requireTransactionRow(db, workspaceId, id);
  const [tx] = await hydrate(db, [row]);
  return tx!;
}

/** Several transactions, in the order of `ids`. */
export async function getTransactions(
  db: Executor,
  workspaceId: string,
  ids: string[],
): Promise<Transaction[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, ids)));
  const hydrated = new Map((await hydrate(db, rows)).map((t) => [t.id, t]));
  return ids.flatMap((id) => hydrated.get(id) ?? []);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function encodeCursor(row: { date: string; id: string }) {
  return Buffer.from(`${row.date}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw badRequest('Invalid cursor');
  }
  return { date, id };
}

type ListQuery = z.output<typeof ListTransactionsQuerySchema>;

function idsCondition(column: SQL | typeof transactions.payeeId, ids: string[]) {
  const real = ids.filter((id) => id !== 'none');
  const parts: SQL[] = [];
  // sql.param binds the array as one parameter; a bare array would expand to a list.
  if (real.length) parts.push(sql`${column} = any(${sql.param(real)}::uuid[])`);
  if (ids.includes('none')) parts.push(sql`${column} is null`);
  return parts.length === 1 ? parts[0]! : sql`(${sql.join(parts, sql` or `)})`;
}

/**
 * Fully qualified column reference for use inside correlated subqueries. Drizzle leaves column
 * names unqualified in single-table queries, and an unqualified "id" inside a subquery would
 * resolve to the subquery's own table.
 */
const txColumn = (column: 'id' | 'payee_id') => sql.raw(`"transactions"."${column}"`);

/** Filter conditions shared by the list, totals and CSV export. */
export function transactionFilters(
  workspaceId: string,
  q: Omit<ListQuery, 'cursor' | 'limit'>,
): SQL[] {
  const t = transactions;
  const where: SQL[] = [eq(t.workspaceId, workspaceId)];
  where.push(q.deleted === 'true' ? isNotNull(t.deletedAt) : isNull(t.deletedAt));
  if (q.from) where.push(sql`${t.date} >= ${q.from}`);
  if (q.to) where.push(sql`${t.date} <= ${q.to}`);
  if (q.accountIds?.length) where.push(idsCondition(sql`${t.accountId}`, q.accountIds));
  if (q.payeeIds?.length) where.push(idsCondition(t.payeeId, q.payeeIds));
  if (q.categoryIds?.length) {
    where.push(sql`exists (
      select 1 from ${transactionSplits} s
      where s.transaction_id = ${txColumn('id')} and ${idsCondition(sql`s.category_id`, q.categoryIds)}
    )`);
  }
  if (q.tagIds?.length) {
    const tagIds = q.tagIds.filter((id) => id !== 'none');
    where.push(sql`exists (
      select 1 from ${transactionTags} tt
      where tt.transaction_id = ${txColumn('id')} and tt.tag_id = any(${sql.param(tagIds)}::uuid[])
    )`);
  }
  if (q.type === 'transfer') where.push(isNotNull(t.transferGroupId));
  if (q.type === 'expense') where.push(and(isNull(t.transferGroupId), sql`${t.amountMinor} < 0`)!);
  if (q.type === 'income') where.push(and(isNull(t.transferGroupId), sql`${t.amountMinor} > 0`)!);
  if (q.minAmount !== undefined) where.push(sql`abs(${t.amountMinor}) >= ${q.minAmount}`);
  if (q.maxAmount !== undefined) where.push(sql`abs(${t.amountMinor}) <= ${q.maxAmount}`);
  if (q.needsReview) where.push(eq(t.needsReview, q.needsReview === 'true'));
  if (q.importBatchId) where.push(eq(t.importBatchId, q.importBatchId));
  if (q.recurringId) where.push(eq(t.recurringId, q.recurringId));
  if (q.createdBy) where.push(eq(t.createdBy, q.createdBy));
  if (q.q) {
    const pattern = `%${escapeLike(q.q)}%`;
    where.push(sql`(
      (${t.rawDescription} || ' ' || ${t.notes}) ilike ${pattern}
      or exists (select 1 from ${payees} p where p.id = ${txColumn('payee_id')} and p.name ilike ${pattern})
    )`);
  }
  return where;
}

export async function listTransactions(
  db: Db,
  ws: WorkspaceCtx,
  query: ListQuery,
): Promise<TransactionPage> {
  const where = transactionFilters(ws.id, query);
  const pageWhere = [...where];
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    pageWhere.push(sql`(${transactions.date}, ${transactions.id}) < (${c.date}, ${c.id})`);
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...pageWhere))
    .orderBy(sql`${transactions.date} desc`, sql`${transactions.id} desc`)
    .limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);

  // Running balance only makes sense when looking at one account's live register.
  let running: Map<string, number> | undefined;
  const singleAccount =
    query.accountIds?.length === 1 && query.accountIds[0] !== 'none' ? query.accountIds[0] : null;
  if (singleAccount && query.deleted !== 'true' && page.length > 0) {
    const [account] = await db
      .select({ opening: accounts.openingBalanceMinor })
      .from(accounts)
      .where(and(eq(accounts.id, singleAccount), eq(accounts.workspaceId, ws.id)));
    const balances = await db.execute<{ id: string; running: string }>(sql`
      select id, running from (
        select id, sum(amount_minor) over (order by date, id rows unbounded preceding) as running
        from ${transactions}
        where account_id = ${singleAccount} and deleted_at is null
      ) x where id = any(${sql.param(page.map((r) => r.id))}::uuid[])
    `);
    running = new Map(
      balances.rows.map((b) => [b.id, (account?.opening ?? 0) + Number(b.running)]),
    );
  }

  // Totals across all matching transactions, converted to the base currency.
  const sums = await db
    .select({
      currency: accounts.currency,
      date: transactions.date,
      count: sql<number>`count(*)::int`,
      inflow: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} > 0), 0)::bigint`,
      outflow: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} < 0), 0)::bigint`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...where))
    .groupBy(accounts.currency, transactions.date);
  let count = 0;
  let inflow = 0;
  let outflow = 0;
  if (sums.length > 0) {
    const dates = sums.map((s) => s.date).sort();
    const rates = await loadRateBook(
      db,
      ws.id,
      sums.map((s) => s.currency),
      ws.baseCurrency,
      dates[0]!,
      dates.at(-1)!,
    );
    for (const s of sums) {
      count += Number(s.count);
      inflow += rates.convert(Number(s.inflow), s.currency, ws.baseCurrency, s.date) ?? 0;
      outflow += rates.convert(Number(s.outflow), s.currency, ws.baseCurrency, s.date) ?? 0;
    }
  }

  return {
    items: await hydrate(db, page, running),
    nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null,
    totals: { count, inflowBaseMinor: inflow, outflowBaseMinor: outflow },
  };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export async function replaceSplits(
  db: Executor,
  workspaceId: string,
  transactionId: string,
  splits: SplitInput[],
) {
  await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
  if (splits.length === 0) return;
  await db.insert(transactionSplits).values(
    splits.map((s, i) => ({
      id: uuidv7(),
      transactionId,
      workspaceId,
      categoryId: s.categoryId,
      amountMinor: s.amountMinor,
      memo: s.memo ?? '',
      sortOrder: i,
    })),
  );
}

async function replaceTags(db: Executor, transactionId: string, tagIds: readonly string[]) {
  await db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  const unique = [...new Set(tagIds)];
  if (unique.length)
    await db.insert(transactionTags).values(unique.map((tagId) => ({ transactionId, tagId })));
}

/** Changes a rule makes to an existing regular transaction. */
export interface TransactionEffects {
  categoryId?: string | null;
  split?: Array<{ categoryId: string | null; amountMinor: number }>;
  payeeId?: string | null;
  addTagIds?: string[];
  notes?: string;
  reviewed?: boolean;
}

export async function applyEffects(
  db: Executor,
  workspaceId: string,
  userId: string | null,
  target: { id: string; amountMinor: number },
  effects: TransactionEffects,
) {
  if (effects.split) {
    await replaceSplits(db, workspaceId, target.id, effects.split);
  } else if (effects.categoryId !== undefined) {
    await replaceSplits(db, workspaceId, target.id, [
      { categoryId: effects.categoryId, amountMinor: target.amountMinor },
    ]);
  }
  if (effects.addTagIds?.length) {
    await db
      .insert(transactionTags)
      .values(effects.addTagIds.map((tagId) => ({ transactionId: target.id, tagId })))
      .onConflictDoNothing();
  }
  const patch: Partial<typeof transactions.$inferInsert> = {};
  if (effects.payeeId !== undefined) patch.payeeId = effects.payeeId;
  if (effects.notes !== undefined) patch.notes = effects.notes;
  if (effects.reviewed) patch.needsReview = false;
  await db
    .update(transactions)
    .set({ ...patch, updatedBy: userId, version: sql`${transactions.version} + 1` })
    .where(eq(transactions.id, target.id));
}

function normalizedOriginal(
  original: { amountMinor: number; currency: string } | null | undefined,
  accountCurrency: string,
) {
  if (!original || original.currency === accountCurrency)
    return { originalAmountMinor: null, originalCurrency: null };
  return { originalAmountMinor: original.amountMinor, originalCurrency: original.currency };
}

export type CreateTransactionData = z.output<typeof CreateTransactionSchema> & {
  needsReview?: boolean;
  rawDescription?: string;
  externalId?: string | null;
  importBatchId?: string | null;
  recurringId?: string | null;
};

/** Inserts a regular (non-transfer) transaction. Assumes validation of references is done. */
export async function insertTransaction(
  db: Executor,
  workspaceId: string,
  userId: string | null,
  accountCurrency: string,
  input: CreateTransactionData,
  payeeId: string | null,
): Promise<string> {
  const id = input.id ?? uuidv7();
  const splits: SplitInput[] = input.splits ?? [
    { categoryId: input.categoryId ?? null, amountMinor: input.amountMinor, memo: '' },
  ];
  await db.insert(transactions).values({
    id,
    workspaceId,
    accountId: input.accountId,
    date: input.date,
    amountMinor: input.amountMinor,
    payeeId,
    notes: input.notes ?? '',
    rawDescription: input.rawDescription ?? '',
    status: input.status ?? 'cleared',
    needsReview: input.needsReview ?? false,
    externalId: input.externalId ?? null,
    importBatchId: input.importBatchId ?? null,
    recurringId: input.recurringId ?? null,
    createdBy: userId,
    updatedBy: userId,
    ...normalizedOriginal(input.original, accountCurrency),
  });
  await replaceSplits(db, workspaceId, id, splits);
  if (input.tagIds?.length) await replaceTags(db, id, input.tagIds);
  return id;
}

export async function createTransaction(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  input: z.output<typeof CreateTransactionSchema>,
): Promise<{ transaction: Transaction; created: boolean }> {
  if (input.id) {
    // Idempotent create: replaying the same request returns the transaction made the first time.
    const [existing] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, input.id))
      .limit(1);
    if (existing) {
      if (existing.workspaceId !== ws.id) throw conflict('Transaction id already in use');
      return { transaction: (await hydrate(db, [existing]))[0]!, created: false };
    }
  }
  const id = await db.transaction(async (tx) => {
    const account = await requireAccount(tx, ws.id, input.accountId);
    const categoryIds = input.splits
      ? input.splits.map((s) => s.categoryId)
      : [input.categoryId ?? null];
    await assertCategoriesExist(tx, ws.id, categoryIds);
    if (input.tagIds) await assertTagsExist(tx, ws.id, input.tagIds);
    const payeeId = await findOrCreatePayee(tx, ws.id, input.payee);
    return insertTransaction(
      tx,
      ws.id,
      userId,
      account.currency,
      await fillFromRules(tx, ws.id, input),
      payeeId,
    );
  });
  return { transaction: await getTransaction(db, ws.id, id), created: true };
}

/**
 * On manual entry rules only fill gaps: a category when none was chosen, extra tags, and notes
 * when empty. What the person typed is never overwritten.
 */
async function fillFromRules(
  db: Executor,
  workspaceId: string,
  input: z.output<typeof CreateTransactionSchema>,
): Promise<z.output<typeof CreateTransactionSchema>> {
  const active = await loadActiveRules(db, workspaceId);
  if (active.length === 0) return input;
  const result = evaluateRules(active, {
    payee: input.payee ?? '',
    description: '',
    notes: input.notes ?? '',
    amountMinor: input.amountMinor,
    accountId: input.accountId,
  });
  if (result.matchedRuleIds.length === 0) return input;
  const filled = { ...input };
  const uncategorized = !input.splits && !input.categoryId;
  if (uncategorized && result.split) filled.splits = result.split;
  else if (uncategorized && result.categoryId) filled.categoryId = result.categoryId;
  if (result.tagIds.length)
    filled.tagIds = [...new Set([...(input.tagIds ?? []), ...result.tagIds])];
  if (!input.notes && result.notes) filled.notes = result.notes;
  await recordHits(db, new Map(result.matchedRuleIds.map((id) => [id, 1])));
  return filled;
}

export async function updateTransaction(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  id: string,
  input: z.output<typeof UpdateTransactionSchema>,
): Promise<Transaction> {
  await db.transaction(async (tx) => {
    const row = await requireTransactionRow(tx, ws.id, id);
    if (row.deletedAt) throw notFound('Transaction');
    if (input.version !== undefined && input.version !== row.version) {
      throw conflict('This transaction was changed elsewhere. Reload and try again.', {
        currentVersion: row.version,
      });
    }
    const touchesBalance =
      (input.amountMinor !== undefined && input.amountMinor !== row.amountMinor) ||
      (input.date !== undefined && input.date !== row.date) ||
      (input.accountId !== undefined && input.accountId !== row.accountId);
    if (row.status === 'reconciled' && touchesBalance && !input.confirmReconciled) {
      throw new ApiError(
        409,
        'reconciled',
        'This transaction is reconciled. Changing its amount, date or account changes a balance you already matched to a statement.',
      );
    }
    const ids = await withTransferPeers(tx, ws.id, [id]);
    await withAudit(tx, ws.id, userId, ids, () => applyUpdate(tx, ws, userId, row, input));
  });
  return getTransaction(db, ws.id, id);
}

async function applyUpdate(
  tx: Executor,
  ws: WorkspaceCtx,
  userId: string,
  row: TxRow,
  input: z.output<typeof UpdateTransactionSchema>,
) {
  const id = row.id;
  if (input.tagIds) await assertTagsExist(tx, ws.id, input.tagIds);

  if (row.transferGroupId) {
    await updateTransferLegFields(tx, ws.id, userId, row, input);
    return;
  }

  const patch: Partial<typeof transactions.$inferInsert> = {
    updatedBy: userId,
    version: row.version + 1,
  };
  let accountCurrency: string | null = null;
  if (input.accountId !== undefined && input.accountId !== row.accountId) {
    const account = await requireAccount(tx, ws.id, input.accountId);
    patch.accountId = account.id;
    accountCurrency = account.currency;
  }
  if (input.date !== undefined) patch.date = input.date;
  if (input.amountMinor !== undefined) patch.amountMinor = input.amountMinor;
  if (input.notes !== undefined) patch.notes = input.notes ?? '';
  if (input.status !== undefined) patch.status = input.status;
  if (input.needsReview !== undefined) patch.needsReview = input.needsReview;
  if (input.payee !== undefined) patch.payeeId = await findOrCreatePayee(tx, ws.id, input.payee);
  if (input.original !== undefined) {
    const currency =
      accountCurrency ??
      (await requireAccount(tx, ws.id, patch.accountId ?? row.accountId, { allowArchived: true }))
        .currency;
    Object.assign(patch, normalizedOriginal(input.original, currency));
  }

  const amount = input.amountMinor ?? row.amountMinor;
  if (input.splits) {
    await assertCategoriesExist(
      tx,
      ws.id,
      input.splits.map((s) => s.categoryId),
    );
    if (input.splits.reduce((sum, s) => sum + s.amountMinor, 0) !== amount) {
      throw badRequest('Split amounts must add up to the total');
    }
    await replaceSplits(tx, ws.id, id, input.splits);
  } else if (input.categoryId !== undefined) {
    await assertCategoriesExist(tx, ws.id, [input.categoryId]);
    await replaceSplits(tx, ws.id, id, [{ categoryId: input.categoryId, amountMinor: amount }]);
  } else if (amount !== row.amountMinor) {
    const existing = await tx
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, id));
    if (existing.length > 1)
      throw badRequest('This transaction is split. Update the split amounts too.');
    await tx
      .update(transactionSplits)
      .set({ amountMinor: amount })
      .where(eq(transactionSplits.transactionId, id));
  }

  await tx.update(transactions).set(patch).where(eq(transactions.id, id));
  if (input.tagIds) await replaceTags(tx, id, input.tagIds);
}

/** Fields that can be edited on one leg of a transfer; date and notes apply to both legs. */
async function updateTransferLegFields(
  tx: Executor,
  workspaceId: string,
  userId: string,
  row: TxRow,
  input: z.output<typeof UpdateTransactionSchema>,
) {
  const disallowed = (
    ['accountId', 'amountMinor', 'payee', 'categoryId', 'splits', 'original'] as const
  ).filter((k) => input[k] !== undefined);
  if (disallowed.length > 0) {
    throw badRequest(
      `Edit transfers with the transfer form (can't change ${disallowed.join(', ')} here)`,
    );
  }
  const shared: Partial<typeof transactions.$inferInsert> = { updatedBy: userId };
  if (input.date !== undefined) shared.date = input.date;
  if (input.notes !== undefined) shared.notes = input.notes ?? '';
  await tx
    .update(transactions)
    .set({ ...shared, version: sql`${transactions.version} + 1` })
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.transferGroupId, row.transferGroupId!),
      ),
    );
  const own: Partial<typeof transactions.$inferInsert> = {};
  if (input.status !== undefined) own.status = input.status;
  if (input.needsReview !== undefined) own.needsReview = input.needsReview;
  if (Object.keys(own).length)
    await tx.update(transactions).set(own).where(eq(transactions.id, row.id));
  if (input.tagIds) await replaceTags(tx, row.id, input.tagIds);
}

/** Ids of the given transactions plus the other legs of any transfers among them. */
async function withTransferPeers(
  db: Executor,
  workspaceId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: transactions.id, group: transactions.transferGroupId })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, ids)));
  const groups = rows.map((r) => r.group).filter((g): g is string => g !== null);
  const peers = groups.length
    ? await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.workspaceId, workspaceId),
            inArray(transactions.transferGroupId, groups),
          ),
        )
    : [];
  return [...new Set([...rows.map((r) => r.id), ...peers.map((p) => p.id)])];
}

/** Moves transactions to the trash (both legs for transfers). Returns the number affected. */
export async function softDeleteTransactions(
  db: Executor,
  workspaceId: string,
  userId: string,
  ids: string[],
) {
  const all = await withTransferPeers(db, workspaceId, ids);
  if (all.length === 0) return 0;
  const updated = await db
    .update(transactions)
    .set({ deletedAt: new Date(), updatedBy: userId, version: sql`${transactions.version} + 1` })
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        inArray(transactions.id, all),
        isNull(transactions.deletedAt),
      ),
    )
    .returning({ id: transactions.id });
  await logAction(
    db,
    workspaceId,
    userId,
    updated.map((u) => u.id),
    'delete',
  );
  return updated.length;
}

export async function restoreTransactions(
  db: Executor,
  workspaceId: string,
  userId: string,
  ids: string[],
) {
  const all = await withTransferPeers(db, workspaceId, ids);
  if (all.length === 0) return 0;
  const updated = await db
    .update(transactions)
    .set({ deletedAt: null, updatedBy: userId, version: sql`${transactions.version} + 1` })
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        inArray(transactions.id, all),
        isNotNull(transactions.deletedAt),
      ),
    )
    .returning({ id: transactions.id });
  await logAction(
    db,
    workspaceId,
    userId,
    updated.map((u) => u.id),
    'restore',
  );
  return updated.length;
}

export async function deleteTransaction(db: Db, workspaceId: string, userId: string, id: string) {
  const row = await requireTransactionRow(db, workspaceId, id);
  if (row.deletedAt) return;
  await db.transaction((tx) => softDeleteTransactions(tx, workspaceId, userId, [id]));
}

/** Permanently removes transactions that have been in the trash for more than `days` days. */
export async function purgeTrash(db: Executor, days = 30) {
  const deleted = await db
    .delete(transactions)
    .where(sql`${transactions.deletedAt} < now() - make_interval(days => ${days})`)
    .returning({ id: transactions.id });
  return deleted.length;
}

export async function bulkUpdate(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  action: BulkTransactionAction,
): Promise<{ updated: number; skipped: number }> {
  return db.transaction((tx) =>
    // Deleting and restoring log themselves; everything else is recorded as field changes.
    action.action === 'delete' || action.action === 'restore'
      ? bulkEdit(tx, ws, userId, action)
      : withAudit(tx, ws.id, userId, action.ids, () => bulkEdit(tx, ws, userId, action)),
  );
}

async function bulkEdit(
  tx: Executor,
  ws: WorkspaceCtx,
  userId: string,
  action: BulkTransactionAction,
): Promise<{ updated: number; skipped: number }> {
  const rows = await tx
    .select({
      id: transactions.id,
      group: transactions.transferGroupId,
      amount: transactions.amountMinor,
    })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, ws.id), inArray(transactions.id, action.ids)));
  const ids = rows.map((r) => r.id);
  const missing = action.ids.length - ids.length;
  const bump = { updatedBy: userId, version: sql`${transactions.version} + 1` };

  switch (action.action) {
    case 'setCategory': {
      await assertCategoriesExist(tx, ws.id, [action.categoryId]);
      const regular = rows.filter((r) => r.group === null);
      const splitCounts = regular.length
        ? await tx
            .select({ id: transactionSplits.transactionId, n: sql<number>`count(*)::int` })
            .from(transactionSplits)
            .where(
              inArray(
                transactionSplits.transactionId,
                regular.map((r) => r.id),
              ),
            )
            .groupBy(transactionSplits.transactionId)
        : [];
      // Split transactions keep their lines rather than being collapsed into one category.
      const single = new Set(splitCounts.filter((s) => Number(s.n) === 1).map((s) => s.id));
      const target = regular.filter((r) => single.has(r.id)).map((r) => r.id);
      if (target.length) {
        await tx
          .update(transactionSplits)
          .set({ categoryId: action.categoryId })
          .where(inArray(transactionSplits.transactionId, target));
        await tx.update(transactions).set(bump).where(inArray(transactions.id, target));
      }
      return { updated: target.length, skipped: action.ids.length - target.length };
    }
    case 'addTags': {
      await assertTagsExist(tx, ws.id, action.tagIds);
      if (ids.length) {
        await tx
          .insert(transactionTags)
          .values(
            ids.flatMap((transactionId) =>
              action.tagIds.map((tagId) => ({ transactionId, tagId })),
            ),
          )
          .onConflictDoNothing();
        await tx.update(transactions).set(bump).where(inArray(transactions.id, ids));
      }
      return { updated: ids.length, skipped: missing };
    }
    case 'removeTags': {
      if (ids.length) {
        await tx
          .delete(transactionTags)
          .where(
            and(
              inArray(transactionTags.transactionId, ids),
              inArray(transactionTags.tagId, action.tagIds),
            ),
          );
        await tx.update(transactions).set(bump).where(inArray(transactions.id, ids));
      }
      return { updated: ids.length, skipped: missing };
    }
    case 'delete': {
      const n = await softDeleteTransactions(tx, ws.id, userId, ids);
      return { updated: n, skipped: missing };
    }
    case 'restore': {
      const n = await restoreTransactions(tx, ws.id, userId, ids);
      return { updated: n, skipped: missing };
    }
    case 'markReviewed': {
      if (ids.length) {
        await tx
          .update(transactions)
          .set({ ...bump, needsReview: false })
          .where(inArray(transactions.id, ids));
      }
      return { updated: ids.length, skipped: missing };
    }
    case 'setStatus': {
      // Reconciled transactions change only through reconciliation.
      if (action.status === 'reconciled')
        throw badRequest('Reconcile the account to mark transactions reconciled');
      const changed = ids.length
        ? await tx
            .update(transactions)
            .set({ ...bump, status: action.status })
            .where(and(inArray(transactions.id, ids), ne(transactions.status, 'reconciled')))
            .returning({ id: transactions.id })
        : [];
      return { updated: changed.length, skipped: action.ids.length - changed.length };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------------------------

export interface TransferResult {
  from: Transaction;
  to: Transaction;
}

async function transferLegs(
  db: Executor,
  workspaceId: string,
  groupId: string,
): Promise<TransferResult> {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.workspaceId, workspaceId), eq(transactions.transferGroupId, groupId)),
    );
  const hydrated = await hydrate(db, rows);
  const from = hydrated.find((t) => t.amountMinor < 0);
  const to = hydrated.find((t) => t.amountMinor > 0);
  if (!from || !to) throw notFound('Transfer');
  return { from, to };
}

export async function getTransfer(db: Db, workspaceId: string, groupId: string) {
  return transferLegs(db, workspaceId, groupId);
}

async function resolveTransferAmounts(
  db: Executor,
  workspaceId: string,
  input: {
    fromAccountId: string;
    toAccountId: string;
    amountMinor: number;
    toAmountMinor?: number | undefined;
  },
) {
  if (input.fromAccountId === input.toAccountId) throw badRequest('Choose two different accounts');
  const [from, to] = await Promise.all([
    requireAccount(db, workspaceId, input.fromAccountId),
    requireAccount(db, workspaceId, input.toAccountId),
  ]);
  if (from.currency !== to.currency && input.toAmountMinor === undefined) {
    throw badRequest(`Enter the amount received in ${to.currency}`, { field: 'toAmountMinor' });
  }
  const toAmount = from.currency === to.currency ? input.amountMinor : input.toAmountMinor!;
  return { from, to, toAmount };
}

export async function createTransfer(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  input: z.output<typeof CreateTransferSchema>,
): Promise<TransferResult> {
  const groupId = await db.transaction((tx) => insertTransfer(tx, ws.id, userId, input));
  return transferLegs(db, ws.id, groupId);
}

/** Inserts both legs of a transfer and returns their group id. */
export async function insertTransfer(
  db: Executor,
  workspaceId: string,
  userId: string | null,
  input: z.output<typeof CreateTransferSchema>,
  extra: { recurringId?: string } = {},
): Promise<string> {
  const groupId = uuidv7();
  const { from, to, toAmount } = await resolveTransferAmounts(db, workspaceId, input);
  const common = {
    workspaceId,
    date: input.date,
    notes: input.notes ?? '',
    transferGroupId: groupId,
    recurringId: extra.recurringId ?? null,
    createdBy: userId,
    updatedBy: userId,
  };
  await db.insert(transactions).values([
    { ...common, id: uuidv7(), accountId: from.id, amountMinor: -input.amountMinor },
    { ...common, id: uuidv7(), accountId: to.id, amountMinor: toAmount },
  ]);
  return groupId;
}

export async function updateTransfer(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  groupId: string,
  input: Partial<z.output<typeof CreateTransferSchema>>,
): Promise<TransferResult> {
  const current = await transferLegs(db, ws.id, groupId);
  if (current.from.deleted) throw notFound('Transfer');
  const merged = {
    fromAccountId: input.fromAccountId ?? current.from.accountId,
    toAccountId: input.toAccountId ?? current.to.accountId,
    date: input.date ?? current.from.date,
    amountMinor: input.amountMinor ?? -current.from.amountMinor,
    toAmountMinor:
      input.toAmountMinor ?? (input.amountMinor === undefined ? current.to.amountMinor : undefined),
    notes: input.notes === undefined ? current.from.notes : (input.notes ?? ''),
  };
  await db.transaction((tx) =>
    withAudit(tx, ws.id, userId, [current.from.id, current.to.id], async () => {
      const { from, to, toAmount } = await resolveTransferAmounts(tx, ws.id, merged);
      const common = {
        date: merged.date,
        notes: merged.notes,
        updatedBy: userId,
        version: sql`${transactions.version} + 1`,
      };
      await tx
        .update(transactions)
        .set({ ...common, accountId: from.id, amountMinor: -merged.amountMinor })
        .where(eq(transactions.id, current.from.id));
      await tx
        .update(transactions)
        .set({ ...common, accountId: to.id, amountMinor: toAmount })
        .where(eq(transactions.id, current.to.id));
    }),
  );
  return transferLegs(db, ws.id, groupId);
}

/** Today in the workspace's time zone. */
export function workspaceToday(ws: WorkspaceCtx) {
  return todayIn(ws.timezone);
}
