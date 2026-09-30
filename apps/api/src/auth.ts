import { passkey as passkeyPlugin } from '@better-auth/passkey';
import { uuidv7 } from '@et/shared';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins/two-factor';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client';
import {
  account,
  passkey,
  session,
  twoFactor,
  user,
  verification,
  workspaceMembers,
  workspaces,
} from './db/schema';
import type { Env } from './env';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function createAuth(db: Db, env: Env) {
  const secure = env.PUBLIC_URL.startsWith('https://');
  const origins = [env.PUBLIC_URL, ...env.TRUSTED_ORIGINS];
  return betterAuth({
    appName: 'Expense Tracker',
    baseURL: env.PUBLIC_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: origins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, twoFactor, passkey },
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
    user: {
      deleteUser: {
        enabled: true,
        // Workspaces nobody else belongs to would be orphaned: delete them with the user.
        beforeDelete: async (deleted) => {
          await db.execute(sql`
            delete from ${workspaces} w
            where w.id in (select workspace_id from ${workspaceMembers} where user_id = ${deleted.id})
              and (select count(*) from ${workspaceMembers} m where m.workspace_id = w.id) = 1
          `);
        },
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test' && env.AUTH_RATE_LIMIT,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/two-factor/*': { window: 60, max: 10 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: 'et',
      useSecureCookies: secure,
      database: { generateId: () => uuidv7() },
    },
    telemetry: { enabled: false },
    plugins: [
      // Codes from an authenticator app, plus one-time backup codes, after the password.
      twoFactorPlugin({
        issuer: 'Expense Tracker',
        backupCodeOptions: { amount: 10, length: 10 },
      }),
      // Passkeys (Face ID, fingerprint, security keys) sign in on their own.
      passkeyPlugin({
        rpID: new URL(env.PUBLIC_URL).hostname,
        rpName: 'Expense Tracker',
        origin: origins,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
