import {
  getCurrency,
  isBsSupported,
  type ListTransactionsQuerySchema,
  normalizePayeeName,
  toBsIsoString,
  toDecimalString,
  uuidv7,
  type Workspace,
} from '@et/shared';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db } from '../db/client';
import {
  accounts,
  budgets,
  categories,
  categoryGroups,
  importProfiles,
  manualRates,
  payees,
  tags,
  transactionSplits,
  transactions,
  transactionTags,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { badRequest } from '../lib/errors';
import { transactionFilters } from './transactions';
import { toWorkspaceDto } from './workspaces';

// ---------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------

/** Quotes a CSV field and neutralises spreadsheet formulas in text (CSV injection). */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportTransactionsCsv(
  db: Db,
  ws: WorkspaceCtx,
  query: Omit<z.output<typeof ListTransactionsQuerySchema>, 'cursor' | 'limit'>,
): Promise<string> {
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...transactionFilters(ws.id, query)))
    .orderBy(asc(transactions.date), asc(transactions.id));
  const ids = rows.map((r) => r.id);
  const [accountRows, catRows, groupRows, payeeRows, tagRows, splitRows, txTagRows, peers] =
    await Promise.all([
      db.select().from(accounts).where(eq(accounts.workspaceId, ws.id)),
      db.select().from(categories).where(eq(categories.workspaceId, ws.id)),
      db.select().from(categoryGroups).where(eq(categoryGroups.workspaceId, ws.id)),
      db.select().from(payees).where(eq(payees.workspaceId, ws.id)),
      db.select().from(tags).where(eq(tags.workspaceId, ws.id)),
      ids.length
        ? db.select().from(transactionSplits).where(inArray(transactionSplits.transactionId, ids))
        : [],
      ids.length
        ? db.select().from(transactionTags).where(inArray(transactionTags.transactionId, ids))
        : [],
      db
        .select({
          id: transactions.id,
          group: transactions.transferGroupId,
          accountId: transactions.accountId,
        })
        .from(transactions)
        .where(and(eq(transactions.workspaceId, ws.id), isNotNull(transactions.transferGroupId))),
    ]);
  const account = new Map(accountRows.map((a) => [a.id, a]));
  const category = new Map(catRows.map((c) => [c.id, c]));
  const group = new Map(groupRows.map((g) => [g.id, g]));
  const payee = new Map(payeeRows.map((p) => [p.id, p.name]));
  const tag = new Map(tagRows.map((t) => [t.id, t.name]));
  const splitsByTx = Map.groupBy(splitRows, (s) => s.transactionId);
  const tagsByTx = Map.groupBy(txTagRows, (t) => t.transactionId);

  const header = [
    'Date',
    'Date (BS)',
    'Account',
    'Payee',
    'Category',
    'Category group',
    'Amount',
    'Currency',
    'Type',
    'Notes',
    'Tags',
    'Status',
    'Bank description',
  ];
  const lines = [header.join(',')];
  for (const t of rows) {
    const acct = account.get(t.accountId);
    const currency = acct?.currency ?? ws.baseCurrency;
    const digits = getCurrency(currency).digits;
    const tagNames = (tagsByTx.get(t.id) ?? []).map((x) => tag.get(x.tagId) ?? '').join('; ');
    const bsDate = isBsSupported(t.date) ? toBsIsoString(t.date) : '';
    const common = (
      amount: number,
      categoryName: string,
      groupName: string,
      type: string,
      payeeName: string,
    ) =>
      [
        t.date,
        bsDate,
        csvText(acct?.name ?? ''),
        csvText(payeeName),
        csvText(categoryName),
        csvText(groupName),
        toDecimalString(amount, digits),
        currency,
        type,
        csvText(t.notes),
        csvText(tagNames),
        t.status,
        csvText(t.rawDescription),
      ].join(',');

    if (t.transferGroupId) {
      const peer = peers.find((p) => p.group === t.transferGroupId && p.id !== t.id);
      const other = peer ? (account.get(peer.accountId)?.name ?? '') : '';
      const label = t.amountMinor < 0 ? `Transfer to ${other}` : `Transfer from ${other}`;
      lines.push(common(t.amountMinor, '', '', 'Transfer', label));
      continue;
    }
    for (const s of splitsByTx.get(t.id) ?? []) {
      const cat = s.categoryId ? category.get(s.categoryId) : undefined;
      const grp = cat ? group.get(cat.groupId) : undefined;
      const type = grp?.kind === 'income' || (!grp && s.amountMinor > 0) ? 'Income' : 'Expense';
      lines.push(
        common(
          s.amountMinor,
          cat?.name ?? '',
          grp?.name ?? '',
          type,
          t.payeeId ? (payee.get(t.payeeId) ?? '') : '',
        ),
      );
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`; // BOM so Excel opens UTF-8 (Devanagari) correctly
}

// ---------------------------------------------------------------------------------------------
// Full backup and restore
// ---------------------------------------------------------------------------------------------

export const BACKUP_FORMAT = 'expense-tracker-backup';
export const BACKUP_VERSION = 1;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1);

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  workspace: z.object({
    name: z.string().min(1).max(60),
    baseCurrency: z.string().length(3),
    calendar: z.enum(['bs', 'ad']),
    monthStartDay: z.number().int().min(1).max(28),
    weekStart: z.number().int().min(0).max(6),
    timezone: z.string(),
  }),
  accounts: z.array(
    z.object({
      id,
      name: z.string(),
      type: z.enum([
        'cash',
        'checking',
        'savings',
        'credit_card',
        'e_wallet',
        'loan',
        'investment',
        'other',
      ]),
      currency: z.string().length(3),
      openingBalanceMinor: z.number().int(),
      openingDate: date,
      creditLimitMinor: z.number().int().nullable(),
      institution: z.string().nullable(),
      icon: z.string(),
      color: z.string(),
      onBudget: z.boolean(),
      inNetWorth: z.boolean(),
      sortOrder: z.number().int(),
      archived: z.boolean(),
    }),
  ),
  categoryGroups: z.array(
    z.object({
      id,
      name: z.string(),
      kind: z.enum(['expense', 'income']),
      sortOrder: z.number().int(),
      archived: z.boolean(),
    }),
  ),
  categories: z.array(
    z.object({
      id,
      groupId: id,
      name: z.string(),
      icon: z.string(),
      color: z.string(),
      sortOrder: z.number().int(),
      archived: z.boolean(),
    }),
  ),
  payees: z.array(z.object({ id, name: z.string(), defaultCategoryId: id.nullable() })),
  tags: z.array(z.object({ id, name: z.string(), color: z.string() })),
  transactions: z.array(
    z.object({
      id,
      accountId: id,
      date,
      amountMinor: z.number().int(),
      payeeId: id.nullable(),
      rawDescription: z.string(),
      notes: z.string(),
      originalAmountMinor: z.number().int().nullable(),
      originalCurrency: z.string().nullable(),
      status: z.enum(['pending', 'cleared', 'reconciled']),
      needsReview: z.boolean(),
      transferGroupId: id.nullable(),
      externalId: z.string().nullable(),
      splits: z.array(
        z.object({ categoryId: id.nullable(), amountMinor: z.number().int(), memo: z.string() }),
      ),
      tagIds: z.array(id),
    }),
  ),
  budgets: z.array(z.object({ categoryId: id, periodStart: date, amountMinor: z.number().int() })),
  manualRates: z.array(
    z.object({ base: z.string().length(3), quote: z.string().length(3), date, rate: z.string() }),
  ),
  importProfiles: z.array(z.object({ name: z.string(), mapping: z.unknown() })),
});
export type Backup = z.infer<typeof BackupSchema>;

export async function exportBackup(db: Db, ws: WorkspaceCtx): Promise<Backup> {
  const w = ws.id;
  const [
    accountRows,
    groupRows,
    catRows,
    payeeRows,
    tagRows,
    txRows,
    splitRows,
    txTagRows,
    budgetRows,
    rateRows,
    profileRows,
  ] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.workspaceId, w)).orderBy(asc(accounts.sortOrder)),
    db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.workspaceId, w))
      .orderBy(asc(categoryGroups.sortOrder)),
    db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, w))
      .orderBy(asc(categories.sortOrder)),
    db.select().from(payees).where(eq(payees.workspaceId, w)),
    db.select().from(tags).where(eq(tags.workspaceId, w)),
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.workspaceId, w)))
      .orderBy(asc(transactions.date), asc(transactions.id)),
    db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.workspaceId, w))
      .orderBy(asc(transactionSplits.sortOrder)),
    db
      .select({ transactionId: transactionTags.transactionId, tagId: transactionTags.tagId })
      .from(transactionTags)
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(eq(tags.workspaceId, w)),
    db.select().from(budgets).where(eq(budgets.workspaceId, w)),
    db.select().from(manualRates).where(eq(manualRates.workspaceId, w)),
    db.select().from(importProfiles).where(eq(importProfiles.workspaceId, w)),
  ]);
  const splitsByTx = Map.groupBy(splitRows, (s) => s.transactionId);
  const tagsByTx = Map.groupBy(txTagRows, (t) => t.transactionId);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: {
      name: ws.name,
      baseCurrency: ws.baseCurrency,
      calendar: ws.calendar,
      monthStartDay: ws.monthStartDay,
      weekStart: ws.weekStart,
      timezone: ws.timezone,
    },
    accounts: accountRows.map((a) => ({
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
      sortOrder: a.sortOrder,
      archived: a.archivedAt !== null,
    })),
    categoryGroups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      sortOrder: g.sortOrder,
      archived: g.archivedAt !== null,
    })),
    categories: catRows.map((c) => ({
      id: c.id,
      groupId: c.groupId,
      name: c.name,
      icon: c.icon,
      color: c.color,
      sortOrder: c.sortOrder,
      archived: c.archivedAt !== null,
    })),
    payees: payeeRows.map((p) => ({
      id: p.id,
      name: p.name,
      defaultCategoryId: p.defaultCategoryId,
    })),
    tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    // Transactions in the trash are left out of backups.
    transactions: txRows
      .filter((t) => t.deletedAt === null)
      .map((t) => ({
        id: t.id,
        accountId: t.accountId,
        date: t.date,
        amountMinor: t.amountMinor,
        payeeId: t.payeeId,
        rawDescription: t.rawDescription,
        notes: t.notes,
        originalAmountMinor: t.originalAmountMinor,
        originalCurrency: t.originalCurrency,
        status: t.status,
        needsReview: t.needsReview,
        transferGroupId: t.transferGroupId,
        externalId: t.externalId,
        splits: (splitsByTx.get(t.id) ?? []).map((s) => ({
          categoryId: s.categoryId,
          amountMinor: s.amountMinor,
          memo: s.memo,
        })),
        tagIds: (tagsByTx.get(t.id) ?? []).map((x) => x.tagId),
      })),
    budgets: budgetRows.map((b) => ({
      categoryId: b.categoryId,
      periodStart: b.periodStart,
      amountMinor: b.amountMinor,
    })),
    manualRates: rateRows.map((r) => ({
      base: r.base,
      quote: r.quote,
      date: r.date,
      rate: r.rate,
    })),
    importProfiles: profileRows.map((p) => ({ name: p.name, mapping: p.mapping })),
  };
}

/**
 * Restores a backup into a brand-new workspace owned by `userId`. Every id is re-generated, so
 * restoring never collides with existing data (you can restore the same backup twice).
 */
export async function restoreBackup(
  db: Db,
  userId: string,
  raw: unknown,
  name?: string,
): Promise<Workspace> {
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest('This file is not a valid backup', parsed.error.issues.slice(0, 5));
  }
  const b = parsed.data;
  const remap = new Map<string, string>();
  const newId = (old: string) => {
    let v = remap.get(old);
    if (!v) {
      v = uuidv7();
      remap.set(old, v);
    }
    return v;
  };
  const ref = (old: string | null, what: string) => {
    if (old === null) return null;
    const v = remap.get(old);
    if (!v) throw badRequest(`Backup refers to a missing ${what}`);
    return v;
  };

  const workspaceId = uuidv7();
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workspaces)
      .values({
        id: workspaceId,
        ...b.workspace,
        name: name ?? `${b.workspace.name} (restored)`.slice(0, 60),
      })
      .returning();
    await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });

    const chunk = async <T>(items: T[], insert: (part: T[]) => Promise<unknown>) => {
      for (let i = 0; i < items.length; i += 500) await insert(items.slice(i, i + 500));
    };
    const archivedAt = (archived: boolean) => (archived ? new Date() : null);

    await chunk(b.accounts, (part) =>
      tx.insert(accounts).values(
        part.map(({ id: old, archived, ...a }) => ({
          ...a,
          id: newId(old),
          workspaceId,
          archivedAt: archivedAt(archived),
        })),
      ),
    );
    await chunk(b.categoryGroups, (part) =>
      tx.insert(categoryGroups).values(
        part.map(({ id: old, archived, ...g }) => ({
          ...g,
          id: newId(old),
          workspaceId,
          archivedAt: archivedAt(archived),
        })),
      ),
    );
    await chunk(b.categories, (part) =>
      tx.insert(categories).values(
        part.map(({ id: old, archived, groupId, ...c }) => ({
          ...c,
          id: newId(old),
          groupId: ref(groupId, 'category group')!,
          workspaceId,
          archivedAt: archivedAt(archived),
        })),
      ),
    );
    await chunk(b.payees, (part) =>
      tx.insert(payees).values(
        part.map((p) => ({
          id: newId(p.id),
          workspaceId,
          name: p.name,
          normalizedName: normalizePayeeName(p.name) || p.id,
          defaultCategoryId: ref(p.defaultCategoryId, 'category'),
        })),
      ),
    );
    await chunk(b.tags, (part) =>
      tx
        .insert(tags)
        .values(part.map((t) => ({ id: newId(t.id), workspaceId, name: t.name, color: t.color }))),
    );
    await chunk(b.transactions, async (part) => {
      await tx.insert(transactions).values(
        part.map((t) => ({
          id: newId(t.id),
          workspaceId,
          accountId: ref(t.accountId, 'account')!,
          date: t.date,
          amountMinor: t.amountMinor,
          payeeId: ref(t.payeeId, 'payee'),
          rawDescription: t.rawDescription,
          notes: t.notes,
          originalAmountMinor: t.originalAmountMinor,
          originalCurrency: t.originalCurrency,
          status: t.status,
          needsReview: t.needsReview,
          transferGroupId: t.transferGroupId ? newId(`transfer:${t.transferGroupId}`) : null,
          externalId: t.externalId,
          createdBy: userId,
          updatedBy: userId,
        })),
      );
      const splits = part.flatMap((t) =>
        t.splits.map((s, i) => ({
          id: uuidv7(),
          transactionId: remap.get(t.id)!,
          workspaceId,
          categoryId: ref(s.categoryId, 'category'),
          amountMinor: s.amountMinor,
          memo: s.memo,
          sortOrder: i,
        })),
      );
      if (splits.length) await tx.insert(transactionSplits).values(splits);
      const txTags = part.flatMap((t) =>
        t.tagIds.map((tagId) => ({ transactionId: remap.get(t.id)!, tagId: ref(tagId, 'tag')! })),
      );
      if (txTags.length) await tx.insert(transactionTags).values(txTags).onConflictDoNothing();
    });
    await chunk(b.budgets, (part) =>
      tx.insert(budgets).values(
        part.map((x) => ({
          id: uuidv7(),
          workspaceId,
          categoryId: ref(x.categoryId, 'category')!,
          periodStart: x.periodStart,
          amountMinor: x.amountMinor,
        })),
      ),
    );
    await chunk(b.manualRates, (part) =>
      tx.insert(manualRates).values(part.map((r) => ({ ...r, workspaceId }))),
    );
    await chunk(b.importProfiles, (part) =>
      tx
        .insert(importProfiles)
        .values(
          part.map((p) => ({ id: uuidv7(), workspaceId, name: p.name, mapping: p.mapping ?? {} })),
        ),
    );
    return created!;
  });
  return toWorkspaceDto(row, 'owner');
}
