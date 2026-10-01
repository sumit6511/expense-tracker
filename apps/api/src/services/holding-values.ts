import { currencyDigits, holdingValueMinor, type IsoDate, todayIn } from '@et/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { accounts, holdings, holdingValues, workspaces } from '../db/schema';

/** What holdings are worth, now and over time (kept apart so account balances can use it). */

export function holdingValue(
  row: { quantity: string; price: string | null },
  digits: number,
): number | null {
  return row.price === null ? null : holdingValueMinor(row.quantity, row.price, digits);
}

/** Current market value of each account's holdings (accounts without any are left out). */
export async function holdingsValueByAccount(db: Executor, accountIds: string[]) {
  if (accountIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      accountId: holdings.accountId,
      quantity: holdings.quantity,
      price: holdings.price,
      currency: accounts.currency,
    })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(inArray(holdings.accountId, accountIds));
  const values = new Map<string, number>();
  for (const r of rows) {
    values.set(
      r.accountId,
      (values.get(r.accountId) ?? 0) + (holdingValue(r, currencyDigits(r.currency)) ?? 0),
    );
  }
  return values;
}

/** Records what an account's holdings are worth today. */
export async function snapshot(db: Executor, accountId: string, date: IsoDate) {
  const value = (await holdingsValueByAccount(db, [accountId])).get(accountId) ?? 0;
  await db
    .insert(holdingValues)
    .values({ accountId, date, valueMinor: value })
    .onConflictDoUpdate({
      target: [holdingValues.accountId, holdingValues.date],
      set: { valueMinor: value },
    });
}

/** The daily snapshot for every account with holdings (each in its workspace's today). */
export async function snapshotAllHoldings(db: Db) {
  const rows = await db
    .selectDistinct({ accountId: holdings.accountId, timezone: workspaces.timezone })
    .from(holdings)
    .innerJoin(workspaces, eq(workspaces.id, holdings.workspaceId));
  for (const r of rows) await snapshot(db, r.accountId, todayIn(r.timezone));
}

/**
 * Holdings value of each account on each date: the latest snapshot on or before it (0 before the
 * first one). For net worth over time.
 */
export async function holdingValuesOn(db: Executor, accountIds: string[], dates: IsoDate[]) {
  const result = new Map<string, Map<IsoDate, number>>();
  if (accountIds.length === 0 || dates.length === 0) return result;
  const rows = await db
    .select()
    .from(holdingValues)
    .where(
      and(
        inArray(holdingValues.accountId, accountIds),
        sql`${holdingValues.date} <= ${dates.reduce((a, b) => (a > b ? a : b))}`,
      ),
    )
    .orderBy(asc(holdingValues.date));
  for (const id of accountIds) {
    const own = rows.filter((r) => r.accountId === id);
    if (own.length === 0) continue;
    const perDate = new Map<IsoDate, number>();
    for (const date of dates) {
      const latest = own.filter((r) => r.date <= date).at(-1);
      perDate.set(date, latest?.valueMinor ?? 0);
    }
    result.set(id, perDate);
  }
  return result;
}
