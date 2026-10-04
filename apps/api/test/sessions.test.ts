import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { pruneExpiredAuthData } from '../src/services/cleanup';
import { Client, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

async function signIn(email: string, userAgent: string) {
  const client = new Client();
  const res = await client.request(
    'POST',
    '/api/auth/sign-in/email',
    { email, password: 'correct-horse-battery' },
    { 'user-agent': userAgent },
  );
  expect(res.status).toBe(200);
  return client;
}

describe('where you’re signed in', () => {
  it('lists your sessions without their tokens and signs other devices out', async () => {
    const me = await signUp('Asha');
    const phone = await signIn(me.email, 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130');
    const laptop = await signIn(me.email, 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/131');

    const list = await laptop.get('/api/v1/me/sessions');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(3);
    expect(list.body[0]).toMatchObject({
      current: true,
      userAgent: expect.stringContaining('Mac'),
    });
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);

    const phoneSession = list.body.find((s: { userAgent: string }) =>
      s.userAgent?.includes('Android'),
    );
    expect((await laptop.delete(`/api/v1/me/sessions/${phoneSession.id}`)).status).toBe(204);
    expect((await phone.get('/api/v1/me')).status).toBe(401);
    // Not this one (that's "Sign out"), and not someone else's.
    expect((await laptop.delete(`/api/v1/me/sessions/${list.body[0].id}`)).status).toBe(400);
    const stranger = await signUp('Stranger');
    const strangerList = await stranger.get('/api/v1/me/sessions');
    expect((await laptop.delete(`/api/v1/me/sessions/${strangerList.body[0].id}`)).status).toBe(
      404,
    );
    expect((await stranger.get('/api/v1/me')).status).toBe(200);

    const others = await laptop.post('/api/v1/me/sessions/sign-out-others');
    expect(others.body).toEqual({ signedOut: 1 });
    expect((await me.get('/api/v1/me')).status).toBe(401);
    expect((await laptop.get('/api/v1/me')).status).toBe(200);
    expect((await laptop.get('/api/v1/me/sessions')).body).toHaveLength(1);
  });
});

describe('dates people enter', () => {
  it('must be between 1900 and 2099', async () => {
    const f = await setupWorkspace();
    for (const date of ['1899-12-31', '2803-01-15', '9999-12-31']) {
      const res = await f.client.post(`${f.base}/transactions`, {
        accountId: f.accounts.Cash,
        date,
        amountMinor: -100,
      });
      expect([date, res.status, res.body.error?.message]).toEqual([
        date,
        400,
        'Date: Use a date between 1900 and 2099',
      ]);
    }
    const bad = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: '2026-02-30',
      amountMinor: -100,
    });
    expect(bad.body.error.message).toBe('Date: Expected a date as YYYY-MM-DD');
    for (const date of ['1900-01-01', '2099-12-31']) {
      const ok = await f.client.post(`${f.base}/transactions`, {
        accountId: f.accounts.Cash,
        date,
        amountMinor: -100,
      });
      expect([date, ok.status]).toEqual([date, 201]);
    }
  });
});

describe('server settings', () => {
  const base = { DATABASE_URL: 'postgres://x@localhost/db', NODE_ENV: 'production' };

  it('refuses the example secret in production', () => {
    for (const secret of [
      'change-me-to-a-long-random-string-at-least-32-chars',
      'a'.repeat(40),
      'abababababababababababababababababababab',
    ]) {
      expect(() => loadEnv({ ...base, AUTH_SECRET: secret })).toThrow(/AUTH_SECRET is the example/);
    }
    expect(() =>
      loadEnv({
        ...base,
        AUTH_SECRET: 'Zq3v9XkP2mL8wR4tY7uB1nC6sD0fG5hJ',
        ENCRYPTION_KEY: 'x'.repeat(40),
      }),
    ).toThrow(/ENCRYPTION_KEY/);
    expect(loadEnv({ ...base, AUTH_SECRET: 'Zq3v9XkP2mL8wR4tY7uB1nC6sD0fG5hJ' }).NODE_ENV).toBe(
      'production',
    );
    // Development keeps working with the example file.
    expect(
      loadEnv({ ...base, NODE_ENV: 'development', AUTH_SECRET: 'change-me-'.repeat(4) }).NODE_ENV,
    ).toBe('development');
  });
});

describe('nightly clean-up', () => {
  it('deletes expired sessions, links, invitations and tokens, and keeps the rest', async () => {
    const f = await setupWorkspace();
    const { db } = testApp();
    const userId = (await f.client.get('/api/v1/me')).body.user.id;
    const old = sql`now() - interval '40 days'`;
    await db.execute(sql`
      insert into session (id, expires_at, token, user_id, created_at, updated_at)
      values ('expired-session-1', now() - interval '1 day', 'expired-token-1', ${userId}, now(), now())`);
    await db.execute(sql`
      insert into verification (id, identifier, value, expires_at, created_at, updated_at)
      values ('expired-verification-1', 'reset-password:old', ${userId}, now() - interval '1 hour', now(), now())`);
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: 'late@example.com',
      role: 'viewer',
    });
    await db.execute(
      sql`update invitations set expires_at = ${old} where id = ${invite.body.invitation.id}`,
    );
    const token = await f.client.post(`${f.base}/tokens`, {
      name: 'Old',
      scope: 'read',
      expiresInDays: 30,
    });
    await db.execute(sql`update api_tokens set expires_at = ${old} where id = ${token.body.id}`);

    const pruned = await pruneExpiredAuthData(db);
    expect(pruned.sessions).toBeGreaterThanOrEqual(1);
    expect(pruned.verifications).toBeGreaterThanOrEqual(1);
    expect(pruned.invitations).toBeGreaterThanOrEqual(1);
    expect(pruned.tokens).toBeGreaterThanOrEqual(1);
    const left = await db.execute<{ n: number }>(sql`
      select (select count(*) from session where id = 'expired-session-1')
           + (select count(*) from verification where id = 'expired-verification-1')
           + (select count(*) from invitations where id = ${invite.body.invitation.id})
           + (select count(*) from api_tokens where id = ${token.body.id}) as n`);
    expect(Number(left.rows[0]!.n)).toBe(0);
    // The person's live session is untouched.
    expect((await f.client.get('/api/v1/me')).status).toBe(200);
  });
});
