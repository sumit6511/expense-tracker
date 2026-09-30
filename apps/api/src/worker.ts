import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEnv } from './env';
import { startJobs } from './jobs';
import { createLogger } from './logger';
import { createMailer } from './mailer';
import { createPusher } from './push';

/** Standalone background worker, for deployments that run jobs outside the API process. */
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const { db, pool } = createDb(env.DATABASE_URL, 4);
await runMigrations(db);
const boss = await startJobs(
  db,
  env,
  logger,
  createMailer(env, logger),
  await createPusher(db, env, logger),
);
logger.info('worker started');

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
