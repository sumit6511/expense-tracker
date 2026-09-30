import { addDays, todayIn } from '@et/shared';
import { PgBoss } from 'pg-boss';
import type { Db } from '../db/client';
import type { Env } from '../env';
import type { Logger } from '../logger';
import { fetchNrbRates, storePublishedRates } from '../services/rates';
import { purgeTrash } from '../services/transactions';

export const QUEUES = {
  fxRefresh: 'fx-refresh',
  purgeTrash: 'purge-trash',
} as const;

/** Fetches the last `days` days of NRB rates and stores them. */
export async function refreshNrbRates(
  db: Db,
  logger: Logger,
  days = 7,
  fetchImpl: typeof fetch = fetch,
) {
  const to = todayIn('Asia/Kathmandu');
  const from = addDays(to, -days);
  const rates = await fetchNrbRates(from, to, fetchImpl);
  const stored = await storePublishedRates(db, rates, 'nrb');
  logger.info({ from, to, stored }, 'NRB exchange rates refreshed');
  return stored;
}

/**
 * Starts the background job runner. Jobs are stored in Postgres (pg-boss), so schedules survive
 * restarts and only one instance runs each job even with several workers.
 */
export async function startJobs(db: Db, env: Env, logger: Logger) {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (err) => logger.error({ err }, 'job runner error'));
  await boss.start();

  await boss.createQueue(QUEUES.purgeTrash);
  await boss.schedule(QUEUES.purgeTrash, '17 3 * * *', null, { tz: 'Asia/Kathmandu' });
  await boss.work(QUEUES.purgeTrash, async () => {
    const purged = await purgeTrash(db, 30);
    logger.info({ purged }, 'purged old transactions from trash');
  });

  if (env.FX_NRB_ENABLED) {
    await boss.createQueue(QUEUES.fxRefresh, {
      retryLimit: 3,
      retryDelay: 300,
      retryBackoff: true,
    });
    // NRB publishes the day's rates in the morning (Nepal time); refresh a few times a day.
    await boss.schedule(QUEUES.fxRefresh, '5 6,10,15 * * *', null, { tz: 'Asia/Kathmandu' });
    await boss.work<{ days?: number }>(QUEUES.fxRefresh, async ([job]) => {
      await refreshNrbRates(db, logger, job?.data?.days ?? 7);
    });
    // Catch up straight away on start (e.g. a fresh install has no rates yet).
    await boss.send(
      QUEUES.fxRefresh,
      { days: 30 },
      { singletonKey: 'startup', singletonSeconds: 3600 },
    );
  }

  return boss;
}
