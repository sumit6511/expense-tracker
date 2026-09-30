import { addDays, getMonthPeriod, todayIn } from '@et/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { sendNotificationEmails } from '../src/services/notifications';
import { postDueRecurring } from '../src/services/recurring';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const today = () => todayIn('Asia/Kathmandu');
const thisMonth = () => getMonthPeriod(today(), { calendar: 'bs', monthStartDay: 1 }).start;

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
}

async function inbox(f: Fixture) {
  const res = await f.client.get<{ items: Item[]; unreadCount: number }>(`${f.base}/notifications`);
  expect(res.status).toBe(200);
  return res.body;
}

async function spend(f: Fixture, amountMinor: number, category: string) {
  const res = await f.client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Cash,
    date: today(),
    amountMinor,
    categoryId: f.categories[category],
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function budget(f: Fixture, category: string, amountMinor: number) {
  const res = await f.client.put(`${f.base}/budgets`, {
    periodStart: thisMonth(),
    items: [{ categoryId: f.categories[category], amountMinor }],
  });
  expect(res.status).toBe(204);
}

describe('notifications', () => {
  it('reminds about bills due within their reminder window, once', async () => {
    const f = await setupWorkspace();
    const bill = {
      name: 'Electricity',
      kind: 'expense',
      accountId: f.accounts.Bank,
      amountMinor: 250_000,
      variableAmount: true,
      frequency: 'monthly',
      calendar: 'bs',
    };
    await f.client.post(`${f.base}/recurring`, { ...bill, nextDate: addDays(today(), 2) });
    // Outside its three-day window, and automatic items, don't need a reminder.
    await f.client.post(`${f.base}/recurring`, {
      ...bill,
      name: 'Water',
      nextDate: addDays(today(), 10),
    });
    await f.client.post(`${f.base}/recurring`, {
      ...bill,
      name: 'Internet',
      variableAmount: false,
      mode: 'auto',
      nextDate: addDays(today(), 1),
    });

    const first = await inbox(f);
    expect(first.unreadCount).toBe(1);
    expect(first.items[0]).toMatchObject({
      kind: 'bill',
      link: '/recurring',
      read: false,
      body: 'About Rs. 2,500 from Bank. Record it once it’s paid.',
    });
    expect(first.items[0]!.title).toMatch(/^Electricity is due \d+ \w+$/);
    // Checking again doesn't repeat it.
    expect((await inbox(f)).items).toHaveLength(1);
  });

  it('warns when a budget is almost used and again when it is over', async () => {
    const f = await setupWorkspace();
    await budget(f, 'Dining Out', 1_000_000);
    await budget(f, 'Shopping', 1_000_000);
    await budget(f, 'Rent', 2_500_000);
    await spend(f, -500_000, 'Dining Out');
    // Spending exactly what was planned isn't a warning.
    await spend(f, -2_500_000, 'Rent');
    expect((await inbox(f)).items).toHaveLength(0);

    await spend(f, -450_000, 'Dining Out');
    let items = (await inbox(f)).items;
    expect(items.map((i) => i.title)).toEqual(['Dining Out budget is almost used']);
    expect(items[0]!.body).toMatch(/^Rs\. 500 left of Rs\. 10,000 for \w+ \d{4}\.$/);

    await spend(f, -100_000, 'Dining Out');
    // Straight past the limit: only "over", and a refund back under it doesn't add "almost".
    await spend(f, -1_200_000, 'Shopping');
    items = (await inbox(f)).items;
    expect(items.map((i) => i.title).sort()).toEqual([
      'Dining Out budget is almost used',
      'Dining Out is over budget',
      'Shopping is over budget',
    ]);
    await spend(f, 250_000, 'Shopping');
    expect((await inbox(f)).items).toHaveLength(3);
  });

  it('watches the overall monthly limit and reached goals', async () => {
    const f = await setupWorkspace();
    await f.client.put(`${f.base}/budgets/cap`, {
      periodStart: thisMonth(),
      amountMinor: 1_000_000,
    });
    await spend(f, -1_100_000, 'Groceries');
    await f.client.post(`${f.base}/goals`, {
      name: 'New phone',
      kind: 'manual',
      targetMinor: 5_000_000,
      savedMinor: 5_000_000,
    });
    await f.client.post(`${f.base}/goals`, {
      name: 'Trip',
      kind: 'manual',
      targetMinor: 5_000_000,
      savedMinor: 100_000,
    });
    const { items } = await inbox(f);
    expect(items.map((i) => [i.kind, i.title]).sort()).toEqual([
      ['budget', 'You’re over your monthly limit'],
      ['goal', 'Goal reached: New phone'],
    ]);
  });

  it('tells you what was recorded automatically', async () => {
    const f = await setupWorkspace();
    const internet = await f.client.post(`${f.base}/recurring`, {
      name: 'Internet',
      kind: 'expense',
      accountId: f.accounts.Bank,
      amountMinor: 150_000,
      frequency: 'monthly',
      calendar: 'bs',
      mode: 'auto',
      nextDate: today(),
    });
    await postDueRecurring(testApp().db);
    const { items } = await inbox(f);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'recurring',
      title: 'Recorded Internet',
      link: `/transactions?recurringId=${internet.body.id}`,
    });
  });

  it('respects preferences and marks notifications read', async () => {
    const f = await setupWorkspace();
    const settings = await f.client.get('/api/v1/me/notification-settings');
    expect(settings.body).toEqual({
      email: false,
      bills: true,
      budgets: true,
      recurring: true,
      goals: true,
      emailAvailable: true,
    });
    const patched = await f.client.patch('/api/v1/me/notification-settings', { budgets: false });
    expect(patched.body).toMatchObject({ budgets: false, bills: true, email: false });

    await budget(f, 'Dining Out', 100_000);
    await spend(f, -200_000, 'Dining Out');
    await f.client.post(`${f.base}/goals`, {
      name: 'A',
      kind: 'manual',
      targetMinor: 100,
      savedMinor: 100,
    });
    await f.client.post(`${f.base}/goals`, {
      name: 'B',
      kind: 'manual',
      targetMinor: 100,
      savedMinor: 200,
    });
    const list = await inbox(f);
    expect(list.items.map((i) => i.kind)).toEqual(['goal', 'goal']);

    const one = await f.client.post('/api/v1/me/notifications/read', {
      ids: [list.items[0]!.id],
    });
    expect(one.body).toEqual({ updated: 1 });
    expect((await inbox(f)).unreadCount).toBe(1);

    // Someone else can't touch them.
    const stranger = await signUp();
    const theirs = await stranger.post('/api/v1/me/notifications/read', {
      ids: [list.items[1]!.id],
    });
    expect(theirs.body).toEqual({ updated: 0 });
    expect((await stranger.get(`${f.base}/notifications`)).status).toBe(404);

    const all = await f.client.post('/api/v1/me/notifications/read', { workspaceId: f.ws.id });
    expect(all.body).toEqual({ updated: 1 });
    const after = await inbox(f);
    expect(after.unreadCount).toBe(0);
    expect(after.items.every((i) => i.read)).toBe(true);

    for (const bad of [{}, { ids: [], workspaceId: f.ws.id }, { ids: ['nope'] }]) {
      expect((await f.client.post('/api/v1/me/notifications/read', bad)).status).toBe(400);
    }
  });

  it('emails unread notifications to people who asked, once', async () => {
    const { db, mailer, outbox } = testApp();
    const f = await setupWorkspace();
    const quiet = await setupWorkspace();
    await f.client.patch('/api/v1/me/notification-settings', { email: true });
    for (const w of [f, quiet]) {
      for (const name of ['Bike', 'Laptop']) {
        await w.client.post(`${w.base}/goals`, {
          name,
          kind: 'manual',
          targetMinor: 100,
          savedMinor: 100,
        });
      }
    }
    const list = await inbox(f);
    await inbox(quiet);
    // Already seen in the app: not emailed.
    await f.client.post('/api/v1/me/notifications/read', {
      ids: [list.items.find((i) => i.title.endsWith('Laptop'))!.id],
    });

    await sendNotificationEmails(db, mailer, 'https://money.example.com/');
    const mine = outbox.filter((m) => m.to === f.client.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ subject: 'Goal reached: Bike' });
    expect(mine[0]!.text).toContain('https://money.example.com/budgets?view=goals');
    expect(mine[0]!.html).toContain('<strong>Goal reached: Bike</strong>');
    expect(outbox.some((m) => m.to === quiet.client.email)).toBe(false);

    await sendNotificationEmails(db, mailer, 'https://money.example.com');
    expect(outbox.filter((m) => m.to === f.client.email)).toHaveLength(1);
  });
});
