import { addDays, todayIn } from '@et/shared';
import { PgBoss } from 'pg-boss';
import type { Db } from '../db/client';
import type { Env } from '../env';
import type { Logger } from '../logger';
import type { Mailer } from '../mailer';
import { runHeadsUp } from '../services/insights';
import { pruneNotifications, runNotifications } from '../services/notifications';
import { fetchNrbRates, storePublishedRates } from '../services/rates';
import { postDueRecurring } from '../services/recurring';
import { purgeTrash } from '../services/transactions';

export const QUEUES = {
  fxRefresh: 'fx-refresh',
  purgeTrash: 'purge-trash',
  recurring: 'recurring-post',
  notifications: 'notifications',
  headsUp: 'heads-up',
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
export async function startJobs(db: Db, env: Env, logger: Logger, mailer: Mailer | null) {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (err) => logger.error({ err }, 'job runner error'));
  await boss.start();

  await boss.createQueue(QUEUES.purgeTrash);
  await boss.schedule(QUEUES.purgeTrash, '17 3 * * *', null, { tz: 'Asia/Kathmandu' });
  await boss.work(QUEUES.purgeTrash, async () => {
    const purged = await purgeTrash(db, 30);
    logger.info({ purged }, 'purged old transactions from trash');
    await pruneNotifications(db);
  });

  // Hourly, so each workspace's items are recorded soon after midnight in its own time zone.
  await boss.createQueue(QUEUES.recurring);
  await boss.schedule(QUEUES.recurring, '7 * * * *');
  await boss.work(QUEUES.recurring, async () => {
    await postDueRecurring(db, logger);
  });
  await boss.send(QUEUES.recurring, null, { singletonKey: 'startup', singletonSeconds: 300 });

  // Bills coming due, budgets running out, goals reached; then email whoever asked for it.
  await boss.createQueue(QUEUES.notifications);
  await boss.schedule(QUEUES.notifications, '*/15 * * * *');
  await boss.work(QUEUES.notifications, async () => {
    await runNotifications(db, mailer, env.PUBLIC_URL, logger);
  });

  // Accounts the bills could empty, prices that changed: once a day, in the morning.
  await boss.createQueue(QUEUES.headsUp);
  await boss.schedule(QUEUES.headsUp, '41 7 * * *', null, { tz: 'Asia/Kathmandu' });
  await boss.work(QUEUES.headsUp, async () => {
    await runHeadsUp(db, logger);
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
