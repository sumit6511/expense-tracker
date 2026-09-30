import { bsToAd } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

// Bikram Sambat months of 2083 (AD start dates).
const BHADRA = bsToAd({ year: 2083, month: 5, day: 1 });
const ASOJ = bsToAd({ year: 2083, month: 6, day: 1 });
const KARTIK = bsToAd({ year: 2083, month: 7, day: 1 });
const MANGSIR = bsToAd({ year: 2083, month: 8, day: 1 });

async function spend(f: Fixture, date: string, amountMinor: number, category: string) {
  const res = await f.client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Cash,
    date,
    amountMinor: -amountMinor,
    categoryId: f.categories[category],
  });
  expect(res.status).toBe(201);
}

async function budget(f: Fixture, periodStart: string, category: string, amountMinor: number) {
  const res = await f.client.put(`${f.base}/budgets`, {
    periodStart,
    items: [{ categoryId: f.categories[category], amountMinor }],
  });
  expect(res.status).toBe(204);
}

async function line(f: Fixture, date: string, category: string) {
  const month = (await f.client.get(`${f.base}/budgets?date=${date}`)).body;
  return month.lines.find((l: { categoryId: string }) => l.categoryId === f.categories[category]);
}

describe('rollover budgets', () => {
  it('carries leftovers, and with "all" overspending too, from the month it was switched on', async () => {
    const f = await setupWorkspace();
    for (const start of [BHADRA, ASOJ, KARTIK, MANGSIR]) {
      await budget(f, start, 'Dining Out', 1_000_000);
      await budget(f, start, 'Shopping', 1_000_000);
    }
    // Bhadra: before rollover starts; its leftover is ignored.
    await spend(f, BHADRA, 200_000, 'Dining Out');
    // Asoj: 3,000 left in Dining Out; Shopping overspent by 5,000.
    await spend(f, ASOJ, 700_000, 'Dining Out');
    await spend(f, ASOJ, 1_500_000, 'Shopping');
    // Kartik: Dining Out overspent by 12,000 (after carrying 3,000 in).
    await spend(f, KARTIK, 2_500_000, 'Dining Out');

    for (const [category, mode] of [
      ['Dining Out', 'surplus'],
      ['Shopping', 'all'],
    ] as const) {
      const res = await f.client.put(`${f.base}/budgets/rollover`, {
        categoryId: f.categories[category],
        mode,
        fromPeriodStart: ASOJ,
      });
      expect(res.status).toBe(204);
    }

    expect(await line(f, ASOJ, 'Dining Out')).toMatchObject({
      carryInMinor: 0,
      rollover: 'surplus',
    });
    expect(await line(f, KARTIK, 'Dining Out')).toMatchObject({
      budgetedMinor: 1_000_000,
      carryInMinor: 300_000,
      availableMinor: 1_300_000,
      remainingMinor: 1_300_000 - 2_500_000,
    });
    // Surplus mode forgives Kartik's overspending.
    expect(await line(f, MANGSIR, 'Dining Out')).toMatchObject({ carryInMinor: 0 });
    // "all": Asoj −5,000, Kartik +10,000 → 5,000 into Mangsir.
    expect(await line(f, KARTIK, 'Shopping')).toMatchObject({ carryInMinor: -500_000 });
    expect(await line(f, MANGSIR, 'Shopping')).toMatchObject({ carryInMinor: 500_000 });

    const month = (await f.client.get(`${f.base}/budgets?date=${MANGSIR}`)).body;
    expect(month.totals.carryInMinor).toBe(500_000);

    // Turning it off stops carrying.
    await f.client.put(`${f.base}/budgets/rollover`, {
      categoryId: f.categories.Shopping,
      mode: 'none',
    });
    expect(await line(f, MANGSIR, 'Shopping')).toMatchObject({ carryInMinor: 0, rollover: 'none' });
  });

  it('only applies to expense categories', async () => {
    const f = await setupWorkspace();
    const res = await f.client.put(`${f.base}/budgets/rollover`, {
      categoryId: f.categories.Salary,
      mode: 'surplus',
    });
    expect(res.status).toBe(400);
  });
});

describe('monthly limit', () => {
  it('applies from the month it is set until changed, and drives the dashboard', async () => {
    const f = await setupWorkspace();
    await budget(f, ASOJ, 'Dining Out', 1_000_000);
    await spend(f, ASOJ, 400_000, 'Dining Out');
    await spend(f, ASOJ, 100_000, 'Shopping');

    let dash = (await f.client.get(`${f.base}/reports/dashboard?date=${ASOJ}`)).body;
    expect(dash.budget).toMatchObject({
      source: 'categories',
      budgetedMinor: 1_000_000,
      remainingMinor: 500_000,
    });

    expect(
      (await f.client.put(`${f.base}/budgets/cap`, { periodStart: ASOJ, amountMinor: 3_000_000 }))
        .status,
    ).toBe(204);
    const later = (await f.client.get(`${f.base}/budgets?date=${MANGSIR}`)).body;
    expect(later.cap).toMatchObject({ amountMinor: 3_000_000, sincePeriodStart: ASOJ });
    const asoj = (await f.client.get(`${f.base}/budgets?date=${ASOJ}`)).body;
    expect(asoj.cap).toMatchObject({ spentMinor: 500_000, remainingMinor: 2_500_000 });
    expect((await f.client.get(`${f.base}/budgets?date=${BHADRA}`)).body.cap).toBeNull();

    dash = (await f.client.get(`${f.base}/reports/dashboard?date=${ASOJ}`)).body;
    expect(dash.budget).toMatchObject({
      source: 'cap',
      budgetedMinor: 3_000_000,
      remainingMinor: 2_500_000,
    });

    // Removing it from Kartik on.
    await f.client.put(`${f.base}/budgets/cap`, { periodStart: KARTIK, amountMinor: 0 });
    expect((await f.client.get(`${f.base}/budgets?date=${MANGSIR}`)).body.cap).toBeNull();
    expect((await f.client.get(`${f.base}/budgets?date=${ASOJ}`)).body.cap).not.toBeNull();

    const bad = await f.client.put(`${f.base}/budgets/cap`, {
      periodStart: '2026-10-01',
      amountMinor: 1,
    });
    expect(bad.status).toBe(400);
  });
});

