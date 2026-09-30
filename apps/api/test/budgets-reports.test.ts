import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

// Asoj 2083 BS runs 17 Sep – 17 Oct 2026; Bhadra 2083 runs 17 Aug – 16 Sep 2026.
const ASOJ = '2026-09-17';
const BHADRA = '2026-08-17';
const KARTIK = '2026-10-18';

let f: Fixture;

beforeAll(async () => {
  f = await setupWorkspace();
  const tx = (body: Record<string, unknown>) => f.client.post(`${f.base}/transactions`, body);
  const rate = await f.client.put(`${f.base}/rates/manual`, {
    base: 'USD',
    quote: 'NPR',
    date: '2026-09-01',
    rate: '133.5',
  });
  expect(rate.status).toBe(204);
  const c = f.categories;
  await tx({
    accountId: f.accounts.Cash,
    date: '2026-09-20',
    amountMinor: -250_000,
    payee: 'Bhat Bhateni',
    categoryId: c['Food & Groceries'],
  });
  await tx({
    accountId: f.accounts.Cash,
    date: '2026-09-21',
    amountMinor: 50_000,
    payee: 'Bhat Bhateni',
    categoryId: c['Food & Groceries'],
  });
  await tx({
    accountId: f.accounts['USD Card'],
    date: '2026-09-22',
    amountMinor: -1000,
    payee: 'Netflix',
    categoryId: c['Dining Out'],
  });
  await tx({
    accountId: f.accounts['INR Wallet'],
    date: '2026-09-23',
    amountMinor: -10_000,
    categoryId: c.Transport,
  });
  await tx({ accountId: f.accounts.Cash, date: '2026-09-24', amountMinor: -3000 });
  await tx({
    accountId: f.accounts.Cash,
    date: '2026-09-10',
    amountMinor: -300_000,
    categoryId: c['Food & Groceries'],
  });
  await tx({
    accountId: f.accounts.Bank,
    date: ASOJ,
    amountMinor: 8_000_000,
    payee: 'Employer',
    categoryId: c.Salary,
  });
  // Transfers never count as spending or income.
  await f.client.post(`${f.base}/transfers`, {
    fromAccountId: f.accounts.Bank,
    toAccountId: f.accounts.Cash,
    date: '2026-09-25',
    amountMinor: 100_000,
  });
});

describe('budgets', () => {
  it('uses Bikram Sambat months', async () => {
    const res = await f.client.get(`${f.base}/budgets?date=2026-09-30`);
    expect(res.status).toBe(200);
    expect(res.body.period).toMatchObject({
      start: ASOJ,
      end: '2026-10-17',
      label: 'Asoj 2083',
      calendar: 'bs',
    });
  });

  it('only accepts real period starts and expense categories', async () => {
    const wrongStart = await f.client.put(`${f.base}/budgets`, {
      periodStart: '2026-09-01',
      items: [{ categoryId: f.categories['Food & Groceries'], amountMinor: 1 }],
    });
    expect(wrongStart.status).toBe(400);
    const incomeCategory = await f.client.put(`${f.base}/budgets`, {
      periodStart: ASOJ,
      items: [{ categoryId: f.categories.Salary, amountMinor: 1 }],
    });
    expect(incomeCategory.status).toBe(400);
  });

  it('computes budgeted, spent (net of refunds, in NPR) and remaining', async () => {
    const set = await f.client.put(`${f.base}/budgets`, {
      periodStart: ASOJ,
      items: [
        { categoryId: f.categories['Food & Groceries'], amountMinor: 1_000_000 },
        { categoryId: f.categories['Dining Out'], amountMinor: 200_000 },
      ],
    });
    expect(set.status).toBe(204);
    const month = (await f.client.get(`${f.base}/budgets?date=2026-09-30`)).body;
    const line = (name: string) =>
      month.lines.find((l: { categoryId: string }) => l.categoryId === f.categories[name]);
    expect(line('Food & Groceries')).toEqual({
      categoryId: f.categories['Food & Groceries'],
      budgetedMinor: 1_000_000,
      spentMinor: 200_000,
      carryInMinor: 0,
      availableMinor: 1_000_000,
      remainingMinor: 800_000,
      rollover: 'none',
      averageMinor: 100_000,
      lastPeriodSpentMinor: 300_000,
    });
    expect(line('Dining Out')).toMatchObject({ spentMinor: 133_500, remainingMinor: 66_500 });
    expect(line('Transport')).toMatchObject({ budgetedMinor: 0, spentMinor: 16_000 });
    expect(month.cap).toBeNull();
    expect(month.totals).toEqual({
      budgetedMinor: 1_200_000,
      carryInMinor: 0,
      spentMinor: 200_000 + 133_500 + 16_000 + 3000,
      remainingMinor: 1_200_000 - 352_500,
      unbudgetedSpentMinor: 19_000,
      incomeMinor: 8_000_000,
    });
  });

  it('copies budgets and fills from averages', async () => {
    const copy = await f.client.post(`${f.base}/budgets/copy`, {
      fromPeriodStart: ASOJ,
      toPeriodStart: KARTIK,
    });
    expect(copy.body.count).toBe(2);
    const again = await f.client.post(`${f.base}/budgets/copy`, {
      fromPeriodStart: ASOJ,
      toPeriodStart: KARTIK,
    });
    expect(again.body.count).toBe(0);
    const fill = await f.client.post(`${f.base}/budgets/fill-average`, {
      periodStart: KARTIK,
      months: 1,
    });
    // Food and Dining already have budgets; Transport (Rs. 160) gets its average.
    expect(fill.body.count).toBe(1);
    const kartik = (await f.client.get(`${f.base}/budgets?date=${KARTIK}`)).body;
    const transport = kartik.lines.find(
      (l: { categoryId: string }) => l.categoryId === f.categories.Transport,
    );
    expect(transport.budgetedMinor).toBe(16_000);
    // Setting 0 removes a budget.
    await f.client.put(`${f.base}/budgets`, {
      periodStart: KARTIK,
      items: [{ categoryId: f.categories.Transport, amountMinor: 0 }],
    });
    const after = (await f.client.get(`${f.base}/budgets?date=${KARTIK}`)).body;
    expect(after.totals.budgetedMinor).toBe(1_200_000);
  });

  it('follows AD months with a custom start day when configured', async () => {
    const g = await setupWorkspace({ calendar: 'ad', monthStartDay: 25 });
    const res = await g.client.get(`${g.base}/budgets?date=2026-09-30`);
    expect(res.body.period).toMatchObject({
      start: '2026-09-25',
      end: '2026-10-24',
      calendar: 'ad',
    });
  });
});

