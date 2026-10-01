import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { addDays, todayIn } from '@et/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { BankProviderError, type ProviderAccount } from '../src/bank/provider';
import { simplefin } from '../src/bank/simplefin';
import { bankConnections, transactions } from '../src/db/schema';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const { bank, db } = testApp();
const today = todayIn('Asia/Kathmandu');
/** Midday Kathmandu time on `date`, in seconds. */
const at = (date: string) => Date.parse(`${date}T06:15:00Z`) / 1000;

let n = 0;
function bankAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: `acct-${++n}`,
    name: 'Everyday Checking',
    institution: 'First Bank',
    currency: 'NPR',
    balance: '25000.00',
    balanceAt: at(today),
    transactions: [],
    ...overrides,
  };
}

async function connect(f: Fixture, accounts: ProviderAccount[]) {
  const token = `good-token-${++n}`;
  bank.banks.set(`cred-${token}`, accounts);
  const res = await f.client.post(`${f.base}/bank/connections`, {
    provider: 'simplefin',
    setupToken: token,
  });
  expect(res.status).toBe(201);
  return { token, sync: res.body, connection: res.body.connections.at(-1) };
}

/** Lets "Sync now" run again straight away. */
async function allowSync(connectionId: string) {
  await db
    .update(bankConnections)
    .set({ lastSyncedAt: sql`now() - interval '1 hour'` })
    .where(eq(bankConnections.id, connectionId));
}

describe('bank sync', () => {
  it('connects, lists the bank’s accounts, and brings in transactions once linked', async () => {
    const f = await setupWorkspace();
    const checking = bankAccount({
      transactions: [
        {
          id: 't1',
          postedAt: at(addDays(today, -2)),
          amount: '-1250.00',
          description: 'POS BHAT BHATENI',
          payee: 'Bhat-Bhateni',
        },
        {
          id: 't2',
          postedAt: at(addDays(today, -1)),
          amount: '50000',
          description: 'SALARY SEP',
          payee: null,
        },
        // Before the chosen start: left out.
        {
          id: 't0',
          postedAt: at(addDays(today, -60)),
          amount: '-10',
          description: 'Old',
          payee: null,
        },
      ],
    });
    const { sync, connection } = await connect(f, [
      checking,
      bankAccount({ name: 'Dollar card', currency: 'USD', balance: '-12.50' }),
    ]);
    expect(sync.providers).toEqual([expect.objectContaining({ id: 'simplefin' })]);
    expect(connection).toMatchObject({ label: 'First Bank', status: 'ok' });
    expect(connection.accounts.map((a: { name: string; accountId: null }) => a.name)).toEqual([
      'Dollar card',
      'Everyday Checking',
    ]);
    const link = connection.accounts.find((a: { name: string }) => a.name === 'Everyday Checking');
    expect(link).toMatchObject({
      accountId: null,
      currency: 'NPR',
      balanceMinor: 2_500_000,
      syncFrom: addDays(today, -30),
    });

    // Currencies must match.
    const usd = connection.accounts.find((a: { name: string }) => a.name === 'Dollar card');
    const wrong = await f.client.patch(`${f.base}/bank/accounts/${usd.id}`, {
      accountId: f.accounts.Bank,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('currency_mismatch');

    await f.client.patch(`${f.base}/bank/accounts/${link.id}`, { accountId: f.accounts.Bank });
    // Linking the same account twice would double everything.
    const twice = await f.client.patch(`${f.base}/bank/accounts/${usd.id}`, {
      accountId: f.accounts['USD Card'],
    });
    expect(twice.status).toBe(200);
    const clash = await f.client.patch(`${f.base}/bank/accounts/${usd.id}`, {
      accountId: f.accounts.Bank,
    });
    expect(clash.status).toBe(400); // currency first

    await allowSync(connection.id);
    const result = await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`);
    expect(result.body).toEqual({ created: 2, matched: 0, errors: [] });
    const list = await f.client.get(`${f.base}/transactions?accountIds=${f.accounts.Bank}`);
    expect(
      list.body.items.map((t: { payeeName: string; amountMinor: number }) => [
        t.payeeName,
        t.amountMinor,
      ]),
    ).toEqual([
      ['Salary SEP', 5_000_000],
      ['Bhat-Bhateni', -125_000],
    ]);
    expect(list.body.items[0]).toMatchObject({ needsReview: true, createdBy: null });

    // Soon again: refused; later: nothing new, nothing doubled.
    const soon = await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`);
    expect(soon.status).toBe(429);
    await allowSync(connection.id);
    const again = await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`);
    expect(again.body).toEqual({ created: 0, matched: 0, errors: [] });
  });

  it('matches what you entered by hand, and doesn’t bring back what you deleted', async () => {
    const f = await setupWorkspace();
    const date = addDays(today, -1);
    const mine = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Bank,
      date,
      amountMinor: -80_000,
      payee: 'NEA',
    });
    const checking = bankAccount({
      transactions: [
        { id: 'nea', postedAt: at(date), amount: '-800.00', description: 'NEA BILL', payee: null },
        { id: 'tea', postedAt: at(date), amount: '-60.00', description: 'TEA', payee: null },
      ],
    });
    const { connection } = await connect(f, [checking]);
    await f.client.patch(`${f.base}/bank/accounts/${connection.accounts[0].id}`, {
      accountId: f.accounts.Bank,
    });
    await allowSync(connection.id);
    const first = await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`);
    expect(first.body).toEqual({ created: 1, matched: 1, errors: [] });
    const [matched] = await db.select().from(transactions).where(eq(transactions.id, mine.body.id));
    expect(matched!.externalId).toBe('bank:nea');

    const tea = (
      await f.client.get(`${f.base}/transactions?accountIds=${f.accounts.Bank}`)
    ).body.items.find((t: { amountMinor: number }) => t.amountMinor === -6_000);
    await f.client.delete(`${f.base}/transactions/${tea.id}`);
    await allowSync(connection.id);
    const second = await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`);
    expect(second.body).toEqual({ created: 0, matched: 0, errors: [] });
  });

  it('shows provider problems, new accounts, and disconnects without losing anything', async () => {
    const f = await setupWorkspace();
    const bad = await f.client.post(`${f.base}/bank/connections`, {
      provider: 'simplefin',
      setupToken: 'not-a-good-token',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Bad setup token');

    const checking = bankAccount({
      transactions: [
        { id: 'x1', postedAt: at(today), amount: '-99', description: 'SHOP', payee: null },
      ],
    });
    const { token, connection } = await connect(f, [checking]);
    await f.client.patch(`${f.base}/bank/accounts/${connection.accounts[0].id}`, {
      accountId: f.accounts.Bank,
    });

    bank.failing.set(
      `cred-${token}`,
      new BankProviderError('SimpleFIN no longer accepts this connection', true),
    );
    await allowSync(connection.id);
    const failed = await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`);
    expect(failed.body.errors).toEqual(['SimpleFIN no longer accepts this connection']);
    expect((await f.client.get(`${f.base}/bank`)).body.connections[0]).toMatchObject({
      status: 'error',
      lastError: 'SimpleFIN no longer accepts this connection',
    });

    bank.failing.delete(`cred-${token}`);
    bank.banks.get(`cred-${token}`)!.push(bankAccount({ name: 'Savings' }));
    await allowSync(connection.id);
    expect((await f.client.post(`${f.base}/bank/connections/${connection.id}/sync`)).body).toEqual({
      created: 1,
      matched: 0,
      errors: [],
    });
    const after = (await f.client.get(`${f.base}/bank`)).body.connections[0];
    expect(after.status).toBe('ok');
    expect(after.accounts.map((a: { name: string }) => a.name)).toContain('Savings');

    expect((await f.client.delete(`${f.base}/bank/connections/${connection.id}`)).status).toBe(200);
    const left = await f.client.get(`${f.base}/transactions?accountIds=${f.accounts.Bank}`);
    expect(left.body.items).toHaveLength(1);
  });

  it('is for owners and admins, from the app', async () => {
    const f = await setupWorkspace();
    const editor = await signUp('Ram');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: editor.email,
      role: 'editor',
    });
    await editor.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    const tried = await editor.post(`${f.base}/bank/connections`, {
      provider: 'simplefin',
      setupToken: 'good-token-editor',
    });
    expect(tried.status).toBe(403);
    // Editors can see what's connected (no secrets in it).
    expect((await editor.get(`${f.base}/bank`)).status).toBe(200);
  });
});

