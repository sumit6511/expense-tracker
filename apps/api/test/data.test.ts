import { afterAll, describe, expect, it } from 'vitest';
import { setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

describe('statement import', () => {
  it('previews duplicates and suggestions, commits, and reverts', async () => {
    const f = await setupWorkspace();
    await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Bank,
      date: '2026-09-30',
      amountMinor: -245_000,
      payee: 'Bhat Bhateni',
      categoryId: f.categories['Food & Groceries'],
    });
    const rows = [
      {
        date: '2026-10-01',
        amountMinor: -245_000,
        payee: 'BHAT BHATENI',
        description: 'POS/BHAT BHATENI',
        externalId: 'R1',
      },
      {
        date: '2026-10-02',
        amountMinor: -80_000,
        payee: 'Bhat Bhateni',
        description: 'POS/BHAT BHATENI',
        externalId: 'R2',
      },
      {
        date: '2026-10-03',
        amountMinor: 8_500_000,
        payee: 'Employer Pvt Ltd',
        description: 'SALARY',
        externalId: 'R3',
      },
    ];
    const preview = await f.client.post(`${f.base}/imports/preview`, {
      accountId: f.accounts.Bank,
      rows,
    });
    expect(preview.status).toBe(200);
    const [dup, fresh, salary] = preview.body.rows;
    expect(dup.duplicateOfId).not.toBeNull();
    expect(fresh).toMatchObject({
      duplicateOfId: null,
      suggestedCategoryId: f.categories['Food & Groceries'],
    });
    expect(fresh.payeeId).toBe(dup.payeeId);
    expect(salary).toEqual({ duplicateOfId: null, payeeId: null, suggestedCategoryId: null });

    const commit = await f.client.post(`${f.base}/imports`, {
      accountId: f.accounts.Bank,
      fileName: 'statement.xlsx',
      source: 'xlsx',
      rows: [{ ...rows[0], skip: true }, rows[1], { ...rows[2], categoryId: f.categories.Salary }],
    });
    expect(commit.status).toBe(201);
    expect(commit.body).toMatchObject({
      created: 2,
      skipped: 1,
      fileName: 'statement.xlsx',
      revertedAt: null,
    });

    const imported = await f.client.get(`${f.base}/transactions?importBatchId=${commit.body.id}`);
    expect(imported.body.items).toHaveLength(2);
    for (const t of imported.body.items) expect(t.needsReview).toBe(true);
    const groceries = imported.body.items.find(
      (t: { amountMinor: number }) => t.amountMinor === -80_000,
    );
    expect(groceries.splits[0].categoryId).toBe(f.categories['Food & Groceries']);
    expect(groceries.rawDescription).toBe('POS/BHAT BHATENI');

    // Re-importing the same statement skips rows whose bank reference is already there.
    const again = await f.client.post(`${f.base}/imports`, {
      accountId: f.accounts.Bank,
      source: 'csv',
      rows: [rows[1], rows[1]],
    });
    expect(again.body).toMatchObject({ created: 0, skipped: 2 });

    const reviewed = await f.client.post(`${f.base}/transactions/bulk`, {
      action: 'markReviewed',
      ids: imported.body.items.map((t: { id: string }) => t.id),
    });
    expect(reviewed.body.updated).toBe(2);

    const revert = await f.client.post(`${f.base}/imports/${commit.body.id}/revert`);
    expect(revert.body.revertedAt).not.toBeNull();
    expect(
      (await f.client.get(`${f.base}/transactions?importBatchId=${commit.body.id}`)).body.items,
    ).toHaveLength(0);
    expect((await f.client.get(`${f.base}/imports`)).body).toHaveLength(2);
  });

  it('saves column mappings as profiles', async () => {
    const f = await setupWorkspace();
    const mapping = {
      hasHeader: true,
      date: 0,
      dateFormat: 'dmy',
      amount: { kind: 'debitCredit', debit: 2, credit: 3 },
      description: 1,
    };
    const created = await f.client.post(`${f.base}/import-profiles`, {
      name: 'Nabil Bank',
      mapping,
    });
    expect(created.status).toBe(201);
    const list = await f.client.get(`${f.base}/import-profiles`);
    expect(list.body).toEqual([expect.objectContaining({ name: 'Nabil Bank', mapping })]);
    expect((await f.client.delete(`${f.base}/import-profiles/${created.body.id}`)).status).toBe(
      204,
    );
  });
});

