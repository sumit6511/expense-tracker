import { addDays, todayIn } from '@et/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { holdingValues } from '../src/db/schema';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const { db } = testApp();
const today = todayIn('Asia/Kathmandu');

async function investmentAccount(f: Fixture, extra: Record<string, unknown> = {}) {
  const res = await f.client.post(`${f.base}/accounts`, {
    name: 'NEPSE (Meroshare)',
    type: 'investment',
    currency: 'NPR',
    openingBalanceMinor: 100_000,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('investment holdings', () => {
  it('values holdings at their latest prices, in the account and in net worth', async () => {
    const f = await setupWorkspace();
    const account = await investmentAccount(f);
    const added = await f.client.post(`${f.base}/accounts/${account}/holdings`, {
      symbol: 'nabil',
      name: 'Nabil Bank',
      quantity: '10',
      costMinor: 500_000,
      price: '512.30',
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      currency: 'NPR',
      valueMinor: 512_300,
      costMinor: 500_000,
      holdings: [
        {
          symbol: 'NABIL',
          quantity: '10',
          price: '512.3',
          priceDate: today,
          valueMinor: 512_300,
          gainMinor: 12_300,
        },
      ],
    });
    // Not priced yet: listed, but not counted.
    const nica = await f.client.post(`${f.base}/accounts/${account}/holdings`, {
      symbol: 'NICA',
      quantity: '2.5',
      costMinor: 200_000,
    });
    expect(nica.body.holdings[1]).toMatchObject({ price: null, valueMinor: null, gainMinor: null });
    expect(nica.body.valueMinor).toBe(512_300);
    expect(nica.body.costMinor).toBe(500_000);

    const accounts = (await f.client.get(`${f.base}/accounts`)).body;
    expect(accounts.find((a: { id: string }) => a.id === account)).toMatchObject({
      balanceMinor: 100_000,
      holdingsValueMinor: 512_300,
      holdingsValueBaseMinor: 512_300,
    });
    expect(accounts.find((a: { name: string }) => a.name === 'Cash').holdingsValueMinor).toBeNull();

    // Prices for several at once (as pasted from a market website).
    const ids = Object.fromEntries(
      nica.body.holdings.map((h: { symbol: string; id: string }) => [h.symbol, h.id]),
    );
    const priced = await f.client.post(`${f.base}/accounts/${account}/holdings/prices`, {
      prices: [
        { holdingId: ids.NABIL, price: '520' },
        { holdingId: ids.NICA, price: '845.5' },
      ],
    });
    expect(priced.body.valueMinor).toBe(520_000 + 211_375);
    const [snap] = await db
      .select()
      .from(holdingValues)
      .where(and(eq(holdingValues.accountId, account), eq(holdingValues.date, today)));
    expect(snap!.valueMinor).toBe(731_375);

    const dashboard = (await f.client.get(`${f.base}/reports/dashboard`)).body;
    const cashOnly = 1_000_000 + 100_000; // Cash's opening balance + the investment account's
    expect(dashboard.netWorthMinor).toBe(cashOnly + 731_375);

    // Sold the NICA shares: gone from the value.
    const sold = await f.client.delete(`${f.base}/holdings/${ids.NICA}`);
    expect(sold.body.valueMinor).toBe(520_000);
    const changed = await f.client.patch(`${f.base}/holdings/${ids.NABIL}`, { quantity: '12.5' });
    expect(changed.body.holdings[0]).toMatchObject({ quantity: '12.5', valueMinor: 650_000 });
  });

  it('uses the value of the time for net worth over time', async () => {
    const f = await setupWorkspace({ calendar: 'ad' });
    const account = await investmentAccount(f, {
      openingBalanceMinor: 0,
      openingDate: addDays(today, -100),
    });
    await f.client.post(`${f.base}/accounts/${account}/holdings`, {
      symbol: 'GOLD',
      quantity: '2',
      costMinor: 0,
      price: '150000',
    });
    // Two months ago they were worth less.
    const past = addDays(today, -62);
    await db
      .insert(holdingValues)
      .values({ accountId: account, date: past, valueMinor: 25_000_000 });
    const series = await f.client.get(
      `${f.base}/reports/net-worth?from=${addDays(today, -95)}&to=${today}`,
    );
    const points = series.body.points as Array<{ date: string; assetsMinor: number }>;
    // Cash was opened today, so earlier months only have what the gold was worth then.
    for (const p of points.slice(0, -1)) {
      expect([p.date, p.assetsMinor]).toEqual([p.date, p.date < past ? 0 : 25_000_000]);
    }
    expect(points.some((p) => p.date >= past && p.date < today)).toBe(true);
    expect(points.at(-1)!.assetsMinor).toBe(1_000_000 + 30_000_000);
  });

  it('checks numbers, and keeps private accounts private', async () => {
    const f = await setupWorkspace();
    const account = await investmentAccount(f);
    const bad = await f.client.post(`${f.base}/accounts/${account}/holdings`, {
      symbol: 'X',
      quantity: '1,000',
    });
    expect(bad.status).toBe(400);
    const huge = await f.client.post(`${f.base}/accounts/${account}/holdings`, {
      symbol: 'X',
      quantity: '999999999999999',
      price: '999999999999999',
    });
    expect(huge.status).toBe(400);

    const mine = await investmentAccount(f, { name: 'My shares', visibility: 'private' });
    await f.client.post(`${f.base}/accounts/${mine}/holdings`, {
      symbol: 'NTC',
      quantity: '5',
      price: '900',
    });
    const sita = await signUp('Sita');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: sita.email,
      role: 'editor',
    });
    await sita.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    expect((await sita.get(`${f.base}/accounts/${mine}/holdings`)).status).toBe(404);
    expect((await sita.get(`${f.base}/accounts/${account}/holdings`)).status).toBe(200);
  });

  it('goes into backups and comes back on restore', async () => {
    const f = await setupWorkspace();
    const account = await investmentAccount(f);
    await f.client.post(`${f.base}/accounts/${account}/holdings`, {
      symbol: 'NABIL',
      name: 'Nabil Bank',
      quantity: '10.125',
      costMinor: 500_000,
      price: '512.3',
    });
    const backup = (await f.client.get(`${f.base}/backup`)).body;
    expect(backup.holdings).toEqual([
      expect.objectContaining({ symbol: 'NABIL', quantity: '10.125', price: '512.3' }),
    ]);
    const restored = await f.client.post('/api/v1/workspaces/restore', { backup, name: 'Copy' });
    expect(restored.status).toBe(201);
    const base = `/api/v1/workspaces/${restored.body.id}`;
    const copy = (await f.client.get(`${base}/accounts`)).body.find(
      (a: { name: string }) => a.name === 'NEPSE (Meroshare)',
    );
    const holdings = (await f.client.get(`${base}/accounts/${copy.id}/holdings`)).body;
    expect(holdings.holdings).toEqual([
      expect.objectContaining({ symbol: 'NABIL', quantity: '10.125', valueMinor: 518_704 }),
    ]);
  });
});
