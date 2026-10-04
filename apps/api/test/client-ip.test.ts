import { afterAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createDb } from '../src/db/client';
import { loadEnv } from '../src/env';
import { CLIENT_IP_HEADER, clientIp, trustedProxies } from '../src/lib/client-ip';
import { createLogger } from '../src/logger';
import { ORIGIN, testApp } from './helpers';

const defaults = trustedProxies(['loopback', 'private']);

describe('client address', () => {
  it('uses the connection, not a header the client sent', () => {
    expect(clientIp('203.0.113.9', '1.2.3.4', defaults)).toBe('203.0.113.9');
    expect(clientIp('::ffff:203.0.113.9', undefined, defaults)).toBe('203.0.113.9');
  });

  it('believes X-Forwarded-For from trusted proxies only, right to left', () => {
    // A reverse proxy on the same machine appends the real client to whatever was sent.
    expect(clientIp('127.0.0.1', 'spoofed, 198.51.100.7', defaults)).toBe('198.51.100.7');
    // Two proxies (a tunnel, then a proxy on the Docker network).
    expect(clientIp('172.18.0.3', '198.51.100.7, 10.0.0.2', defaults)).toBe('198.51.100.7');
    // Garbage the client put in front is never reached; garbage last keeps the proxy.
    expect(clientIp('127.0.0.1', 'not-an-ip, 198.51.100.7', defaults)).toBe('198.51.100.7');
    expect(clientIp('127.0.0.1', '198.51.100.7, nonsense', defaults)).toBe('127.0.0.1');
    // Only private hops all the way: the leftmost is the client.
    expect(clientIp('127.0.0.1', '192.168.1.20', defaults)).toBe('192.168.1.20');
  });

  it('can trust nothing, or exactly the proxies given', () => {
    const none = trustedProxies(['none']);
    expect(clientIp('127.0.0.1', '198.51.100.7', none)).toBe('127.0.0.1');
    const cloud = trustedProxies(['203.0.113.0/24', '2001:db8::/32']);
    expect(clientIp('203.0.113.50', '198.51.100.7', cloud)).toBe('198.51.100.7');
    expect(clientIp('2001:db8::5', '198.51.100.7', cloud)).toBe('198.51.100.7');
    expect(clientIp('10.0.0.1', '198.51.100.7', cloud)).toBe('10.0.0.1');
  });

  it('rejects settings it does not understand', () => {
    expect(() => trustedProxies(['10.0.0.0/33'])).toThrow(/TRUST_PROXY/);
    expect(() => trustedProxies(['everyone'])).toThrow(/TRUST_PROXY/);
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://x@y/z', AUTH_SECRET: 'x'.repeat(40), TRUST_PROXY: 'a' }),
    ).toThrow(/TRUST_PROXY/);
  });
});

describe('sign-in rate limit', () => {
  // A separate app with Better Auth's rate limits on (the shared test app turns them off).
  const env = loadEnv({
    NODE_ENV: 'development',
    DATABASE_URL: inject('databaseUrl'),
    PUBLIC_URL: ORIGIN,
    AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
    LOG_LEVEL: 'silent',
    RUN_WORKER: 'false',
    FX_NRB_ENABLED: 'false',
    AUTH_RATE_LIMIT: 'true',
  });
  const { db, pool } = createDb(env.DATABASE_URL, 2);
  const app = createApp({
    db,
    env,
    auth: createAuth(db, env),
    logger: createLogger('silent', false),
    mailer: null,
    pusher: null,
    ai: null,
    webhookSender: testApp().receiver.send,
    bank: {},
  });
  afterAll(async () => {
    await pool.end();
    await testApp().pool.end();
  });

  /** A wrong-password attempt arriving over a connection from `socket`. */
  const attempt = (socket: string, headers: Record<string, string> = {}) =>
    app.request(
      '/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
      },
      { incoming: { socket: { remoteAddress: socket } } },
    );

  it('can’t be dodged with made-up forwarding headers', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await attempt('203.0.113.9', {
        'x-forwarded-for': `10.9.${i}.7`,
        [CLIENT_IP_HEADER]: `10.8.${i}.7`,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('keeps clients behind a trusted proxy apart', async () => {
    for (let i = 0; i < 10; i++) await attempt('127.0.0.1', { 'x-forwarded-for': '198.51.100.1' });
    expect((await attempt('127.0.0.1', { 'x-forwarded-for': '198.51.100.1' })).status).toBe(429);
    // Someone else signing in through the same proxy isn't locked out.
    expect((await attempt('127.0.0.1', { 'x-forwarded-for': '198.51.100.2' })).status).toBe(401);
  });
});
