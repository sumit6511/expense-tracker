import { uuidv7 } from '@et/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transactionSplits, transactions } from '../src/db/schema';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

let f: Fixture;
beforeAll(async () => {
  f = await setupWorkspace();
});

const balanceOf = async (fx: Fixture, name: string) =>
  (await fx.client.get(`${fx.base}/accounts/${fx.accounts[name]}`)).body.balanceMinor as number;

describe('creating transactions', () => {
  it('creates an expense with a category, payee and tag', async () => {
    const tag = await f.client.post(`${f.base}/tags`, { name: '#dashain', color: '#e11d48' });
    expect(tag.status).toBe(201);
    const res = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-30',
      amountMinor: -250_000,
      payee: 'Bhat-Bhateni Supermarket',
      categoryId: f.categories['Food & Groceries'],
      notes: 'Monthly groceries',
      tagIds: [tag.body.id],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amountMinor: -250_000,
      currency: 'NPR',
      payeeName: 'Bhat-Bhateni Supermarket',
      notes: 'Monthly groceries',
      status: 'cleared',
      needsReview: false,
      transfer: null,
      tagIds: [tag.body.id],
      splits: [{ categoryId: f.categories['Food & Groceries'], amountMinor: -250_000 }],
    });
    expect(await balanceOf(f, 'Cash')).toBe(1_000_000 - 250_000);
  });

  it('reuses payees regardless of case and punctuation', async () => {
    const a = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-29',
      amountMinor: -1000,
      payee: 'bhat bhateni supermarket',
    });
    const b = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-29',
      amountMinor: -2000,
      payee: 'BHAT BHATENI SUPERMARKET PVT. LTD.',
    });
    expect(a.body.payeeId).toBe(b.body.payeeId);
  });

  it('splits one payment across categories', async () => {
    const res = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Bank,
      date: '2026-09-28',
      amountMinor: -100_000,
      payee: 'Big Mart',
      splits: [
        { categoryId: f.categories['Food & Groceries'], amountMinor: -70_000, memo: 'food' },
        { categoryId: f.categories.Shopping, amountMinor: -30_000, memo: 'soap' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.splits).toHaveLength(2);

    const bad = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Bank,
      date: '2026-09-28',
      amountMinor: -100_000,
      splits: [
        { categoryId: null, amountMinor: -70_000 },
        { categoryId: null, amountMinor: -20_000 },
      ],
    });
    expect(bad.status).toBe(400);
  });

  it('rejects unknown categories, zero amounts and other workspaces’ accounts', async () => {
    const other = await setupWorkspace();
    const base = { accountId: f.accounts.Cash, date: '2026-09-30', amountMinor: -100 };
    expect(
      (
        await f.client.post(`${f.base}/transactions`, {
          ...base,
          categoryId: other.categories.Rent,
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.client.post(`${f.base}/transactions`, { ...base, amountMinor: 0 })).status,
    ).toBe(400);
    expect(
      (await f.client.post(`${f.base}/transactions`, { ...base, accountId: other.accounts.Cash }))
        .status,
    ).toBe(404);
  });

  it('is idempotent when the client supplies an id', async () => {
    const id = uuidv7();
    const body = { id, accountId: f.accounts.Cash, date: '2026-09-30', amountMinor: -777 };
    const first = await f.client.post(`${f.base}/transactions`, body);
    const second = await f.client.post(`${f.base}/transactions`, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(id);
    const other = await setupWorkspace();
    const clash = await other.client.post(`${other.base}/transactions`, {
      ...body,
      accountId: other.accounts.Cash,
    });
    expect(clash.status).toBe(409);
  });

  it('refuses transactions on archived accounts', async () => {
    const acct = await f.client.post(`${f.base}/accounts`, {
      name: 'Old',
      type: 'cash',
      currency: 'NPR',
    });
    await f.client.patch(`${f.base}/accounts/${acct.body.id}`, { archived: true });
    const res = await f.client.post(`${f.base}/transactions`, {
      accountId: acct.body.id,
      date: '2026-09-30',
      amountMinor: -1,
    });
    expect(res.status).toBe(400);
  });
});

describe('editing transactions', () => {
  it('updates amount of a single-split transaction and keeps the split in sync', async () => {
    const t = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-27',
      amountMinor: -5000,
      categoryId: f.categories['Dining Out'],
    });
    const res = await f.client.patch(`${f.base}/transactions/${t.body.id}`, {
      amountMinor: -6500,
      version: t.body.version,
    });
    expect(res.status).toBe(200);
    expect(res.body.amountMinor).toBe(-6500);
    expect(res.body.splits).toEqual([
      expect.objectContaining({ amountMinor: -6500, categoryId: f.categories['Dining Out'] }),
    ]);
    expect(res.body.version).toBe(t.body.version + 1);

    const stale = await f.client.patch(`${f.base}/transactions/${t.body.id}`, {
      notes: 'x',
      version: t.body.version,
    });
    expect(stale.status).toBe(409);
  });

  it('requires new split amounts when a split transaction’s total changes', async () => {
    const t = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-27',
      amountMinor: -1000,
      splits: [
        { categoryId: null, amountMinor: -600 },
        { categoryId: null, amountMinor: -400 },
      ],
    });
    expect(
      (await f.client.patch(`${f.base}/transactions/${t.body.id}`, { amountMinor: -2000 })).status,
    ).toBe(400);
    const ok = await f.client.patch(`${f.base}/transactions/${t.body.id}`, {
      amountMinor: -2000,
      splits: [
        { categoryId: f.categories.Health, amountMinor: -1500 },
        { categoryId: null, amountMinor: -500 },
      ],
    });
    expect(ok.status).toBe(200);
    const collapse = await f.client.patch(`${f.base}/transactions/${t.body.id}`, {
      categoryId: f.categories.Health,
    });
    expect(collapse.body.splits).toEqual([expect.objectContaining({ amountMinor: -2000 })]);
  });

  it('moves a transaction to another account, changes payee and tags', async () => {
    const t = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-26',
      amountMinor: -300,
    });
    const res = await f.client.patch(`${f.base}/transactions/${t.body.id}`, {
      accountId: f.accounts.Bank,
      payee: 'Pathao',
      date: '2026-09-25',
      tagIds: [],
    });
    expect(res.body).toMatchObject({
      accountId: f.accounts.Bank,
      payeeName: 'Pathao',
      date: '2026-09-25',
    });
  });

  it('soft-deletes and restores', async () => {
    const t = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Bank,
      date: '2026-09-26',
      amountMinor: -12345,
    });
    const before = await balanceOf(f, 'Bank');
    expect((await f.client.delete(`${f.base}/transactions/${t.body.id}`)).status).toBe(204);
    expect(await balanceOf(f, 'Bank')).toBe(before + 12345);
    const trash = await f.client.get(`${f.base}/transactions?deleted=true`);
    expect(trash.body.items.map((i: { id: string }) => i.id)).toContain(t.body.id);
    expect(
      (await f.client.patch(`${f.base}/transactions/${t.body.id}`, { notes: 'x' })).status,
    ).toBe(404);
    const restored = await f.client.post(`${f.base}/transactions/${t.body.id}/restore`);
    expect(restored.body.deleted).toBe(false);
    expect(await balanceOf(f, 'Bank')).toBe(before);
  });
});

