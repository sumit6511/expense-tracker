import { addDays, getMonthPeriod, shiftMonthPeriod, todayIn } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { headsUpCandidates } from '../src/services/insights';
import { deliver } from '../src/services/notifications';
import { memberContexts } from '../src/services/visibility';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const today = () => todayIn('Asia/Kathmandu');
const settings = { calendar: 'bs' as const, monthStartDay: 1 };
const month = (offset: number) =>
  shiftMonthPeriod(getMonthPeriod(today(), settings), offset, settings);

async function tx(f: Fixture, body: Record<string, unknown>) {
  const res = await f.client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Cash,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function openedLongAgo(f: Fixture, balances: Record<string, number> = {}) {
  for (const [name, id] of Object.entries(f.accounts)) {
    const res = await f.client.patch(`${f.base}/accounts/${id}`, {
      openingDate: addDays(today(), -1000),
      ...(name in balances ? { openingBalanceMinor: balances[name] } : {}),
    });
    expect(res.status).toBe(200);
  }
}

const feed = async (f: Fixture) => {
  const res = await f.client.get(`${f.base}/insights`);
  expect(res.status).toBe(200);
  return res.body.items as Array<Record<string, any>>;
};

describe('subscriptions and bills in your history', () => {
  it('suggests what to track, flags price changes and accounts the bills could empty', async () => {
    const f = await setupWorkspace();
    await openedLongAgo(f, { Bank: 5_000_000 });
    // Netflix, monthly, with a price rise on the latest charge.
    for (const [days, amount] of [
      [90, 64_900],
      [60, 64_900],
      [30, 64_900],
      [1, 79_900],
    ] as const) {
      await tx(f, {
        date: addDays(today(), -days),
        amountMinor: -amount,
        payee: 'Netflix',
        categoryId: f.categories.Entertainment,
      });
    }
    // Insurance, yearly, from the bank.
    for (const [days, amount] of [
      [465, 1_800_000],
      [100, 2_000_000],
    ] as const) {
      await tx(f, {
        accountId: f.accounts.Bank,
        date: addDays(today(), -days),
        amountMinor: -amount,
        payee: 'Life insurance',
      });
    }

    const suggestions = (await f.client.get(`${f.base}/recurring/suggestions`)).body;
    expect(suggestions).toHaveLength(2);
    const netflix = suggestions.find((s: any) => s.payeeName === 'Netflix');
    expect(netflix).toMatchObject({
      cadence: 'monthly',
      frequency: 'monthly',
      interval: 1,
      fixed: true,
      amountMinor: 79_900,
      count: 4,
      categoryId: f.categories.Entertainment,
      dismissKey: `recurring:${netflix.payeeId}:${f.accounts.Cash}`,
    });
    expect(suggestions.find((s: any) => s.payeeName === 'Life insurance')).toMatchObject({
      cadence: 'yearly',
      frequency: 'yearly',
      amountMinor: 2_000_000,
      nextDate: addDays(today(), 265),
    });

    // Track Netflix at the old price: no longer suggested, and the rise points at the series.
    const series = await f.client.post(`${f.base}/recurring`, {
      name: 'Netflix',
      kind: 'expense',
      accountId: f.accounts.Cash,
      amountMinor: 64_900,
      payee: 'Netflix',
      frequency: 'monthly',
      calendar: 'ad',
      nextDate: addDays(today(), 29),
    });
    expect(series.status).toBe(201);
    // Rent from the bank in 5 days: more than the Rs. 12,000 left there.
    await f.client.post(`${f.base}/recurring`, {
      name: 'Rent',
      kind: 'expense',
      accountId: f.accounts.Bank,
      amountMinor: 2_000_000,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: addDays(today(), 5),
    });

    let items = await feed(f);
    const rise = items.find((i) => i.kind === 'price_change' && i.payeeName === 'Netflix');
    expect(rise).toMatchObject({
      tone: 'warning',
      flow: 'expense',
      fromMinor: 64_900,
      toMinor: 79_900,
      cadence: 'monthly',
      date: addDays(today(), -1),
      recurringId: series.body.id,
      recurringAmountMinor: 64_900,
    });
    expect(
      items.find((i) => i.kind === 'price_change' && i.payeeName === 'Life insurance'),
    ).toMatchObject({ fromMinor: 1_800_000, toMinor: 2_000_000, recurringId: null });
    expect(items.find((i) => i.kind === 'low_balance')).toMatchObject({
      tone: 'warning',
      accountId: f.accounts.Bank,
      balanceMinor: 1_200_000,
      negativeDate: addDays(today(), 5),
      lowestMinor: -800_000,
    });
    const suggested = items.filter((i) => i.kind === 'new_recurring');
    expect(suggested.map((i) => i.suggestion.payeeName)).toEqual(['Life insurance']);
    // Warnings come first.
    expect(items[0]!.tone).toBe('warning');

    // Heads-up notifications for the low balance and the price rises, once.
    const { db } = testApp();
    const ws = (await memberContexts(db)).find((w) => w.id === f.ws.id)!;
    const candidates = await headsUpCandidates(db, ws);
    expect(candidates.map((c) => c.title).sort()).toEqual([
      'Bank may run short',
      'Life insurance went up to Rs. 20,000',
      'Netflix went up to Rs. 799',
    ]);
    expect(await deliver(db, ws.id, candidates, [ws.userId])).toBe(3);
    expect(await deliver(db, ws.id, candidates, [ws.userId])).toBe(0);
    const inbox = (await f.client.get(`${f.base}/notifications`)).body;
    expect(inbox.items.filter((n: any) => n.kind === 'insight')).toHaveLength(3);

    // Dismissing hides it from the feed, from suggestions and from future heads-ups.
    for (const key of [rise!.key, suggested[0]!.key]) {
      expect((await f.client.post(`${f.base}/insights/dismiss`, { key })).status).toBe(204);
    }
    items = await feed(f);
    expect(items.some((i) => i.key === rise!.key || i.kind === 'new_recurring')).toBe(false);
    expect((await f.client.get(`${f.base}/recurring/suggestions`)).body).toHaveLength(0);
    expect((await headsUpCandidates(db, ws)).map((c) => c.title)).not.toContain(
      'Netflix went up to Rs. 799',
    );
  });

  it('lets a viewer dismiss for themselves only', async () => {
    const f = await setupWorkspace();
    await openedLongAgo(f);
    for (const days of [60, 30, 1]) {
      await tx(f, { date: addDays(today(), -days), amountMinor: -50_000, payee: 'Gym' });
    }
    const viewer = await signUp('Hari');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: viewer.email,
      role: 'viewer',
    });
    await viewer.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    const key = (await feed(f)).find((i) => i.kind === 'new_recurring')!.key;
    expect((await viewer.post(`${f.base}/insights/dismiss`, { key })).status).toBe(204);
    expect((await viewer.get(`${f.base}/insights`)).body.items).toHaveLength(0);
    expect((await feed(f)).map((i) => i.key)).toContain(key);
    // Other writes are still off limits.
    expect((await viewer.post(`${f.base}/tags`, { name: 'x' })).status).toBe(403);
  });
});

