import { afterAll, describe, expect, it } from 'vitest';
import { workspaceMembers } from '../src/db/schema';
import { Client, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

describe('authentication and tenancy', () => {
  it('requires a session', async () => {
    const anon = new Client();
    expect((await anon.get('/api/v1/me')).status).toBe(401);
    expect(
      (await anon.get('/api/v1/workspaces/01a0f120-1093-7a79-90da-882756aa3c18/accounts')).status,
    ).toBe(401);
  });

  it('signs up and signs in', async () => {
    const user = await signUp('Asha');
    const me = await user.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({
      name: 'Asha',
      numberGrouping: 'lakh',
      tourCompleted: false,
    });
    expect(me.body.workspaces).toEqual([]);
    // The getting-started tour shows until it is finished or skipped, and can be shown again.
    const done = await user.patch('/api/v1/me', { tourCompleted: true });
    expect(done.body.user.tourCompleted).toBe(true);
    expect((await user.get('/api/v1/me')).body.user.tourCompleted).toBe(true);
    const again1 = await user.patch('/api/v1/me', { tourCompleted: false });
    expect(again1.body.user.tourCompleted).toBe(false);

    const again = new Client();
    const bad = await again.post('/api/auth/sign-in/email', {
      email: user.email,
      password: 'wrong-password',
    });
    expect(bad.status).toBe(401);
    const good = await again.post('/api/auth/sign-in/email', {
      email: user.email,
      password: 'correct-horse-battery',
    });
    expect(good.status).toBe(200);
    expect((await again.get('/api/v1/me')).status).toBe(200);
  });

  it("hides other people's workspaces", async () => {
    const a = await setupWorkspace();
    const b = await signUp();
    const res = await b.get(`${a.base}/accounts`);
    expect(res.status).toBe(404);
    const write = await b.post(`${a.base}/transactions`, {
      accountId: a.accounts.Cash,
      date: '2026-09-30',
      amountMinor: -100,
    });
    expect(write.status).toBe(404);
  });

  it('lets viewers read but not write', async () => {
    const a = await setupWorkspace();
    const viewer = await signUp();
    await testApp()
      .db.insert(workspaceMembers)
      .values({ workspaceId: a.ws.id, userId: viewer.userId, role: 'viewer' });
    expect((await viewer.get(`${a.base}/accounts`)).status).toBe(200);
    const res = await viewer.post(`${a.base}/accounts`, {
      name: 'Nope',
      type: 'cash',
      currency: 'NPR',
    });
    expect(res.status).toBe(403);
  });

  it('rejects cross-site writes (origin check)', async () => {
    const a = await setupWorkspace();
    const body = { name: 'X', type: 'cash', currency: 'NPR' };
    const foreign = await a.client.request('POST', `${a.base}/accounts`, body, {
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);
    const ok = await a.client.post(`${a.base}/accounts`, body);
    expect(ok.status).toBe(201);
  });

  it('validates input with a consistent error shape', async () => {
    const a = await setupWorkspace();
    const res = await a.client.post(`${a.base}/accounts`, {
      name: '',
      type: 'nope',
      currency: 'ZZZ',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['name', 'type', 'currency']),
    );
  });

  it('serves the OpenAPI document', async () => {
    const res = await new Client().get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/workspaces/{wid}/transactions');
  });
});

describe('workspaces and preferences', () => {
  it('creates a workspace with starter data and makes it the default', async () => {
    const a = await setupWorkspace();
    const me = await a.client.get('/api/v1/me');
    expect(me.body.defaultWorkspaceId).toBe(a.ws.id);
    expect(a.ws).toMatchObject({
      baseCurrency: 'NPR',
      calendar: 'bs',
      timezone: 'Asia/Kathmandu',
      role: 'owner',
    });
    expect(Object.keys(a.categories)).toEqual(
      expect.arrayContaining(['Festivals & Gifts', 'Remittance', 'Salary']),
    );
    expect(Object.keys(a.accounts)).toEqual(['Cash', 'Bank', 'USD Card', 'INR Wallet']);
  });

  it('updates preferences and settings', async () => {
    const a = await setupWorkspace();
    const me = await a.client.patch('/api/v1/me', { numberGrouping: 'international' });
    expect(me.body.user.numberGrouping).toBe('international');
    const ws = await a.client.patch(a.base, { calendar: 'ad', monthStartDay: 25 });
    expect(ws.body).toMatchObject({ calendar: 'ad', monthStartDay: 25 });
    const bad = await a.client.patch(a.base, { timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(400);
  });

  it('deletes a workspace with all its data', async () => {
    const a = await setupWorkspace();
    await a.client.post(`${a.base}/transactions`, {
      accountId: a.accounts.Cash,
      date: '2026-09-30',
      amountMinor: -500,
    });
    await a.client.post(`${a.base}/transfers`, {
      fromAccountId: a.accounts.Cash,
      toAccountId: a.accounts.Bank,
      date: '2026-09-30',
      amountMinor: 100,
    });
    expect((await a.client.delete(a.base)).status).toBe(204);
    expect((await a.client.get(`${a.base}/accounts`)).status).toBe(404);
    expect((await a.client.get('/api/v1/me')).body.defaultWorkspaceId).toBeNull();
  });
});