describe('transfers', () => {
  it('moves money between same-currency accounts', async () => {
    const [cash, bank] = [await balanceOf(f, 'Cash'), await balanceOf(f, 'Bank')];
    const res = await f.client.post(`${f.base}/transfers`, {
      fromAccountId: f.accounts.Cash,
      toAccountId: f.accounts.Bank,
      date: '2026-09-30',
      amountMinor: 20_000,
      notes: 'Deposit',
    });
    expect(res.status).toBe(201);
    expect(res.body.from).toMatchObject({
      amountMinor: -20_000,
      splits: [],
      transfer: { peerAccountId: f.accounts.Bank },
    });
    expect(res.body.to).toMatchObject({ amountMinor: 20_000, notes: 'Deposit' });
    expect(await balanceOf(f, 'Cash')).toBe(cash - 20_000);
    expect(await balanceOf(f, 'Bank')).toBe(bank + 20_000);

    // Editing date on one leg moves both; amounts can't be edited from a leg.
    const leg = await f.client.patch(`${f.base}/transactions/${res.body.to.id}`, {
      date: '2026-09-29',
    });
    expect(leg.body.date).toBe('2026-09-29');
    expect((await f.client.get(`${f.base}/transactions/${res.body.from.id}`)).body.date).toBe(
      '2026-09-29',
    );
    expect(
      (await f.client.patch(`${f.base}/transactions/${res.body.to.id}`, { amountMinor: 5 })).status,
    ).toBe(400);
    expect(
      (await f.client.patch(`${f.base}/transactions/${res.body.to.id}`, { categoryId: null }))
        .status,
    ).toBe(400);

    // Deleting one leg deletes both.
    await f.client.delete(`${f.base}/transactions/${res.body.from.id}`);
    expect((await f.client.get(`${f.base}/transactions/${res.body.to.id}`)).body.deleted).toBe(
      true,
    );
    expect(await balanceOf(f, 'Cash')).toBe(cash);
  });

  it('needs the received amount across currencies', async () => {
    const body = {
      fromAccountId: f.accounts.Bank,
      toAccountId: f.accounts['USD Card'],
      date: '2026-09-30',
      amountMinor: 133_000,
    };
    const missing = await f.client.post(`${f.base}/transfers`, body);
    expect(missing.status).toBe(400);
    const res = await f.client.post(`${f.base}/transfers`, { ...body, toAmountMinor: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.to).toMatchObject({ amountMinor: 1000, currency: 'USD' });

    const updated = await f.client.patch(`${f.base}/transfers/${res.body.from.transfer.groupId}`, {
      amountMinor: 140_000,
      toAmountMinor: 1050,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.from.amountMinor).toBe(-140_000);
    expect(updated.body.to.amountMinor).toBe(1050);
    const same = await f.client.post(`${f.base}/transfers`, {
      ...body,
      toAccountId: f.accounts.Bank,
    });
    expect(same.status).toBe(400);
  });
});

describe('listing', () => {
  it('filters, searches, paginates and totals', async () => {
    const g = await setupWorkspace();
    const make = (amountMinor: number, date: string, extra: Record<string, unknown> = {}) =>
      g.client.post(`${g.base}/transactions`, {
        accountId: g.accounts.Cash,
        date,
        amountMinor,
        ...extra,
      });
    for (let i = 1; i <= 12; i++) await make(-100 * i, `2026-09-${String(i).padStart(2, '0')}`);
    await make(-5000, '2026-09-15', {
      payee: 'Himalayan Java',
      categoryId: g.categories['Dining Out'],
      notes: 'latte',
    });
    await make(90_000, '2026-09-16', { payee: 'Employer', categoryId: g.categories.Salary });

    const all = await g.client.get(`${g.base}/transactions?limit=5`);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.items[0].date).toBe('2026-09-16');
    expect(all.body.totals).toEqual({
      count: 14,
      inflowBaseMinor: 90_000,
      outflowBaseMinor: -(7800 + 5000),
    });

    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } =
        await g.client.get(`${g.base}/transactions?limit=5${cursor ? `&cursor=${cursor}` : ''}`);
      for (const item of page.body.items) seen.add(item.id);
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(14);

    const search = await g.client.get(`${g.base}/transactions?q=java`);
    expect(search.body.items.map((t: { payeeName: string }) => t.payeeName)).toEqual([
      'Himalayan Java',
    ]);
    const byNote = await g.client.get(`${g.base}/transactions?q=LATTE`);
    expect(byNote.body.items).toHaveLength(1);
    const uncategorized = await g.client.get(`${g.base}/transactions?categoryIds=none`);
    expect(uncategorized.body.totals.count).toBe(12);
    const dining = await g.client.get(
      `${g.base}/transactions?categoryIds=${g.categories['Dining Out']}`,
    );
    expect(dining.body.totals.count).toBe(1);
    const income = await g.client.get(`${g.base}/transactions?type=income`);
    expect(income.body.totals.count).toBe(1);
    const range = await g.client.get(
      `${g.base}/transactions?from=2026-09-10&to=2026-09-12&minAmount=1050`,
    );
    expect(range.body.items.map((t: { amountMinor: number }) => t.amountMinor)).toEqual([
      -1200, -1100,
    ]);
  });

  it('shows running balances for a single account', async () => {
    const g = await setupWorkspace();
    await g.client.post(`${g.base}/transactions`, {
      accountId: g.accounts.Bank,
      date: '2026-09-01',
      amountMinor: 50_000,
    });
    await g.client.post(`${g.base}/transactions`, {
      accountId: g.accounts.Bank,
      date: '2026-09-02',
      amountMinor: -20_000,
    });
    const res = await g.client.get(`${g.base}/transactions?accountIds=${g.accounts.Bank}`);
    expect(
      res.body.items.map((t: { runningBalanceMinor: number }) => t.runningBalanceMinor),
    ).toEqual([30_000, 50_000]);
  });
});

