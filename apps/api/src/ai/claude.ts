import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Env } from '../env';
import type { Logger } from '../logger';
import {
  type AiCategory,
  type AiContext,
  AiError,
  type AiProvider,
  type AiReceiptFields,
  type AiStatementFields,
  type AiTransactionFields,
  type AskTool,
} from './provider';

type Effort = 'low' | 'medium' | 'high';
type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

/** Effort isn't accepted by Haiku 4.5, Sonnet 4.5 and older models. */
const supportsEffort = (model: string) => !/haiku|sonnet-4-5|sonnet-4-0|claude-3/.test(model);
/** Server-side fallback on a safety decline ("default" routing) for the models that offer it. */
const supportsFallback = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

const TransactionFields = z.object({
  direction: z.enum(['expense', 'income']),
  amount: z.number().nullable().describe('Total in major units, e.g. 450.5; null if not stated'),
  currency: z.string().nullable().describe('ISO 4217 code if stated, else null'),
  date: z.string().nullable().describe('YYYY-MM-DD, or null if not stated'),
  accountId: z.string().nullable().describe('An account id from the list, or null'),
  categoryId: z.string().nullable().describe('A category id from the list, or null'),
  payee: z.string().nullable().describe('Merchant or person, or null'),
  notes: z.string().nullable().describe('Anything else worth keeping, briefly, or null'),
});

const ReceiptFields = TransactionFields.extend({
  tax: z.number().nullable().describe('Tax or VAT total if printed, else null'),
  items: z
    .array(z.object({ description: z.string(), amount: z.number() }))
    .describe('Line items as printed (at most 30); empty if unreadable'),
});

const StatementFields = z.object({
  currency: z.string().nullable(),
  rows: z.array(
    z.object({
      date: z.string().describe('YYYY-MM-DD'),
      description: z.string(),
      amount: z.number().describe('Negative for money out (debits), positive for money in'),
      balance: z.number().nullable().describe('Running balance after this row, if shown'),
    }),
  ),
});

const Categorized = z.object({
  results: z.array(z.object({ key: z.string(), categoryId: z.string().nullable() })),
});

function listsFor(ctx: Pick<AiContext, 'accounts' | 'categories'>) {
  const accounts = ctx.accounts.map((a) => `${a.id}: ${a.name} (${a.currency})`).join('\n');
  const categories = ctx.categories.map((c) => `${c.id}: ${c.name} (${c.kind})`).join('\n');
  return `Accounts:\n${accounts || '(none)'}\n\nCategories:\n${categories || '(none)'}`;
}

