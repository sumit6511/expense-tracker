import {
  addDays,
  type BankConnection,
  type BankSync,
  type BankSyncResult,
  type ConnectBank,
  cleanPayeeName,
  currencyDigits,
  guessPayeeFromDescription,
  isCurrencyCode,
  parseStatementAmount,
  type Role,
  todayIn,
  type UpdateBankLink,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { type BankProvider, BankProviderError } from '../bank/provider';
import type { WorkspaceCtx } from '../context';
import type { Db } from '../db/client';
import { bankAccountLinks, bankConnections, transactions, workspaceMembers } from '../db/schema';
import type { Env } from '../env';
import { ApiError, forbidden, notFound } from '../lib/errors';
import { openSecret, sealSecret } from '../lib/secrets';
import type { Logger } from '../logger';
import { listAccounts } from './accounts';
import { commitImport, previewImport } from './imports';
import { isHidden, memberContext } from './visibility';

export interface BankDeps {
  db: Db;
  env: Env;
  bank: Partial<Record<string, BankProvider>>;
  logger: Logger;
}

const MANAGERS: readonly Role[] = ['owner', 'admin'];
/** Late-posting transactions are caught by looking back this far past the last sync. */
const LOOK_BACK_DAYS = 7;

function requireManager(ws: WorkspaceCtx) {
  if (!MANAGERS.includes(ws.role)) {
    throw forbidden('Only owners and admins can manage bank connections');
  }
}

function toMinor(amount: string | null, currency: string) {
  if (amount === null || !isCurrencyCode(currency)) return null;
  return parseStatementAmount(amount, currencyDigits(currency));
}

export async function getBankSync(deps: BankDeps, ws: WorkspaceCtx): Promise<BankSync> {
  const { db, env } = deps;
  const connections = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.workspaceId, ws.id))
    .orderBy(asc(bankConnections.createdAt));
  const links = connections.length
    ? await db
        .select()
        .from(bankAccountLinks)
        .where(
          inArray(
            bankAccountLinks.connectionId,
            connections.map((c) => c.id),
          ),
        )
        .orderBy(asc(bankAccountLinks.institution), asc(bankAccountLinks.name))
    : [];
  return {
    available: env.BANK_SYNC,
    providers: env.BANK_SYNC ? Object.values(deps.bank).flatMap((p) => (p ? [p.info] : [])) : [],
    connections: connections.map(
      (c): BankConnection => ({
        id: c.id,
        provider: c.provider as BankConnection['provider'],
        label: c.label,
        status: c.status === 'error' ? 'error' : 'ok',
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        lastError: c.lastError,
        createdAt: c.createdAt.toISOString(),
        accounts: links
          .filter((l) => l.connectionId === c.id)
          .map((l) => {
            // Someone's private account: its balance is theirs.
            const hidden = isHidden(ws, l.accountId);
            return {
              id: l.id,
              name: l.name,
              institution: l.institution,
              currency: l.currency,
              accountId: l.accountId,
              syncFrom: l.syncFrom,
              balanceMinor: hidden ? null : l.balanceMinor,
              balanceAt: hidden ? null : (l.balanceAt?.toISOString() ?? null),
            };
          }),
      }),
    ),
  };
}

function providerFor(deps: BankDeps, id: string) {
  const provider = deps.env.BANK_SYNC ? deps.bank[id] : undefined;
  if (!provider) throw new ApiError(409, 'unavailable', 'Bank sync isn’t available on this server');
  return provider;
}

const providerError = (err: unknown) =>
  err instanceof BankProviderError
    ? new ApiError(400, 'bank_error', err.message)
    : new ApiError(502, 'bank_error', 'Couldn’t reach the bank sync provider. Try again later.');

export async function connectBank(deps: BankDeps, ws: WorkspaceCtx, input: ConnectBank) {
  requireManager(ws);
  const { db, env } = deps;
  const provider = providerFor(deps, input.provider);
  let credential: string;
  let found: Awaited<ReturnType<BankProvider['fetchAccounts']>>;
  try {
    ({ credential } = await provider.connect(input.setupToken));
    // Just the accounts for now; transactions come once they're linked.
    found = await provider.fetchAccounts(credential, Math.floor(Date.now() / 1000));
  } catch (err) {
    throw providerError(err);
  }
  const institutions = [...new Set(found.accounts.map((a) => a.institution).filter(Boolean))];
  const id = uuidv7();
  const syncFrom = addDays(todayIn(ws.timezone), -30);
  await db.transaction(async (tx) => {
    await tx.insert(bankConnections).values({
      id,
      workspaceId: ws.id,
      provider: provider.info.id,
      label: institutions.join(', ') || provider.info.label,
      credentialSealed: sealSecret(env, credential),
      createdBy: ws.userId,
      lastError: found.errors.join(' ') || null,
    });
    if (found.accounts.length) {
      await tx.insert(bankAccountLinks).values(
        found.accounts.map((a) => ({
          id: uuidv7(),
          connectionId: id,
          providerAccountId: a.id,
          name: a.name.slice(0, 200),
          institution: a.institution.slice(0, 200),
          currency: a.currency.slice(0, 200),
          syncFrom,
          balanceMinor: toMinor(a.balance, a.currency),
          balanceAt: a.balanceAt ? new Date(a.balanceAt * 1000) : null,
        })),
      );
    }
  });
  return getBankSync(deps, ws);
}

