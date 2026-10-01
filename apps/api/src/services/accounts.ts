import {
  ACCOUNT_PRESETS,
  type Account,
  type CreateAccountSchema,
  todayIn,
  type UpdateAccountSchema,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { accounts, transactions } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { holdingsValueByAccount } from './holding-values';
import { loadRateBook } from './rates';
import { isHidden, type Scope, scopeId, visibleAccount } from './visibility';

type AccountRow = typeof accounts.$inferSelect;

const balanceColumns = {
  txSum: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.deletedAt} is null), 0)::bigint`,
  txCount: sql<number>`count(${transactions.id}) filter (where ${transactions.deletedAt} is null)::int`,
  lastDate: sql<
    string | null
  >`max(${transactions.date}) filter (where ${transactions.deletedAt} is null)::text`,
  clearedSum: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.deletedAt} is null and ${transactions.status} <> 'pending'), 0)::bigint`,
  pendingCount: sql<number>`count(${transactions.id}) filter (where ${transactions.deletedAt} is null and ${transactions.status} = 'pending')::int`,
  // Qualified by hand: correlated subqueries don't get table prefixes from Drizzle.
  reconciledThrough: sql<
    string | null
  >`(select max(r.statement_date)::text from reconciliations r where r.account_id = "accounts"."id")`,
};

async function withBalances(
  db: Executor,
  ws: WorkspaceCtx,
  where: ReturnType<typeof and>,
): Promise<Account[]> {
  const rows = await db
    .select({ account: accounts, ...balanceColumns })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(and(where, visibleAccount(ws, accounts.id)))
    .groupBy(accounts.id)
    .orderBy(sql`${accounts.archivedAt} is not null`, asc(accounts.sortOrder), asc(accounts.name));

  const today = todayIn(ws.timezone);
  const rates = await loadRateBook(
    db,
    ws.id,
    rows.map((r) => r.account.currency),
    ws.baseCurrency,
    today,
    today,
  );
  const invested = await holdingsValueByAccount(
    db,
    rows.map((r) => r.account.id),
  );
  return rows.map(
    ({ account, txSum, txCount, lastDate, clearedSum, pendingCount, reconciledThrough }) => {
      const balance = account.openingBalanceMinor + Number(txSum);
      const holdingsValue = invested.get(account.id) ?? null;
      return toAccountDto(account, {
        balance,
        balanceBase: rates.convert(balance, account.currency, ws.baseCurrency, today),
        holdingsValue,
        holdingsValueBase:
          holdingsValue === null
            ? null
            : rates.convert(holdingsValue, account.currency, ws.baseCurrency, today),
        cleared: account.openingBalanceMinor + Number(clearedSum),
        pendingCount: Number(pendingCount),
        reconciledThrough,
        count: Number(txCount),
        lastDate,
      });
    },
  );
}

function toAccountDto(
  a: AccountRow,
  stats: {
    balance: number;
    balanceBase: number | null;
    holdingsValue: number | null;
    holdingsValueBase: number | null;
    cleared: number;
    pendingCount: number;
    reconciledThrough: string | null;
    count: number;
    lastDate: string | null;
  },
): Account {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    openingBalanceMinor: a.openingBalanceMinor,
    openingDate: a.openingDate,
    creditLimitMinor: a.creditLimitMinor,
    institution: a.institution,
    icon: a.icon,
    color: a.color,
    onBudget: a.onBudget,
    inNetWorth: a.inNetWorth,
    visibility: a.visibility,
    ownerUserId: a.ownerUserId,
    archived: a.archivedAt !== null,
    sortOrder: a.sortOrder,
    balanceMinor: stats.balance,
    balanceBaseMinor: stats.balanceBase,
    clearedBalanceMinor: stats.cleared,
    holdingsValueMinor: stats.holdingsValue,
    holdingsValueBaseMinor: stats.holdingsValueBase,
    pendingCount: stats.pendingCount,
    reconciledThrough: stats.reconciledThrough,
    transactionCount: stats.count,
    lastTransactionDate: stats.lastDate,
  };
}

export async function listAccounts(db: Db, ws: WorkspaceCtx): Promise<Account[]> {
  return withBalances(db, ws, and(eq(accounts.workspaceId, ws.id)));
}