describe('goals', () => {
  it('tracks manual, account and savings-fund goals', async () => {
    const f = await setupWorkspace();
    const manual = await f.client.post(`${f.base}/goals`, {
      name: 'New phone',
      kind: 'manual',
      targetMinor: 12_000_000,
      savedMinor: 2_000_000,
    });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({
      currentMinor: 2_000_000,
      progress: 2 / 12,
      reached: false,
      monthsLeft: null,
    });
    const added = await f.client.post(`${f.base}/goals/${manual.body.id}/contribute`, {
      amountMinor: 10_000_000,
    });
    expect(added.body).toMatchObject({ currentMinor: 12_000_000, progress: 1, reached: true });
    const taken = await f.client.post(`${f.base}/goals/${manual.body.id}/contribute`, {
      amountMinor: -20_000_000,
    });
    expect(taken.body.currentMinor).toBe(0);

    // Cash starts at Rs. 10,000.
    const emergency = await f.client.post(`${f.base}/goals`, {
      name: 'Emergency fund',
      kind: 'account',
      accountId: f.accounts.Cash,
      targetMinor: 5_000_000,
      targetDate: bsToAd({ year: 2090, month: 1, day: 1 }),
    });
    expect(emergency.body).toMatchObject({ currentMinor: 1_000_000, progress: 0.2 });
    expect(emergency.body.monthsLeft).toBeGreaterThan(12);
    // Rounded up to whole rupees.
    expect(emergency.body.monthlyNeededMinor).toBe(
      Math.ceil(4_000_000 / emergency.body.monthsLeft / 100) * 100,
    );
    expect(
      (await f.client.post(`${f.base}/goals/${emergency.body.id}/contribute`, { amountMinor: 1 }))
        .status,
    ).toBe(400);

    // A savings fund turns on rollover for its category and counts what it holds.
    const today = (await f.client.get(`${f.base}/reports/dashboard`)).body.period.start;
    await budget(f, today, 'Festivals & Gifts', 1_500_000);
    const fund = await f.client.post(`${f.base}/goals`, {
      name: 'Dashain',
      kind: 'category',
      categoryId: f.categories['Festivals & Gifts'],
      targetMinor: 6_000_000,
    });
    expect(fund.body.currentMinor).toBe(1_500_000);
    expect(await line(f, today, 'Festivals & Gifts')).toMatchObject({ rollover: 'surplus' });

    const renamed = await f.client.patch(`${f.base}/goals/${fund.body.id}`, {
      name: 'Dashain 2083',
    });
    expect(renamed.body).toMatchObject({
      name: 'Dashain 2083',
      kind: 'category',
      targetMinor: 6_000_000,
    });
    const archived = await f.client.patch(`${f.base}/goals/${manual.body.id}`, { archived: true });
    expect(archived.body.archived).toBe(true);

    const list = (await f.client.get(`${f.base}/goals`)).body;
    expect(list.map((g: { name: string }) => g.name)).toEqual([
      expect.any(String),
      expect.any(String),
      'New phone',
    ]);
    expect((await f.client.delete(`${f.base}/goals/${manual.body.id}`)).status).toBe(204);

    const invalid = await f.client.post(`${f.base}/goals`, {
      name: 'x',
      kind: 'category',
      categoryId: f.categories.Salary,
      targetMinor: 1,
    });
    expect(invalid.status).toBe(400);
  });

  it('survive a backup round trip with rollover and limits', async () => {
    const f = await setupWorkspace();
    await f.client.put(`${f.base}/budgets/rollover`, {
      categoryId: f.categories.Travel,
      mode: 'all',
      fromPeriodStart: ASOJ,
    });
    await f.client.put(`${f.base}/budgets/cap`, { periodStart: ASOJ, amountMinor: 5_000_000 });
    await f.client.post(`${f.base}/goals`, {
      name: 'Trip',
      kind: 'account',
      accountId: f.accounts.Bank,
      targetMinor: 1_000_000,
    });
    const backup = (await f.client.get(`${f.base}/backup`)).body;
    const restored = await f.client.post('/api/v1/workspaces/restore', { backup, name: 'Copy' });
    const base = `/api/v1/workspaces/${restored.body.id}`;
    const [goal] = (await f.client.get(`${base}/goals`)).body;
    const accounts = (await f.client.get(`${base}/accounts`)).body;
    expect(goal.accountId).toBe(accounts.find((a: { name: string }) => a.name === 'Bank').id);
    const month = (await f.client.get(`${base}/budgets?date=${KARTIK}`)).body;
    expect(month.cap.amountMinor).toBe(5_000_000);
    expect(month.lines.filter((l: { rollover: string }) => l.rollover === 'all')).toHaveLength(1);
  });
});
