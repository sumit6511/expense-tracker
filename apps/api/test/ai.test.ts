import { addDays, todayIn } from '@et/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiError } from '../src/ai/provider';
import { aiUsage } from '../src/db/schema';
import { type Fixture, ORIGIN, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const ai = () => testApp().ai;
beforeEach(() => ai().reset());

const today = () => todayIn('Asia/Kathmandu');

async function enable(f: Fixture) {
  const res = await f.client.patch(f.base, { aiEnabled: true });
  expect(res.status).toBe(200);
  expect(res.body.aiEnabled).toBe(true);
}

/** Posts a file as multipart form data. */
async function upload(f: Fixture, path: string, bytes: Uint8Array, name: string) {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  const res = await testApp().app.request(`${f.base}${path}`, {
    method: 'POST',
    body: form,
    headers: { cookie: f.client.cookie, origin: ORIGIN },
  });
  return { status: res.status, body: (await res.json()) as any };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4\n% statement\n');

const fields = (overrides: Record<string, unknown> = {}) => ({
  direction: 'expense' as const,
  amount: null,
  currency: null,
  date: null,
  accountId: null,
  categoryId: null,
  payee: null,
  notes: null,
  ...overrides,
});

describe('AI helpers', () => {
  it('are off until the workspace turns them on; quick add works without them', async () => {
    const f = await setupWorkspace();
    expect((await f.client.get(`${f.base}/ai`)).body).toEqual({
      available: true,
      enabled: false,
      provider: 'Test AI',
      usedToday: 0,
      dailyLimit: 200,
    });
    // Rules and history only: Bhat Bhateni was Food & Groceries before.
    await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: today(),
      amountMinor: -10_000,
      payee: 'Bhat Bhateni',
      categoryId: f.categories['Food & Groceries'],
    });
    const draft = await f.client.post(`${f.base}/ai/parse`, {
      text: '2300 at bhat bhateni yesterday via bank',
    });
    expect(draft.body).toEqual({
      direction: 'expense',
      amountMinor: 230_000,
      currency: 'NPR',
      date: addDays(today(), -1),
      accountId: f.accounts.Bank,
      categoryId: f.categories['Food & Groceries'],
      payee: 'bhat bhateni',
      notes: null,
      source: 'rules',
    });
    // Nothing to go on, and AI is off: the draft stays empty rather than calling out.
    const vague = await f.client.post(`${f.base}/ai/parse`, { text: 'the usual' });
    expect(vague.body).toMatchObject({ amountMinor: null, source: 'rules' });
    expect(ai().calls).toEqual([]);

    for (const path of ['/ai/categorize', '/ai/ask']) {
      const res = await f.client.post(`${f.base}${path}`, { question: 'How much?' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ai_disabled');
    }
    expect((await upload(f, '/ai/receipt', PNG, 'r.png')).status).toBe(403);
  });

  it('falls back to the model for what the rules can’t read, sending only names', async () => {
    const f = await setupWorkspace();
    await enable(f);
    ai().next.draftFromText = async (_text, ctx) =>
      fields({
        amount: 400,
        payee: 'Himalayan Java',
        categoryId: ctx.categories.find((c) => c.name === 'Dining Out')!.id,
        date: 'not a date',
        accountId: 'made-up',
      });
    const res = await f.client.post(`${f.base}/ai/parse`, {
      text: 'coffee and cake with Sita, about four hundred',
      accountId: f.accounts.Cash,
    });
    expect(res.body).toMatchObject({
      amountMinor: 40_000,
      currency: 'NPR',
      payee: 'Himalayan Java',
      categoryId: f.categories['Dining Out'],
      date: null,
      accountId: null,
      source: 'ai',
    });
    const [call] = ai().calls;
    expect(call!.method).toBe('draftFromText');
    const ctx = call!.args[1] as { accounts: object[]; categories: object[] };
    // Names and ids only: no balances, no transactions.
    expect(Object.keys(ctx.accounts[0]!).sort()).toEqual(['currency', 'id', 'name']);
    expect(Object.keys(ctx.categories[0]!).sort()).toEqual(['id', 'kind', 'name']);
  });

  it('reads a receipt, preferring the merchant’s usual category', async () => {
    const f = await setupWorkspace();
    await enable(f);
    await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: today(),
      amountMinor: -10_000,
      payee: 'Big Mart',
      categoryId: f.categories['Food & Groceries'],
    });
    ai().next.readReceipt = async (_file, ctx) => ({
      ...fields({
        amount: 1234.5,
        currency: 'npr',
        date: today(),
        payee: 'Big Mart',
        categoryId: ctx.categories.find((c) => c.name === 'Shopping')!.id,
      }),
      tax: 142.04,
      items: [
        { description: 'Rice 5kg', amount: 950 },
        { description: 'Milk', amount: 284.5 },
      ],
    });
    const res = await upload(f, '/ai/receipt', PNG, 'receipt.png');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      amountMinor: 123_450,
      currency: 'NPR',
      payee: 'Big Mart',
      categoryId: f.categories['Food & Groceries'],
      taxMinor: 14_204,
      items: [
        { description: 'Rice 5kg', amountMinor: 95_000 },
        { description: 'Milk', amountMinor: 28_450 },
      ],
      source: 'ai',
    });
    expect((ai().calls[0]!.args[0] as { mediaType: string }).mediaType).toBe('image/png');

    const bad = await upload(f, '/ai/receipt', new TextEncoder().encode('hello'), 'x.png');
    expect(bad.status).toBe(400);

    ai().next.readReceipt = async () => {
      throw new AiError('The AI declined to read this. Fill it in by hand.', 422);
    };
    const declined = await upload(f, '/ai/receipt', PNG, 'receipt.png');
    expect(declined.status).toBe(422);
    expect(declined.body.error.message).toMatch(/declined/);
  });

  it('suggests categories: history first, then the model, all waiting for review', async () => {
    const f = await setupWorkspace();
    await enable(f);
    const add = async (payee: string, amountMinor: number, categoryId: string | null = null) =>
      (
        await f.client.post(`${f.base}/transactions`, {
          accountId: f.accounts.Cash,
          date: today(),
          amountMinor,
          payee,
          categoryId,
        })
      ).body.id as string;
    await add('Pathao', -30_000, f.categories.Transport);
    const known = await add('Pathao', -25_000);
    const unknown = await add('NEA Bill Payment', -180_000);
    const vague = await add('Transfer 0042', -5_000);
    ai().next.categorize = async (items, categories) =>
      items.map((i) => ({
        key: i.key,
        categoryId: i.text.includes('NEA')
          ? categories.find((c) => c.name === 'Utilities')!.id
          : null,
      }));

    const res = await f.client.post(`${f.base}/ai/categorize`, {});
    expect(res.body).toEqual({ suggested: 2, skipped: 1 });
    // Only the ones history couldn't place were sent.
    const sent = ai().calls[0]!.args[0] as Array<{ key: string; text: string }>;
    expect(sent.map((s) => s.key).sort()).toEqual([unknown, vague].sort());
    expect(sent.find((s) => s.key === unknown)).toEqual({
      key: unknown,
      text: 'NEA Bill Payment',
      direction: 'expense',
    });

    const get = async (id: string) => (await f.client.get(`${f.base}/transactions/${id}`)).body;
    expect(await get(known)).toMatchObject({
      needsReview: true,
      splits: [{ categoryId: f.categories.Transport }],
    });
    expect(await get(unknown)).toMatchObject({
      needsReview: true,
      splits: [{ categoryId: f.categories.Utilities }],
    });
    expect(await get(vague)).toMatchObject({ needsReview: false, splits: [{ categoryId: null }] });
  });

  it('reads a PDF statement into rows for the import preview', async () => {
    const f = await setupWorkspace();
    await enable(f);
    ai().next.readStatement = async () => ({
      currency: 'NPR',
      rows: [
        { date: '2026-09-01', description: 'ATM withdrawal', amount: -5000, balance: 45_000 },
        { date: '2026-09-02', description: 'Salary', amount: 125_000.5, balance: 170_000.5 },
        { date: 'yesterday', description: 'Unreadable', amount: -10, balance: null },
      ],
    });
    const res = await upload(f, '/ai/statement', PDF, 'statement.pdf');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currency: 'NPR',
      rows: [
        {
          date: '2026-09-01',
          description: 'ATM withdrawal',
          amountMinor: -500_000,
          balanceMinor: 4_500_000,
        },
        {
          date: '2026-09-02',
          description: 'Salary',
          amountMinor: 12_500_050,
          balanceMinor: 17_000_050,
        },
      ],
    });
    expect((await upload(f, '/ai/statement', PNG, 'photo.png')).status).toBe(400);
  });

  it('answers questions through the report tools only, for viewers too', async () => {
    const f = await setupWorkspace();
    await enable(f);
    await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: today(),
      amountMinor: -250_000,
      payee: 'Bhojan Griha',
      categoryId: f.categories['Dining Out'],
    });
    let seen = '';
    ai().next.answer = async (_question, system, tools) => {
      expect(system).toMatch(/Bikram Sambat/);
      const month = await tools.find((t) => t.name === 'month_dates')!.run({ offset: 0 });
      const [, from, to] = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(month)!;
      seen = await tools.find((t) => t.name === 'spending_by_category')!.run({ from, to });
      const bad = await tools
        .find((t) => t.name === 'find_transactions')!
        .run({
          from: 'soon',
          to: to!,
          search: null,
          category: null,
          type: 'any',
        });
      expect(bad).toMatch(/^Error:/);
      return 'You spent Rs. 2,500 on dining out this month.';
    };
    const viewer = await signUp('Hari');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: viewer.email,
      role: 'viewer',
    });
    await viewer.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    const res = await viewer.post(`${f.base}/ai/ask`, {
      question: 'How much did we spend eating out this month?',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      answer: 'You spent Rs. 2,500 on dining out this month.',
      sources: ['Budget months', 'Spending by category', 'Transactions'],
    });
    expect(seen).toContain('Dining Out: Rs. 2,500 (1 transactions)');
    // Viewers still can't use the helpers that make changes.
    expect((await viewer.post(`${f.base}/ai/categorize`, {})).status).toBe(403);
  });

  it('stops at the daily limit', async () => {
    const f = await setupWorkspace();
    await enable(f);
    await testApp().db.insert(aiUsage).values({ workspaceId: f.ws.id, day: today(), count: 200 });
    const res = await f.client.post(`${f.base}/ai/ask`, { question: 'How am I doing?' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ai_limit');
    expect(ai().calls).toEqual([]);
  });
});
