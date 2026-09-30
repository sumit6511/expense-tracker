import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { Db } from './db/client';
import { serverKeys } from './db/schema';
import type { Env } from './env';
import type { Logger } from './logger';

/** What a device shows. The service worker opens `url` when it's tapped. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends Web Push messages. Only exists when push is enabled. */
export interface Pusher {
  publicKey: string;
  /** "gone": the device unsubscribed or the subscription expired; forget it. */
  send(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone'>;
}

/**
 * Push services of the major browsers. The server only ever sends to these (plus any listed in
 * PUSH_EXTRA_HOSTS), so a made-up "subscription" can't point it at other addresses.
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
];

export function isAllowedPushEndpoint(endpoint: string, extraHosts: readonly string[] = []) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return [...PUSH_HOSTS, ...extraHosts].some((h) => host === h || host.endsWith(`.${h}`));
}

async function vapidKeys(db: Db, env: Env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const read = async () => {
    const [row] = await db.select().from(serverKeys).where(eq(serverKeys.name, 'vapid'));
    return row ? (JSON.parse(row.value) as { publicKey: string; privateKey: string }) : null;
  };
  const existing = await read();
  if (existing) return existing;
  // First start: make a pair. If two processes race, the first one stored wins.
  await db
    .insert(serverKeys)
    .values({ name: 'vapid', value: JSON.stringify(webpush.generateVAPIDKeys()) })
    .onConflictDoNothing();
  return (await read())!;
}

function subjectFor(env: Env) {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  const address = /<([^>]+)>/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM;
  if (address.includes('@') && !address.endsWith('@localhost')) return `mailto:${address}`;
  return env.PUBLIC_URL.startsWith('https:') ? env.PUBLIC_URL : 'mailto:admin@example.com';
}

export async function createPusher(db: Db, env: Env, logger: Logger): Promise<Pusher | null> {
  if (!env.WEB_PUSH) return null;
  const { publicKey, privateKey } = await vapidKeys(db, env);
  const vapidDetails = { subject: subjectFor(env), publicKey, privateKey };
  return {
    publicKey,
    async send(target, message) {
      if (!isAllowedPushEndpoint(target.endpoint, env.PUSH_EXTRA_HOSTS)) return 'gone';
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          { vapidDetails, TTL: 24 * 3600, urgency: 'normal', timeout: 10_000 },
        );
        logger.debug({ host: new URL(target.endpoint).host }, 'push sent');
        return 'sent';
      } catch (err) {
        if (err instanceof webpush.WebPushError && [404, 410].includes(err.statusCode))
          return 'gone';
        throw err;
      }
    },
  };
}
