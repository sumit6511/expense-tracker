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
import { CLIENT_IP_HEADER } from './lib/client-ip';
import type { Mailer } from './mailer';
import { deletePrivateAccountsOf, handOverOwnedWorkspaces } from './services/members';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (password: string) => hash(password, ARGON2_OPTIONS);

/** How long a "reset your password" link works. */
export const RESET_LINK_MINUTES = 60;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/** The email with a link to choose a new password. */
function resetPasswordMail(env: Env, user: { email: string; name: string }, token: string) {
  const link = `${env.PUBLIC_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const first = user.name.split(' ')[0] || user.name;
  return {
    to: user.email,
    subject: 'Reset your Expense Tracker password',
    text: [
      `Hi ${first},`,
      '',
      'Someone (hopefully you) asked to reset the password for your Expense Tracker account.',
      `Choose a new password here: ${link}`,
      '',
      `The link works for ${RESET_LINK_MINUTES} minutes and only once. If you didn’t ask for this, ignore this email; your password stays the same.`,
    ].join('\n'),
    html: [
      `<p>Hi ${escapeHtml(first)},</p>`,
      '<p>Someone (hopefully you) asked to reset the password for your Expense Tracker account.</p>',
      `<p><a href="${escapeHtml(link)}"><strong>Choose a new password</strong></a></p>`,
      `<p style="color:#6b7280;font-size:12px">The link works for ${RESET_LINK_MINUTES} minutes and only once. If you didn’t ask for this, ignore this email; your password stays the same.</p>`,
    ].join('\n'),
  };
}

export function createAuth(db: Db, env: Env, mailer: Mailer | null = null) {
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
        hash: hashPassword,
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
      // "Forgot password?" needs a way to send the link; without SMTP the server owner resets
      // passwords from the command line (src/reset-password-cli.ts).
      ...(mailer
        ? {
            sendResetPassword: async ({ user: u, token }) => {
              await mailer.send(resetPasswordMail(env, u, token));
            },
          }
        : {}),
      resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
      // A new password signs out every device, in case the old one was stolen.
      revokeSessionsOnPasswordReset: true,
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
          // Their private accounts go; shared workspaces get a new owner; ones nobody else
          // uses are deleted.
          await deletePrivateAccountsOf(db, deleted.id);
          await handOverOwnedWorkspaces(db, deleted.id);
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
        '/request-password-reset': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 10 },
        '/two-factor/*': { window: 60, max: 10 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
      },
    },
    advanced: {
      // The app works out the client's address (honouring only trusted proxies) and passes it
      // in this header; see lib/client-ip.ts.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
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
