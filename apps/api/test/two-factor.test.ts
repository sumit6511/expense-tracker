import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Client, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const PASSWORD = 'correct-horse-battery';

function base32Decode(input: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code an authenticator app would show for this otpauth:// URI right now. */
function totp(uri: string, at = Date.now()) {
  const secret = new URL(uri).searchParams.get('secret')!;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

async function withTwoFactor() {
  const client = await signUp();
  const enabled = await client.post<{ totpURI: string; backupCodes: string[] }>(
    '/api/auth/two-factor/enable',
    { password: PASSWORD },
  );
  expect(enabled.status).toBe(200);
  expect(enabled.body.totpURI).toMatch(/^otpauth:\/\/totp\/Expense%20Tracker:/);
  expect(enabled.body.backupCodes).toHaveLength(10);
  // Not on until a code from the app has been checked.
  expect((await client.get('/api/v1/me')).body.user.twoFactorEnabled).toBe(false);
  const verified = await client.post('/api/auth/two-factor/verify-totp', {
    code: totp(enabled.body.totpURI),
  });
  expect(verified.status).toBe(200);
  expect((await client.get('/api/v1/me')).body.user.twoFactorEnabled).toBe(true);
  return { client, ...enabled.body };
}

async function signInWithPassword(email: string) {
  const client = new Client();
  const res = await client.post('/api/auth/sign-in/email', { email, password: PASSWORD });
  return { client, res };
}

describe('two-step sign-in', () => {
  it('asks for a code from the authenticator app after the password', async () => {
    const { client, totpURI } = await withTwoFactor();
    const { email } = client;

    const { client: fresh, res } = await signInWithPassword(email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ twoFactorRedirect: true });
    // The password alone doesn't sign in.
    expect((await fresh.get('/api/v1/me')).status).toBe(401);

    const wrong = await fresh.post('/api/auth/two-factor/verify-totp', { code: '000000' });
    expect(wrong.status).toBe(401);
    expect((await fresh.get('/api/v1/me')).status).toBe(401);

    const ok = await fresh.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) });
    expect(ok.status).toBe(200);
    const me = await fresh.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('accepts each backup code once', async () => {
    const { client, backupCodes } = await withTwoFactor();
    const { email } = client;

    const first = await signInWithPassword(email);
    const used = await first.client.post('/api/auth/two-factor/verify-backup-code', {
      code: backupCodes[0],
    });
    expect(used.status).toBe(200);
    expect((await first.client.get('/api/v1/me')).status).toBe(200);

    const second = await signInWithPassword(email);
    const again = await second.client.post('/api/auth/two-factor/verify-backup-code', {
      code: backupCodes[0],
    });
    expect(again.status).toBe(401);
    expect((await second.client.get('/api/v1/me')).status).toBe(401);
  });

  it('can be turned off with the password', async () => {
    const { client } = await withTwoFactor();
    const { email } = client;
    const wrong = await client.post('/api/auth/two-factor/disable', {
      password: 'not-my-password',
    });
    expect(wrong.status).toBe(400);
    const off = await client.post('/api/auth/two-factor/disable', { password: PASSWORD });
    expect(off.status).toBe(200);
    expect((await client.get('/api/v1/me')).body.user.twoFactorEnabled).toBe(false);

    const { client: fresh, res } = await signInWithPassword(email);
    expect(res.body.twoFactorRedirect).toBeUndefined();
    expect((await fresh.get('/api/v1/me')).status).toBe(200);
  });
});

describe('passkeys', () => {
  it('offers registration options to a signed-in user and lists none yet', async () => {
    const client = await signUp();
    const options = await client.get('/api/auth/passkey/generate-register-options');
    expect(options.status).toBe(200);
    expect(options.body).toMatchObject({
      rp: { name: 'Expense Tracker', id: 'localhost' },
      user: { name: expect.any(String) },
    });
    expect(typeof options.body.challenge).toBe('string');
    expect((await client.get('/api/auth/passkey/list-user-passkeys')).body).toEqual([]);

    const anonymous = new Client();
    expect((await anonymous.get('/api/auth/passkey/generate-register-options')).status).toBe(401);
    // Anyone may start a passkey sign-in.
    const auth = await anonymous.get('/api/auth/passkey/generate-authenticate-options');
    expect(auth.status).toBe(200);
    expect(auth.body.rpId).toBe('localhost');
  });
});
