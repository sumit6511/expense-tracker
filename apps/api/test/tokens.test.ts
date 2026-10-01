import { todayIn } from '@et/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { apiTokens } from '../src/db/schema';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

/** A script using a token: no cookies, no Origin header. */
async function withToken(token: string, method: string, path: string, body?: unknown) {
  const res = await testApp().app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function makeToken(
  f: Pick<Fixture, 'client' | 'base'>,
  scope: 'read' | 'write' = 'write',
  name = 'Script',
) {
  const res = await f.client.post(`${f.base}/tokens`, { name, scope, expiresInDays: 90 });
  expect(res.status).toBe(201);
  return res.body as { id: string; token: string; hint: string };
}

async function join(f: Fixture, role: 'admin' | 'editor' | 'viewer') {
  const person = await signUp('Sita');
  const invite = await f.client.post(`${f.base}/invitations`, { email: person.email, role });
  const token = invite.body.link.split('/invite/')[1];
  expect((await person.post(`/api/v1/invitations/${token}/accept`)).status).toBe(200);
  return person;
}

const expense = (f: Fixture) => ({
  accountId: f.accounts.Cash,
  date: todayIn('Asia/Kathmandu'),
  amountMinor: -25_000,
  payee: 'Bhat Bhateni',
});

describe('personal access tokens', () => {
  it('shows a token once, then lets a script read and write its workspace', async () => {
    const f = await setupWorkspace();
    const created = await makeToken(f);
    expect(created.token).toMatch(/^et_[\w-]{43}$/);
    expect(created.hint).toBe(created.token.slice(0, 9));

    const list = await f.client.get(`${f.base}/tokens`);
    expect(list.body).toEqual([
      expect.objectContaining({ id: created.id, name: 'Script', scope: 'write', mine: true }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(created.token);

    const me = await withToken(created.token, 'GET', '/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.defaultWorkspaceId).toBe(f.ws.id);

    // No Origin header needed: tokens can't be forged by another site.
    const tx = await withToken(created.token, 'POST', `${f.base}/transactions`, expense(f));
    expect(tx.status).toBe(201);
    expect(tx.body.createdBy).toBe(f.client.userId);
    const read = await withToken(created.token, 'GET', `${f.base}/transactions`);
    expect(read.body.items.map((t: { id: string }) => t.id)).toContain(tx.body.id);
    expect(read.headers.get('ratelimit-limit')).toBeNull(); // limits are off in tests

    const [row] = await testApp().db.select().from(apiTokens).where(eq(apiTokens.id, created.id));
    expect(row!.lastUsedAt).not.toBeNull();
    expect(row!.tokenHash).not.toContain(created.token);
  });

  it('keeps a token to its own workspace and away from settings, members and tokens', async () => {
    const f = await setupWorkspace();
    const other = await f.client.post('/api/v1/workspaces', {
      name: 'Office',
      baseCurrency: 'USD',
      calendar: 'ad',
    });
    const { token } = await makeToken(f);

    const workspaces = await withToken(token, 'GET', '/api/v1/workspaces');
    expect(workspaces.body.map((w: { id: string }) => w.id)).toEqual([f.ws.id]);
    expect(
      (await withToken(token, 'GET', `/api/v1/workspaces/${other.body.id}/accounts`)).status,
    ).toBe(404);

    const blocked: Array<[string, string, unknown?]> = [
      ['PATCH', '/api/v1/me', { name: 'Hacker' }],
      ['POST', '/api/v1/workspaces', { name: 'X', baseCurrency: 'NPR', calendar: 'bs' }],
      ['PATCH', f.base, { name: 'Renamed' }],
      ['DELETE', f.base],
      ['GET', `${f.base}/tokens`],
      ['POST', `${f.base}/tokens`, { name: 'More', scope: 'write', expiresInDays: null }],
      ['POST', `${f.base}/invitations`, { email: 'x@example.com', role: 'admin' }],
      ['PATCH', `${f.base}/members/${f.client.userId}`, { role: 'viewer' }],
      ['POST', `${f.base}/transfer-ownership`, { userId: f.client.userId }],
      ['GET', '/api/v1/me/push'],
    ];
    for (const [method, path, body] of blocked) {
      const res = await withToken(token, method, path, body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    // Reading who's in the workspace is fine.
    expect((await withToken(token, 'GET', `${f.base}/members`)).status).toBe(200);
  });

  it('read tokens only read', async () => {
    const f = await setupWorkspace();
    const { token } = await makeToken(f, 'read');
    expect((await withToken(token, 'GET', `${f.base}/reports/dashboard`)).status).toBe(200);
    const write = await withToken(token, 'POST', `${f.base}/transactions`, expense(f));
    expect(write.status).toBe(403);
    expect(write.body.error.message).toBe('This access token can only read');
  });

  it('rejects unknown, revoked and expired tokens, never falling back to cookies', async () => {
    const f = await setupWorkspace();
    const created = await makeToken(f);

    const bad = await f.client.request('GET', `${f.base}/accounts`, undefined, {
      authorization: 'Bearer et_not-a-real-token',
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('invalid_token');
    expect(bad.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expect((await withToken('', 'GET', `${f.base}/accounts`)).status).toBe(401);

    await testApp()
      .db.update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, created.id));
    expect((await withToken(created.token, 'GET', `${f.base}/accounts`)).status).toBe(401);

    const second = await makeToken(f);
    expect((await f.client.delete(`${f.base}/tokens/${second.id}`)).status).toBe(204);
    expect((await withToken(second.token, 'GET', `${f.base}/accounts`)).status).toBe(401);
  });

  it('never does more than its person may, and goes when they leave', async () => {
    const f = await setupWorkspace();
    const sita = await join(f, 'editor');
    const sitaToken = await makeToken({ client: sita, base: f.base }, 'write', 'Sita’s sheet');
    const mine = await makeToken(f);

    // Owners and admins see (and can revoke) everyone's tokens; editors only their own.
    const ownerList = await f.client.get(`${f.base}/tokens`);
    expect(ownerList.body.map((t: { name: string; mine: boolean }) => [t.name, t.mine])).toEqual([
      ['Script', true],
      ['Sita’s sheet', false],
    ]);
    const sitaList = await sita.get(`${f.base}/tokens`);
    expect(sitaList.body.map((t: { name: string }) => t.name)).toEqual(['Sita’s sheet']);
    expect((await sita.delete(`${f.base}/tokens/${mine.id}`)).status).toBe(404);

    // Made a viewer: the write token can only read now.
    await f.client.patch(`${f.base}/members/${sita.userId}`, { role: 'viewer' });
    const write = await withToken(sitaToken.token, 'POST', `${f.base}/transactions`, expense(f));
    expect(write.status).toBe(403);
    expect((await withToken(sitaToken.token, 'GET', `${f.base}/accounts`)).status).toBe(200);
    // Viewers can still make read tokens, but not write ones.
    const viewerWrite = await sita.post(`${f.base}/tokens`, {
      name: 'More',
      scope: 'write',
      expiresInDays: 30,
    });
    expect(viewerWrite.status).toBe(403);
    expect(
      (await sita.post(`${f.base}/tokens`, { name: 'Read', scope: 'read', expiresInDays: 30 }))
        .status,
    ).toBe(201);

    // Removed from the workspace: their tokens are gone.
    expect((await f.client.delete(`${f.base}/members/${sita.userId}`)).status).toBe(204);
    expect((await withToken(sitaToken.token, 'GET', `${f.base}/accounts`)).status).toBe(401);
    const left = await testApp()
      .db.select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, sita.userId));
    expect(left).toEqual([]);
  });

  it('documents token sign-in in the OpenAPI description', async () => {
    const doc = await testApp().app.request('/api/v1/openapi.json');
    const body = (await doc.json()) as {
      components: { securitySchemes: Record<string, unknown> };
      security: unknown;
    };
    expect(body.components.securitySchemes.accessToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(body.security).toEqual([{ accessToken: [] }, { session: [] }]);
  });
});
