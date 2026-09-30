import { bsToAd } from '@et/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

// Bhadra and Asoj 2083 BS.
const BHADRA = bsToAd({ year: 2083, month: 5, day: 1 });
const BHADRA_END = bsToAd({ year: 2083, month: 5, day: 31 });
const ASOJ = bsToAd({ year: 2083, month: 6, day: 1 });
const ASOJ_END = bsToAd({ year: 2083, month: 6, day: 31 });
const day = (start: string, n: number) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let f: Fixture;
let tag: string;

beforeAll(async () => {
  f = await setupWorkspace();
  tag = (await f.client.post(`${f.base}/tags`, { name: 'trip' })).body.id;
  // Opening balances count from their opening date.
  for (const id of Object.values(f.accounts))
    await f.client.patch(`${f.base}/accounts/${id}`, { openingDate: BHADRA });
  const add = (body: Record<string, unknown>) =>
    f.client.post(`${f.base}/transactions`, { accountId: f.accounts.Cash, ...body });
  const c = f.categories;
  await add({
    date: day(BHADRA, 2),
    amountMinor: -80_000,
    payee: 'Bhat Bhateni',
    categoryId: c['Food & Groceries'],
  });
  await add({
    date: day(ASOJ, 1),
    amountMinor: -100_000,
    payee: 'Bhat Bhateni',
    categoryId: c['Food & Groceries'],
  });
  await add({
    date: day(ASOJ, 1),
    amountMinor: -50_000,
    payee: 'Bhat Bhateni',
    categoryId: c['Food & Groceries'],
  });
  await add({
    date: day(ASOJ, 3),
    amountMinor: -200_000,
    payee: 'Daraz',
    categoryId: c.Shopping,
    tagIds: [tag],
  });
  await add({
    date: day(ASOJ, 4),
    amountMinor: 1_000_000,
    payee: 'Employer',
    categoryId: c.Salary,
    accountId: f.accounts.Bank,
  });
  // Work expenses that get reimbursed: left out of reports.
  await add({ date: day(ASOJ, 5), amountMinor: -300_000, payee: 'Hotel', categoryId: c.Travel });
  const res = await f.client.patch(`${f.base}/categories/${c.Travel}`, {
    excludeFromReports: true,
  });
  expect(res.status).toBe(204);
});

describe('more reports', () => {
  it('leaves excluded categories out of reports but not budgets', async () => {
    const cats = (await f.client.get(`${f.base}/categories`)).body;
    const travel = cats
      .flatMap((g: { categories: unknown[] }) => g.categories)
      .find((c: { id: string }) => c.id === f.categories.Travel);
    expect(travel.excludeFromReports).toBe(true);

    const spending = await f.client.get(
      `${f.base}/reports/spending-by-category?from=${ASOJ}&to=${ASOJ_END}`,
    );
    expect(spending.body.totalExpenseMinor).toBe(350_000);
    expect(
      spending.body.expense.some(
        (e: { categoryId: string }) => e.categoryId === f.categories.Travel,
      ),
    ).toBe(false);

    const budget = (await f.client.get(`${f.base}/budgets?date=${ASOJ}`)).body;
    const line = budget.lines.find(
      (l: { categoryId: string }) => l.categoryId === f.categories.Travel,
    );
    expect(line.spentMinor).toBe(300_000);
  });

  it('groups by payee and by tag', async () => {
    const payees = await f.client.get(
      `${f.base}/reports/spending-by-payee?from=${ASOJ}&to=${ASOJ_END}`,
    );
    expect(payees.status).toBe(200);
    const byName = async (id: string) =>
      (await f.client.get(`${f.base}/payees`)).body.find((p: { id: string }) => p.id === id)?.name;
    const [first, second] = payees.body.expense;
    expect([await byName(first.id), first.amountMinor]).toEqual(['Daraz', 200_000]);
    expect([await byName(second.id), second.amountMinor, second.count]).toEqual([
      'Bhat Bhateni',
      150_000,
      2,
    ]);
    expect(payees.body.income).toHaveLength(1);

    const tags = await f.client.get(
      `${f.base}/reports/spending-by-tag?from=${ASOJ}&to=${ASOJ_END}`,
    );
    expect(tags.body.expense).toEqual([{ id: tag, amountMinor: 200_000, count: 1 }]);
  });

  it('tracks net worth month by month', async () => {
    const res = await f.client.get(`${f.base}/reports/net-worth?from=${BHADRA}&to=${ASOJ_END}`);
    expect(res.status).toBe(200);
    const [bhadra, asoj] = res.body.points;
    // Cash starts at Rs. 10,000; Bank and the cards at 0.
    expect(bhadra).toMatchObject({ start: BHADRA, date: BHADRA_END, netMinor: 1_000_000 - 80_000 });
    expect(asoj.netMinor).toBe(1_000_000 - 80_000 - 350_000 + 1_000_000 - 300_000);
    expect(asoj.liabilitiesMinor).toBe(0);
  });

  it('compares two periods per category', async () => {
    const res = await f.client.get(
      `${f.base}/reports/compare?from=${ASOJ}&to=${ASOJ_END}&compareFrom=${BHADRA}&compareTo=${BHADRA_END}`,
    );
    expect(res.body.current).toMatchObject({ expenseMinor: 350_000, incomeMinor: 1_000_000 });
    expect(res.body.previous).toMatchObject({ expenseMinor: 80_000, incomeMinor: 0 });
    expect(res.body.categories[0]).toEqual({
      categoryId: f.categories.Shopping,
      currentMinor: 200_000,
      previousMinor: 0,
    });
  });

  it('totals each day for the calendar', async () => {
    const res = await f.client.get(`${f.base}/reports/daily?from=${ASOJ}&to=${ASOJ_END}`);
    expect(res.body.days).toEqual([
      { date: day(ASOJ, 1), expenseMinor: 150_000, incomeMinor: 0, count: 2 },
      { date: day(ASOJ, 3), expenseMinor: 200_000, incomeMinor: 0, count: 1 },
      { date: day(ASOJ, 4), expenseMinor: 0, incomeMinor: 1_000_000, count: 1 },
    ]);
    const tooLong = await f.client.get(`${f.base}/reports/daily?from=2024-01-01&to=${ASOJ_END}`);
    expect(tooLong.status).toBe(400);
  });
});
