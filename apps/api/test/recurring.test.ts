import { addDays, addMonths, adToBs, todayIn } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { postDueRecurring } from '../src/services/recurring';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const today = () => todayIn('Asia/Kathmandu');

function rent(f: Fixture, extra: Record<string, unknown> = {}) {
  return {
    name: 'Rent',
    kind: 'expense',
    accountId: f.accounts.Bank,
    amountMinor: 2_500_000,
    payee: 'Landlord',
    categoryId: f.categories.Rent,
    frequency: 'monthly',
    calendar: 'bs',
    nextDate: addDays(today(), 2),
    ...extra,
  };
}

async function balances(f: Fixture) {
  const accounts = (await f.client.get(`${f.base}/accounts`)).body as Array<{
    name: string;
    balanceMinor: number;
  }>;
  return Object.fromEntries(accounts.map((a) => [a.name, a.balanceMinor]));
}

describe('recurring transactions', () => {
  it('creates, lists with a monthly total, updates and deletes', async () => {
    const f = await setupWorkspace();
    const created = await f.client.post(`${f.base}/recurring`, rent(f));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Rent',
      payeeName: 'Landlord',
      currency: 'NPR',
      mode: 'remind',
      nextDate: addDays(today(), 2),
      monthlyBaseMinor: -2_500_000,
    });
    const yearly = await f.client.post(`${f.base}/recurring`, {
      ...rent(f),
      name: 'Insurance',
      amountMinor: 1_200_000,
      frequency: 'yearly',
    });
    expect(yearly.body.monthlyBaseMinor).toBe(-100_000);

    const patched = await f.client.patch(`${f.base}/recurring/${created.body.id}`, {
      amountMinor: 2_600_000,
      active: false,
    });
    expect(patched.body).toMatchObject({ amountMinor: 2_600_000, active: false });
    expect((await f.client.get(`${f.base}/recurring`)).body).toHaveLength(2);
    expect((await f.client.delete(`${f.base}/recurring/${created.body.id}`)).status).toBe(204);
    expect((await f.client.get(`${f.base}/recurring`)).body).toHaveLength(1);
  });

  it('validates', async () => {
    const f = await setupWorkspace();
    const other = await setupWorkspace();
    const bad = [
      rent(f, { variableAmount: true, mode: 'auto' }),
      rent(f, { kind: 'transfer', toAccountId: f.accounts.Bank }),
      rent(f, { endDate: addDays(today(), -1) }),
      rent(f, { categoryId: other.categories.Rent }),
      rent(f, { kind: 'transfer', toAccountId: f.accounts['USD Card'] }), // needs toAmountMinor
    ];
    for (const body of bad) {
      expect((await f.client.post(`${f.base}/recurring`, body)).status).toBe(400);
    }
    expect(
      (await f.client.post(`${f.base}/recurring`, rent(f, { accountId: other.accounts.Bank })))
        .status,
    ).toBe(404);
  });

  it('shows upcoming occurrences on Bikram Sambat months', async () => {
    const f = await setupWorkspace();
    await f.client.post(`${f.base}/recurring`, rent(f, { nextDate: today() }));
    const res = await f.client.get(`${f.base}/recurring/upcoming?days=100`);
    expect(res.status).toBe(200);
    const dates = res.body.map((i: any) => i.date);
    expect(dates.length).toBeGreaterThanOrEqual(3);
    const day = adToBs(today()).day;
    // Same BS day each month (or the month's last day when it is shorter).
    for (const d of dates) expect(adToBs(d).day).toBeLessThanOrEqual(day);
    expect(res.body[0]).toMatchObject({ isNext: true, overdue: false, amountMinor: -2_500_000 });
    expect(res.body[1].isNext).toBe(false);
  });

  it('records, skips and ends after a number of times', async () => {
    const f = await setupWorkspace();
    const bill = await f.client.post(
      `${f.base}/recurring`,
      rent(f, {
        name: 'Electricity',
        payee: 'NEA',
        categoryId: f.categories.Utilities,
        variableAmount: true,
        amountMinor: 150_000,
        calendar: 'ad',
        nextDate: addDays(today(), -3),
        remaining: 3,
      }),
    );
    const upcoming = await f.client.get(`${f.base}/recurring/upcoming?days=10`);
    expect(upcoming.body[0]).toMatchObject({ name: 'Electricity', overdue: true });

    const recorded = await f.client.post(`${f.base}/recurring/${bill.body.id}/record`, {
      amountMinor: 187_550,
    });
    expect(recorded.status).toBe(201);
    expect(recorded.body.transaction).toMatchObject({
      amountMinor: -187_550,
      payeeName: 'NEA',
      date: addDays(today(), -3),
      recurringId: bill.body.id,
      splits: [{ categoryId: f.categories.Utilities }],
    });
    expect(recorded.body.recurring).toMatchObject({
      nextDate: addMonths(addDays(today(), -3), 1),
      remaining: 2,
      lastPostedDate: addDays(today(), -3),
    });

    const skipped = await f.client.post(`${f.base}/recurring/${bill.body.id}/skip`);
    expect(skipped.body).toMatchObject({ remaining: 1 });
    const last = await f.client.post(`${f.base}/recurring/${bill.body.id}/record`, {});
    expect(last.body.transaction.amountMinor).toBe(-150_000);
    expect(last.body.recurring).toMatchObject({ remaining: 0, nextDate: null });
    expect((await f.client.post(`${f.base}/recurring/${bill.body.id}/skip`)).status).toBe(409);

    const history = await f.client.get(`${f.base}/transactions?recurringId=${bill.body.id}`);
    expect(history.body.totals.count).toBe(2);
  });

  it('posts automatic items when due, including transfers, and catches up', async () => {
    const f = await setupWorkspace();
    const start = addDays(today(), -40);
    const internet = await f.client.post(
      `${f.base}/recurring`,
      rent(f, {
        name: 'Internet',
        payee: 'WorldLink',
        categoryId: f.categories.Utilities,
        amountMinor: 150_000,
        calendar: 'ad',
        mode: 'auto',
        nextDate: start,
      }),
    );
    const saving = await f.client.post(`${f.base}/recurring`, {
      name: 'Savings',
      kind: 'transfer',
      accountId: f.accounts.Cash,
      toAccountId: f.accounts.Bank,
      amountMinor: 500_000,
      frequency: 'weekly',
      calendar: 'ad',
      mode: 'auto',
      nextDate: today(),
    });
    // Reminders are never posted automatically.
    await f.client.post(`${f.base}/recurring`, rent(f, { nextDate: addDays(today(), -1) }));

    const before = await balances(f);
    const posted = await postDueRecurring(testApp().db);
    expect(posted).toBeGreaterThanOrEqual(3);

    const internetTx = await f.client.get(`${f.base}/transactions?recurringId=${internet.body.id}`);
    expect(internetTx.body.items.map((t: any) => t.date).sort()).toEqual([
      start,
      addMonths(start, 1),
    ]);
    const after = await balances(f);
    expect(after.Cash).toBe(before.Cash! - 500_000);
    expect(after.Bank).toBe(before.Bank! + 500_000 - 300_000);

    const [, list] = await Promise.all([
      postDueRecurring(testApp().db), // running again posts nothing new
      f.client.get(`${f.base}/recurring`),
    ]);
    const bySeries = Object.fromEntries(list.body.map((r: any) => [r.name, r]));
    expect(bySeries.Savings.nextDate).toBe(addDays(today(), 7));
    expect(bySeries.Internet.lastPostedDate).toBe(addMonths(start, 1));
    expect(bySeries.Rent.lastPostedDate).toBeNull();
    const again = await f.client.get(`${f.base}/transactions?recurringId=${saving.body.id}`);
    expect(again.body.totals.count).toBe(2); // two legs, one transfer
  });

  it('moves the schedule when the next date changes', async () => {
    const f = await setupWorkspace();
    const r = await f.client.post(
      `${f.base}/recurring`,
      rent(f, { variableAmount: true, nextDate: addDays(today(), 5) }),
    );
    await f.client.post(`${f.base}/recurring/${r.body.id}/record`, { amountMinor: 1000 });
    const moved = await f.client.patch(`${f.base}/recurring/${r.body.id}`, {
      nextDate: today(),
    });
    expect(moved.status).toBe(200);
    // Fields left out of a PATCH keep their values.
    expect(moved.body).toMatchObject({
      nextDate: today(),
      variableAmount: true,
      payeeName: 'Landlord',
      categoryId: f.categories.Rent,
    });
    const paused = await f.client.patch(`${f.base}/recurring/${r.body.id}`, { active: false });
    expect(paused.body).toMatchObject({ active: false, variableAmount: true, mode: 'remind' });
  });

  it('resuming a paused series skips what was missed', async () => {
    const f = await setupWorkspace();
    const r = await f.client.post(
      `${f.base}/recurring`,
      rent(f, { calendar: 'ad', nextDate: addDays(today(), -70), active: false }),
    );
    const resumed = await f.client.patch(`${f.base}/recurring/${r.body.id}`, { active: true });
    expect(resumed.body.nextDate >= today()).toBe(true);
    expect(resumed.body.nextDate <= addMonths(today(), 1)).toBe(true);
  });

  it('suggests payments that look monthly', async () => {
    const f = await setupWorkspace();
    for (const daysAgo of [95, 64, 34, 4]) {
      await f.client.post(`${f.base}/transactions`, {
        accountId: f.accounts.Bank,
        date: addDays(today(), -daysAgo),
        amountMinor: -149_900,
        payee: 'Netflix',
        categoryId: f.categories.Entertainment,
      });
    }
    // Irregular payee: not suggested.
    for (const daysAgo of [80, 12, 3]) {
      await f.client.post(`${f.base}/transactions`, {
        accountId: f.accounts.Cash,
        date: addDays(today(), -daysAgo),
        amountMinor: -20_000,
        payee: 'Tea shop',
      });
    }
    const suggestions = await f.client.get(`${f.base}/recurring/suggestions`);
    expect(suggestions.body).toHaveLength(1);
    expect(suggestions.body[0]).toMatchObject({
      payeeName: 'Netflix',
      frequency: 'monthly',
      amountMinor: 149_900,
      kind: 'expense',
      categoryId: f.categories.Entertainment,
      count: 4,
    });
    expect(suggestions.body[0].nextDate >= today()).toBe(true);

    await f.client.post(
      `${f.base}/recurring`,
      rent(f, { name: 'Netflix', payee: 'netflix', amountMinor: 149_900 }),
    );
    expect((await f.client.get(`${f.base}/recurring/suggestions`)).body).toHaveLength(0);
  });

  it('survives a backup round trip', async () => {
    const f = await setupWorkspace();
    const r = await f.client.post(`${f.base}/recurring`, rent(f, { nextDate: today() }));
    await f.client.post(`${f.base}/recurring/${r.body.id}/record`, {});
    const backup = (await f.client.get(`${f.base}/backup`)).body;
    expect(backup.recurring).toHaveLength(1);
    const restored = await f.client.post('/api/v1/workspaces/restore', { backup, name: 'Copy' });
    const base = `/api/v1/workspaces/${restored.body.id}`;
    const [copy] = (await f.client.get(`${base}/recurring`)).body;
    expect(copy).toMatchObject({
      name: 'Rent',
      payeeName: 'Landlord',
      nextDate: backup.recurring[0].nextDate,
    });
    expect(copy.id).not.toBe(r.body.id);
    const history = await f.client.get(`${base}/transactions?recurringId=${copy.id}`);
    expect(history.body.totals.count).toBe(1);
  });
});