async function requireLink(db: Db, ws: WorkspaceCtx, id: string) {
  const [row] = await db
    .select({ link: bankAccountLinks })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .where(and(eq(bankAccountLinks.id, id), eq(bankConnections.workspaceId, ws.id)));
  if (!row) throw notFound('Bank account');
  return row.link;
}

/** Links a bank account to one of ours (same currency), or unlinks it; sets where sync starts. */
export async function updateBankLink(
  deps: BankDeps,
  ws: WorkspaceCtx,
  id: string,
  input: UpdateBankLink,
) {
  requireManager(ws);
  const { db } = deps;
  const link = await requireLink(db, ws, id);
  if (input.accountId) {
    const account = (await listAccounts(db, ws)).find((a) => a.id === input.accountId);
    if (!account || account.archived) throw notFound('Account');
    if (account.currency !== link.currency) {
      throw new ApiError(
        400,
        'currency_mismatch',
        `This bank account is in ${link.currency}; choose an account in ${link.currency}`,
      );
    }
    const [taken] = await db
      .select({ id: bankAccountLinks.id })
      .from(bankAccountLinks)
      .where(and(eq(bankAccountLinks.accountId, account.id), ne(bankAccountLinks.id, link.id)));
    if (taken) {
      throw new ApiError(409, 'already_linked', `${account.name} is already synced from a bank`);
    }
  }
  await db
    .update(bankAccountLinks)
    .set({
      ...(input.accountId !== undefined && { accountId: input.accountId }),
      ...(input.syncFrom !== undefined && { syncFrom: input.syncFrom }),
    })
    .where(eq(bankAccountLinks.id, link.id));
  return getBankSync(deps, ws);
}

/** Disconnects (the transactions already brought in stay). */
export async function removeBankConnection(deps: BankDeps, ws: WorkspaceCtx, id: string) {
  requireManager(ws);
  const gone = await deps.db
    .delete(bankConnections)
    .where(and(eq(bankConnections.workspaceId, ws.id), eq(bankConnections.id, id)))
    .returning({ id: bankConnections.id });
  if (gone.length === 0) throw notFound('Bank connection');
  return getBankSync(deps, ws);
}

/** "Sync now" from the app (at most every two minutes per connection). */
export async function syncBankNow(
  deps: BankDeps,
  ws: WorkspaceCtx,
  id: string,
): Promise<BankSyncResult> {
  requireManager(ws);
  const [conn] = await deps.db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.workspaceId, ws.id), eq(bankConnections.id, id)));
  if (!conn) throw notFound('Bank connection');
  if (conn.lastSyncedAt && Date.now() - conn.lastSyncedAt.getTime() < 120_000) {
    throw new ApiError(429, 'too_soon', 'Synced a moment ago. Try again in a couple of minutes.');
  }
  return syncConnection(deps, conn);
}

/** Every connection, for the scheduled job. */
export async function syncAllBanks(deps: BankDeps) {
  if (!deps.env.BANK_SYNC) return;
  const all = await deps.db.select().from(bankConnections);
  for (const conn of all) {
    try {
      const result = await syncConnection(deps, conn);
      if (result.created || result.matched) {
        deps.logger.info({ connectionId: conn.id, ...result }, 'bank sync');
      }
    } catch (err) {
      deps.logger.error({ err, connectionId: conn.id }, 'bank sync failed');
    }
  }
}

/**
 * Brings in what's new from one connection. Each bank transaction is added once (its id is the
 * transaction's reference, deleted ones included, so deleting one doesn't bring it back). One
 * that looks like a transaction you already entered by hand is matched to it instead.
 */