describe('bulk actions', () => {
  it('categorizes, tags, reviews and deletes many at once', async () => {
    const g = await setupWorkspace();
    const ids: string[] = [];
    for (const amount of [-100, -200, -300]) {
      ids.push(
        (
          await g.client.post(`${g.base}/transactions`, {
            accountId: g.accounts.Cash,
            date: '2026-09-10',
            amountMinor: amount,
          })
        ).body.id,
      );
    }
    const split = await g.client.post(`${g.base}/transactions`, {
      accountId: g.accounts.Cash,
      date: '2026-09-10',
      amountMinor: -100,
      splits: [
        { categoryId: null, amountMinor: -50 },
        { categoryId: null, amountMinor: -50 },
      ],
    });
    const cat = await g.client.post(`${g.base}/transactions/bulk`, {
      action: 'setCategory',
      ids: [...ids, split.body.id],
      categoryId: g.categories.Transport,
    });
    expect(cat.body).toEqual({ updated: 3, skipped: 1 });

    const tag = await g.client.post(`${g.base}/tags`, { name: 'trip' });
    const tagged = await g.client.post(`${g.base}/transactions/bulk`, {
      action: 'addTags',
      ids,
      tagIds: [tag.body.id],
    });
    expect(tagged.body.updated).toBe(3);
    expect(
      (await g.client.get(`${g.base}/transactions?tagIds=${tag.body.id}`)).body.totals.count,
    ).toBe(3);

    const del = await g.client.post(`${g.base}/transactions/bulk`, { action: 'delete', ids });
    expect(del.body.updated).toBe(3);
    const restored = await g.client.post(`${g.base}/transactions/bulk`, {
      action: 'restore',
      ids: ids.slice(0, 1),
    });
    expect(restored.body.updated).toBe(1);
  });
});

