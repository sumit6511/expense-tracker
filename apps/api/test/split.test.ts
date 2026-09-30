import { todayIn } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const today = () => todayIn('Asia/Kathmandu');

interface Group {
  id: string;
  members: Array<{
    id: string;
    name: string;
    you: boolean;
    balanceMinor: number;
    userId: string | null;
  }>;
  suggested: Array<{ fromMemberId: string; toMemberId: string; amountMinor: number }>;
  activity: Array<{ type: string; id: string; linkedTransactionId: string | null }>;
  totalSpentMinor: number;
}

async function trip(f: Fixture, extra: Record<string, unknown> = {}) {
  const res = await f.client.post<Group>(`${f.base}/split-groups`, {
    name: 'Pokhara trip',
    currency: 'NPR',
    categoryId: f.categories.Travel,
    members: [{ name: 'Bikash' }, { name: 'Chandra' }],
    ...extra,
  });
  expect(res.status).toBe(201);
  const byName = Object.fromEntries(res.body.members.map((m) => [m.name, m.id]));
  return { group: res.body, url: `${f.base}/split-groups/${res.body.id}`, m: byName };
}

const balances = (g: Group) => Object.fromEntries(g.members.map((m) => [m.name, m.balanceMinor]));
const named = (g: Group) => {
  const name = new Map(g.members.map((m) => [m.id, m.name]));
  return g.suggested.map((d) => [name.get(d.fromMemberId), name.get(d.toMemberId), d.amountMinor]);
};