export async function getAccount(db: Executor, ws: WorkspaceCtx, id: string): Promise<Account> {
  const [account] = await withBalances(
    db,
    ws,
    and(eq(accounts.workspaceId, ws.id), eq(accounts.id, id)),
  );
  if (!account) throw notFound('Account');
  return account;
}

/**
 * Loads an account row and checks it belongs to the workspace and that the person asking can
 * see it (someone else's private account is "not found", like one in another workspace).
 */
export async function requireAccount(
  db: Executor,
  scope: Scope,
  id: string,
  options: { allowArchived?: boolean } = {},
): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.workspaceId, scopeId(scope)), eq(accounts.id, id)))
    .limit(1);
  if (!row || isHidden(scope, row.id)) throw notFound('Account');
  if (row.archivedAt && !options.allowArchived) {
    throw badRequest(`"${row.name}" is archived. Unarchive it to add transactions.`);
  }
  return row;
}

export async function createAccount(
  db: Db,
  ws: WorkspaceCtx,
  input: z.output<typeof CreateAccountSchema>,
): Promise<Account> {
  const preset = ACCOUNT_PRESETS.find((p) => p.type === input.type);
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${accounts.sortOrder}) + 1, 0)::int` })
    .from(accounts)
    .where(eq(accounts.workspaceId, ws.id));
  const id = uuidv7();
  await db.insert(accounts).values({
    id,
    workspaceId: ws.id,
    name: input.name,
    type: input.type,
    currency: input.currency,
    openingBalanceMinor: input.openingBalanceMinor,
    openingDate: input.openingDate ?? todayIn(ws.timezone),
    creditLimitMinor: input.creditLimitMinor ?? null,
    institution: input.institution ?? null,
    icon: input.icon ?? preset?.icon ?? 'wallet',
    color: input.color ?? preset?.color ?? '#64748b',
    onBudget: input.onBudget,
    inNetWorth: input.inNetWorth,
    visibility: input.visibility,
    ownerUserId: ws.userId,
    sortOrder: Number(next),
  });
  return getAccount(db, ws, id);
}

export async function updateAccount(
  db: Db,
  ws: WorkspaceCtx,
  id: string,
  input: z.output<typeof UpdateAccountSchema>,
): Promise<Account> {
  const row = await requireAccount(db, ws, id, { allowArchived: true });
  if (input.visibility && input.visibility !== row.visibility && row.ownerUserId !== ws.userId) {
    throw forbidden('Only the person who added this account can change who sees it');
  }
  const { archived, ...rest } = input;
  const patch: Partial<typeof accounts.$inferInsert> = { ...rest };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  if (Object.keys(patch).length > 0) {
    await db
      .update(accounts)
      .set(patch)
      .where(and(eq(accounts.workspaceId, ws.id), eq(accounts.id, id)));
  }
  return getAccount(db, ws, id);
}

/**
 * Deletes an account. Refused while it still has transactions: archive it instead, or delete
 * the transactions first. Transactions already in the trash are purged with it.
 */
export async function deleteAccount(db: Db, ws: WorkspaceCtx, id: string): Promise<void> {
  await requireAccount(db, ws, id, { allowArchived: true });
  await db.transaction(async (tx) => {
    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.accountId, id), isNull(transactions.deletedAt)));
    if (Number(live?.n) > 0) {
      throw conflict(
        'This account has transactions. Archive it instead, or delete its transactions first.',
      );
    }
    const trashedTransfers = await tx
      .select({ group: transactions.transferGroupId })
      .from(transactions)
      .where(and(eq(transactions.accountId, id), isNotNull(transactions.transferGroupId)));
    const groups = trashedTransfers.map((t) => t.group).filter((g): g is string => g !== null);
    // A trashed transfer's other leg (in another account) goes too, so no half-transfer is left.
    for (const group of groups) {
      await tx.delete(transactions).where(eq(transactions.transferGroupId, group));
    }
    await tx.delete(transactions).where(eq(transactions.accountId, id));
    await tx.delete(accounts).where(and(eq(accounts.workspaceId, ws.id), eq(accounts.id, id)));
  });
}
