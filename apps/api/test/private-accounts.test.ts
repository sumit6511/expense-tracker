import { addDays, todayIn } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { type Client, type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const today = () => todayIn('Asia/Kathmandu');

async function join(f: Fixture, name: string) {
  const person = await signUp(name);
  const invite = await f.client.post(`${f.base}/invitations`, {
    email: person.email,
    role: 'editor',
  });
  const token = invite.body.link.split('/invite/')[1];
  expect((await person.post(`/api/v1/invitations/${token}/accept`)).status).toBe(200);
  return person;
}

/**
 * Sita (an editor) keeps a private savings account in Ram's household workspace: a balance, a
 * grocery purchase, a bill, a goal, and a transfer from the shared cash.
 */
async function household() {
  const f = await setupWorkspace();
  const sita = await join(f, 'Sita');
  const created = await sita.post(`${f.base}/accounts`, {
    name: 'Sita savings',
    type: 'savings',
    currency: 'NPR',
    openingBalanceMinor: 5_000_000,
    visibility: 'private',
  });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ visibility: 'private', ownerUserId: sita.userId });
  const account = created.body.id as string;
  const spent = await sita.post(`${f.base}/transactions`, {
    accountId: account,
    date: today(),
    amountMinor: -200_000,
    payee: 'Secret shop',
    categoryId: f.categories['Food & Groceries'],
  });
  const shared = await f.client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Cash,
    date: today(),
    amountMinor: -100_000,
    payee: 'Bhatbhateni',
    categoryId: f.categories['Food & Groceries'],
  });
  const transfer = await sita.post(`${f.base}/transfers`, {
    fromAccountId: f.accounts.Cash,
    toAccountId: account,
    date: today(),
    amountMinor: 300_000,
  });
  expect(transfer.status).toBe(201);
  const bill = await sita.post(`${f.base}/recurring`, {
    name: 'Private insurance',
    kind: 'expense',
    accountId: account,
    amountMinor: 150_000,
    frequency: 'monthly',
    calendar: 'bs',
    nextDate: addDays(today(), 2),
  });
  const goal = await sita.post(`${f.base}/goals`, {
    name: 'Surprise gift',
    kind: 'account',
    accountId: account,
    targetMinor: 10_000_000,
  });
  expect(goal.status).toBe(201);
  return {
    f,
    ram: f.client,
    sita,
    account,
    privateTx: spent.body.id as string,
    sharedTx: shared.body.id as string,
    transfer: transfer.body as { from: { id: string }; to: { id: string; transfer: any } },
    bill: bill.body.id as string,
    goal: goal.body.id as string,
  };
}

const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

