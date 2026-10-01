import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  /** Public origin of the app, e.g. https://money.example.com. Used for auth cookies and CSRF checks. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** Extra origins allowed to call the API (comma separated), e.g. the Vite dev server. */
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Directory with the built web app to serve (production). */
  WEB_DIST_DIR: z.string().optional(),
  /** Run background jobs inside the API process instead of a separate worker. */
  RUN_WORKER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Fetch exchange rates from Nepal Rastra Bank. Disable where outbound access is blocked. */
  FX_NRB_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Rate-limit sign-in and sign-up attempts. Only disable for automated end-to-end tests. */
  AUTH_RATE_LIMIT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** SMTP server for email notifications, e.g. smtp://user:pass@smtp.example.com:587. */
  SMTP_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  /** Sender address for email, e.g. "Expense Tracker <money@example.com>". */
  MAIL_FROM: z.string().default('Expense Tracker <no-reply@localhost>'),
  /** Web Push notifications to browsers and installed apps. */
  WEB_PUSH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * VAPID keys identify this server to push services. Leave empty to have the server make a pair
   * on first start and keep it in the database (changing keys means devices must re-subscribe).
   */
  VAPID_PUBLIC_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Contact for push services: a mailto: or https: URL (defaults from MAIL_FROM or PUBLIC_URL). */
  VAPID_SUBJECT: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Push services besides the major browsers' ones to allow (comma separated host names). */
  PUSH_EXTRA_HOSTS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  /**
   * Claude API key for the optional AI helpers (receipt scan, quick add fallback, category
   * suggestions, questions, PDF statements). Without it the helpers are unavailable; with it,
   * each workspace still has to turn them on.
   */
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Which Claude model the helpers use. */
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** AI requests allowed per workspace per day. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(200),
  /**
   * Key for secrets the server must read back (webhook signing secrets, bank connections). Defaults
   * to one derived from AUTH_SECRET; set it to change AUTH_SECRET without losing those.
   */
  ENCRYPTION_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
  /**
   * Let webhooks reach private network addresses (e.g. Home Assistant on 192.168.x.x). Off by
   * default so the server can't be used to probe its own network.
   */
  WEBHOOK_ALLOW_PRIVATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Allow new sign-ups. Set to false on a personal server once your account exists. */
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
