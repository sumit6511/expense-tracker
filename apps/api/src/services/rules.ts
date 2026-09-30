import {
  evaluateRules,
  normalizePayeeName,
  type Rule,
  type RuleBody,
  RuleBodySchema,
  type RulePreview,
  type RuleResult,
  type RuleSubject,
  uuidv7,
} from '@et/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import { accounts, categories, rules, tags } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { withAudit } from './audit';
import { assertCategoriesExist } from './categories';
import { findOrCreatePayee } from './payees';
import { assertTagsExist } from './tags';
import { applyEffects, getTransactions, type TransactionEffects } from './transactions';
import { type Scope, visibleAccountSql } from './visibility';

type RuleRow = typeof rules.$inferSelect;

function toDto(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    match: row.match,
    conditions: row.conditions as Rule['conditions'],
    actions: row.actions as Rule['actions'],
    stopProcessing: row.stopProcessing,
    priority: row.priority,
    hitCount: row.hitCount,
    lastHitAt: row.lastHitAt?.toISOString() ?? null,
  };
}

export async function listRules(db: Executor, workspaceId: string): Promise<Rule[]> {
  const rows = await db
    .select()
    .from(rules)
    .where(eq(rules.workspaceId, workspaceId))
    .orderBy(asc(rules.priority), asc(rules.createdAt));
  return rows.map(toDto);
}

async function requireRule(db: Executor, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.workspaceId, workspaceId), eq(rules.id, id)))
    .limit(1);
  if (!row) throw notFound('Rule');
  return row;
}

export async function getRule(db: Executor, workspaceId: string, id: string) {
  return toDto(await requireRule(db, workspaceId, id));
}

/** Every category, tag and account a rule mentions must belong to the workspace. */
async function assertReferences(db: Executor, workspaceId: string, body: RuleBody) {
  const categoryIds: Array<string | null> = [];
  const tagIds: string[] = [];
  for (const a of body.actions) {
    if (a.type === 'setCategory') categoryIds.push(a.categoryId);
    if (a.type === 'splitByPercent') categoryIds.push(...a.lines.map((l) => l.categoryId));
    if (a.type === 'addTags') tagIds.push(...a.tagIds);
  }
  await assertCategoriesExist(db, workspaceId, categoryIds);
  await assertTagsExist(db, workspaceId, tagIds);
  const accountIds = [
    ...new Set(body.conditions.flatMap((c) => (c.field === 'account' ? [c.value] : []))),
  ];
  if (accountIds.length) {
    const found = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, workspaceId), inArray(accounts.id, accountIds)));
    if (found.length !== accountIds.length) throw badRequest('Unknown account');
  }
}

