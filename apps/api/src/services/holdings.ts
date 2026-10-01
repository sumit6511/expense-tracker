import {
  type CreateHolding,
  CreateHoldingSchema,
  currencyDigits,
  type Holding,
  type Holdings,
  holdingValueMinor,
  todayIn,
  type UpdateHolding,
  type UpdatePrices,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db } from '../db/client';
import { accounts, holdings } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { requireAccount } from './accounts';
import { holdingValue, snapshot } from './holding-values';
import { isHidden, type Scope } from './visibility';

type HoldingRow = typeof holdings.$inferSelect;

/** Postgres numeric comes back as "12.50000000"; show it without trailing zeros. */
const tidy = (n: string) => (n.includes('.') ? n.replace(/\.?0+$/, '') : n);

function toDto(row: HoldingRow, digits: number): Holding {
  const value = holdingValue(row, digits);
  return {
    id: row.id,
    accountId: row.accountId,
    symbol: row.symbol,
    name: row.name,
    quantity: tidy(row.quantity),
    costMinor: row.costMinor,
    price: row.price === null ? null : tidy(row.price),
    priceDate: row.priceDate,
    valueMinor: value,
    gainMinor: value === null ? null : value - row.costMinor,
  };
}

export async function listHoldings(db: Db, ws: WorkspaceCtx, accountId: string): Promise<Holdings> {
  const account = await requireAccount(db, ws, accountId, { allowArchived: true });
  const digits = currencyDigits(account.currency);
  const rows = await db
    .select()
    .from(holdings)
    .where(eq(holdings.accountId, account.id))
    .orderBy(asc(holdings.symbol));
  const list = rows.map((r) => toDto(r, digits));
  return {
    currency: account.currency,
    holdings: list,
    valueMinor: list.reduce((s, h) => s + (h.valueMinor ?? 0), 0),
    costMinor: list.filter((h) => h.valueMinor !== null).reduce((s, h) => s + h.costMinor, 0),
  };
}

export async function createHolding(
  db: Db,
  ws: WorkspaceCtx,
  accountId: string,
  input: CreateHolding,
) {
  const account = await requireAccount(db, ws, accountId);
  const data = CreateHoldingSchema.parse(input);
  const today = todayIn(ws.timezone);
  checkValue(data.quantity, data.price, account.currency);
  await db.insert(holdings).values({
    id: uuidv7(),
    workspaceId: ws.id,
    accountId: account.id,
    symbol: data.symbol,
    name: data.name,
    quantity: data.quantity,
    costMinor: data.costMinor,
    price: data.price,
    priceDate: data.price === null ? null : (data.priceDate ?? today),
  });
  await snapshot(db, account.id, today);
  return listHoldings(db, ws, account.id);
}

/** Refuses amounts too large to count safely. */
function checkValue(quantity: string, price: string | null, currency: string) {
  if (price === null) return;
  try {
    holdingValueMinor(quantity, price, currencyDigits(currency));
  } catch {
    throw badRequest('That holding is worth more than can be counted');
  }
}

async function requireHolding(db: Db, scope: Scope, id: string) {
  const [row] = await db
    .select({ holding: holdings, currency: accounts.currency })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(eq(holdings.workspaceId, scope.id), eq(holdings.id, id)));
  if (!row || isHidden(scope, row.holding.accountId)) throw notFound('Holding');
  return row;
}

export async function updateHolding(db: Db, ws: WorkspaceCtx, id: string, input: UpdateHolding) {
  const { holding, currency } = await requireHolding(db, ws, id);
  const today = todayIn(ws.timezone);
  const priceChanged = input.price !== undefined && input.price !== holding.price;
  checkValue(input.quantity ?? holding.quantity, input.price ?? holding.price, currency);
  await db
    .update(holdings)
    .set({
      ...(input.symbol !== undefined && { symbol: input.symbol }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.quantity !== undefined && { quantity: input.quantity }),
      ...(input.costMinor !== undefined && { costMinor: input.costMinor }),
      ...(input.price !== undefined && { price: input.price }),
      ...((input.priceDate !== undefined || priceChanged) && {
        priceDate: input.price === null ? null : (input.priceDate ?? today),
      }),
    })
    .where(eq(holdings.id, holding.id));
  await snapshot(db, holding.accountId, today);
  return listHoldings(db, ws, holding.accountId);
}

export async function deleteHolding(db: Db, ws: WorkspaceCtx, id: string) {
  const { holding } = await requireHolding(db, ws, id);
  await db.delete(holdings).where(eq(holdings.id, holding.id));
  await snapshot(db, holding.accountId, todayIn(ws.timezone));
  return listHoldings(db, ws, holding.accountId);
}

/** New prices for several holdings in one account. */
export async function updatePrices(
  db: Db,
  ws: WorkspaceCtx,
  accountId: string,
  input: UpdatePrices,
) {
  const account = await requireAccount(db, ws, accountId);
  const date = input.date ?? todayIn(ws.timezone);
  const ids = input.prices.map((p) => p.holdingId);
  const found = await db
    .select({ id: holdings.id, quantity: holdings.quantity })
    .from(holdings)
    .where(and(eq(holdings.accountId, account.id), inArray(holdings.id, ids)));
  if (found.length !== new Set(ids).size) throw notFound('Holding');
  await db.transaction(async (tx) => {
    for (const p of input.prices) {
      checkValue(found.find((f) => f.id === p.holdingId)!.quantity, p.price, account.currency);
      await tx
        .update(holdings)
        .set({ price: p.price, priceDate: date })
        .where(eq(holdings.id, p.holdingId));
    }
  });
  await snapshot(db, account.id, todayIn(ws.timezone));
  return listHoldings(db, ws, account.id);
}