describe('SimpleFIN', () => {
  it('claims a setup token and reads accounts with the access address', async () => {
    const requests: Array<{ method?: string; url?: string; auth?: string }> = [];
    let claimed = false;
    const server = createServer((req, res) => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      const { port } = server.address() as AddressInfo;
      if (req.method === 'POST' && req.url === '/claim/abc') {
        if (claimed) return res.writeHead(403).end();
        claimed = true;
        return res.writeHead(200).end(`http://user1:pa%24s@127.0.0.1:${port}/simplefin`);
      }
      if (req.url?.startsWith('/simplefin/accounts')) {
        if (req.headers.authorization !== `Basic ${Buffer.from('user1:pa$s').toString('base64')}`)
          return res.writeHead(403).end();
        return res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            errors: ['Connection to Big Bank may need attention'],
            accounts: [
              {
                org: { domain: 'bigbank.example', name: 'Big Bank' },
                id: 'A1',
                name: 'Checking',
                currency: 'USD',
                balance: '100.23',
                'balance-date': 1790000000,
                transactions: [
                  {
                    id: 'T1',
                    posted: 1789900000,
                    amount: '-33.43',
                    description: 'Coffee',
                    memo: 'Card 1234',
                  },
                  {
                    id: 'T2',
                    posted: 0,
                    amount: '-5.00',
                    description: 'Pending thing',
                    pending: true,
                  },
                ],
              },
            ],
          }),
        );
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const provider = simplefin({ allowPrivate: true });
      const token = Buffer.from(`http://127.0.0.1:${port}/claim/abc`).toString('base64');
      const { credential } = await provider.connect(token);
      await expect(provider.connect(token)).rejects.toThrow(/already used/);

      const { accounts, errors } = await provider.fetchAccounts(credential, 1789000000);
      expect(errors).toEqual(['Connection to Big Bank may need attention']);
      expect(accounts).toEqual([
        {
          id: 'A1',
          name: 'Checking',
          institution: 'Big Bank',
          currency: 'USD',
          balance: '100.23',
          balanceAt: 1790000000,
          transactions: [
            {
              id: 'T1',
              postedAt: 1789900000,
              amount: '-33.43',
              description: 'Coffee · Card 1234',
              payee: null,
            },
          ],
        },
      ]);
      const read = requests.find((r) => r.url?.startsWith('/simplefin/accounts'))!;
      expect(read.url).toBe('/simplefin/accounts?start-date=1789000000');

      const revoked = `http://user1:wrong@127.0.0.1:${port}/simplefin`;
      await expect(provider.fetchAccounts(revoked, 0)).rejects.toMatchObject({ reconnect: true });

      // Without the test-only allowance, a local address is refused.
      await expect(simplefin().connect(token)).rejects.toThrow(/setup token|private network/);
    } finally {
      server.close();
    }
  });
});
