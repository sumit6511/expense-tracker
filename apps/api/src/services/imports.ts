import {
  addDays,
  type CommitImportSchema,
  evaluateRules,
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
import { countHits, loadActiveRules, recordHits } from './rules';
import { insertTransaction, softDeleteTransactions } from './transactions';
import { isHidden, type Scope, visibleAccount } from './visibility';

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
  await requireAccount(db, ws, accountId);
  const existing = await existingForDuplicates(db, accountId, rows);
  const duplicates = findDuplicates(rows, existing);
  const ruled = await applyRulesToRows(db, ws.id, accountId, rows);
  return {
    rows: rows.map((_, i) => {
      const r = ruled[i]!;
      return {
        duplicateOfId: duplicates[i] ?? null,
        payeeId: r.payeeId,
        suggestedCategoryId: r.split ? null : r.categoryId,
        ruleIds: r.result.matchedRuleIds,
        splitByRule: r.split !== undefined,
        rulePayee: r.result.payee ?? null,
      };
    }),
  };
}

/**
 * Runs the workspace's rules over statement rows, then fills in what rules left open from the
 * payee: its default category, else the category learned from history.
 */
async function applyRulesToRows(
  db: Executor,
  workspaceId: string,
  accountId: string,
  rows: ImportRowInput[],
) {
  const active = await loadActiveRules(db, workspaceId);
  const results = rows.map((row) =>
    evaluateRules(active, {
      payee: row.payee,
      description: row.description,
      notes: row.notes,
      amountMinor: row.amountMinor,
      accountId,
    }),
  );
  const payeeNames = rows.map((row, i) => results[i]!.payee ?? row.payee);
  const lookup = await payeeLookup(db, workspaceId, payeeNames);
  const learned = await learnedCategories(db, workspaceId, [
    ...new Set([...lookup.values()].map((p) => p.id)),
  ]);
  return rows.map((_, i) => {
    const result = results[i]!;
    const payee = lookup.get(normalizePayeeName(payeeNames[i]!));
    const fromPayee = payee ? (payee.defaultCategoryId ?? learned.get(payee.id) ?? null) : null;
    return {
      result,
      payeeName: payeeNames[i]!,
      payeeId: payee?.id ?? null,
      split: result.split,
      categoryId: result.categoryId !== undefined ? result.categoryId : fromPayee,
    };
  });
}

export async function commitImport(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  input: z.output<typeof CommitImportSchema>,
): Promise<ImportBatch> {
  const batchId = uuidv7();
  await db.transaction(async (tx) => {
    const account = await requireAccount(tx, ws, input.accountId);
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

    const ruled = await applyRulesToRows(tx, ws.id, account.id, input.rows);
    const hits = new Map<string, number>();

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
    for (const [i, row] of input.rows.entries()) {
      if (row.skip || (row.externalId && takenRefs.has(row.externalId))) {
        skipped++;
        continue;
      }
      if (row.externalId) takenRefs.add(row.externalId);
      const r = ruled[i]!;
      const payeeKey = normalizePayeeName(r.payeeName);
      let payeeId = payeeIdCache.get(payeeKey);
      if (payeeId === undefined) {
        payeeId = await findOrCreatePayee(tx, ws.id, r.payeeName);
        payeeIdCache.set(payeeKey, payeeId);
      }
      // A category chosen in the review screen wins (null = deliberately none). Without one, a
      // rule's split applies, else the rule's or payee's category.
      const split = row.categoryId ? undefined : r.split;
      const categoryId =
        row.categoryId !== undefined ? row.categoryId : split ? null : r.categoryId;
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
          ...(split && { splits: split }),
          notes: r.result.notes ?? row.notes,
          tagIds: r.result.tagIds,
          rawDescription: row.description,
          externalId: row.externalId,
          importBatchId: batchId,
          needsReview: !r.result.markReviewed,
        },
        payeeId,
      );
      countHits(hits, r.result);
      created++;
    }
    await recordHits(tx, hits);
    await tx
      .update(importBatches)
      .set({ createdCount: created, skippedCount: skipped })
      .where(eq(importBatches.id, batchId));
  });
  return getBatch(db, ws, batchId);
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

async function getBatch(db: Executor, scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.workspaceId, scope.id), eq(importBatches.id, id)));
  if (!row || isHidden(scope, row.accountId)) throw notFound('Import');
  return toBatchDto(row);
}

export async function listBatches(db: Db, scope: Scope): Promise<ImportBatch[]> {
  const rows = await db
    .select()
    .from(importBatches)
    .where(
      and(eq(importBatches.workspaceId, scope.id), visibleAccount(scope, importBatches.accountId)),
    )
    .orderBy(desc(importBatches.createdAt))
    .limit(100);
  return rows.map(toBatchDto);
}

/** Undoes an import: its transactions go to the trash (restorable) and the batch is marked. */
export async function revertBatch(db: Db, scope: Scope, userId: string, id: string) {
  const workspaceId = scope.id;
  await getBatch(db, scope, id);
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
  return getBatch(db, scope, id);
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
