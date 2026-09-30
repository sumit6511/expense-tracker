import {
  addDays,
  type CommitImportSchema,
  findDuplicates,
  type ImportBatch,
  type ImportPreview,
  type ImportProfile,
  type ImportRowSchema,
  normalizePayeeName,
  uuidv7,
} from '@et/shared';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { importBatches, importProfiles, payees, transactions } from '../db/schema';
import { notFound } from '../lib/errors';
import { requireAccount } from './accounts';
import { assertCategoriesExist } from './categories';
import { findOrCreatePayee, learnedCategories } from './payees';
import { insertTransaction, softDeleteTransactions } from './transactions';

type ImportRowInput = z.output<typeof ImportRowSchema>;

/** Existing live transactions in the account around the import's date range. */
async function existingForDuplicates(db: Executor, accountId: string, rows: ImportRowInput[]) {
  const dates = rows.map((r) => r.date).sort();
  const from = addDays(dates[0]!, -7);
  const to = addDays(dates.at(-1)!, 7);
  const existing = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountMinor: transactions.amountMinor,
      externalId: transactions.externalId,
      payee: payees.name,
    })
    .from(transactions)
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    );
  // Bank reference numbers are compared across the whole account history, not just the window.
  const refs = [...new Set(rows.map((r) => r.externalId).filter((x): x is string => !!x))];
  const byRef = refs.length
    ? await db
        .select({
          id: transactions.id,
          date: transactions.date,
          amountMinor: transactions.amountMinor,
          externalId: transactions.externalId,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            isNull(transactions.deletedAt),
            inArray(transactions.externalId, refs),
          ),
        )
    : [];
  const seen = new Set(existing.map((e) => e.id));
  return [...existing, ...byRef.filter((e) => !seen.has(e.id)).map((e) => ({ ...e, payee: null }))];
}

async function payeeLookup(db: Executor, workspaceId: string, names: string[]) {
  const normalized = [...new Set(names.map(normalizePayeeName).filter(Boolean))];
  if (normalized.length === 0)
    return new Map<string, { id: string; defaultCategoryId: string | null }>();
  const rows = await db
    .select({
      id: payees.id,
      normalizedName: payees.normalizedName,
      defaultCategoryId: payees.defaultCategoryId,
    })
    .from(payees)
    .where(and(eq(payees.workspaceId, workspaceId), inArray(payees.normalizedName, normalized)));
  return new Map(rows.map((r) => [r.normalizedName, r]));
}

/**
 * For each row: whether it duplicates a transaction already in the account, which existing payee
 * it matches, and the category we'd suggest (payee default, else learned from history).
 */
export async function previewImport(
  db: Db,
  ws: WorkspaceCtx,
  accountId: string,
  rows: ImportRowInput[],
): Promise<ImportPreview> {
  await requireAccount(db, ws.id, accountId);
  const existing = await existingForDuplicates(db, accountId, rows);
  const duplicates = findDuplicates(rows, existing);
  const lookup = await payeeLookup(
    db,
    ws.id,
    rows.map((r) => r.payee),
  );
  const payeeIds = [...new Set([...lookup.values()].map((p) => p.id))];
  const learned = await learnedCategories(db, ws.id, payeeIds);
  return {
    rows: rows.map((row, i) => {
      const payee = lookup.get(normalizePayeeName(row.payee));
      return {
        duplicateOfId: duplicates[i] ?? null,
        payeeId: payee?.id ?? null,
        suggestedCategoryId: payee
          ? (payee.defaultCategoryId ?? learned.get(payee.id) ?? null)
          : null,
      };
    }),
  };
}