describe('ledger invariant (database level)', () => {
  it('rejects splits that do not add up, even bypassing the API', async () => {
    const { db } = testApp();
    const id = uuidv7();
    const attempt = db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        id,
        workspaceId: f.ws.id,
        accountId: f.accounts.Cash!,
        date: '2026-09-30',
        amountMinor: -1000,
      });
      await tx
        .insert(transactionSplits)
        .values({ id: uuidv7(), transactionId: id, workspaceId: f.ws.id, amountMinor: -999 });
    });
    await expect(attempt).rejects.toThrow();
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.id, id));
    expect(row?.n).toBe(0);
  });

  it('rejects a regular transaction with no splits', async () => {
    const { db } = testApp();
    await expect(
      db.insert(transactions).values({
        id: uuidv7(),
        workspaceId: f.ws.id,
        accountId: f.accounts.Cash!,
        date: '2026-09-30',
        amountMinor: -1000,
      }),
    ).rejects.toThrow();
  });
});

describe('accounts', () => {
  it('refuses to delete accounts with transactions but allows archiving', async () => {
    const g = await setupWorkspace();
    await g.client.post(`${g.base}/transactions`, {
      accountId: g.accounts.Bank,
      date: '2026-09-01',
      amountMinor: -1,
    });
    expect((await g.client.delete(`${g.base}/accounts/${g.accounts.Bank}`)).status).toBe(409);
    const archived = await g.client.patch(`${g.base}/accounts/${g.accounts.Bank}`, {
      archived: true,
    });
    expect(archived.body.archived).toBe(true);
    expect((await g.client.delete(`${g.base}/accounts/${g.accounts.Cash}`)).status).toBe(204);
  });

  it('partial updates leave other fields alone', async () => {
    const g = await setupWorkspace();
    await g.client.patch(`${g.base}/accounts/${g.accounts.Cash}`, { onBudget: false });
    const archived = await g.client.patch(`${g.base}/accounts/${g.accounts.Cash}`, {
      archived: true,
    });
    expect(archived.body).toMatchObject({
      archived: true,
      openingBalanceMinor: 1_000_000,
      balanceMinor: 1_000_000,
      onBudget: false,
    });
    const tag = await g.client.post(`${g.base}/tags`, { name: 'trip', color: '#dc2626' });
    await g.client.patch(`${g.base}/tags/${tag.body.id}`, { name: 'travel' });
    const [renamed] = (await g.client.get(`${g.base}/tags`)).body;
    expect(renamed).toMatchObject({ name: 'travel', color: '#dc2626' });
  });

  it('reports balances converted to the base currency', async () => {
    const g = await setupWorkspace();
    await g.client.post(`${g.base}/transactions`, {
      accountId: g.accounts['INR Wallet'],
      date: '2026-09-01',
      amountMinor: 10_000,
    });
    const accounts = (await g.client.get(`${g.base}/accounts`)).body;
    const inr = accounts.find((a: { name: string }) => a.name === 'INR Wallet');
    expect(inr).toMatchObject({
      balanceMinor: 10_000,
      balanceBaseMinor: 16_000,
      transactionCount: 1,
    });
  });
});