describe('split groups', () => {
  it('shares costs, keeps balances and suggests who pays whom', async () => {
    const f = await setupWorkspace();
    const { group, url, m } = await trip(f);
    expect(group.members.map((x) => [x.name, x.you])).toEqual([
      ['Test User', true],
      ['Bikash', false],
      ['Chandra', false],
    ]);

    const dinner = await f.client.post<Group>(`${url}/expenses`, {
      date: today(),
      description: 'Dinner by the lake',
      amountMinor: 300_000,
      paidByMemberId: m['Test User'],
      shares: [{ memberId: m['Test User'] }, { memberId: m.Bikash }, { memberId: m.Chandra }],
      record: { accountId: f.accounts.Cash },
    });
    expect(dinner.status).toBe(201);
    expect(balances(dinner.body)).toEqual({
      'Test User': 200_000,
      Bikash: -100_000,
      Chandra: -100_000,
    });

    // What I paid is in my Cash account, in the group's category.
    const linked = dinner.body.activity[0]!.linkedTransactionId!;
    const tx = await f.client.get(`${f.base}/transactions/${linked}`);
    expect(tx.body).toMatchObject({
      accountId: f.accounts.Cash,
      amountMinor: -300_000,
      notes: 'Dinner by the lake · Pokhara trip',
      splits: [{ categoryId: f.categories.Travel }],
    });

    const taxi = await f.client.post<Group>(`${url}/expenses`, {
      date: today(),
      description: 'Taxi',
      amountMinor: 60_000,
      paidByMemberId: m.Bikash,
      method: 'exact',
      shares: [
        { memberId: m['Test User'], value: 40_000 },
        { memberId: m.Bikash, value: 20_000 },
      ],
    });
    expect(balances(taxi.body)).toEqual({
      'Test User': 160_000,
      Bikash: -60_000,
      Chandra: -100_000,
    });
    expect(named(taxi.body)).toEqual([
      ['Chandra', 'Test User', 100_000],
      ['Bikash', 'Test User', 60_000],
    ]);

    // Chandra pays me back in cash: money in, against the trip's category.
    const paid = await f.client.post<Group>(`${url}/settlements`, {
      date: today(),
      fromMemberId: m.Chandra,
      toMemberId: m['Test User'],
      amountMinor: 100_000,
      record: { accountId: f.accounts.Cash },
    });
    expect(balances(paid.body)).toEqual({ 'Test User': 60_000, Bikash: -60_000, Chandra: 0 });
    expect(named(paid.body)).toEqual([['Bikash', 'Test User', 60_000]]);
    const received = paid.body.activity.find((a) => a.type === 'settlement')!;
    expect(
      (await f.client.get(`${f.base}/transactions/${received.linkedTransactionId}`)).body,
    ).toMatchObject({ amountMinor: 100_000, splits: [{ categoryId: f.categories.Travel }] });

    const list = await f.client.get(`${f.base}/split-groups`);
    expect(list.body).toEqual([
      expect.objectContaining({
        name: 'Pokhara trip',
        memberCount: 3,
        yourBalanceMinor: 60_000,
        totalSpentMinor: 360_000,
      }),
    ]);
  });

  it('keeps recorded transactions in step, and checks what’s entered', async () => {
    const f = await setupWorkspace();
    const { url, m } = await trip(f);
    const everyone = [{ memberId: m['Test User'] }, { memberId: m.Bikash }];
    const created = await f.client.post<Group>(`${url}/expenses`, {
      date: today(),
      description: 'Hotel',
      amountMinor: 500_000,
      paidByMemberId: m['Test User'],
      shares: everyone,
      record: { accountId: f.accounts.Bank, categoryId: f.categories.Rent },
    });
    const expense = created.body.activity[0]!;
    const linked = expense.linkedTransactionId!;

    const edited = await f.client.put<Group>(`${url}/expenses/${expense.id}`, {
      date: today(),
      description: 'Hotel (2 nights)',
      amountMinor: 800_000,
      paidByMemberId: m['Test User'],
      method: 'percent',
      shares: [
        { memberId: m['Test User'], value: 7_500 },
        { memberId: m.Bikash, value: 2_500 },
      ],
    });
    expect(balances(edited.body)).toMatchObject({ 'Test User': 200_000, Bikash: -200_000 });
    const tx = (await f.client.get(`${f.base}/transactions/${linked}`)).body;
    expect(tx).toMatchObject({
      amountMinor: -800_000,
      notes: 'Hotel (2 nights) · Pokhara trip',
      splits: [{ categoryId: f.categories.Rent, amountMinor: -800_000 }],
    });

    const bad = [
      { method: 'percent', shares: [{ memberId: m.Bikash, value: 5_000 }] },
      { paidByMemberId: m.Bikash, record: { accountId: f.accounts.Cash } },
      { record: { accountId: f.accounts['USD Card'] } },
      { shares: [{ memberId: '00000000-0000-7000-8000-000000000000' }] },
      { amountMinor: 0 },
    ];
    for (const patch of bad) {
      const res = await f.client.post(`${url}/expenses`, {
        date: today(),
        description: 'Bad',
        amountMinor: 1_000,
        paidByMemberId: m['Test User'],
        shares: everyone,
        ...patch,
      });
      expect([JSON.stringify(patch), res.status]).toEqual([JSON.stringify(patch), 400]);
    }

    // Can't remove someone who's part of an expense; can once it's gone.
    expect((await f.client.delete(`${url}/members/${m.Bikash}`)).status).toBe(409);
    const removed = await f.client.delete<Group>(`${url}/expenses/${expense.id}`);
    expect(removed.body.activity).toEqual([]);
    expect((await f.client.get(`${f.base}/transactions/${linked}`)).body.deleted).toBe(true);
    const gone = await f.client.delete<Group>(`${url}/members/${m.Bikash}`);
    expect(gone.body.members.map((x) => x.name)).toEqual(['Test User', 'Chandra']);
  });

  it('shows debts per pair when not simplifying', async () => {
    const f = await setupWorkspace();
    const { url, m } = await trip(f, { simplifyDebts: false });
    // Chandra owes Bikash 100, Bikash owes me 100: kept as two debts.
    await f.client.post(`${url}/expenses`, {
      date: today(),
      description: 'Snacks',
      amountMinor: 10_000,
      paidByMemberId: m.Bikash,
      method: 'exact',
      shares: [{ memberId: m.Chandra, value: 10_000 }],
    });
    const res = await f.client.post<Group>(`${url}/expenses`, {
      date: today(),
      description: 'Tea',
      amountMinor: 10_000,
      paidByMemberId: m['Test User'],
      method: 'shares',
      shares: [{ memberId: m.Bikash, value: 1 }],
    });
    expect(named(res.body)).toEqual(
      expect.arrayContaining([
        ['Chandra', 'Bikash', 10_000],
        ['Bikash', 'Test User', 10_000],
      ]),
    );
    expect(res.body.suggested).toHaveLength(2);
    const simplified = await f.client.patch<Group>(url, { simplifyDebts: true });
    expect(named(simplified.body)).toEqual([['Chandra', 'Test User', 10_000]]);
  });

  it('links people in the workspace, and stays inside the workspace', async () => {
    const f = await setupWorkspace();
    const partner = await signUp('Partner');
    const invite = await f.client.post(`${f.base}/invitations`, { email: partner.email });
    await partner.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);

    const { url, m } = await trip(f, {
      members: [{ name: 'Partner', userId: partner.userId }, { name: 'Chandra' }],
    });
    await f.client.post(`${url}/expenses`, {
      date: today(),
      description: 'Groceries',
      amountMinor: 20_000,
      paidByMemberId: m['Test User'],
      shares: [{ memberId: m['Test User'] }, { memberId: m.Partner }],
    });
    const seen = await partner.get<Group>(url);
    expect(seen.body.members.find((x) => x.you)?.name).toBe('Partner');
    expect((await partner.get(`${f.base}/split-groups`)).body[0].yourBalanceMinor).toBe(-10_000);

    const stranger = await setupWorkspace();
    expect((await stranger.client.get(url)).status).toBe(404);
    expect(
      (
        await f.client.post(`${f.base}/split-groups`, {
          name: 'X',
          currency: 'NPR',
          members: [{ name: 'Stranger', userId: stranger.client.userId }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.client.post(`${f.base}/split-groups`, { name: 'X', currency: 'XYZ' })).status,
    ).toBe(400);
  });

  it('comes back from a backup', async () => {
    const f = await setupWorkspace();
    const { url, m } = await trip(f);
    await f.client.post(`${url}/expenses`, {
      date: today(),
      description: 'Boat ride',
      amountMinor: 90_000,
      paidByMemberId: m['Test User'],
      method: 'shares',
      shares: [
        { memberId: m['Test User'], value: 1 },
        { memberId: m.Bikash, value: 2 },
      ],
      record: { accountId: f.accounts.Cash },
    });
    await f.client.post(`${url}/settlements`, {
      date: today(),
      fromMemberId: m.Bikash,
      toMemberId: m['Test User'],
      amountMinor: 20_000,
      notes: 'eSewa',
    });
    const backup = (await f.client.get(`${f.base}/backup`)).body;
    const restored = await f.client.post('/api/v1/workspaces/restore', { backup });
    expect(restored.status).toBe(201);
    const base = `/api/v1/workspaces/${restored.body.id}`;
    const [summary] = (await f.client.get(`${base}/split-groups`)).body;
    const group = (await f.client.get<Group>(`${base}/split-groups/${summary.id}`)).body;
    expect(balances(group)).toEqual({ 'Test User': 40_000, Bikash: -40_000, Chandra: 0 });
    expect(group.members.find((x) => x.you)?.name).toBe('Test User');
    const expense = group.activity.find((a) => a.type === 'expense')!;
    const tx = await f.client.get(`${base}/transactions/${expense.linkedTransactionId}`);
    expect(tx.body).toMatchObject({ amountMinor: -90_000 });
  });
});
