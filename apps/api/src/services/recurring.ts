import {
  addDays,
  type IsoDate,
  indexOnOrAfter,
  occurrenceAt,
  occurrencesUntil,
  perMonth,
  type RecordRecurringSchema,
  type Recurring,
  type RecurringBody,
  RecurringBodySchema,
  type Schedule,
  type UpcomingItem,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { accounts, payees, recurring, tags, workspaces } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import type { Logger } from '../logger';
import { requireAccount } from './accounts';
import { assertCategoriesExist } from './categories';
import { deliver, recordedCandidate } from './notifications';
import { findOrCreatePayee } from './payees';
import { loadRateBook } from './rates';
import { assertTagsExist } from './tags';
import { getTransaction, insertTransaction, insertTransfer, workspaceToday } from './transactions';
import { isHidden, type Scope, systemScope, visibleAccount } from './visibility';

type Row = typeof recurring.$inferSelect;

const scheduleOf = (r: Row): Schedule => ({
  frequency: r.frequency,
  interval: r.interval,
  calendar: r.calendar,
  startDate: r.startDate,
  lastDayOfMonth: r.lastDayOfMonth,
});

/** Signed amount of one occurrence, as seen from the (source) account. */
const signedAmount = (kind: Row['kind'], amount: number) => (kind === 'income' ? amount : -amount);

/** The date of occurrence `index`, or null if the series has ended by then. */
function dateOrEnd(
  r: Pick<Row, 'endDate'>,
  schedule: Schedule,
  index: number,
  remaining: number | null,
) {
  if (remaining !== null && remaining <= 0) return null;
  const date = occurrenceAt(schedule, index);
  if (date === null || (r.endDate && date > r.endDate)) return null;
  return date;
}

/** Moves a series past its next occurrence. */
function advanced(r: Row) {
  const nextIndex = r.nextIndex + 1;
  const remaining = r.remaining === null ? null : r.remaining - 1;
  return { nextIndex, remaining, nextDate: dateOrEnd(r, scheduleOf(r), nextIndex, remaining) };
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

async function toDtos(db: Executor, ws: WorkspaceCtx, rows: Row[]): Promise<Recurring[]> {
  if (rows.length === 0) return [];
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const payeeIds = [...new Set(rows.map((r) => r.payeeId).filter((p): p is string => !!p))];
  const [accountRows, payeeRows] = await Promise.all([
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(inArray(accounts.id, accountIds)),
    payeeIds.length
      ? db
          .select({ id: payees.id, name: payees.name })
          .from(payees)
          .where(inArray(payees.id, payeeIds))
      : Promise.resolve([]),
  ]);
  const currency = new Map(accountRows.map((a) => [a.id, a.currency]));
  const payeeName = new Map(payeeRows.map((p) => [p.id, p.name]));
  const today = workspaceToday(ws);
  const book = await loadRateBook(
    db,
    ws.id,
    [...new Set(currency.values())],
    ws.baseCurrency,
    addDays(today, -30),
    today,
  );
  return rows.map((r) => {
    const cur = currency.get(r.accountId) ?? ws.baseCurrency;
    const monthly =
      r.kind === 'transfer'
        ? 0
        : book.convert(
            Math.round(signedAmount(r.kind, r.amountMinor) * perMonth(r.frequency, r.interval)),
            cur,
            ws.baseCurrency,
            today,
          );
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      accountId: r.accountId,
      toAccountId: r.toAccountId,
      currency: cur,
      amountMinor: r.amountMinor,
      toAmountMinor: r.toAmountMinor,
      variableAmount: r.variableAmount,
      payeeName: r.payeeId ? (payeeName.get(r.payeeId) ?? null) : null,
      categoryId: r.categoryId,
      notes: r.notes,
      tagIds: r.tagIds,
      frequency: r.frequency,
      interval: r.interval,
      calendar: r.calendar,
      lastDayOfMonth: r.lastDayOfMonth,
      nextDate: r.nextDate,
      endDate: r.endDate,
      remaining: r.remaining,
      mode: r.mode,
      remindDaysBefore: r.remindDaysBefore,
      active: r.active,
      lastPostedDate: r.lastPostedDate,
      monthlyBaseMinor: monthly,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** A series the person can see: one moving money in or out of a hidden account is hidden too. */
async function requireRow(db: Executor, scope: Scope, id: string, lock = false) {
  const query = db
    .select()
    .from(recurring)
    .where(and(eq(recurring.workspaceId, scope.id), eq(recurring.id, id)))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row || isHidden(scope, row.accountId) || isHidden(scope, row.toAccountId))
    throw notFound('Recurring transaction');
  return row;
}

/** Only series the person can see. */
const visibleSeries = (scope: Scope) =>
  and(visibleAccount(scope, recurring.accountId), visibleAccount(scope, recurring.toAccountId));

export async function listRecurring(db: Executor, ws: WorkspaceCtx): Promise<Recurring[]> {
  const rows = await db
    .select()
    .from(recurring)
    .where(and(eq(recurring.workspaceId, ws.id), visibleSeries(ws)))
    .orderBy(sql`${recurring.nextDate} asc nulls last`, asc(recurring.name));
  return toDtos(db, ws, rows);
}

export async function getRecurring(db: Executor, ws: WorkspaceCtx, id: string) {
  const [dto] = await toDtos(db, ws, [await requireRow(db, ws, id)]);
  return dto!;
}

export interface ScheduledOccurrence {
  recurringId: string;
  name: string;
  kind: Row['kind'];
  date: IsoDate;
  index: number;
  isNext: boolean;
  accountId: string;
  currency: string;
  toAccountId: string | null;
  toCurrency: string | null;
  /** Positive; the usual amount for a variable bill. */
  amountMinor: number;
  /** Transfers: what arrives (null = the same as `amountMinor`). */
  toAmountMinor: number | null;
  categoryId: string | null;
  variableAmount: boolean;
  mode: Row['mode'];
  /** A reminder whose date has passed without being recorded or skipped. */
  overdue: boolean;
}

/**
 * Every occurrence of the active series up to `until` (and reminders already overdue), at most
 * `perSeries` of each.
 */
export async function scheduledOccurrences(
  db: Executor,
  ws: WorkspaceCtx,
  until: IsoDate,
  perSeries: number,
): Promise<ScheduledOccurrence[]> {
  const today = workspaceToday(ws);
  const toAccounts = alias(accounts, 'to_accounts');
  const rows = await db
    .select({ r: recurring, currency: accounts.currency, toCurrency: toAccounts.currency })
    .from(recurring)
    .innerJoin(accounts, eq(accounts.id, recurring.accountId))
    .leftJoin(toAccounts, eq(toAccounts.id, recurring.toAccountId))
    .where(
      and(
        eq(recurring.workspaceId, ws.id),
        eq(recurring.active, true),
        isNotNull(recurring.nextDate),
        sql`${recurring.nextDate} <= ${until}`,
        visibleSeries(ws),
      ),
    );
  const out: ScheduledOccurrence[] = [];
  for (const { r, currency, toCurrency } of rows) {
    const schedule = scheduleOf(r);
    for (const { index, date } of occurrencesUntil(schedule, r.nextIndex, until, perSeries)) {
      const remaining = r.remaining === null ? null : r.remaining - (index - r.nextIndex);
      if (dateOrEnd(r, schedule, index, remaining) === null) break;
      out.push({
        recurringId: r.id,
        name: r.name,
        kind: r.kind,
        date,
        index,
        isNext: index === r.nextIndex,
        accountId: r.accountId,
        currency,
        toAccountId: r.toAccountId,
        toCurrency,
        amountMinor: r.amountMinor,
        toAmountMinor: r.toAmountMinor,
        categoryId: r.categoryId,
        variableAmount: r.variableAmount,
        mode: r.mode,
        overdue: r.mode === 'remind' && date < today,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Everything due in the next `days` days (and reminders already overdue), soonest first. */
export async function upcoming(db: Db, ws: WorkspaceCtx, days: number): Promise<UpcomingItem[]> {
  const occurrences = await scheduledOccurrences(db, ws, addDays(workspaceToday(ws), days), 12);
  return occurrences.map((o) => ({
    recurringId: o.recurringId,
    name: o.name,
    kind: o.kind,
    date: o.date,
    amountMinor: signedAmount(o.kind, o.amountMinor),
    currency: o.currency,
    accountId: o.accountId,
    categoryId: o.categoryId,
    variableAmount: o.variableAmount,
    mode: o.mode,
    overdue: o.overdue,
    isNext: o.isNext,
  }));
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

async function validateRefs(db: Executor, ws: WorkspaceCtx, body: RecurringBody) {
  const from = await requireAccount(db, ws, body.accountId);
  if (body.kind === 'transfer') {
    const to = await requireAccount(db, ws, body.toAccountId!);
    if (from.currency !== to.currency && body.toAmountMinor === null && !body.variableAmount) {
      throw badRequest(`Enter the amount received in ${to.currency}`, { field: 'toAmountMinor' });
    }
  } else {
    await assertCategoriesExist(db, ws.id, [body.categoryId]);
  }
  await assertTagsExist(db, ws.id, body.tagIds);
}

function columns(body: RecurringBody, payeeId: string | null) {
  const transfer = body.kind === 'transfer';
  return {
    name: body.name,
    kind: body.kind,
    accountId: body.accountId,
    toAccountId: transfer ? body.toAccountId : null,
    amountMinor: body.amountMinor,
    toAmountMinor: transfer ? body.toAmountMinor : null,
    variableAmount: body.variableAmount,
    payeeId: transfer ? null : payeeId,
    categoryId: transfer ? null : body.categoryId,
    notes: body.notes,
    tagIds: transfer ? [] : body.tagIds,
    frequency: body.frequency,
    interval: body.interval,
    calendar: body.calendar,
    lastDayOfMonth: body.lastDayOfMonth,
    endDate: body.endDate,
    remaining: body.remaining,
    mode: body.mode,
    remindDaysBefore: body.remindDaysBefore,
    active: body.active,
  };
}

export async function createRecurring(db: Db, ws: WorkspaceCtx, body: RecurringBody) {
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await validateRefs(tx, ws, body);
    const payeeId =
      body.kind === 'transfer' ? null : await findOrCreatePayee(tx, ws.id, body.payee);
    await tx.insert(recurring).values({
      id,
      workspaceId: ws.id,
      ...columns(body, payeeId),
      startDate: body.nextDate,
      nextIndex: 0,
      nextDate: body.nextDate,
    });
  });
  return getRecurring(db, ws, id);
}

const SCHEDULE_FIELDS = [
  'frequency',
  'interval',
  'calendar',
  'nextDate',
  'lastDayOfMonth',
] as const;

export async function updateRecurring(
  db: Db,
  ws: WorkspaceCtx,
  id: string,
  patch: Partial<RecurringBody>,
) {
  await db.transaction(async (tx) => {
    const row = await requireRow(tx, ws, id, true);
    const [current] = await toDtos(tx, ws, [row]);
    const parsed = RecurringBodySchema.safeParse({
      ...current,
      payee: current!.payeeName,
      nextDate: current!.nextDate ?? row.lastPostedDate ?? row.startDate,
      ...patch,
    });
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid');
    const body = parsed.data;
    await validateRefs(tx, ws, body);
    const payeeId =
      body.kind === 'transfer'
        ? null
        : patch.payee !== undefined
          ? await findOrCreatePayee(tx, ws.id, body.payee)
          : row.payeeId;
    const rescheduled = SCHEDULE_FIELDS.some(
      (f) => patch[f] !== undefined && patch[f] !== (current as Record<string, unknown>)[f],
    );
    // A new schedule is anchored at the chosen next date. Resuming a paused series skips the
    // occurrences missed while it was paused.
    const next = rescheduled
      ? { startDate: body.nextDate, nextIndex: 0 }
      : !row.active && body.active && row.nextDate && row.nextDate < workspaceToday(ws)
        ? {
            startDate: row.startDate,
            nextIndex: indexOnOrAfter(scheduleOf(row), workspaceToday(ws)),
          }
        : { startDate: row.startDate, nextIndex: row.nextIndex };
    const updated = { ...row, ...columns(body, payeeId), ...next };
    await tx
      .update(recurring)
      .set({
        ...columns(body, payeeId),
        ...next,
        nextDate: dateOrEnd(updated, scheduleOf(updated), next.nextIndex, body.remaining),
      })
      .where(eq(recurring.id, id));
  });
  return getRecurring(db, ws, id);
}

export async function deleteRecurring(db: Db, scope: Scope, id: string) {
  await requireRow(db, scope, id);
  await db.delete(recurring).where(and(eq(recurring.workspaceId, scope.id), eq(recurring.id, id)));
}

/** Records one occurrence as a transaction (or transfer) and returns its id. */
async function post(
  tx: Executor,
  scope: Scope,
  r: Row,
  userId: string | null,
  occurrence: { date: IsoDate; amountMinor: number; toAmountMinor?: number; accountId?: string },
) {
  const accountId = occurrence.accountId ?? r.accountId;
  if (r.kind === 'transfer') {
    const groupId = await insertTransfer(
      tx,
      scope,
      userId,
      {
        fromAccountId: accountId,
        toAccountId: r.toAccountId!,
        date: occurrence.date,
        amountMinor: occurrence.amountMinor,
        toAmountMinor: occurrence.toAmountMinor ?? r.toAmountMinor ?? undefined,
        notes: r.notes || null,
      },
      { recurringId: r.id },
    );
    const [leg] = await tx
      .execute<{ id: string }>(
        sql`select id from transactions where transfer_group_id = ${groupId} and amount_minor < 0`,
      )
      .then((res) => res.rows);
    return leg!.id;
  }
  const account = await requireAccount(tx, scope, accountId);
  // Tags deleted since the series was set up are dropped.
  const liveTags = r.tagIds.length
    ? (
        await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.workspaceId, r.workspaceId), inArray(tags.id, r.tagIds)))
      ).map((t) => t.id)
    : [];
  return insertTransaction(
    tx,
    r.workspaceId,
    userId,
    account.currency,
    {
      accountId,
      date: occurrence.date,
      amountMinor: signedAmount(r.kind, occurrence.amountMinor),
      categoryId: r.categoryId,
      notes: r.notes || null,
      tagIds: liveTags,
      recurringId: r.id,
    },
    r.payeeId,
  );
}

export async function recordOccurrence(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  id: string,
  input: z.output<typeof RecordRecurringSchema>,
) {
  const transactionId = await db.transaction(async (tx) => {
    const r = await requireRow(tx, ws, id, true);
    if (!r.nextDate) throw conflict('This series has ended');
    const txId = await post(tx, ws, r, userId, {
      date: input.date ?? r.nextDate,
      amountMinor: input.amountMinor ?? r.amountMinor,
      ...(input.toAmountMinor !== undefined && { toAmountMinor: input.toAmountMinor }),
      ...(input.accountId !== undefined && { accountId: input.accountId }),
    });
    await tx
      .update(recurring)
      .set({ ...advanced(r), lastPostedDate: input.date ?? r.nextDate })
      .where(eq(recurring.id, r.id));
    return txId;
  });
  return {
    transaction: await getTransaction(db, ws, transactionId),
    recurring: await getRecurring(db, ws, id),
  };
}

export async function skipOccurrence(db: Db, ws: WorkspaceCtx, id: string) {
  await db.transaction(async (tx) => {
    const r = await requireRow(tx, ws, id, true);
    if (!r.nextDate) throw conflict('This series has ended');
    await tx.update(recurring).set(advanced(r)).where(eq(recurring.id, r.id));
  });
  return getRecurring(db, ws, id);
}

/**
 * Records every automatic occurrence that is due (in each workspace's own time zone). Runs from
 * the job worker; catching up after downtime is capped per series so a daily item can't flood
 * the ledger.
 */
export async function postDueRecurring(db: Db, logger?: Logger, now: Date = new Date()) {
  const due = await db
    .select({
      id: recurring.id,
      workspaceId: recurring.workspaceId,
      timezone: workspaces.timezone,
      calendar: workspaces.calendar,
    })
    .from(recurring)
    .innerJoin(workspaces, eq(workspaces.id, recurring.workspaceId))
    .where(
      and(
        eq(recurring.active, true),
        eq(recurring.mode, 'auto'),
        isNotNull(recurring.nextDate),
        sql`${recurring.nextDate} <= (${now.toISOString()}::timestamptz at time zone ${workspaces.timezone})::date`,
      ),
    );
  let posted = 0;
  for (const item of due) {
    try {
      const done = await db.transaction(async (tx) => {
        const system = systemScope(item.workspaceId);
        let r = await requireRow(tx, system, item.id, true);
        const today = await tx
          .execute<{ d: string }>(
            sql`select ((${now.toISOString()}::timestamptz at time zone ${item.timezone})::date)::text as d`,
          )
          .then((res) => res.rows[0]!.d);
        let n = 0;
        while (r.active && r.mode === 'auto' && r.nextDate && r.nextDate <= today && n < 60) {
          await post(tx, system, r, null, { date: r.nextDate, amountMinor: r.amountMinor });
          const next = advanced(r);
          await tx
            .update(recurring)
            .set({ ...next, lastPostedDate: r.nextDate })
            .where(eq(recurring.id, r.id));
          r = { ...r, ...next, lastPostedDate: r.nextDate };
          n++;
        }
        return { n, r };
      });
      posted += done.n;
      if (done.n > 0) {
        const involved = await db
          .select({
            id: accounts.id,
            currency: accounts.currency,
            visibility: accounts.visibility,
            owner: accounts.ownerUserId,
          })
          .from(accounts)
          .where(
            inArray(
              accounts.id,
              [done.r.accountId, done.r.toAccountId].filter((a): a is string => !!a),
            ),
          );
        const account = involved.find((a) => a.id === done.r.accountId);
        // Money in or out of a private account is news only for its owner.
        const owners = [
          ...new Set(involved.filter((a) => a.visibility === 'private').map((a) => a.owner)),
        ];
        const onlyFor =
          owners.length === 0 ? undefined : owners.length === 1 && owners[0] ? [owners[0]] : [];
        await deliver(
          db,
          item.workspaceId,
          [
            recordedCandidate({
              recurringId: done.r.id,
              name: done.r.name,
              kind: done.r.kind,
              count: done.n,
              lastDate: done.r.lastPostedDate!,
              amountMinor: done.r.amountMinor,
              currency: account?.currency ?? 'NPR',
              calendar: item.calendar,
            }),
          ],
          onlyFor,
        );
      }
    } catch (err) {
      // e.g. the account was archived: leave it due so the person sees it.
      logger?.warn({ err, recurringId: item.id }, 'could not record recurring transaction');
    }
  }
  if (posted) logger?.info({ posted }, 'recorded recurring transactions');
  return posted;
}
