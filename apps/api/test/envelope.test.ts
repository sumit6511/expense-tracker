import { getMonthPeriod, shiftMonthPeriod, todayIn } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { type Fixture, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const settings = { calendar: 'bs' as const, monthStartDay: 1 };
const today = () => todayIn('Asia/Kathmandu');
const thisMonth = () => getMonthPeriod(today(), settings);
const nextMonth = () => shiftMonthPeriod(thisMonth(), 1, settings);

async function month(f: Fixture, date = today()) {
  const res = await f.client.get(`${f.base}/budgets?date=${date}`);
  expect(res.status).toBe(200);
  return res.body;
}
const line = (m: any, f: Fixture, name: string) =>
  m.lines.find((l: { categoryId: string }) => l.categoryId === f.categories[name]);

async function tx(
  f: Fixture,
  accountId: string | undefined,
  amountMinor: number,
  category?: string,
) {
  const res = await f.client.post(`${f.base}/transactions`, {
    accountId,
    date: today(),
    amountMinor,
    categoryId: category ? f.categories[category] : null,
  });
  expect(res.status).toBe(201);
}

describe('envelope budgeting', () => {
  it('gives every rupee a job', async () => {
    const f = await setupWorkspace();
    expect((await month(f)).envelope).toBeNull();
    const switched = await f.client.patch(f.base, { budgetMode: 'envelope' });
    expect(switched.body).toMatchObject({
      budgetMode: 'envelope',
      envelopeSince: thisMonth().start,
    });

    // Cash (Rs. 10,000 opened today) is money to assign; so is salary.
    let m = await month(f);
    expect(m.envelope).toMatchObject({ readyToAssignMinor: 1_000_000, incomeMinor: 1_000_000 });
    await tx(f, f.accounts.Bank, 5_000_000, 'Salary');
    await f.client.put(`${f.base}/budgets`, {
      periodStart: thisMonth().start,
      items: [
        { categoryId: f.categories.Rent, amountMinor: 2_000_000 },
        { categoryId: f.categories['Dining Out'], amountMinor: 500_000 },
      ],
    });
    m = await month(f);
    expect(m.envelope).toMatchObject({ readyToAssignMinor: 3_500_000, assignedMinor: 2_500_000 });

    // Overspending shows now, and comes out of next month's Ready to assign.
    await tx(f, f.accounts.Cash, -700_000, 'Dining Out');
    await tx(f, f.accounts.Cash, -100_000); // no category: straight out of Ready to assign
    m = await month(f);
    expect(line(m, f, 'Dining Out')).toMatchObject({ remainingMinor: -200_000 });
    expect(m.envelope).toMatchObject({
      readyToAssignMinor: 3_400_000,
      overspentMinor: 200_000,
      uncategorizedSpentMinor: 100_000,
    });

    // Cover it by moving money from Rent.
    const moved = await f.client.post(`${f.base}/budgets/move`, {
      periodStart: thisMonth().start,
      fromCategoryId: f.categories.Rent,
      toCategoryId: f.categories['Dining Out'],
      amountMinor: 300_000,
    });
    expect(moved.status).toBe(204);
    m = await month(f);
    expect(line(m, f, 'Dining Out')).toMatchObject({
      budgetedMinor: 800_000,
      remainingMinor: 100_000,
    });
    expect(line(m, f, 'Rent')).toMatchObject({
      budgetedMinor: 1_700_000,
      remainingMinor: 1_700_000,
    });
    expect(m.envelope).toMatchObject({ readyToAssignMinor: 3_400_000, overspentMinor: 0 });

    // Next month: leftovers carry, Ready to assign carries.
    let next = await month(f, nextMonth().start);
    expect(line(next, f, 'Rent')).toMatchObject({
      carryInMinor: 1_700_000,
      remainingMinor: 1_700_000,
    });
    expect(line(next, f, 'Dining Out')).toMatchObject({ carryInMinor: 100_000 });
    expect(next.envelope.readyToAssignMinor).toBe(3_400_000);

    // Overspend again this month: next month's Ready to assign pays for it.
    await tx(f, f.accounts.Cash, -300_000, 'Dining Out');
    next = await month(f, nextMonth().start);
    expect(line(next, f, 'Dining Out')).toMatchObject({ carryInMinor: 0 });
    expect(next.envelope).toMatchObject({
      readyToAssignMinor: 3_200_000,
      overspentLastMonthMinor: 200_000,
    });
    // Assign from Ready to assign straight into next month.
    await f.client.post(`${f.base}/budgets/move`, {
      periodStart: nextMonth().start,
      fromCategoryId: null,
      toCategoryId: f.categories['Food & Groceries'],
      amountMinor: 1_000_000,
    });
    expect((await month(f, nextMonth().start)).envelope.readyToAssignMinor).toBe(2_200_000);

    const dash = await f.client.get(`${f.base}/reports/dashboard`);
    // This month's overspending only reaches Ready to assign next month.
    expect(dash.body.budget.readyToAssignMinor).toBe(3_400_000);

    const back = await f.client.patch(f.base, { budgetMode: 'tracking' });
    expect(back.body).toMatchObject({ budgetMode: 'tracking', envelopeSince: null });
    expect((await month(f)).envelope).toBeNull();
    expect(
      (await f.client.get(`${f.base}/reports/dashboard`)).body.budget.readyToAssignMinor,
    ).toBeNull();
  });

  it('refuses moves outside expense categories', async () => {
    const f = await setupWorkspace();
    const bad = await f.client.post(`${f.base}/budgets/move`, {
      periodStart: thisMonth().start,
      fromCategoryId: null,
      toCategoryId: f.categories.Salary,
      amountMinor: 100,
    });
    expect(bad.status).toBe(400);
    const same = await f.client.post(`${f.base}/budgets/move`, {
      periodStart: thisMonth().start,
      fromCategoryId: f.categories.Rent,
      toCategoryId: f.categories.Rent,
      amountMinor: 100,
    });
    expect(same.status).toBe(400);
  });
});
