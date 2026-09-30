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
