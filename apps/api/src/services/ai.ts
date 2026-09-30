import {
  type AiStatus,
  type AskAnswer,
  type CategorizeResult,
  currencyDigits,
  formatBsDate,
  formatMoney,
  formatMonthPeriod,
  getMonthPeriod,
  isCurrencyCode,
  isIsoDate,
  normalizePayeeName,
  parseQuickText,
  type ReceiptDraft,
  type StatementExtract,
  shiftMonthPeriod,
  type TransactionDraft,
} from '@et/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type AiCategory,
  type AiContext,
  AiError,
  type AiProvider,
  type AiTransactionFields,
  type AskTool,
} from '../ai/provider';
import type { WorkspaceCtx } from '../context';
import type { Db } from '../db/client';
import { aiUsage, payees, transactionSplits, transactions } from '../db/schema';
import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { listAccounts } from './accounts';
import { getBudgetMonth } from './budgets';
import { listCategoryGroups } from './categories';
import { learnedCategories } from './payees';
import { cashFlow, periodSettings, spendingByCategory } from './reports';
import { bulkUpdate, listTransactions, workspaceToday } from './transactions';
import { visibleAccount } from './visibility';

export interface AiDeps {
  db: Db;
  env: Env;
  ai: AiProvider | null;
}

// ---------------------------------------------------------------------------------------------
// Switched on, and within the daily allowance
// ---------------------------------------------------------------------------------------------

async function usedToday(db: Db, ws: WorkspaceCtx) {
  const [row] = await db
    .select({ count: aiUsage.count })
    .from(aiUsage)
    .where(and(eq(aiUsage.workspaceId, ws.id), eq(aiUsage.day, workspaceToday(ws))));
  return row?.count ?? 0;
}

export async function aiStatus({ db, env, ai }: AiDeps, ws: WorkspaceCtx): Promise<AiStatus> {
  return {
    available: ai !== null,
    enabled: ai !== null && ws.aiEnabled,
    provider: ai?.label ?? null,
    usedToday: await usedToday(db, ws),
    dailyLimit: env.AI_DAILY_LIMIT,
  };
}

/** Throws unless the server has a provider and the workspace has opted in. */
function requireEnabled({ ai }: AiDeps, ws: WorkspaceCtx): AiProvider {
  if (!ai) throw new ApiError(503, 'ai_unavailable', 'AI helpers aren’t set up on this server');
  if (!ws.aiEnabled)
    throw new ApiError(403, 'ai_disabled', 'Turn on AI helpers in Settings → General first');
  return ai;
}

/** The provider, once the workspace has opted in; counts the request against today's limit. */
async function provider(deps: AiDeps, ws: WorkspaceCtx): Promise<AiProvider> {
  const ai = requireEnabled(deps, ws);
  const { db, env } = deps;
  const [row] = await db
    .insert(aiUsage)
    .values({ workspaceId: ws.id, day: workspaceToday(ws), count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.workspaceId, aiUsage.day],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });
  if (row!.count > env.AI_DAILY_LIMIT)
    throw new ApiError(
      429,
      'ai_limit',
      'This workspace has used today’s AI requests. Try tomorrow.',
    );
  return ai;
}

/** Runs a provider call, turning its friendly failures into API errors. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiError) throw new ApiError(err.status, 'ai_failed', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// What the model gets to see: names of accounts and categories, nothing else
// ---------------------------------------------------------------------------------------------

async function contextFor(db: Db, ws: WorkspaceCtx): Promise<AiContext> {
  const [accounts, groups] = await Promise.all([listAccounts(db, ws), listCategoryGroups(db, ws)]);
  return {
    today: workspaceToday(ws),
    currency: ws.baseCurrency,
    accounts: accounts
      .filter((a) => !a.archived)
      .map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    categories: groups
      .filter((g) => !g.archived)
      .flatMap((g) =>
        g.categories
          .filter((c) => !c.archived)
          .map((c): AiCategory => ({ id: c.id, name: c.name, kind: g.kind })),
      ),
  };
}

const toMinor = (amount: number, currency: string) =>
  Math.round(Math.abs(amount) * 10 ** currencyDigits(currency));

/** Keeps only what checks out: known ids, real dates and currencies. */
function checked(fields: AiTransactionFields, ctx: AiContext, fallbackCurrency: string) {
  const currency =
    fields.currency && isCurrencyCode(fields.currency.toUpperCase())
      ? fields.currency.toUpperCase()
      : fallbackCurrency;
  const category = ctx.categories.find(
    (c) => c.id === fields.categoryId && c.kind === fields.direction,
  );
  return {
    direction: fields.direction,
    currency,
    amountMinor:
      fields.amount !== null && Number.isFinite(fields.amount) && fields.amount !== 0
        ? toMinor(fields.amount, currency)
        : null,
    date: fields.date && isIsoDate(fields.date) ? fields.date : null,
    accountId: ctx.accounts.some((a) => a.id === fields.accountId) ? fields.accountId : null,
    categoryId: category?.id ?? null,
    payee: fields.payee?.trim().slice(0, 120) || null,
    notes: fields.notes?.trim().slice(0, 500) || null,
  };
}