describe('spending insights', () => {
  it('notices unusual spending, a good month and budgets kept', async () => {
    const f = await setupWorkspace();
    await openedLongAgo(f);
    const c = f.categories;
    for (let m = -5; m <= -1; m++) {
      const date = addDays(month(m).start, 2);
      await tx(f, { date, amountMinor: -1_000_000, categoryId: c['Food & Groceries'] });
      await tx(f, {
        date,
        amountMinor: m === -1 ? -200_000 : -500_000,
        categoryId: c['Dining Out'],
      });
      await tx(f, {
        accountId: f.accounts.Bank,
        date,
        amountMinor: 5_000_000,
        categoryId: c.Salary,
      });
      if (m >= -4) {
        await f.client.put(`${f.base}/budgets`, {
          periodStart: month(m).start,
          items: [{ categoryId: c['Food & Groceries'], amountMinor: 1_200_000 }],
        });
      }
    }
    // This month, groceries are already well past the usual.
    await tx(f, { date: today(), amountMinor: -2_500_000, categoryId: c['Food & Groceries'] });

    const items = await feed(f);
    const find = (kind: string) => items.filter((i) => i.kind === kind);
    expect(find('unusual_spending')).toEqual([
      expect.objectContaining({
        tone: 'warning',
        current: true,
        categoryId: c['Food & Groceries'],
        amountMinor: 2_500_000,
        usualMinor: 1_000_000,
        periodStart: month(0).start,
      }),
    ]);
    expect(find('spending_down')).toEqual([
      expect.objectContaining({
        tone: 'positive',
        categoryId: c['Dining Out'],
        amountMinor: 200_000,
        usualMinor: 500_000,
        periodStart: month(-1).start,
      }),
    ]);
    expect(find('saved')).toEqual([
      expect.objectContaining({ incomeMinor: 5_000_000, expenseMinor: 1_200_000, streak: 5 }),
    ]);
    expect(find('budget_streak')).toEqual([
      expect.objectContaining({ categoryId: c['Food & Groceries'], months: 4 }),
    ]);
    expect(items[0]!.kind).toBe('unusual_spending');
  });

  it('stays quiet without enough history', async () => {
    const f = await setupWorkspace();
    await tx(f, { date: today(), amountMinor: -2_500_000, categoryId: f.categories.Shopping });
    expect(await feed(f)).toEqual([]);
  });
});

