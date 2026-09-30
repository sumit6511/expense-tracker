import { type PushDevice, type PushSettings, type PushSubscribeSchema, uuidv7 } from '@et/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { notifications, pushSubscriptions } from '../db/schema';
import type { Env } from '../env';
import { badRequest, notFound } from '../lib/errors';
import type { Logger } from '../logger';
import { isAllowedPushEndpoint, type Pusher, type PushMessage } from '../push';

type Row = typeof pushSubscriptions.$inferSelect;

const toDevice = (r: Row): PushDevice => ({
  id: r.id,
  label: r.label,
  endpoint: r.endpoint,
  createdAt: r.createdAt.toISOString(),
  lastSentAt: r.lastSentAt?.toISOString() ?? null,
});

export async function pushSettings(
  db: Db,
  userId: string,
  pusher: Pusher | null,
): Promise<PushSettings> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(asc(pushSubscriptions.createdAt));
  return {
    available: pusher !== null,
    publicKey: pusher?.publicKey ?? null,
    devices: rows.map(toDevice),
  };
}

/**
 * Remembers a device. The same browser profile keeps one subscription: signing in there as
 * someone else moves it to them.
 */
export async function subscribePush(
  db: Db,
  env: Env,
  pusher: Pusher | null,
  userId: string,
  input: z.infer<typeof PushSubscribeSchema>,
): Promise<PushDevice> {
  if (!pusher) throw badRequest('Push notifications aren’t turned on for this server');
  if (!isAllowedPushEndpoint(input.endpoint, env.PUSH_EXTRA_HOSTS))
    throw badRequest('This browser’s push service isn’t supported');
  const values = {
    userId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    label: input.label,
    createdAt: new Date(),
    lastSentAt: null,
  };
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ id: uuidv7(), ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
    .returning();
  return toDevice(row!);
}

export async function unsubscribePush(db: Db, userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function removePushDevice(db: Db, userId: string, id: string) {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)))
    .returning({ id: pushSubscriptions.id });
  if (deleted.length === 0) throw notFound('Device');
}

/** Sends to the given devices; forgets the ones that are gone. Returns how many got it. */
async function sendTo(
  db: Db,
  pusher: Pusher,
  devices: Row[],
  message: PushMessage,
  logger?: Logger,
) {
  let sent = 0;
  const gone: string[] = [];
  const delivered: string[] = [];
  await Promise.all(
    devices.map(async (d) => {
      try {
        if ((await pusher.send(d, message)) === 'gone') gone.push(d.id);
        else {
          sent++;
          delivered.push(d.id);
        }
      } catch (err) {
        logger?.warn({ err, device: d.id }, 'push failed');
      }
    }),
  );
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (delivered.length)
    await db
      .update(pushSubscriptions)
      .set({ lastSentAt: new Date() })
      .where(inArray(pushSubscriptions.id, delivered));
  return sent;
}

export async function sendTestPush(db: Db, pusher: Pusher | null, userId: string) {
  if (!pusher) throw badRequest('Push notifications aren’t turned on for this server');
  const devices = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const sent = await sendTo(db, pusher, devices, {
    title: 'Notifications are on',
    body: 'This is how bills, budgets and heads-ups will reach you.',
    url: '/settings?tab=notifications',
    tag: 'test',
  });
  return { sent };
}

/** In-app path plus the workspace to open it in. */
function urlFor(link: string | null, workspaceId: string) {
  const url = new URL(link ?? '/', 'https://app.invalid');
  url.searchParams.set('ws', workspaceId);
  return `${url.pathname}${url.search}`;
}

/** Only fresh news goes to devices; anything older has been seen in the app or is stale. */
const PUSH_WITHIN_MS = 24 * 3600_000;
/** More than this at once for one person becomes one summary. */
const MAX_SEPARATE = 3;

/**
 * Pushes notifications created since the last run to their person's devices (those subscribed
 * before the notification was made), then marks them handled. Runs every minute.
 */
export async function sendPendingPushes(db: Db, pusher: Pusher, logger?: Logger, now = new Date()) {
  const pending = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      workspaceId: notifications.workspaceId,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(isNull(notifications.pushedAt))
    .orderBy(asc(notifications.createdAt))
    .limit(500);
  if (pending.length === 0) return 0;
  await db
    .update(notifications)
    .set({ pushedAt: now })
    .where(
      inArray(
        notifications.id,
        pending.map((n) => n.id),
      ),
    );

  const fresh = pending.filter(
    (n) => n.readAt === null && now.getTime() - n.createdAt.getTime() < PUSH_WITHIN_MS,
  );
  const userIds = [...new Set(fresh.map((n) => n.userId))];
  if (userIds.length === 0) return 0;
  const devices = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  let sent = 0;
  for (const [userId, items] of Map.groupBy(fresh, (n) => n.userId)) {
    const mine = devices.filter((d) => d.userId === userId);
    const targets = (createdAt: Date) => mine.filter((d) => d.createdAt <= createdAt);
    if (items.length > MAX_SEPARATE) {
      const latest = items.at(-1)!;
      sent += await sendTo(
        db,
        pusher,
        targets(items[0]!.createdAt),
        {
          title: `${items.length} new notifications`,
          body: items
            .slice(-MAX_SEPARATE)
            .map((n) => n.title)
            .join(' · '),
          url: urlFor(null, latest.workspaceId),
          tag: 'summary',
        },
        logger,
      );
      continue;
    }
    for (const n of items) {
      sent += await sendTo(
        db,
        pusher,
        targets(n.createdAt),
        { title: n.title, body: n.body, url: urlFor(n.link, n.workspaceId), tag: n.id },
        logger,
      );
    }
  }
  if (sent) logger?.info({ sent }, 'push notifications sent');
  return sent;
}