export async function createRule(db: Db, workspaceId: string, body: RuleBody) {
  await assertReferences(db, workspaceId, body);
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${rules.priority}) + 1, 0)::int` })
    .from(rules)
    .where(eq(rules.workspaceId, workspaceId));
  const id = uuidv7();
  await db.insert(rules).values({ id, workspaceId, ...body, priority: Number(next) });
  return getRule(db, workspaceId, id);
}

export async function updateRule(
  db: Db,
  workspaceId: string,
  id: string,
  patch: Partial<RuleBody>,
) {
  const current = toDto(await requireRule(db, workspaceId, id));
  const parsed = RuleBodySchema.safeParse({
    name: current.name,
    enabled: current.enabled,
    match: current.match,
    conditions: current.conditions,
    actions: current.actions,
    stopProcessing: current.stopProcessing,
    ...patch,
  });
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid rule');
  await assertReferences(db, workspaceId, parsed.data);
  await db.update(rules).set(parsed.data).where(eq(rules.id, id));
  return getRule(db, workspaceId, id);
}

export async function deleteRule(db: Db, workspaceId: string, id: string) {
  const deleted = await db
    .delete(rules)
    .where(and(eq(rules.workspaceId, workspaceId), eq(rules.id, id)))
    .returning({ id: rules.id });
  if (deleted.length === 0) throw notFound('Rule');
}

/** Puts the given rules first, in this order; any others keep their relative order after them. */
export async function reorderRules(db: Db, workspaceId: string, ids: string[]) {
  await db.transaction(async (tx) => {
    const existing = await listRules(tx, workspaceId);
    const known = new Set(existing.map((r) => r.id));
    if (ids.some((id) => !known.has(id))) throw notFound('Rule');
    const order = [...new Set(ids), ...existing.map((r) => r.id).filter((id) => !ids.includes(id))];
    for (const [priority, id] of order.entries()) {
      await tx.update(rules).set({ priority }).where(eq(rules.id, id));
    }
  });
  return listRules(db, workspaceId);
}

// ---------------------------------------------------------------------------------------------
// Running rules
// ---------------------------------------------------------------------------------------------

/**
 * The enabled rules of a workspace, ready to evaluate. Categories and tags deleted since a rule
 * was saved are dropped from its actions (a deleted category becomes "no change").
 */
export async function loadActiveRules(db: Executor, workspaceId: string) {
  const all = (await listRules(db, workspaceId)).filter((r) => r.enabled);
  if (all.length === 0) return [];
  const [cats, tagRows] = await Promise.all([
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId)),
    db.select({ id: tags.id }).from(tags).where(eq(tags.workspaceId, workspaceId)),
  ]);
  const catIds = new Set(cats.map((c) => c.id));
  const tagIds = new Set(tagRows.map((t) => t.id));
  const okCategory = (id: string | null) => id === null || catIds.has(id);
  return all.map((rule) => ({
    ...rule,
    actions: rule.actions.flatMap((a): Rule['actions'] => {
      if (a.type === 'setCategory') return okCategory(a.categoryId) ? [a] : [];
      if (a.type === 'splitByPercent')
        return a.lines.every((l) => okCategory(l.categoryId)) ? [a] : [];
      if (a.type === 'addTags') {
        const kept = a.tagIds.filter((t) => tagIds.has(t));
        return kept.length ? [{ ...a, tagIds: kept }] : [];
      }
      return [a];
    }),
  }));
}

/** Adds to each rule's hit counter (how many transactions it has touched). */
export async function recordHits(db: Executor, hits: Map<string, number>) {
  for (const [id, n] of hits) {
    if (n > 0) {
      await db
        .update(rules)
        .set({ hitCount: sql`${rules.hitCount} + ${n}`, lastHitAt: sql`now()` })
        .where(eq(rules.id, id));
    }
  }
}

export function countHits(hits: Map<string, number>, result: RuleResult) {
  for (const id of result.matchedRuleIds) hits.set(id, (hits.get(id) ?? 0) + 1);
}

interface Candidate {
  id: string;
  accountId: string;
  amountMinor: number;
  rawDescription: string;
  notes: string;
  needsReview: boolean;
  payee: string | null;
  categoryIds: Array<string | null>;
  tagIds: string[];
}

/** Live, non-transfer transactions with what rules look at, newest first. */
async function loadCandidates(db: Executor, scope: Scope): Promise<Candidate[]> {
  const result = await db.execute<{
    id: string;
    account_id: string;
    amount_minor: number;
    raw_description: string;
    notes: string;
    needs_review: boolean;
    payee: string | null;
    category_ids: Array<string | null>;
    tag_ids: string[];
  }>(sql`
    select t.id, t.account_id, t.amount_minor, t.raw_description, t.notes, t.needs_review,
      p.name as payee,
      coalesce((select array_agg(s.category_id::text order by s.sort_order, s.id)
        from transaction_splits s where s.transaction_id = t.id), '{}') as category_ids,
      coalesce((select array_agg(tt.tag_id::text)
        from transaction_tags tt where tt.transaction_id = t.id), '{}') as tag_ids
    from transactions t
    left join payees p on p.id = t.payee_id
    where t.workspace_id = ${scope.id}
      and t.deleted_at is null
      and t.transfer_group_id is null
      ${visibleAccountSql(scope, sql`t.account_id`)}
    order by t.date desc, t.id desc
  `);
  return result.rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    amountMinor: Number(r.amount_minor),
    rawDescription: r.raw_description,
    notes: r.notes,
    needsReview: r.needs_review,
    payee: r.payee,
    categoryIds: r.category_ids,
    tagIds: r.tag_ids,
  }));
}

function subjectOf(c: Candidate): RuleSubject {
  return {
    payee: c.payee ?? '',
    description: c.rawDescription,
    notes: c.notes,
    amountMinor: c.amountMinor,
    accountId: c.accountId,
  };
}

const isUncategorized = (c: Candidate) => c.categoryIds.every((id) => id === null);

/** What applying `result` would change on `c`, or null if nothing. Payee is a name here. */
function diff(c: Candidate, result: RuleResult) {
  const changes: Omit<TransactionEffects, 'payeeId'> & { payee?: string } = {};
  if (result.split) {
    const same =
      c.categoryIds.length === result.split.length &&
      result.split.every((s, i) => s.categoryId === c.categoryIds[i]);
    if (!same) changes.split = result.split;
  } else if (result.categoryId !== undefined) {
    if (c.categoryIds.length !== 1 || c.categoryIds[0] !== result.categoryId) {
      changes.categoryId = result.categoryId;
    }
  }
  if (result.payee && normalizePayeeName(result.payee) !== normalizePayeeName(c.payee ?? '')) {
    changes.payee = result.payee;
  }
  const newTags = result.tagIds.filter((t) => !c.tagIds.includes(t));
  if (newTags.length) changes.addTagIds = newTags;
  if (result.notes !== undefined && result.notes !== c.notes) changes.notes = result.notes;
  if (result.markReviewed && c.needsReview) changes.reviewed = true;
  return Object.keys(changes).length ? changes : null;
}

const PREVIEW_ITEMS = 25;

export async function previewRule(
  db: Db,
  scope: Scope,
  body: RuleBody,
  onlyUncategorized: boolean,
): Promise<RulePreview> {
  const candidates = await loadCandidates(db, scope);
  const rule = { ...body, id: 'preview', enabled: true };
  let count = 0;
  let changeCount = 0;
  const sample: string[] = [];
  for (const c of candidates) {
    if (onlyUncategorized && !isUncategorized(c)) continue;
    const result = evaluateRules([rule], subjectOf(c));
    if (result.matchedRuleIds.length === 0) continue;
    count++;
    if (diff(c, result)) changeCount++;
    if (sample.length < PREVIEW_ITEMS) sample.push(c.id);
  }
  return { count, changeCount, items: await getTransactions(db, scope, sample) };
}

/** Runs one saved rule over existing transactions. */
export async function applyRule(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  id: string,
  onlyUncategorized: boolean,
) {
  return db.transaction(async (tx) => {
    const rule = (await loadActiveRules(tx, ws.id)).find((r) => r.id === id) ?? {
      ...(await getRule(tx, ws.id, id)),
      enabled: true,
    };
    const candidates = await loadCandidates(tx, ws);
    const todo = candidates.flatMap((c) => {
      if (onlyUncategorized && !isUncategorized(c)) return [];
      const result = evaluateRules([{ ...rule, enabled: true }], subjectOf(c));
      const changes = result.matchedRuleIds.length ? diff(c, result) : null;
      return changes ? [{ c, changes }] : [];
    });
    const payeeIds = new Map<string, string | null>();
    await withAudit(
      tx,
      ws.id,
      userId,
      todo.map(({ c }) => c.id),
      async () => {
        for (const { c, changes } of todo) {
          const { payee, ...effects } = changes;
          let payeeId: string | null | undefined;
          if (payee !== undefined) {
            payeeId = payeeIds.get(payee);
            if (payeeId === undefined) {
              payeeId = await findOrCreatePayee(tx, ws.id, payee);
              payeeIds.set(payee, payeeId);
            }
          }
          await applyEffects(tx, ws.id, userId, c, {
            ...effects,
            ...(payeeId !== undefined && { payeeId }),
          });
        }
      },
    );
    await recordHits(tx, new Map([[id, todo.length]]));
    return { updated: todo.length };
  });
}
