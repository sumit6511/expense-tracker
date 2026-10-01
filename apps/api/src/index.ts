import { serve } from '@hono/node-server';
import { createAiProvider } from './ai/claude';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEnv } from './env';
import { startJobs } from './jobs';
import { httpSender } from './lib/webhook-http';
import { createLogger } from './logger';
import { createMailer } from './mailer';
import { createPusher } from './push';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const { db, pool } = createDb(env.DATABASE_URL);

await runMigrations(db);
const auth = createAuth(db, env);
const mailer = createMailer(env, logger);
const pusher = await createPusher(db, env, logger);
const ai = createAiProvider(env, logger);
const webhookSender = httpSender({ allowPrivate: env.WEBHOOK_ALLOW_PRIVATE });
const app = createApp({ db, env, auth, logger, mailer, pusher, ai, webhookSender });
const jobs = env.RUN_WORKER
  ? await startJobs(db, env, logger, mailer, pusher, webhookSender)
  : null;

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info(`API listening on http://${info.address}:${info.port}`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  server.close();
  await jobs?.stop();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
