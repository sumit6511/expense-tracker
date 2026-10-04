import type { CreateWorkspaceInput, Workspace } from '@et/shared';
import { inject } from 'vitest';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createDb } from '../src/db/client';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import type { Mail, Mailer } from '../src/mailer';
import type { Pusher, PushMessage, PushTarget } from '../src/push';
import { FakeAi } from './fake-ai';
import { FakeBank } from './fake-bank';
import { FakeReceiver } from './fake-receiver';

export const ORIGIN = 'http://localhost:5173';
export const EMAIL_IN_SECRET = 'test-email-in-secret-0123456789';

let shared: ReturnType<typeof build> | null = null;

function build() {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    PUBLIC_URL: ORIGIN,
    AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    RUN_WORKER: 'false',
    FX_NRB_ENABLED: 'false',
    EMAIL_IN_ADDRESS: 'money+{token}@example.com',
    EMAIL_IN_SECRET: EMAIL_IN_SECRET,
  });
  const logger = createLogger(env.LOG_LEVEL, false);
  const { db, pool } = createDb(env.DATABASE_URL, 5);
  // Keeps sent email in memory so tests can read it.
  const outbox: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      outbox.push(mail);
    },
  };
  const auth = createAuth(db, env, mailer);
  // Records pushes instead of sending them; endpoints containing "gone" act unsubscribed.
  const pushed: Array<{ target: PushTarget; message: PushMessage }> = [];
  const pusher: Pusher = {
    publicKey: 'BTestPublicKey',
    async send(target, message) {
      if (target.endpoint.includes('gone')) return 'gone';
      pushed.push({ target, message });
      return 'sent';
    },
  };
  const ai = new FakeAi();
  const receiver = new FakeReceiver();
  const bank = new FakeBank();
  const app = createApp({
    db,
    env,
    auth,
    logger,
    mailer,
    pusher,
    ai,
    webhookSender: receiver.send,
    bank: { simplefin: bank },
  });
  return { app, db, pool, env, logger, mailer, outbox, pusher, pushed, ai, receiver, bank };
}

/** One app + pool per test file. */
export function testApp() {
  shared ??= build();
  return shared;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** A signed-in API client backed by the in-process app (no network). */
export class Client {
  cookie = '';
  constructor(readonly app = testApp().app) {}

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const init: RequestInit = {
      method,
      headers: {
        origin: ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const res = await this.app.request(path, init);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const pair = c.split(';')[0]!;
      const [name] = pair.split('=');
      const others = this.cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`));
      this.cookie = [...others, pair].join('; ');
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (CSV etc.)
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }
  patch<T = any>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  put<T = any>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  delete<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

let counter = 0;

export async function signUp(
  name = 'Test User',
): Promise<Client & { userId: string; email: string }> {
  const client = new Client();
  const email = `user${Date.now()}_${counter++}@example.com`;
  const res = await client.post<{ user: { id: string } }>('/api/auth/sign-up/email', {
    name,
    email,
    password: 'correct-horse-battery',
  });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return Object.assign(client, { userId: res.body.user.id, email });
}

export interface Fixture {
  client: Client & { userId: string; email: string };
  ws: Workspace;
  base: string;
  accounts: Record<string, string>;
  categories: Record<string, string>;
}

/** A user with a workspace, starter categories and a few accounts. */
export async function setupWorkspace(
  overrides: Partial<CreateWorkspaceInput> = {},
): Promise<Fixture> {
  const client = await signUp();
  const res = await client.post<Workspace>('/api/v1/workspaces', {
    name: 'Home',
    baseCurrency: 'NPR',
    calendar: 'bs',
    accounts: [
      { name: 'Cash', type: 'cash', currency: 'NPR', openingBalanceMinor: 1_000_000 },
      { name: 'Bank', type: 'checking', currency: 'NPR', openingBalanceMinor: 0 },
      { name: 'USD Card', type: 'credit_card', currency: 'USD' },
      { name: 'INR Wallet', type: 'e_wallet', currency: 'INR' },
    ],
    ...overrides,
  });
  if (res.status !== 201)
    throw new Error(`workspace failed: ${res.status} ${JSON.stringify(res.body)}`);
  const ws = res.body;
  const base = `/api/v1/workspaces/${ws.id}`;
  const accounts = Object.fromEntries(
    ((await client.get<Array<{ id: string; name: string }>>(`${base}/accounts`)).body ?? []).map(
      (a) => [a.name, a.id],
    ),
  );
  const groups = (
    await client.get<Array<{ categories: Array<{ id: string; name: string }> }>>(
      `${base}/categories`,
    )
  ).body;
  const categories = Object.fromEntries(
    groups.flatMap((g) => g.categories.map((c) => [c.name, c.id])),
  );
  return { client, ws, base, accounts, categories };
}