describe('private accounts', () => {
  it('are invisible to everyone but their owner', async () => {
    const h = await household();
    const { f, ram, sita } = h;

    const ramAccounts = (await ram.get(`${f.base}/accounts`)).body;
    expect(ids(ramAccounts)).not.toContain(h.account);
    expect(ids((await sita.get(`${f.base}/accounts`)).body)).toContain(h.account);
    for (const [method, path, body] of [
      ['GET', `${f.base}/accounts/${h.account}`],
      ['PATCH', `${f.base}/accounts/${h.account}`, { name: 'Mine now' }],
      ['DELETE', `${f.base}/accounts/${h.account}`],
      ['GET', `${f.base}/accounts/${h.account}/reconcile`],
      ['GET', `${f.base}/accounts/${h.account}/reconciliations`],
      ['GET', `${f.base}/transactions/${h.privateTx}`],
      ['PATCH', `${f.base}/transactions/${h.privateTx}`, { notes: 'peek' }],
      ['DELETE', `${f.base}/transactions/${h.privateTx}`],
      ['POST', `${f.base}/transactions/${h.privateTx}/restore`, {}],
      ['GET', `${f.base}/transactions/${h.privateTx}/history`],
      ['GET', `${f.base}/transactions/${h.privateTx}/attachments`],
      ['GET', `${f.base}/transfers/${h.transfer.to.transfer.groupId}`],
      ['PATCH', `${f.base}/recurring/${h.bill}`, { name: 'Peek' }],
      ['DELETE', `${f.base}/recurring/${h.bill}`],
      ['PATCH', `${f.base}/goals/${h.goal}`, { name: 'Peek' }],
      ['DELETE', `${f.base}/goals/${h.goal}`],
      [
        'POST',
        `${f.base}/transactions`,
        { accountId: h.account, date: today(), amountMinor: -100 },
      ],
      [
        'POST',
        `${f.base}/transfers`,
        { fromAccountId: f.accounts.Cash, toAccountId: h.account, date: today(), amountMinor: 1 },
      ],
    ] as Array<[string, string, unknown?]>) {
      const res = await (ram as Client).request(method, path, body);
      expect(`${method} ${path} → ${res.status}`).toBe(`${method} ${path} → 404`);
    }
    // Sita still sees (and can change) everything of hers.
    expect((await sita.get(`${f.base}/transactions/${h.privateTx}`)).status).toBe(200);
    expect((await sita.get(`${f.base}/transactions/${h.privateTx}/history`)).status).toBe(200);
    expect((await sita.get(`${f.base}/accounts/${h.account}/reconcile`)).status).toBe(200);
    expect((await sita.patch(`${f.base}/goals/${h.goal}`, { name: 'Gift' })).status).toBe(200);
    expect((await sita.patch(`${f.base}/recurring/${h.bill}`, { name: 'Cover' })).status).toBe(200);
    expect((await sita.get(`${f.base}/transfers/${h.transfer.to.transfer.groupId}`)).status).toBe(
      200,
    );
  });

  it('leave their transactions out of lists, exports and counts for others', async () => {
    const h = await household();
    const { f, ram, sita } = h;
    const ramList = await ram.get(`${f.base}/transactions`);
    expect(ids(ramList.body.items)).toEqual(
      expect.arrayContaining([h.sharedTx, h.transfer.from.id]),
    );
    expect(ids(ramList.body.items)).not.toContain(h.privateTx);
    expect(ids(ramList.body.items)).not.toContain(h.transfer.to.id);
    expect(ramList.body.totals.count).toBe(2);
    expect((await sita.get(`${f.base}/transactions`)).body.totals.count).toBe(4);

    const csv = await ram.get(`${f.base}/export/transactions.csv`);
    expect(csv.body).not.toContain('Secret shop');
    expect(csv.body).not.toContain('Sita savings');
    expect(csv.body).toContain('Transfer to another account');
    const backup = await ram.get(`${f.base}/backup`);
    expect(backup.body.accounts.map((a: { name: string }) => a.name)).not.toContain('Sita savings');
    expect(ids(backup.body.transactions)).not.toContain(h.privateTx);
    // The visible leg of the transfer is kept as a plain transaction.
    const leg = backup.body.transactions.find((t: { id: string }) => t.id === h.transfer.from.id);
    expect(leg).toMatchObject({ transferGroupId: null, splits: [{ amountMinor: -300_000 }] });
    expect(backup.body.recurring).toEqual([]);
    expect(backup.body.goals).toEqual([]);

    const payees = (await ram.get(`${f.base}/payees`)).body;
    expect(payees.find((p: { name: string }) => p.name === 'Secret shop')?.transactionCount).toBe(
      0,
    );
    expect(ids((await ram.get(`${f.base}/recurring`)).body)).toEqual([]);
    expect((await ram.get(`${f.base}/recurring/upcoming?days=30`)).body).toEqual([]);
    expect((await ram.get(`${f.base}/goals`)).body).toEqual([]);
    const preview = await ram.post(`${f.base}/rules/preview`, {
      rule: {
        name: 'Groceries',
        match: 'all',
        conditions: [{ field: 'direction', op: 'is', value: 'out' }],
        actions: [{ type: 'markReviewed' }],
      },
      onlyUncategorized: false,
    });
    expect(preview.status).toBe(200);
    expect(ids(preview.body.items)).not.toContain(h.privateTx);
  });

  it('count only toward their owner’s reports and budgets', async () => {
    const h = await household();
    const { f, ram, sita } = h;
    const range = `from=${addDays(today(), -1)}&to=${today()}`;
    const groceries = async (c: Client) => {
      const res = await c.get(`${f.base}/reports/spending-by-category?${range}`);
      return res.body.expense.find(
        (e: { categoryId: string }) => e.categoryId === f.categories['Food & Groceries'],
      )?.amountMinor;
    };
    expect(await groceries(ram)).toBe(100_000);
    expect(await groceries(sita)).toBe(300_000);
    const ramWorth = (await ram.get(`${f.base}/reports/dashboard`)).body.netWorthMinor;
    const sitaWorth = (await sita.get(`${f.base}/reports/dashboard`)).body.netWorthMinor;
    // Sita also sees her savings (5,000,000 + 300,000 in − 200,000 out).
    expect(sitaWorth - ramWorth).toBe(5_100_000);
  });

  it('keep transfers into them from being changed by others', async () => {
    const h = await household();
    const { f, ram } = h;
    const leg = h.transfer.from.id;
    expect((await ram.patch(`${f.base}/transactions/${leg}`, { notes: 'hmm' })).status).toBe(403);
    expect((await ram.delete(`${f.base}/transactions/${leg}`)).status).toBe(403);
    const bulk = await ram.post(`${f.base}/transactions/bulk`, { action: 'delete', ids: [leg] });
    expect(bulk.body).toEqual({ updated: 0, skipped: 1 });
    // Other bulk edits on the visible leg are fine.
    const tagged = await ram.post(`${f.base}/transactions/bulk`, {
      action: 'markReviewed',
      ids: [leg],
    });
    expect(tagged.body.updated).toBe(1);
  });

  it('can only be made private (or shared) by the person who added them', async () => {
    const h = await household();
    const { f, ram, sita } = h;
    const joint = await sita.post(`${f.base}/accounts`, {
      name: 'Joint',
      type: 'checking',
      currency: 'NPR',
    });
    expect(joint.body).toMatchObject({ visibility: 'shared', ownerUserId: sita.userId });
    expect(
      (await ram.patch(`${f.base}/accounts/${joint.body.id}`, { visibility: 'private' })).status,
    ).toBe(403);
    // Accounts from before sharing belong to the workspace owner.
    expect(
      (await sita.patch(`${f.base}/accounts/${f.accounts.Bank}`, { visibility: 'private' })).status,
    ).toBe(403);
    expect(
      (await ram.patch(`${f.base}/accounts/${f.accounts.Bank}`, { visibility: 'private' })).body
        .visibility,
    ).toBe('private');
    expect(ids((await sita.get(`${f.base}/accounts`)).body)).not.toContain(f.accounts.Bank);
    const back = await sita.patch(`${f.base}/accounts/${h.account}`, { visibility: 'shared' });
    expect(back.body.visibility).toBe('shared');
    expect(ids((await ram.get(`${f.base}/accounts`)).body)).toContain(h.account);
  });

  it('are deleted with their owner’s login, leaving shared balances alone', async () => {
    const h = await household();
    const { f, ram, sita } = h;
    const cashBefore = (await ram.get(`${f.base}/accounts/${f.accounts.Cash}`)).body.balanceMinor;
    const res = await sita.post('/api/auth/delete-user', { password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    const cashAfter = (await ram.get(`${f.base}/accounts/${f.accounts.Cash}`)).body.balanceMinor;
    expect(cashAfter).toBe(cashBefore);
    const leg = await ram.get(`${f.base}/transactions/${h.transfer.from.id}`);
    expect(leg.body).toMatchObject({
      transfer: null,
      notes: 'Transfer (the other account was deleted)',
      splits: [{ categoryId: null, amountMinor: -300_000 }],
    });
  });
});
