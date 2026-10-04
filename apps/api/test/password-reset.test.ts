import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { Client, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const resetLinkFor = (email: string) => {
  const mail = testApp()
    .outbox.filter((m) => m.to === email && /Reset your/.test(m.subject))
    .at(-1);
  const token = mail && /reset-password\?token=([\w-]+)/.exec(mail.text)?.[1];
  return { mail, token };
};

describe('forgotten passwords', () => {
  it('tells the sign-in page what this server offers', async () => {
    const res = await new Client().get('/api/v1/sign-in-options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ signUp: true, passwordReset: true });
  });

  it('emails a one-time link that sets a new password and signs out everywhere', async () => {
    const person = await signUp('Reset Me');
    const anon = new Client();
    const asked = await anon.post('/api/auth/request-password-reset', { email: person.email });
    expect(asked.status).toBe(200);
    const { mail, token } = resetLinkFor(person.email);
    expect(mail?.text).toContain('http://localhost:5173/reset-password?token=');
    expect(token).toBeTruthy();

    // An unknown address gets the same answer, and no email: it doesn't reveal who has an account.
    const before = testApp().outbox.length;
    const unknown = await anon.post('/api/auth/request-password-reset', {
      email: 'nobody-here@example.com',
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(asked.body);
    expect(testApp().outbox.length).toBe(before);

    const done = await anon.post('/api/auth/reset-password', {
      token,
      newPassword: 'a-brand-new-password',
    });
    expect(done.status).toBe(200);
    // The old session was signed out, the old password no longer works, the new one does.
    expect((await person.get('/api/v1/me')).status).toBe(401);
    const old = await new Client().post('/api/auth/sign-in/email', {
      email: person.email,
      password: 'correct-horse-battery',
    });
    expect(old.status).toBe(401);
    const fresh = new Client();
    const signedIn = await fresh.post('/api/auth/sign-in/email', {
      email: person.email,
      password: 'a-brand-new-password',
    });
    expect(signedIn.status).toBe(200);

    // The link works once.
    const again = await anon.post('/api/auth/reset-password', {
      token,
      newPassword: 'yet-another-password',
    });
    expect(again.status).toBe(400);
  });

  it('refuses an expired link and a short password', async () => {
    const person = await signUp('Slow Resetter');
    const anon = new Client();
    await anon.post('/api/auth/request-password-reset', { email: person.email });
    const { token } = resetLinkFor(person.email);

    const short = await anon.post('/api/auth/reset-password', { token, newPassword: 'short' });
    expect(short.status).toBe(400);

    await testApp().db.execute(
      sql`update verification set expires_at = now() - interval '1 minute'
          where identifier = ${`reset-password:${token}`}`,
    );
    const late = await anon.post('/api/auth/reset-password', {
      token,
      newPassword: 'a-brand-new-password',
    });
    expect(late.status).toBe(400);
  });

  it('can be reset by the server owner from the command line', async () => {
    const person = await signUp('Locked Out');
    const run = promisify(execFile);
    const { stdout } = await run('npx', ['tsx', 'src/reset-password-cli.ts', person.email], {
      env: { ...process.env, DATABASE_URL: inject('databaseUrl') },
    });
    const password = /: (\w{16})$/m.exec(stdout)?.[1];
    expect(password).toBeTruthy();
    expect((await person.get('/api/v1/me')).status).toBe(401);
    const signedIn = await new Client().post('/api/auth/sign-in/email', {
      email: person.email,
      password,
    });
    expect(signedIn.status).toBe(200);

    await expect(
      run('npx', ['tsx', 'src/reset-password-cli.ts', 'nobody-at-all@example.com'], {
        env: { ...process.env, DATABASE_URL: inject('databaseUrl') },
      }),
    ).rejects.toMatchObject({ code: 1 });
  }, 30_000);
});
