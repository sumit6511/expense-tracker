import type {
  AiCategory,
  AiContext,
  AiProvider,
  AiReceiptFields,
  AiStatementFields,
  AiTransactionFields,
  AskTool,
} from '../src/ai/provider';

type Handlers = {
  draftFromText: (text: string, ctx: AiContext) => Promise<AiTransactionFields>;
  readReceipt: (
    file: { data: Buffer; mediaType: string },
    ctx: AiContext,
  ) => Promise<AiReceiptFields>;
  categorize: (
    items: Array<{ key: string; text: string; direction: 'expense' | 'income' }>,
    categories: AiCategory[],
  ) => Promise<Array<{ key: string; categoryId: string | null }>>;
  readStatement: (pdf: Buffer, ctx: AiContext) => Promise<AiStatementFields>;
  answer: (question: string, system: string, tools: AskTool[]) => Promise<string>;
};

/** A provider for tests: each call does what the test scripted, and is recorded. */
export class FakeAi implements AiProvider {
  readonly label = 'Test AI';
  calls: Array<{ method: keyof Handlers; args: unknown[] }> = [];
  next: Partial<Handlers> = {};

  private run<K extends keyof Handlers>(method: K, ...args: Parameters<Handlers[K]>) {
    this.calls.push({ method, args });
    const handler = this.next[method] as ((...a: unknown[]) => ReturnType<Handlers[K]>) | undefined;
    if (!handler) throw new Error(`FakeAi.${method} wasn't scripted`);
    return handler(...args) as ReturnType<Handlers[K]>;
  }

  reset() {
    this.calls = [];
    this.next = {};
  }

  draftFromText(text: string, ctx: AiContext) {
    return this.run('draftFromText', text, ctx);
  }
  readReceipt(file: { data: Buffer; mediaType: string }, ctx: AiContext) {
    return this.run('readReceipt', file, ctx);
  }
  categorize(
    items: Array<{ key: string; text: string; direction: 'expense' | 'income' }>,
    categories: AiCategory[],
  ) {
    return this.run('categorize', items, categories);
  }
  readStatement(pdf: Buffer, ctx: AiContext) {
    return this.run('readStatement', pdf, ctx);
  }
  answer(question: string, system: string, tools: AskTool[]) {
    return this.run('answer', question, system, tools);
  }
}