describe('backup, restore and CSV export', () => {
  it('round-trips a workspace through a JSON backup', async () => {
    const f = await setupWorkspace();
    const tag = await f.client.post(`${f.base}/tags`, { name: 'tihar' });
    await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-10-20',
      amountMinor: -500_000,
      payee: 'Sweets shop',
      tagIds: [tag.body.id],
      splits: [
        { categoryId: f.categories['Festivals & Gifts'], amountMinor: -300_000 },
        { categoryId: f.categories['Food & Groceries'], amountMinor: -200_000 },
      ],
    });
    await f.client.post(`${f.base}/transfers`, {
      fromAccountId: f.accounts.Bank,
      toAccountId: f.accounts['USD Card'],
      date: '2026-10-21',
      amountMinor: 13_350,
      toAmountMinor: 100,
    });
    await f.client.put(`${f.base}/budgets`, {
      periodStart: '2026-10-18',
      items: [{ categoryId: f.categories['Festivals & Gifts'], amountMinor: 1_000_000 }],
    });

    const backup = await f.client.get(`${f.base}/backup`);
    expect(backup.status).toBe(200);
    expect(backup.headers.get('content-disposition')).toContain('attachment');
    expect(backup.body).toMatchObject({ format: 'expense-tracker-backup', version: 1 });

    const restored = await f.client.post('/api/v1/workspaces/restore', {
      backup: backup.body,
      name: 'Copy',
    });
    expect(restored.status).toBe(201);
    const base2 = `/api/v1/workspaces/${restored.body.id}`;
    const balances = async (base: string) =>
      Object.fromEntries(
        (
          (await f.client.get(`${base}/accounts`)).body as Array<{
            name: string;
            balanceMinor: number;
          }>
        ).map((a) => [a.name, a.balanceMinor]),
      );
    expect(await balances(base2)).toEqual(await balances(f.base));
    const txs = await f.client.get(`${base2}/transactions`);
    expect(txs.body.totals.count).toBe(3);
    const festival = txs.body.items.find(
      (t: { payeeName: string }) => t.payeeName === 'Sweets shop',
    );
    expect(festival.splits).toHaveLength(2);
    expect(festival.tagIds).toHaveLength(1);
    const budget = await f.client.get(`${base2}/budgets?date=2026-10-20`);
    expect(budget.body.totals.budgetedMinor).toBe(1_000_000);

    const invalid = await f.client.post('/api/v1/workspaces/restore', {
      backup: { format: 'nope' },
    });
    expect(invalid.status).toBe(400);
  });

  it('exports transactions as spreadsheet-safe CSV', async () => {
    const f = await setupWorkspace();
    await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-30',
      amountMinor: -12_345,
      payee: 'Tea, Snacks & "Co"',
      notes: '=HYPERLINK("http://evil")',
      categoryId: f.categories['Dining Out'],
    });
    const res = await f.client.get(`${f.base}/export/transactions.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = res.body as string;
    expect(text.startsWith('Date,Date (BS),Account,Payee')).toBe(true);
    // The file starts with a UTF-8 byte-order mark so Excel reads Devanagari correctly.
    const raw = await testApp().app.request(`${f.base}/export/transactions.csv`, {
      headers: { cookie: f.client.cookie },
    });
    expect([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const line = text.split('\r\n')[1]!;
    expect(line).toContain(
      '2026-09-30,2083-06-14,Cash,"Tea, Snacks & ""Co""",Dining Out,Everyday,-123.45,NPR,Expense',
    );
    expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('categories, payees and tags', () => {
  it('asks where transactions go when deleting a used category', async () => {
    const f = await setupWorkspace();
    const t = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-09-30',
      amountMinor: -100,
      categoryId: f.categories.Donations,
    });
    const refused = await f.client.delete(`${f.base}/categories/${f.categories.Donations}`);
    expect(refused.status).toBe(409);
    const moved = await f.client.delete(
      `${f.base}/categories/${f.categories.Donations}?reassignTo=${f.categories['Family Support']}`,
    );
    expect(moved.status).toBe(204);
    expect(
      (await f.client.get(`${f.base}/transactions/${t.body.id}`)).body.splits[0].categoryId,
    ).toBe(f.categories['Family Support']);
    const toNone = await f.client.delete(
      `${f.base}/categories/${f.categories['Family Support']}?reassignTo=none`,
    );
    expect(toNone.status).toBe(204);
    expect(
      (await f.client.get(`${f.base}/transactions/${t.body.id}`)).body.splits[0].categoryId,
    ).toBeNull();
  });

  it('creates groups and categories and keeps kinds consistent', async () => {
    const f = await setupWorkspace();
    const group = await f.client.post(`${f.base}/category-groups`, {
      name: 'Pets',
      kind: 'expense',
    });
    const cat = await f.client.post(`${f.base}/categories`, {
      groupId: group.body.id,
      name: 'Dog food',
      icon: 'bone',
      color: '#a16207',
    });
    expect(cat.status).toBe(201);
    const groups = (await f.client.get(`${f.base}/categories`)).body;
    const incomeGroup = groups.find((g: { kind: string }) => g.kind === 'income');
    expect(
      (await f.client.patch(`${f.base}/categories/${cat.body.id}`, { groupId: incomeGroup.id }))
        .status,
    ).toBe(400);
    expect((await f.client.delete(`${f.base}/category-groups/${group.body.id}`)).status).toBe(409);
    await f.client.delete(`${f.base}/categories/${cat.body.id}`);
    expect((await f.client.delete(`${f.base}/category-groups/${group.body.id}`)).status).toBe(204);
  });

  it('merges payees, learns categories and rejects duplicate tags', async () => {
    const f = await setupWorkspace();
    const mk = (payee: string, categoryId?: string) =>
      f.client.post(`${f.base}/transactions`, {
        accountId: f.accounts.Cash,
        date: '2026-09-30',
        amountMinor: -100,
        payee,
        categoryId,
      });
    const a = await mk('Foodmandu', f.categories['Dining Out']);
    await mk('Foodmandu', f.categories['Dining Out']);
    const b = await mk('FoodMandu Delivery');
    const payees = (await f.client.get(`${f.base}/payees`)).body;
    const foodmandu = payees.find((p: { id: string }) => p.id === a.body.payeeId);
    expect(foodmandu).toMatchObject({
      transactionCount: 2,
      suggestedCategoryId: f.categories['Dining Out'],
    });

    const merged = await f.client.post(`${f.base}/payees/${b.body.payeeId}/merge`, {
      targetId: a.body.payeeId,
    });
    expect(merged.status).toBe(204);
    expect((await f.client.get(`${f.base}/transactions/${b.body.id}`)).body.payeeId).toBe(
      a.body.payeeId,
    );

    await f.client.post(`${f.base}/tags`, { name: 'Trip' });
    expect((await f.client.post(`${f.base}/tags`, { name: '#trip' })).status).toBe(409);
  });
});
