import { addDays, todayIn } from '@et/shared';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { AiProvider } from '../ai/provider';
import type { Db } from '../db/client';
import type { Env } from '../env';
import type { WebhookSender } from '../lib/webhook-http';
import type { Logger } from '../logger';
import type { Mailer } from '../mailer';
import type { Pusher } from '../push';
import { pruneInboundEmails } from '../services/email-in';
import { runHeadsUp } from '../services/insights';
import { pollMailbox } from '../services/mailbox';
import { pruneNotifications, runNotifications } from '../services/notifications';
import { sendPendingPushes } from '../services/push';
import { fetchNrbRates, storePublishedRates } from '../services/rates';
import { postDueRecurring } from '../services/recurring';
import { purgeTrash } from '../services/transactions';
import { pruneDeliveries, runWebhooks } from '../services/webhooks';

export const QUEUES = {
  fxRefresh: 'fx-refresh',
  purgeTrash: 'purge-trash',
  recurring: 'recurring-post',
  notifications: 'notifications',
  headsUp: 'heads-up',
  push: 'push',
  mailbox: 'email-in-mailbox',
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
export async function startJobs(
  db: Db,
  env: Env,
  logger: Logger,
  mailer: Mailer | null,
  pusher: Pusher | null,
  webhookSender: WebhookSender,
  ai: AiProvider | null,
) {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (err) => logger.error({ err }, 'job runner error'));
  await boss.start();

  await boss.createQueue(QUEUES.purgeTrash);
  await boss.schedule(QUEUES.purgeTrash, '17 3 * * *', null, { tz: 'Asia/Kathmandu' });
  await boss.work(QUEUES.purgeTrash, async () => {
    const purged = await purgeTrash(db, 30);
    logger.info({ purged }, 'purged old transactions from trash');
    await pruneNotifications(db);
    await pruneDeliveries(db);
    await pruneInboundEmails(db);
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

  // New notifications to people's phones and computers, soon after they're made.
  if (pusher) {
    await boss.createQueue(QUEUES.push);
    await boss.schedule(QUEUES.push, '* * * * *');
    await boss.work(QUEUES.push, async () => {
      await sendPendingPushes(db, pusher, logger);
    });
  }

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

  // Email in from a mailbox (IMAP), checked every minute.
  const imapUrl = env.EMAIL_IN_IMAP_URL;
  if (imapUrl && env.EMAIL_IN_ADDRESS) {
    await boss.createQueue(QUEUES.mailbox);
    await boss.schedule(QUEUES.mailbox, '* * * * *');
    await boss.work(QUEUES.mailbox, async () => {
      try {
        const handled = await pollMailbox(
          { db, env, ai, logger },
          imapUrl,
          env.EMAIL_IN_IMAP_FOLDER,
        );
        if (handled) logger.info({ handled }, 'read new emails');
      } catch (err) {
        logger.warn({ err }, 'could not check the email-in mailbox');
      }
    });
  }

  const webhookDispatcher = await startWebhookDispatcher(db, env, logger, webhookSender);

  return {
    boss,
    async stop() {
      await webhookDispatcher.stop();
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}

/**
 * Webhooks go out within a second or two of a change: the outbox trigger NOTIFYs, and we LISTEN.
 * A timer also runs every 15 seconds, for retries and in case a notification is missed.
 */
export async function startWebhookDispatcher(
  db: Db,
  env: Env,
  logger: Logger,
  sender: WebhookSender,
) {
  let running = false;
  let again = false;
  let stopped = false;
  async function run() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await runWebhooks(db, env, sender, logger);
      } while (again && !stopped);
    } catch (err) {
      logger.error({ err }, 'webhook dispatch failed');
    } finally {
      running = false;
    }
  }

  let debounce: NodeJS.Timeout | undefined;
  let listener: pg.Client | null = null;
  async function listen() {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    client.on('notification', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void run(), 300);
    });
    client.on('error', (err) => {
      logger.warn({ err }, 'webhook listener lost its connection; retrying');
      listener = null;
      void client.end().catch(() => {});
      if (!stopped) setTimeout(() => void listen().catch(() => {}), 5_000);
    });
    await client.connect();
    await client.query('LISTEN webhook_outbox');
    listener = client;
  }
  try {
    await listen();
  } catch (err) {
    logger.warn({ err }, 'could not listen for webhook changes; checking every 15 seconds');
  }
  const timer = setInterval(() => void run(), 15_000);
  void run();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(debounce);
      await listener?.end().catch(() => {});
    },
  };
}