export class ClaudeProvider implements AiProvider {
  readonly label = 'Claude by Anthropic';

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly logger?: Logger,
  ) {}

  /** Effort where the model accepts it, and the server-side fallback on a safety decline. */
  private common(effort: Effort) {
    return {
      effort: supportsEffort(this.model) ? effort : undefined,
      params: {
        model: this.model,
        ...(supportsFallback(this.model)
          ? {
              betas: ['server-side-fallback-2026-07-01'] satisfies Anthropic.Beta.AnthropicBeta[],
              fallbacks: 'default' as const,
            }
          : {}),
      },
    };
  }

  /** One structured-output request, checked for refusals and truncation. */
  private async extract<Schema extends z.ZodType>(
    schema: Schema,
    system: string,
    content: string | ContentBlock[],
    options: { effort?: Effort; maxTokens?: number; timeoutMs?: number } = {},
  ): Promise<z.infer<Schema>> {
    const { effort, params } = this.common(options.effort ?? 'low');
    try {
      const response = await this.client.beta.messages.parse(
        {
          ...params,
          max_tokens: options.maxTokens ?? 4096,
          system,
          messages: [{ role: 'user', content }],
          output_config: { ...(effort ? { effort } : {}), format: betaZodOutputFormat(schema) },
        },
        { timeout: options.timeoutMs ?? 60_000 },
      );
      if (response.stop_reason === 'refusal')
        throw new AiError('The AI declined to read this. Fill it in by hand.', 422);
      if (response.stop_reason === 'max_tokens')
        throw new AiError('That was too long for the AI to read in one go.', 422);
      if (!response.parsed_output) throw new AiError('The AI’s answer couldn’t be read.');
      return response.parsed_output;
    } catch (err) {
      throw this.friendly(err);
    }
  }

  private friendly(err: unknown): Error {
    if (err instanceof AiError) return err;
    if (err instanceof Anthropic.RateLimitError)
      return new AiError('The AI service is busy. Try again in a minute.', 429);
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError
    ) {
      this.logger?.error({ err }, 'AI provider rejected the API key');
      return new AiError('The server’s AI key isn’t working. Ask whoever runs it.', 503);
    }
    if (err instanceof Anthropic.BadRequestError) {
      this.logger?.warn({ err }, 'AI request rejected');
      return new AiError('The AI couldn’t process that file or text.', 422);
    }
    if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
      this.logger?.warn({ err }, 'AI request failed');
      return new AiError('The AI service didn’t respond. Try again.', 502);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async draftFromText(text: string, ctx: AiContext): Promise<AiTransactionFields> {
    const system = `You turn a short note about money spent or received into transaction fields for an expense tracker. Today is ${ctx.today}. Amounts are in ${ctx.currency} unless the note says otherwise. Use ids from the lists; leave a field null when the note doesn't say.\n\n${listsFor(ctx)}`;
    return this.extract(TransactionFields, system, text);
  }

  async readReceipt(
    file: { data: Buffer; mediaType: string },
    ctx: AiContext,
  ): Promise<AiReceiptFields> {
    const data = file.data.toString('base64');
    const source: ContentBlock =
      file.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : {
            type: 'image',
            source: {
              type: 'base64',
              media_type: file.mediaType as (typeof IMAGE_TYPES)[number],
              data,
            },
          };
    const system = `You read receipts and bills for an expense tracker. Today is ${ctx.today}; the default currency is ${ctx.currency}. amount is the total paid. Pick the category that best fits the merchant and items; use ids from the lists, or null.\n\n${listsFor(ctx)}`;
    return this.extract(ReceiptFields, system, [
      source,
      { type: 'text', text: 'Read this receipt.' },
    ]);
  }

  async categorize(
    items: Array<{ key: string; text: string; direction: 'expense' | 'income' }>,
    categories: AiCategory[],
  ): Promise<Array<{ key: string; categoryId: string | null }>> {
    const system = `You sort bank transactions into a person's budget categories. For each item, choose the category id that fits best (matching money out to expense categories and money in to income ones), or null when none fits well or the description is too vague.\n\n${listsFor({ accounts: [], categories })}`;
    const result = await this.extract(Categorized, system, JSON.stringify(items), {
      maxTokens: 8192,
    });
    return result.results;
  }

  async readStatement(pdf: Buffer, ctx: AiContext): Promise<AiStatementFields> {
    const system = `You extract transactions from bank and wallet statements. List every transaction row in order. Skip opening and closing balances, totals and headers. The account's usual currency is ${ctx.currency}.`;
    return this.extract(
      StatementFields,
      system,
      [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
        },
        { type: 'text', text: 'Extract the transactions from this statement.' },
      ],
      { maxTokens: 16_000, timeoutMs: 180_000 },
    );
  }

  async answer(question: string, system: string, tools: AskTool[]): Promise<string> {
    const { effort, params } = this.common('medium');
    try {
      const runner = this.client.beta.messages.toolRunner(
        {
          ...params,
          max_tokens: 4096,
          max_iterations: 8,
          system,
          ...(effort ? { output_config: { effort } } : {}),
          tools: tools.map((t) =>
            betaZodTool({
              name: t.name,
              description: t.description,
              inputSchema: t.input,
              run: (input) => t.run(input),
            }),
          ),
          messages: [{ role: 'user', content: question }],
        },
        // The whole back-and-forth, however many tool calls it takes.
        { signal: AbortSignal.timeout(120_000) },
      );
      const message = await runner.done();
      if (message.stop_reason === 'refusal')
        throw new AiError('The AI declined to answer that.', 422);
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (!text) throw new AiError('The AI didn’t come up with an answer. Try rephrasing.');
      return text;
    } catch (err) {
      throw this.friendly(err);
    }
  }
}

export function createAiProvider(env: Env, logger: Logger): AiProvider | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  return new ClaudeProvider(client, env.AI_MODEL, logger);
}