export async function syncConnection(
  deps: BankDeps,
  conn: typeof bankConnections.$inferSelect,
): Promise<BankSyncResult> {
  const { db, env } = deps;
  const provider = deps.bank[conn.provider];
  const fail = async (message: string) => {
    await db
      .update(bankConnections)
      .set({ status: 'error', lastError: message, lastSyncedAt: new Date() })
      .where(eq(bankConnections.id, conn.id));
    return { created: 0, matched: 0, errors: [message] };
  };
  if (!env.BANK_SYNC || !provider) return fail('Bank sync is turned off on this server');

  // Work in the owner's view, but able to reach every account (a link may be to anyone's).
  const [owner] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, conn.workspaceId), eq(workspaceMembers.role, 'owner')),
    );
  const base = owner ? await memberContext(db, conn.workspaceId, owner.userId) : null;
  if (!base) return fail('The workspace has no owner');
  const ws: WorkspaceCtx = { ...base, hiddenAccountIds: [] };
  const today = todayIn(ws.timezone);

  const links = await db
    .select()
    .from(bankAccountLinks)
    .where(eq(bankAccountLinks.connectionId, conn.id));
  const linked = links.filter((l) => l.accountId);
  const toSeconds = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
  let since = linked.length
    ? Math.min(...linked.map((l) => toSeconds(l.syncFrom)))
    : Math.floor(Date.now() / 1000);
  if (conn.lastSyncedAt) {
    since = Math.max(since, conn.lastSyncedAt.getTime() / 1000 - LOOK_BACK_DAYS * 86_400);
  }

  let fetched: Awaited<ReturnType<BankProvider['fetchAccounts']>>;
  try {
    fetched = await provider.fetchAccounts(openSecret(env, conn.credentialSealed), since);
  } catch (err) {
    return fail(
      err instanceof BankProviderError
        ? err.message
        : 'Couldn’t reach the bank sync provider; it will try again later',
    );
  }

  let created = 0;
  let matched = 0;
  const errors = [...fetched.errors];
  const ours = new Map((await listAccounts(db, ws)).map((a) => [a.id, a]));
  for (const remote of fetched.accounts) {
    let link = links.find((l) => l.providerAccountId === remote.id);
    const balance = {
      name: remote.name.slice(0, 200),
      institution: remote.institution.slice(0, 200),
      balanceMinor: toMinor(remote.balance, remote.currency),
      balanceAt: remote.balanceAt ? new Date(remote.balanceAt * 1000) : null,
    };
    if (!link) {
      // A new account at the bank: listed, waiting to be linked.
      [link] = await db
        .insert(bankAccountLinks)
        .values({
          id: uuidv7(),
          connectionId: conn.id,
          providerAccountId: remote.id,
          currency: remote.currency.slice(0, 200),
          syncFrom: addDays(today, -30),
          ...balance,
        })
        .returning();
      continue;
    }
    await db.update(bankAccountLinks).set(balance).where(eq(bankAccountLinks.id, link.id));

    const account = link.accountId ? ours.get(link.accountId) : undefined;
    if (!account || account.archived) continue;
    const digits = currencyDigits(account.currency);
    const rows = remote.transactions.flatMap((t) => {
      const date = todayIn(ws.timezone, new Date(t.postedAt * 1000));
      const amountMinor = parseStatementAmount(t.amount, digits);
      if (date < link.syncFrom || amountMinor === null || amountMinor === 0) return [];
      const payee = cleanPayeeName(t.payee ?? guessPayeeFromDescription(t.description));
      return [
        {
          date,
          amountMinor,
          payee: payee.slice(0, 120),
          description: t.description.slice(0, 500),
          notes: '',
          externalId: `bank:${t.id}`.slice(0, 100),
        },
      ];
    });
    if (rows.length === 0) continue;

    // Seen before (including ones deleted since): not again.
    const seen = new Set(
      (
        await db
          .select({ ref: transactions.externalId })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, account.id),
              isNotNull(transactions.externalId),
              inArray(
                transactions.externalId,
                rows.map((r) => r.externalId),
              ),
            ),
          )
      ).map((r) => r.ref),
    );
    const fresh = rows.filter((r) => !seen.has(r.externalId));
    if (fresh.length === 0) continue;

    // Entered by hand already? Then that one gets the bank's reference instead of a copy.
    const preview = await previewImport(db, ws, account.id, fresh);
    const toAdd: typeof fresh = [];
    for (const [i, row] of fresh.entries()) {
      const duplicateOf = preview.rows[i]?.duplicateOfId;
      if (duplicateOf) {
        const claimed = await db
          .update(transactions)
          .set({ externalId: row.externalId })
          .where(and(eq(transactions.id, duplicateOf), sql`${transactions.externalId} is null`))
          .returning({ id: transactions.id });
        if (claimed.length) {
          matched++;
          continue;
        }
      }
      toAdd.push(row);
    }
    if (toAdd.length === 0) continue;
    try {
      const batch = await commitImport(db, ws, null, {
        accountId: account.id,
        fileName: `${conn.label || provider.info.label} sync`.slice(0, 200),
        source: 'bank',
        rows: toAdd.map((r) => ({ ...r, skip: false })),
      });
      created += batch.created;
    } catch (err) {
      errors.push(
        `${account.name}: ${err instanceof Error ? err.message : 'transactions couldn’t be added'}`,
      );
    }
  }

  await db
    .update(bankConnections)
    .set({ status: 'ok', lastError: errors.join(' ') || null, lastSyncedAt: new Date() })
    .where(eq(bankConnections.id, conn.id));
  return { created, matched, errors };
}