describe('reports', () => {
  it('breaks spending down by category in NPR', async () => {
    const res = await f.client.get(
      `${f.base}/reports/spending-by-category?from=${ASOJ}&to=2026-10-17`,
    );
    expect(res.body).toEqual({
      currency: 'NPR',
      expense: [
        { categoryId: f.categories['Food & Groceries'], amountMinor: 200_000, count: 2 },
        { categoryId: f.categories['Dining Out'], amountMinor: 133_500, count: 1 },
        { categoryId: f.categories.Transport, amountMinor: 16_000, count: 1 },
        { categoryId: null, amountMinor: 3000, count: 1 },
      ],
      income: [{ categoryId: f.categories.Salary, amountMinor: 8_000_000, count: 1 }],
      totalExpenseMinor: 352_500,
      totalIncomeMinor: 8_000_000,
      missingRates: [],
    });
  });

  it('shows cash flow per BS month', async () => {
    const res = await f.client.get(`${f.base}/reports/cash-flow?from=${BHADRA}&to=2026-10-17`);
    expect(
      res.body.periods.map((p: Record<string, unknown>) => [
        p.label,
        p.incomeMinor,
        p.expenseMinor,
        p.netMinor,
      ]),
    ).toEqual([
      ['Bhadra 2083', 0, 300_000, -300_000],
      ['Asoj 2083', 8_000_000, 352_500, 8_000_000 - 352_500],
    ]);
  });

  it('shows category trends and budget vs actual', async () => {
    const trends = await f.client.get(
      `${f.base}/reports/category-trends?from=${BHADRA}&to=2026-10-17`,
    );
    const food = trends.body.series.find(
      (s: { categoryId: string }) => s.categoryId === f.categories['Food & Groceries'],
    );
    expect(food.valuesMinor).toEqual([300_000, 200_000]);
    const bva = await f.client.get(`${f.base}/reports/budget-vs-actual?date=2026-09-30&periods=2`);
    expect(
      bva.body.periods.map((p: Record<string, unknown>) => [
        p.label,
        p.budgetedMinor,
        p.spentMinor,
      ]),
    ).toEqual([
      ['Bhadra 2083', 0, 300_000],
      ['Asoj 2083', 1_200_000, 352_500],
    ]);
  });

  it('summarises the month on the dashboard', async () => {
    const res = await f.client.get(`${f.base}/reports/dashboard?date=2026-09-30`);
    expect(res.status).toBe(200);
    expect(res.body.period.label).toBe('Asoj 2083');
    expect(res.body.cashFlow).toEqual({
      incomeMinor: 8_000_000,
      expenseMinor: 352_500,
      netMinor: 8_000_000 - 352_500,
    });
    expect(res.body.budget).toMatchObject({
      budgetedMinor: 1_200_000,
      spentMinor: 352_500,
      remainingMinor: 847_500,
    });
    expect(res.body.previousPeriodExpenseMinor).toBe(300_000);
    expect(res.body.topCategories[0]).toMatchObject({
      categoryId: f.categories['Food & Groceries'],
      amountMinor: 200_000,
    });
    expect(res.body.uncategorizedCount).toBe(1);
    const accounts = (await f.client.get(`${f.base}/accounts`)).body as Array<{
      balanceBaseMinor: number;
    }>;
    expect(res.body.netWorthMinor).toBe(accounts.reduce((s, a) => s + a.balanceBaseMinor, 0));
  });

  it('reports currencies it could not convert', async () => {
    const g = await setupWorkspace();
    const eur = await g.client.post(`${g.base}/accounts`, {
      name: 'Euro',
      type: 'cash',
      currency: 'EUR',
    });
    await g.client.post(`${g.base}/transactions`, {
      accountId: eur.body.id,
      date: '2026-09-20',
      amountMinor: -500,
    });
    const res = await g.client.get(
      `${g.base}/reports/spending-by-category?from=2026-09-01&to=2026-09-30`,
    );
    expect(res.body.missingRates).toEqual(['EUR']);
    expect(res.body.totalExpenseMinor).toBe(0);
  });

  it('lists exchange rates including the INR peg and manual rates', async () => {
    const res = await f.client.get(`${f.base}/rates?date=2026-09-30`);
    expect(res.body).toEqual(
      expect.arrayContaining([
        { base: 'INR', quote: 'NPR', date: '2026-09-30', rate: '1.6', source: 'peg' },
        { base: 'USD', quote: 'NPR', date: '2026-09-01', rate: '133.5', source: 'manual' },
      ]),
    );
  });
});