/** The category someone usually picks for this payee (its default, else learned). */
async function payeeCategory(
  db: Db,
  ws: WorkspaceCtx,
  name: string | null,
  ctx: AiContext,
  direction: 'expense' | 'income',
) {
  const normalized = name ? normalizePayeeName(name) : '';
  if (!normalized) return null;
  const [payee] = await db
    .select({ id: payees.id, defaultCategoryId: payees.defaultCategoryId })
    .from(payees)
    .where(and(eq(payees.workspaceId, ws.id), eq(payees.normalizedName, normalized)))
    .limit(1);
  if (!payee) return null;
  const id =
    payee.defaultCategoryId ?? (await learnedCategories(db, ws.id, [payee.id])).get(payee.id);
  return ctx.categories.some((c) => c.id === id && c.kind === direction) ? id! : null;
}

// ---------------------------------------------------------------------------------------------
// Quick add from a sentence
// ---------------------------------------------------------------------------------------------

/**
 * "lunch 450 at Bhojan Griha yesterday via eSewa" → a draft. The deterministic parser and the
 * payee's history do the work; a model is asked only when they leave the amount unknown (or find
 * nothing but a number), and only if the workspace has AI turned on.
 */
export async function draftFromText(
  deps: AiDeps,
  ws: WorkspaceCtx,
  input: { text: string; accountId?: string | null },
): Promise<TransactionDraft> {
  const ctx = await contextFor(deps.db, ws);
  const account = ctx.accounts.find((a) => a.id === input.accountId) ?? ctx.accounts[0];
  const currency = account?.currency ?? ws.baseCurrency;
  const parsed = parseQuickText(input.text, {
    today: ctx.today,
    accounts: ctx.accounts,
    categories: ctx.categories,
    digits: currencyDigits(currency),
  });
  const draft: TransactionDraft = {
    ...parsed,
    currency: parsed.accountId
      ? (ctx.accounts.find((a) => a.id === parsed.accountId)?.currency ?? currency)
      : currency,
    source: 'rules',
  };
  draft.categoryId ??= await payeeCategory(deps.db, ws, draft.payee, ctx, draft.direction);

  const unclear = draft.amountMinor === null || (!draft.payee && !draft.categoryId && !draft.notes);
  if (!unclear || !deps.ai || !ws.aiEnabled) return draft;

  const ai = await provider(deps, ws);
  const fields = checked(await call(() => ai.draftFromText(input.text, ctx)), ctx, currency);
  // The rules are sure of numbers, dates and account names; the model reads the rest better
  // than leftover words do.
  const merged: TransactionDraft = {
    direction: fields.direction,
    amountMinor: draft.amountMinor ?? fields.amountMinor,
    currency: draft.amountMinor !== null ? draft.currency : fields.currency,
    date: draft.date ?? fields.date,
    accountId: draft.accountId ?? fields.accountId,
    payee: fields.payee ?? draft.payee,
    categoryId: null,
    notes: fields.notes ?? draft.notes,
    source: 'ai',
  };
  merged.categoryId =
    (await payeeCategory(deps.db, ws, merged.payee, ctx, merged.direction)) ??
    fields.categoryId ??
    (draft.direction === merged.direction ? draft.categoryId : null);
  return merged;
}

// ---------------------------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------------------------

export const RECEIPT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

