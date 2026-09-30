import { z } from 'zod';
import { Id } from './schemas';

/**
 * Optional AI helpers. Off until a workspace owner or admin turns them on, and only on servers
 * with an API key. Each helper sends the least it can (the text you typed, the receipt you
 * scanned, the question you asked plus the figures needed to answer it), and whatever comes back
 * is a draft you confirm.
 */

export const AiStatusSchema = z.object({
  /** The server has an AI provider set up. */
  available: z.boolean(),
  /** This workspace has turned the helpers on. */
  enabled: z.boolean(),
  /** Who processes the data, for the disclosure ("Claude by Anthropic"). */
  provider: z.string().nullable(),
  usedToday: z.number(),
  dailyLimit: z.number(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

/** A transaction worked out from text, a receipt or a statement line. The user confirms it. */
export const TransactionDraftSchema = z.object({
  direction: z.enum(['expense', 'income']),
  /** Positive, in `currency`'s minor units; null when unknown. */
  amountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  date: z.string().nullable(),
  accountId: Id.nullable(),
  categoryId: Id.nullable(),
  payee: z.string().nullable(),
  notes: z.string().nullable(),
  /** "rules": worked out without AI; "ai": a model filled some of it in. */
  source: z.enum(['rules', 'ai']),
});
export type TransactionDraft = z.infer<typeof TransactionDraftSchema>;

export const ParseTextSchema = z.object({
  text: z.string().trim().min(1, { error: 'Type something' }).max(300),
  /** The account picked in the form, if any (its currency sets the amount's). */
  accountId: Id.nullable().optional(),
});

export const ReceiptDraftSchema = TransactionDraftSchema.extend({
  taxMinor: z.number().int().nullable(),
  items: z.array(z.object({ description: z.string(), amountMinor: z.number().int() })),
});
export type ReceiptDraft = z.infer<typeof ReceiptDraftSchema>;

export const CategorizeSchema = z.object({
  /** Uncategorized transactions to suggest categories for (default: the latest 50). */
  transactionIds: z.array(Id).max(50).optional(),
});
export const CategorizeResultSchema = z.object({
  /** Transactions that got a suggestion; they wait in the review inbox. */
  suggested: z.number(),
  /** Transactions the model couldn't place. */
  skipped: z.number(),
});
export type CategorizeResult = z.infer<typeof CategorizeResultSchema>;

export const AskSchema = z.object({
  question: z.string().trim().min(3, { error: 'Ask a question' }).max(500),
});
export const AskAnswerSchema = z.object({
  answer: z.string(),
  /** Which reports it looked at, so the answer can be checked. */
  sources: z.array(z.string()),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

/** Rows read out of a PDF bank statement, ready for the import preview. */
export const StatementExtractSchema = z.object({
  currency: z.string().nullable(),
  rows: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      /** Signed: money out is negative. Minor units of the statement currency. */
      amountMinor: z.number().int(),
      balanceMinor: z.number().int().nullable(),
    }),
  ),
});
export type StatementExtract = z.infer<typeof StatementExtractSchema>;
