import { uuidv7 } from '@et/shared';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from './db/client';
import { account, session, user, verification } from './db/schema';
import type { Env } from './env';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function createAuth(db: Db, env: Env) {
  const secure = env.PUBLIC_URL.startsWith('https://');
  return betterAuth({
    appName: 'Expense Tracker',
    baseURL: env.PUBLIC_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_URL, ...env.TRUSTED_ORIGINS],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      disableSignUp: !env.ALLOW_SIGNUP,
      password: {
        hash: (password) => hash(password, ARGON2_OPTIONS),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh expiry at most once a day
    },
    user: { deleteUser: { enabled: true } },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'et',
      useSecureCookies: secure,
      database: { generateId: () => uuidv7() },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
