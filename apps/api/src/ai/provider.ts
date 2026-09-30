import type { IsoDate } from '@et/shared';
import type { z } from 'zod';

/**
 * The AI helpers talk to a provider through this interface, so it can be swapped, faked in
 * tests, or left out entirely (the helpers are then unavailable). Providers see only what each
 * helper hands them: the text, image or PDF the person gave, the names of their accounts and
 * categories, and, for questions, the figures the report tools return.
 */

export interface AiCategory {
  id: string;
  name: string;
  kind: 'expense' | 'income';
}

export interface AiContext {
  today: IsoDate;
  /** The workspace currency: amounts are in it unless the input says otherwise. */
  currency: string;
  accounts: Array<{ id: string; name: string; currency: string }>;
  categories: AiCategory[];
}

/** What a model fills in: amounts in major units (450.5), ids from the lists it was given. */
export interface AiTransactionFields {
  direction: 'expense' | 'income';
  amount: number | null;
  currency: string | null;
  /** YYYY-MM-DD. */
  date: string | null;
  accountId: string | null;
  categoryId: string | null;
  payee: string | null;
  notes: string | null;
}

export interface AiReceiptFields extends AiTransactionFields {
  tax: number | null;
  items: Array<{ description: string; amount: number }>;
}

export interface AiStatementFields {
  currency: string | null;
  rows: Array<{ date: string; description: string; amount: number; balance: number | null }>;
}

/** A read-only report the model may call while answering a question. */
export interface AskTool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: Input;
  run(input: z.infer<Input>): Promise<string>;
}

export interface AiProvider {
  /** Who processes the data, for the disclosure ("Claude by Anthropic"). */
  readonly label: string;
  draftFromText(text: string, ctx: AiContext): Promise<AiTransactionFields>;
  readReceipt(file: { data: Buffer; mediaType: string }, ctx: AiContext): Promise<AiReceiptFields>;
  /** A category (or null) for each item, by key. */
  categorize(
    items: Array<{ key: string; text: string; direction: 'expense' | 'income' }>,
    categories: AiCategory[],
  ): Promise<Array<{ key: string; categoryId: string | null }>>;
  readStatement(pdf: Buffer, ctx: AiContext): Promise<AiStatementFields>;
  /** Answers a question using only the given tools. */
  answer(question: string, system: string, tools: AskTool[]): Promise<string>;
}

/** A failure worth showing to the person as is ("The receipt is too blurry to read"). */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 429 | 502 | 503 = 502,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
