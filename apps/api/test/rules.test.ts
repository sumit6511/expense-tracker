import { afterAll, describe, expect, it } from 'vitest';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

async function tag(f: Fixture, name: string) {
  const res = await f.client.post(`${f.base}/tags`, { name, color: '#2563eb' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function pathaoRule(f: Fixture, extra: Record<string, unknown> = {}) {
  return {
    name: 'Pathao rides',
    conditions: [{ field: 'description', op: 'contains', value: 'pathao' }],
    actions: [
      { type: 'setCategory', categoryId: f.categories.Transport },
      { type: 'setPayee', payee: 'Pathao' },
    ],
    ...extra,
  };
}

describe('rules', () => {
  it('creates, lists in order, updates, reorders and deletes', async () => {
    const f = await setupWorkspace();
    const a = await f.client.post(`${f.base}/rules`, pathaoRule(f));
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      name: 'Pathao rides',
      enabled: true,
      match: 'all',
      priority: 0,
    });
    const b = await f.client.post(`${f.base}/rules`, {
      name: 'Big spends',
      conditions: [{ field: 'amount', op: 'gte', value: 5_000_000 }],
      actions: [{ type: 'markReviewed' }],
    });
    expect(b.body.priority).toBe(1);

    const disabled = await f.client.patch(`${f.base}/rules/${a.body.id}`, { enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ enabled: false, name: 'Pathao rides' });

    const reordered = await f.client.post(`${f.base}/rules/reorder`, { ids: [b.body.id] });
    expect(reordered.body.map((r: any) => r.name)).toEqual(['Big spends', 'Pathao rides']);

    expect((await f.client.delete(`${f.base}/rules/${a.body.id}`)).status).toBe(204);
    expect((await f.client.get(`${f.base}/rules`)).body).toHaveLength(1);
  });

  it('validates rules and their references', async () => {
    const f = await setupWorkspace();
    const other = await setupWorkspace();
    const badPattern = await f.client.post(`${f.base}/rules`, {
      name: 'Broken',
      conditions: [{ field: 'payee', op: 'matches', value: '([a-z' }],
      actions: [{ type: 'markReviewed' }],
    });
    expect(badPattern.status).toBe(400);
    const foreignCategory = await f.client.post(`${f.base}/rules`, {
      name: 'Foreign',
      conditions: [{ field: 'payee', op: 'contains', value: 'x' }],
      actions: [{ type: 'setCategory', categoryId: other.categories.Transport }],
    });
    expect(foreignCategory.status).toBe(400);
    const badSplit = await f.client.post(`${f.base}/rules`, {
      name: 'Split',
      conditions: [{ field: 'payee', op: 'contains', value: 'x' }],
      actions: [
        {
          type: 'splitByPercent',
          lines: [
            { categoryId: f.categories.Rent, percent: 60 },
            { categoryId: f.categories.Utilities, percent: 30 },
          ],
        },
      ],
    });
    expect(badSplit.status).toBe(400);
    // Another workspace's member can't see or change these rules.
    const rule = await f.client.post(`${f.base}/rules`, pathaoRule(f));
    expect((await other.client.get(`${f.base}/rules`)).status).toBe(404);
    expect(
      (await other.client.patch(`${other.base}/rules/${rule.body.id}`, { enabled: false })).status,
    ).toBe(404);
  });

  it('applies to imports: category, payee, tags, split and auto-review', async () => {
    const f = await setupWorkspace();
    const ride = await tag(f, 'rides');
    await f.client.post(`${f.base}/rules`, {
      ...pathaoRule(f),
      actions: [...pathaoRule(f).actions, { type: 'addTags', tagIds: [ride] }],
    });
    await f.client.post(`${f.base}/rules`, {
      name: 'Rent and bills',
      conditions: [{ field: 'payee', op: 'equals', value: 'Landlord' }],
      actions: [
        {
          type: 'splitByPercent',
          lines: [
            { categoryId: f.categories.Rent, percent: 90 },
            { categoryId: f.categories.Utilities, percent: 10 },
          ],
        },
        { type: 'markReviewed' },
      ],
    });
    const rows = [
      { date: '2026-10-01', amountMinor: -35_000, payee: '', description: 'FONEPAY/PATHAO RIDE' },
      { date: '2026-10-02', amountMinor: -2_500_001, payee: 'Landlord', description: 'Rent' },
      { date: '2026-10-03', amountMinor: -10_000, payee: 'Tea shop', description: 'Tea' },
    ];
    const preview = await f.client.post(`${f.base}/imports/preview`, {
      accountId: f.accounts.Bank,
      rows,
    });
    const [p0, p1, p2] = preview.body.rows;
    expect(p0).toMatchObject({
      suggestedCategoryId: f.categories.Transport,
      rulePayee: 'Pathao',
      splitByRule: false,
    });
    expect(p0.ruleIds).toHaveLength(1);
    expect(p1).toMatchObject({ suggestedCategoryId: null, splitByRule: true });
    expect(p2).toMatchObject({ ruleIds: [], suggestedCategoryId: null });

    const commit = await f.client.post(`${f.base}/imports`, {
      accountId: f.accounts.Bank,
      source: 'csv',
      rows: rows.map((r, i) => ({ ...r, categoryId: preview.body.rows[i].suggestedCategoryId })),
    });
    expect(commit.status).toBe(201);
    const list = await f.client.get(
      `${f.base}/transactions?importBatchId=${commit.body.id}&limit=10`,
    );
    const byDesc = Object.fromEntries(list.body.items.map((t: any) => [t.rawDescription, t]));
    expect(byDesc['FONEPAY/PATHAO RIDE']).toMatchObject({
      payeeName: 'Pathao',
      tagIds: [ride],
      needsReview: true,
      splits: [{ categoryId: f.categories.Transport, amountMinor: -35_000 }],
    });
    expect(byDesc.Rent.needsReview).toBe(false);
    expect(byDesc.Rent.splits.map((s: any) => [s.categoryId, s.amountMinor])).toEqual([
      [f.categories.Rent, -2_250_001],
      [f.categories.Utilities, -250_000],
    ]);
    expect(byDesc.Tea.splits[0].categoryId).toBeNull();

    const rules = (await f.client.get(`${f.base}/rules`)).body;
    expect(rules.map((r: any) => r.hitCount)).toEqual([1, 1]);
    expect(rules[0].lastHitAt).not.toBeNull();
  });

  it('fills gaps on manual entry without overriding choices', async () => {
    const f = await setupWorkspace();
    await f.client.post(`${f.base}/rules`, {
      name: 'Momo',
      conditions: [{ field: 'payee', op: 'contains', value: 'momo' }],
      actions: [
        { type: 'setCategory', categoryId: f.categories['Dining Out'] },
        { type: 'setNotes', notes: 'Snacks' },
      ],
    });
    const auto = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-10-01',
      amountMinor: -30_000,
      payee: 'Momo Hut',
    });
    expect(auto.body).toMatchObject({ notes: 'Snacks' });
    expect(auto.body.splits[0].categoryId).toBe(f.categories['Dining Out']);

    const chosen = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-10-01',
      amountMinor: -30_000,
      payee: 'Momo Hut',
      categoryId: f.categories['Festivals & Gifts'],
      notes: 'Treat for Tihar',
    });
    expect(chosen.body.notes).toBe('Treat for Tihar');
    expect(chosen.body.splits[0].categoryId).toBe(f.categories['Festivals & Gifts']);
  });

  it('previews and applies to existing transactions', async () => {
    const f = await setupWorkspace();
    const make = (payee: string, categoryId: string | null | undefined, amountMinor = -50_000) =>
      f.client.post(`${f.base}/transactions`, {
        accountId: f.accounts.Cash,
        date: '2026-10-01',
        amountMinor,
        payee,
        categoryId,
      });
    await make('NTC Recharge', null);
    await make('NTC recharge', f.categories.Shopping);
    await make('Ncell', null);
    await make('NTC refund', null, 50_000);
    // Transfers are never touched by rules.
    await f.client.post(`${f.base}/transfers`, {
      fromAccountId: f.accounts.Cash,
      toAccountId: f.accounts.Bank,
      date: '2026-10-01',
      amountMinor: 10_000,
      notes: 'ntc',
    });
    const body = {
      name: 'Phone top-ups',
      conditions: [
        { field: 'payee', op: 'startsWith', value: 'ntc' },
        { field: 'direction', op: 'is', value: 'out' },
      ],
      actions: [{ type: 'setCategory', categoryId: f.categories['Mobile & Data'] }],
    };
    const all = await f.client.post(`${f.base}/rules/preview`, { rule: body });
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ count: 2, changeCount: 2 });
    const onlyNew = await f.client.post(`${f.base}/rules/preview`, {
      rule: body,
      onlyUncategorized: true,
    });
    expect(onlyNew.body).toMatchObject({ count: 1, changeCount: 1 });
    expect(onlyNew.body.items[0].payeeName).toBe('NTC Recharge');

    const rule = await f.client.post(`${f.base}/rules`, body);
    const applied = await f.client.post(`${f.base}/rules/${rule.body.id}/apply`, {});
    expect(applied.body).toEqual({ updated: 1 });
    const again = await f.client.post(`${f.base}/rules/${rule.body.id}/apply`, {
      onlyUncategorized: false,
    });
    expect(again.body).toEqual({ updated: 1 });
    const mobile = await f.client.get(
      `${f.base}/transactions?categoryIds=${f.categories['Mobile & Data']}`,
    );
    expect(mobile.body.totals.count).toBe(2);
    expect((await f.client.get(`${f.base}/rules`)).body[0].hitCount).toBe(2);
  });

  it('survives a backup round trip', async () => {
    const f = await setupWorkspace();
    await f.client.post(`${f.base}/rules`, {
      ...pathaoRule(f),
      conditions: [
        { field: 'description', op: 'contains', value: 'pathao' },
        { field: 'account', op: 'is', value: f.accounts.Bank },
      ],
    });
    const backup = await f.client.get(`${f.base}/backup`);
    expect(backup.body.rules).toHaveLength(1);
    const restored = await f.client.post('/api/v1/workspaces/restore', {
      backup: backup.body,
      name: 'Restored',
    });
    expect(restored.status).toBe(201);
    const base = `/api/v1/workspaces/${restored.body.id}`;
    const [rule] = (await f.client.get(`${base}/rules`)).body;
    const accounts = (await f.client.get(`${base}/accounts`)).body;
    const bank = accounts.find((a: any) => a.name === 'Bank');
    expect(rule.conditions[1].value).toBe(bank.id);
    expect(rule.actions[0].categoryId).not.toBe(f.categories.Transport);
  });
});