export async function commitImport(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  input: z.output<typeof CommitImportSchema>,
): Promise<ImportBatch> {
  const batchId = uuidv7();
  await db.transaction(async (tx) => {
    const account = await requireAccount(tx, ws.id, input.accountId);
    await assertCategoriesExist(
      tx,
      ws.id,
      input.rows.map((r) => r.categoryId ?? null),
    );

    // Rows whose bank reference already exists (or repeats within the file) are skipped: the
    // reference is unique per account.
    const refs = [...new Set(input.rows.map((r) => r.externalId).filter((x): x is string => !!x))];
    const takenRefs = new Set(
      refs.length
        ? (
            await tx
              .select({ ref: transactions.externalId })
              .from(transactions)
              .where(
                and(
                  eq(transactions.accountId, account.id),
                  isNull(transactions.deletedAt),
                  isNotNull(transactions.externalId),
                  inArray(transactions.externalId, refs),
                ),
              )
          ).map((r) => r.ref)
        : [],
    );

    const lookup = await payeeLookup(
      tx,
      ws.id,
      input.rows.map((r) => r.payee),
    );
    const learned = await learnedCategories(tx, ws.id, [
      ...new Set([...lookup.values()].map((p) => p.id)),
    ]);

    await tx.insert(importBatches).values({
      id: batchId,
      workspaceId: ws.id,
      accountId: account.id,
      source: input.source,
      fileName: input.fileName,
      mapping: input.mapping ?? null,
      createdBy: userId,
    });

    let created = 0;
    let skipped = 0;
    const payeeIdCache = new Map<string, string | null>();
    for (const row of input.rows) {
      if (row.skip || (row.externalId && takenRefs.has(row.externalId))) {
        skipped++;
        continue;
      }
      if (row.externalId) takenRefs.add(row.externalId);
      const payeeKey = normalizePayeeName(row.payee);
      let payeeId = payeeIdCache.get(payeeKey);
      if (payeeId === undefined) {
        payeeId = await findOrCreatePayee(tx, ws.id, row.payee);
        payeeIdCache.set(payeeKey, payeeId);
      }
      const known = lookup.get(normalizePayeeName(row.payee));
      const categoryId =
        row.categoryId !== undefined
          ? row.categoryId
          : known
            ? (known.defaultCategoryId ?? learned.get(known.id) ?? null)
            : null;
      await insertTransaction(
        tx,
        ws.id,
        userId,
        account.currency,
        {
          accountId: account.id,
          date: row.date,
          amountMinor: row.amountMinor,
          categoryId,
          notes: row.notes,
          rawDescription: row.description,
          externalId: row.externalId,
          importBatchId: batchId,
          needsReview: true,
        },
        payeeId,
      );
      created++;
    }
    await tx
      .update(importBatches)
      .set({ createdCount: created, skippedCount: skipped })
      .where(eq(importBatches.id, batchId));
  });
  return getBatch(db, ws.id, batchId);
}

function toBatchDto(b: typeof importBatches.$inferSelect): ImportBatch {
  return {
    id: b.id,
    accountId: b.accountId,
    fileName: b.fileName,
    source: b.source,
    createdAt: b.createdAt.toISOString(),
    revertedAt: b.revertedAt?.toISOString() ?? null,
    created: b.createdCount,
    skipped: b.skippedCount,
  };
}

async function getBatch(db: Executor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.workspaceId, workspaceId), eq(importBatches.id, id)));
  if (!row) throw notFound('Import');
  return toBatchDto(row);
}

export async function listBatches(db: Db, workspaceId: string): Promise<ImportBatch[]> {
  const rows = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.workspaceId, workspaceId))
    .orderBy(desc(importBatches.createdAt))
    .limit(100);
  return rows.map(toBatchDto);
}

/** Undoes an import: its transactions go to the trash (restorable) and the batch is marked. */
export async function revertBatch(db: Db, workspaceId: string, userId: string, id: string) {
  await getBatch(db, workspaceId, id);
  await db.transaction(async (tx) => {
    const ids = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.importBatchId, id), isNull(transactions.deletedAt)));
    await softDeleteTransactions(
      tx,
      workspaceId,
      userId,
      ids.map((r) => r.id),
    );
    await tx.update(importBatches).set({ revertedAt: sql`now()` }).where(eq(importBatches.id, id));
  });
  return getBatch(db, workspaceId, id);
}

export async function listProfiles(db: Db, workspaceId: string): Promise<ImportProfile[]> {
  const rows = await db
    .select()
    .from(importProfiles)
    .where(eq(importProfiles.workspaceId, workspaceId))
    .orderBy(importProfiles.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mapping: r.mapping as ImportProfile['mapping'],
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createProfile(
  db: Db,
  workspaceId: string,
  input: { name: string; mapping: ImportProfile['mapping'] },
) {
  const id = uuidv7();
  await db
    .insert(importProfiles)
    .values({ id, workspaceId, name: input.name, mapping: input.mapping });
  return id;
}

export async function deleteProfile(db: Db, workspaceId: string, id: string) {
  const deleted = await db
    .delete(importProfiles)
    .where(and(eq(importProfiles.workspaceId, workspaceId), eq(importProfiles.id, id)))
    .returning({ id: importProfiles.id });
  if (deleted.length === 0) throw notFound('Import profile');
}