export async function scanReceipt(
  deps: AiDeps,
  ws: WorkspaceCtx,
  file: { data: Buffer; mediaType: string },
): Promise<ReceiptDraft> {
  const ai = await provider(deps, ws);
  const ctx = await contextFor(deps.db, ws);
  const raw = await call(() => ai.readReceipt(file, ctx));
  const fields = checked(raw, ctx, ws.baseCurrency);
  // History beats a guess: a known merchant gets its usual category.
  const usual = await payeeCategory(deps.db, ws, fields.payee, ctx, fields.direction);
  return {
    ...fields,
    categoryId: usual ?? fields.categoryId,
    source: 'ai',
    taxMinor: raw.tax ? toMinor(raw.tax, fields.currency) : null,
    items: raw.items.slice(0, 30).map((i) => ({
      description: i.description.slice(0, 120),
      amountMinor: toMinor(i.amount, fields.currency),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Categories for transactions nobody could place
// ---------------------------------------------------------------------------------------------

/**
 * Suggests categories for uncategorized transactions (these, or the latest 50). History goes
 * first; only what it can't place goes to the model, as payee and description. Suggestions are
 * saved and wait in the review inbox for a person to confirm.
 */
export async function suggestCategories(
  deps: AiDeps,
  ws: WorkspaceCtx,
  input: { transactionIds?: string[] | undefined },
): Promise<CategorizeResult> {
  requireEnabled(deps, ws);
  const { db } = deps;
  const rows = await db
    .select({
      id: transactions.id,
      amount: transactions.amountMinor,
      payeeId: transactions.payeeId,
      payee: payees.name,
      description: transactions.rawDescription,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.workspaceId, ws.id),
        sql`${transactions.deletedAt} is null`,
        sql`${transactions.transferGroupId} is null`,
        visibleAccount(ws, transactions.accountId),
        input.transactionIds ? inArray(transactions.id, input.transactionIds) : undefined,
        // One line, and no category on it.
        sql`(select count(*) from ${transactionSplits} s where s.transaction_id = ${transactions.id}) = 1`,
        sql`exists (select 1 from ${transactionSplits} s where s.transaction_id = ${transactions.id} and s.category_id is null)`,
      ),
    )
    .orderBy(sql`${transactions.date} desc`)
    .limit(50);
  if (rows.length === 0) return { suggested: 0, skipped: 0 };

  const ctx = await contextFor(db, ws);
  const direction = (amount: number): 'expense' | 'income' => (amount < 0 ? 'expense' : 'income');
  const learned = await learnedCategories(
    db,
    ws.id,
    rows.flatMap((r) => (r.payeeId ? [r.payeeId] : [])),
  );
  const picks = new Map<string, string>();
  const unknown: typeof rows = [];
  for (const r of rows) {
    const fromHistory = r.payeeId ? learned.get(r.payeeId) : undefined;
    if (
      fromHistory &&
      ctx.categories.some((c) => c.id === fromHistory && c.kind === direction(r.amount))
    )
      picks.set(r.id, fromHistory);
    else unknown.push(r);
  }
  if (unknown.length) {
    const ai = await provider(deps, ws);
    const results = await call(() =>
      ai.categorize(
        unknown.map((r) => ({
          key: r.id,
          text: [r.payee, r.description, r.notes].filter(Boolean).join(' · ').slice(0, 200),
          direction: direction(r.amount),
        })),
        ctx.categories,
      ),
    );
    for (const r of results) {
      const row = unknown.find((u) => u.id === r.key);
      if (
        row &&
        r.categoryId &&
        ctx.categories.some((c) => c.id === r.categoryId && c.kind === direction(row.amount))
      )
        picks.set(row.id, r.categoryId);
    }
  }

  for (const [categoryId, ids] of Map.groupBy(picks, ([, c]) => c)) {
    await bulkUpdate(db, ws, ws.userId, {
      action: 'setCategory',
      categoryId,
      ids: ids.map(([id]) => id),
    });
  }
  if (picks.size) {
    await db
      .update(transactions)
      .set({ needsReview: true })
      .where(inArray(transactions.id, [...picks.keys()]));
  }
  return { suggested: picks.size, skipped: rows.length - picks.size };
}

// ---------------------------------------------------------------------------------------------
// PDF statements
// ---------------------------------------------------------------------------------------------

export async function readStatement(
  deps: AiDeps,
  ws: WorkspaceCtx,
  pdf: Buffer,
): Promise<StatementExtract> {
  const ai = await provider(deps, ws);
  const ctx = await contextFor(deps.db, ws);
  const raw = await call(() => ai.readStatement(pdf, ctx));
  const currency =
    raw.currency && isCurrencyCode(raw.currency.toUpperCase())
      ? raw.currency.toUpperCase()
      : ws.baseCurrency;
  const digits = 10 ** currencyDigits(currency);
  const rows = raw.rows
    .filter((r) => isIsoDate(r.date) && Number.isFinite(r.amount) && r.amount !== 0)
    .map((r) => ({
      date: r.date,
      description: r.description.trim().slice(0, 300),
      amountMinor: Math.round(r.amount * digits),
      balanceMinor:
        r.balance !== null && Number.isFinite(r.balance) ? Math.round(r.balance * digits) : null,
    }));
  if (rows.length === 0)
    throw new ApiError(422, 'ai_failed', 'No transactions could be read from that PDF.');
  return { currency, rows };
}

// ---------------------------------------------------------------------------------------------
// "Ask your money": the model can only call these read-only reports
// ---------------------------------------------------------------------------------------------

const DateRange = z.object({
  from: z.string().describe('First day, YYYY-MM-DD'),
  to: z.string().describe('Last day, YYYY-MM-DD'),
});

function checkRange(r: { from: string; to: string }) {
  if (!isIsoDate(r.from) || !isIsoDate(r.to) || r.from > r.to)
    throw new Error('from and to must be YYYY-MM-DD dates, from on or before to');
}

const SOURCE_LABELS: Record<string, string> = {
  month_dates: 'Budget months',
  spending_by_category: 'Spending by category',
  income_and_spending: 'Cash flow',
  find_transactions: 'Transactions',
  account_balances: 'Account balances',
  budget_month: 'Budgets',
};

function askTools(db: Db, ws: WorkspaceCtx, used: Set<string>): AskTool[] {
  const money = (minor: number, currency = ws.baseCurrency) =>
    formatMoney(minor, currency, {
      grouping: currency === 'NPR' || currency === 'INR' ? 'lakh' : 'international',
      trimZeroFraction: true,
    });
  const settings = periodSettings(ws);
  const today = workspaceToday(ws);
  const track = <T extends z.ZodObject>(tool: AskTool<T>): AskTool => ({
    ...tool,
    run: async (input) => {
      used.add(tool.name);
      try {
        return await tool.run(input as z.infer<T>);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
  const categoryNames = async () => {
    const groups = await listCategoryGroups(db, ws);
    return new Map(groups.flatMap((g) => g.categories.map((c) => [c.id, c.name])));
  };

  return [
    track({
      name: 'month_dates',
      description:
        'The start and end dates of a budget month: 0 is this month, -1 last month, and so on. Budget months may follow the Bikram Sambat calendar, so use this rather than guessing month boundaries.',
      input: z.object({ offset: z.number().int().describe('0 = this month, -1 = last month') }),
      run: async ({ offset }) => {
        const p = shiftMonthPeriod(getMonthPeriod(today, settings), offset, settings);
        return `${formatMonthPeriod(p)}: ${p.start} to ${p.end}`;
      },
    }),
    track({
      name: 'spending_by_category',
      description:
        'Total spending and income per category between two dates (inclusive), biggest first.',
      input: DateRange,
      run: async (r) => {
        checkRange(r);
        const [data, names] = await Promise.all([
          spendingByCategory(db, ws, { from: r.from, to: r.to }),
          categoryNames(),
        ]);
        const line = (e: { categoryId: string | null; amountMinor: number; count: number }) =>
          `${e.categoryId ? (names.get(e.categoryId) ?? 'Other') : 'Uncategorized'}: ${money(e.amountMinor)} (${e.count} transactions)`;
        return [
          `Spending ${r.from} to ${r.to}: ${money(data.totalExpenseMinor)}`,
          ...data.expense.slice(0, 25).map(line),
          `Income: ${money(data.totalIncomeMinor)}`,
          ...data.income.slice(0, 10).map(line),
        ].join('\n');
      },
    }),
    track({
      name: 'income_and_spending',
      description: 'Income, spending and net for each budget month between two dates.',
      input: DateRange,
      run: async (r) => {
        checkRange(r);
        const data = await cashFlow(db, ws, { from: r.from, to: r.to });
        return data.periods
          .map(
            (p) =>
              `${p.label} (${p.start} to ${p.end}): income ${money(p.incomeMinor)}, spending ${money(p.expenseMinor)}, net ${money(p.netMinor)}`,
          )
          .join('\n');
      },
    }),
    track({
      name: 'find_transactions',
      description:
        'Searches transactions between two dates by words in the payee, description or notes, and/or a category name. Returns the count, totals and up to 20 of the matches.',
      input: DateRange.extend({
        search: z.string().nullable().describe('Words to look for, or null'),
        category: z.string().nullable().describe('A category name, or null'),
        type: z.enum(['expense', 'income', 'any']),
      }),
      run: async (r) => {
        checkRange(r);
        const names = await categoryNames();
        let categoryIds: string[] | undefined;
        if (r.category) {
          const wanted = normalizePayeeName(r.category);
          categoryIds = [...names]
            .filter(([, n]) => normalizePayeeName(n) === wanted)
            .map(([id]) => id);
          if (categoryIds.length === 0) return `There's no category called "${r.category}".`;
        }
        const page = await listTransactions(db, ws, {
          from: r.from,
          to: r.to,
          limit: 20,
          ...(r.search ? { q: r.search.slice(0, 100) } : {}),
          ...(categoryIds ? { categoryIds } : {}),
          ...(r.type !== 'any' ? { type: r.type } : {}),
        });
        const t = page.totals;
        return [
          `${t.count} transactions; money out ${money(t.outflowBaseMinor)}, money in ${money(t.inflowBaseMinor)}.`,
          ...page.items.map((tx) => {
            const category =
              tx.splits.length > 1
                ? 'split'
                : (tx.splits[0]?.categoryId && names.get(tx.splits[0].categoryId)) ||
                  'Uncategorized';
            return `${tx.date} · ${tx.payeeName ?? tx.rawDescription.slice(0, 60) ?? ''} · ${category} · ${money(tx.amountMinor, tx.currency)}`;
          }),
        ].join('\n');
      },
    }),
    track({
      name: 'account_balances',
      description: 'Current balance of each account.',
      input: z.object({}),
      run: async () => {
        const accounts = await listAccounts(db, ws);
        return accounts
          .filter((a) => !a.archived)
          .map((a) => `${a.name} (${a.type}): ${money(a.balanceMinor, a.currency)}`)
          .join('\n');
      },
    }),
    track({
      name: 'budget_month',
      description: 'Budgeted, spent and left per category for the budget month containing a date.',
      input: z.object({ date: z.string().describe('Any day in the month, YYYY-MM-DD') }),
      run: async ({ date }) => {
        if (!isIsoDate(date)) throw new Error('date must be YYYY-MM-DD');
        const [month, names] = await Promise.all([getBudgetMonth(db, ws, date), categoryNames()]);
        return [
          `${month.period.label}: budgeted ${money(month.totals.budgetedMinor)}, spent ${money(month.totals.spentMinor)}`,
          ...month.lines
            .filter((l) => l.budgetedMinor !== 0 || l.spentMinor !== 0)
            .map(
              (l) =>
                `${names.get(l.categoryId) ?? 'Other'}: budget ${money(l.budgetedMinor)}, spent ${money(l.spentMinor)}, left ${money(l.remainingMinor)}`,
            ),
        ].join('\n');
      },
    }),
  ];
}

export async function askMoney(
  deps: AiDeps,
  ws: WorkspaceCtx,
  question: string,
): Promise<AskAnswer> {
  const ai = await provider(deps, ws);
  const today = workspaceToday(ws);
  const settings = periodSettings(ws);
  const month = getMonthPeriod(today, settings);
  const calendar =
    ws.calendar === 'bs'
      ? `Budget months follow the Bikram Sambat calendar (today is ${formatBsDate(today)} BS).`
      : 'Budget months follow the Gregorian calendar.';
  const system = [
    'You answer questions about one household’s money in their expense tracker.',
    'Use the tools for every figure and never estimate one; say so when the tools can’t answer.',
    `Today is ${today}. ${calendar} This budget month, ${formatMonthPeriod(month)}, runs ${month.start} to ${month.end}; "last month" and "this year" mean budget months unless the question says otherwise.`,
    `Amounts are in ${ws.baseCurrency}.`,
    'Answer in one to four plain sentences with the figures the tools gave (no markdown, no tables).',
  ].join(' ');
  const used = new Set<string>();
  const answer = await call(() => ai.answer(question, system, askTools(deps.db, ws, used)));
  return {
    answer,
    sources: [...used].map((name) => SOURCE_LABELS[name] ?? name),
  };
}
