import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEnv } from './env';
import { startJobs } from './jobs';
import { createLogger } from './logger';
import { createMailer } from './mailer';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const { db, pool } = createDb(env.DATABASE_URL);

await runMigrations(db);
const auth = createAuth(db, env);
const mailer = createMailer(env, logger);
const app = createApp({ db, env, auth, logger, mailer });
const boss = env.RUN_WORKER ? await startJobs(db, env, logger, mailer) : null;

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info(`API listening on http://${info.address}:${info.port}`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  server.close();
  await boss?.stop({ graceful: true, timeout: 10_000 });
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