describe('cash-flow forecast', () => {
  it('projects scheduled items and everyday spending, with a band', async () => {
    const f = await setupWorkspace();
    await openedLongAgo(f, { Bank: 2_000_000 });
    // Last month's rent, paid before the schedule was set up: part of the schedule, not everyday.
    await tx(f, {
      accountId: f.accounts.Bank,
      date: addDays(today(), -20),
      amountMinor: -2_000_000,
      payee: 'Landlord',
    });
    // Rs. 100 a day of everyday spending for the last 30 days.
    for (let d = 30; d >= 1; d--) {
      await tx(f, { date: addDays(today(), -d), amountMinor: -10_000 });
    }
    const schedule = (body: Record<string, unknown>) =>
      f.client.post(`${f.base}/recurring`, {
        frequency: 'monthly',
        calendar: 'ad',
        accountId: f.accounts.Bank,
        ...body,
      });
    await schedule({
      name: 'Salary',
      kind: 'income',
      amountMinor: 5_000_000,
      nextDate: addDays(today(), 10),
      mode: 'auto',
    });
    await schedule({
      name: 'Rent',
      kind: 'expense',
      payee: 'Landlord',
      amountMinor: 2_000_000,
      nextDate: addDays(today(), 15),
    });
    // Between two counted accounts: no change to the total.
    await schedule({
      name: 'Pocket money',
      kind: 'transfer',
      toAccountId: f.accounts.Cash,
      amountMinor: 100_000,
      nextDate: addDays(today(), 5),
    });

    const res = await f.client.get(`${f.base}/forecast?days=30`);
    expect(res.status).toBe(200);
    const fc = res.body;
    // Cash, Bank and the INR wallet; not the credit card.
    expect(fc.accountIds.sort()).toEqual(
      [f.accounts.Cash, f.accounts.Bank, f.accounts['INR Wallet']].sort(),
    );
    expect(fc).toMatchObject({
      startMinor: 700_000,
      everydayPerDayMinor: -10_000,
      historyDays: 30,
      lowest: { date: addDays(today(), 9), expectedMinor: 610_000 },
    });
    expect(fc.points).toHaveLength(31);
    const at = (d: number) => fc.points[d].expectedMinor;
    expect([at(0), at(10), at(15), at(30)]).toEqual([700_000, 5_600_000, 3_550_000, 3_400_000]);
    // Every day cost the same, so the band has no width.
    expect(fc.points[30]).toMatchObject({ lowMinor: 3_400_000, highMinor: 3_400_000 });
    expect(fc.events.map((e: any) => [e.name, e.amountMinor])).toEqual([
      ['Salary', 5_000_000],
      ['Rent', -2_000_000],
    ]);

    // Just the cash: the pocket money arrives, the salary and rent don't touch it.
    const cash = (await f.client.get(`${f.base}/forecast?days=30&accountIds=${f.accounts.Cash}`))
      .body;
    expect(cash.events.map((e: any) => [e.name, e.amountMinor])).toEqual([
      ['Pocket money', 100_000],
    ]);
    expect(cash.points[30].expectedMinor).toBe(700_000 + 100_000 - 300_000);

    // A day that varies widens the band.
    await tx(f, { date: addDays(today(), -3), amountMinor: -300_000 });
    const wider = (await f.client.get(`${f.base}/forecast?days=30`)).body;
    expect(wider.points[30].highMinor).toBeGreaterThan(wider.points[30].expectedMinor);
    expect(wider.points[30].lowMinor).toBeLessThan(wider.points[30].expectedMinor);
    expect((await f.client.get(`${f.base}/forecast?days=500`)).status).toBe(400);
  });
});
