import {
  type CreatedWebhook,
  type CreateWebhook,
  CreateWebhookSchema,
  MAX_WEBHOOKS,
  type Role,
  type UpdateWebhook,
  uuidv7,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookTestResult,
} from '@et/shared';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Executor } from '../db/client';
import { accounts, transactions, webhookDeliveries, webhooks } from '../db/schema';
import type { Env } from '../env';
import { ApiError, forbidden, notFound } from '../lib/errors';
import { openSecret, sealSecret } from '../lib/secrets';
import {
  isPublicAddress,
  newWebhookSecret,
  signWebhook,
  type WebhookSender,
} from '../lib/webhook-http';
import type { Logger } from '../logger';
import { getTransactions } from './transactions';
import type { Scope } from './visibility';

type SecretEnv = Pick<Env, 'ENCRYPTION_KEY' | 'AUTH_SECRET'>;
type SendEnv = SecretEnv & Pick<Env, 'WEBHOOK_ALLOW_PRIVATE'>;

const MANAGERS: readonly Role[] = ['owner', 'admin'];
/** Minutes to wait before each retry; after the last one a delivery has failed (about a day). */
const RETRY_MINUTES = [1, 5, 30, 120, 360, 720];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** A webhook that has failed for this long is turned off. */
const GIVE_UP_AFTER_MS = 3 * 86_400_000;

function requireManager(ws: WorkspaceCtx) {
  if (!MANAGERS.includes(ws.role)) throw forbidden('Only owners and admins can manage webhooks');
}

/** Rejects addresses that can never be sent to (a literal private IP, unless allowed). */
function checkUrl(env: SendEnv, url: string) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const literal = /^[\d.]+$/.test(host) || host.includes(':');
  if (!env.WEBHOOK_ALLOW_PRIVATE && (host === 'localhost' || (literal && !isPublicAddress(host)))) {
    throw new ApiError(
      400,
      'private_address',
      'That address is on a private network. Ask whoever runs this server to allow it (WEBHOOK_ALLOW_PRIVATE).',
    );
  }
}

type WebhookRow = typeof webhooks.$inferSelect;

async function toApi(db: Executor, rows: WebhookRow[]): Promise<Webhook[]> {
  if (rows.length === 0) return [];
  const stats = await db
    .select({
      webhookId: webhookDeliveries.webhookId,
      status: webhookDeliveries.status,
      n: count(),
    })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(
          webhookDeliveries.webhookId,
          rows.map((r) => r.id),
        ),
        sql`${webhookDeliveries.createdAt} > now() - interval '7 days'`,
      ),
    )
    .groupBy(webhookDeliveries.webhookId, webhookDeliveries.status);
  return rows.map((r) => {
    const recent = { succeeded: 0, failed: 0, pending: 0 };
    for (const s of stats) if (s.webhookId === r.id) recent[s.status] = Number(s.n);
    return {
      id: r.id,
      url: r.url,
      description: r.description,
      events: r.events as WebhookEvent[],
      enabled: r.enabled,
      disabledReason: r.disabledReason,
      createdAt: r.createdAt.toISOString(),
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      failingSince: r.failingSince?.toISOString() ?? null,
      recent,
    };
  });
}

async function requireWebhook(db: Executor, ws: WorkspaceCtx, id: string) {
  requireManager(ws);
  const [row] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, ws.id), eq(webhooks.id, id)));
  if (!row) throw notFound('Webhook');
  return row;
}

export async function listWebhooks(db: Executor, ws: WorkspaceCtx) {
  requireManager(ws);
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspaceId, ws.id))
    .orderBy(webhooks.createdAt);
  return toApi(db, rows);
}

export async function createWebhook(
  db: Executor,
  env: SendEnv,
  ws: WorkspaceCtx,
  input: CreateWebhook,
): Promise<CreatedWebhook> {
  requireManager(ws);
  const data = CreateWebhookSchema.parse(input);
  checkUrl(env, data.url);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(webhooks)
    .where(eq(webhooks.workspaceId, ws.id));
  if (Number(n) >= MAX_WEBHOOKS) {
    throw new ApiError(409, 'too_many', `A workspace can have up to ${MAX_WEBHOOKS} webhooks`);
  }
  const secret = newWebhookSecret();
  const [row] = await db
    .insert(webhooks)
    .values({
      id: uuidv7(),
      workspaceId: ws.id,
      url: data.url,
      description: data.description,
      events: [...new Set(data.events)],
      secretSealed: sealSecret(env, secret),
      createdBy: ws.userId,
    })
    .returning();
  const [api] = await toApi(db, [row!]);
  return { ...api!, secret };
}

export async function updateWebhook(
  db: Executor,
  env: SendEnv,
  ws: WorkspaceCtx,
  id: string,
  input: UpdateWebhook,
) {
  const current = await requireWebhook(db, ws, id);
  if (input.url) checkUrl(env, input.url);
  const turningOn = input.enabled === true && !current.enabled;
  const [row] = await db
    .update(webhooks)
    .set({
      ...(input.url !== undefined && { url: input.url }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.events !== undefined && { events: [...new Set(input.events)] }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      // Turned back on (or off by hand): start afresh.
      ...(input.enabled !== undefined && { disabledReason: null }),
      ...(turningOn && { failingSince: null }),
    })
    .where(eq(webhooks.id, id))
    .returning();
  const [api] = await toApi(db, [row!]);
  return api!;
}

export async function deleteWebhook(db: Executor, ws: WorkspaceCtx, id: string) {
  await requireWebhook(db, ws, id);
  await db.delete(webhooks).where(eq(webhooks.id, id));
}

export async function rotateWebhookSecret(
  db: Executor,
  env: SecretEnv,
  ws: WorkspaceCtx,
  id: string,
) {
  await requireWebhook(db, ws, id);
  const secret = newWebhookSecret();
  await db
    .update(webhooks)
    .set({ secretSealed: sealSecret(env, secret) })
    .where(eq(webhooks.id, id));
  return { secret };
}

export async function listDeliveries(
  db: Executor,
  ws: WorkspaceCtx,
  id: string,
): Promise<WebhookDelivery[]> {
  await requireWebhook(db, ws, id);
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(50);
  return rows.map((d) => ({
    id: d.id,
    eventId: d.eventId,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt?.toISOString() ?? null,
    nextAttemptAt: d.status === 'pending' ? (d.nextAttemptAt?.toISOString() ?? null) : null,
  }));
}

/** Sends a failed (or waiting) delivery again now. */
export async function retryDelivery(
  db: Executor,
  ws: WorkspaceCtx,
  webhookId: string,
  deliveryId: string,
) {
  const hook = await requireWebhook(db, ws, webhookId);
  if (!hook.enabled) throw new ApiError(409, 'disabled', 'Turn the webhook on first');
  const updated = await db
    .update(webhookDeliveries)
    .set({ status: 'pending', nextAttemptAt: new Date(), completedAt: null, attempts: 0 })
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, webhookId)))
    .returning({ id: webhookDeliveries.id });
  if (updated.length === 0) throw notFound('Delivery');
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

interface Payload {
  type: WebhookEvent | 'ping';
  timestamp: string;
  data: Record<string, unknown>;
}

function signedRequest(secret: string, eventId: string, payload: Payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'ExpenseTracker-Webhooks/1.0',
      'webhook-id': eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signWebhook(secret, eventId, timestamp, body),
    },
  };
}

const describeError = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300) || 'Could not connect';

async function attempt(
  sender: WebhookSender,
  url: string,
  secret: string,
  eventId: string,
  payload: Payload,
) {
  const started = performance.now();
  try {
    const { body, headers } = signedRequest(secret, eventId, payload);
    const { status } = await sender(url, body, headers);
    const ok = status >= 200 && status < 300;
    return {
      ok,
      responseStatus: status,
      error: ok ? null : `The receiver answered ${status}`,
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      ok: false,
      responseStatus: null,
      error: describeError(err),
      ms: Math.round(performance.now() - started),
    };
  }
}

/** Sends a "ping" straight away and records it, so the result shows up in the log too. */
export async function testWebhook(
  db: Executor,
  env: SecretEnv,
  sender: WebhookSender,
  ws: WorkspaceCtx,
  id: string,
): Promise<WebhookTestResult> {
  const hook = await requireWebhook(db, ws, id);
  const eventId = uuidv7();
  const payload: Payload = {
    type: 'ping',
    timestamp: new Date().toISOString(),
    data: { workspaceId: ws.id, webhookId: hook.id },
  };
  const result = await attempt(
    sender,
    hook.url,
    openSecret(env, hook.secretSealed),
    eventId,
    payload,
  );
  await db.insert(webhookDeliveries).values({
    id: uuidv7(),
    webhookId: hook.id,
    eventId,
    event: 'ping',
    payload,
    status: result.ok ? 'succeeded' : 'failed',
    attempts: 1,
    responseStatus: result.responseStatus,
    error: result.error,
    completedAt: new Date(),
  });
  if (result.ok) {
    await db
      .update(webhooks)
      .set({ lastSuccessAt: new Date(), failingSince: null })
      .where(eq(webhooks.id, hook.id));
  }
  return result;
}

type Change = 'created' | 'updated' | 'deleted';

/**
 * What a run of changes to one transaction adds up to for someone who saw none of them: added
 * then edited is "created"; added then deleted is nothing; deleted then restored is "updated".
 */
export function netChange(changes: readonly Change[]): Change | null {
  let state = 'none' as Change | 'none' | 'gone';
  for (const c of changes) {
    if (c === 'created') state = state === 'deleted' ? 'updated' : 'created';
    else if (c === 'deleted') state = state === 'created' || state === 'gone' ? 'gone' : 'deleted';
    else if (state === 'none') state = 'updated';
  }
  return state === 'none' || state === 'gone' ? null : state;
}

/** Everything in a workspace except private accounts: what webhooks may tell. */
async function sharedScope(db: Executor, workspaceId: string): Promise<Scope> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.visibility, 'private')));
  return { id: workspaceId, hiddenAccountIds: rows.map((r) => r.id) };
}

/**
 * Turns waiting outbox rows into deliveries, one per event and webhook. Safe to run in several
 * processes at once (rows are claimed with SKIP LOCKED). Returns how many outbox rows it took.
 */
export async function processOutbox(db: Executor, limit = 500): Promise<number> {
  return db.transaction(async (tx) => {
    const claimed = await tx.execute<{
      id: number;
      workspace_id: string;
      transaction_id: string;
      op: Change;
      at: Date;
    }>(sql`
      delete from webhook_outbox
      where id in (select id from webhook_outbox order by id limit ${limit} for update skip locked)
      returning id, workspace_id, transaction_id, op, at
    `);
    const rows = [...claimed.rows].sort((a, b) => Number(a.id) - Number(b.id));
    const byWorkspace = new Map<string, Map<string, { changes: Change[]; at: Date }>>();
    for (const r of rows) {
      const txs = byWorkspace.get(r.workspace_id) ?? new Map();
      byWorkspace.set(r.workspace_id, txs);
      const entry = txs.get(r.transaction_id) ?? { changes: [], at: new Date(r.at) };
      entry.changes.push(r.op);
      entry.at = new Date(r.at);
      txs.set(r.transaction_id, entry);
    }

    for (const [workspaceId, txs] of byWorkspace) {
      const hooks = await tx
        .select({ id: webhooks.id, events: webhooks.events })
        .from(webhooks)
        .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.enabled, true)));
      if (hooks.length === 0) continue;
      const scope = await sharedScope(tx, workspaceId);
      const net = [...txs].flatMap(([id, e]) => {
        const change = netChange(e.changes);
        return change ? [{ id, change, at: e.at }] : [];
      });
      const live = await getTransactions(
        tx,
        scope,
        net.filter((n) => n.change !== 'deleted').map((n) => n.id),
      );
      const liveById = new Map(live.map((t) => [t.id, t]));
      // Deleted rows may still be in the trash; skip ones from private accounts.
      const deletedIds = net.filter((n) => n.change === 'deleted').map((n) => n.id);
      const hiddenDeleted = new Set(
        deletedIds.length && scope.hiddenAccountIds.length
          ? (
              await tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    inArray(transactions.id, deletedIds),
                    inArray(transactions.accountId, scope.hiddenAccountIds),
                  ),
                )
            ).map((r) => r.id)
          : [],
      );

      const deliveries = net.flatMap((n) => {
        const type = `transaction.${n.change}` as WebhookEvent;
        let transaction: unknown;
        if (n.change === 'deleted') {
          if (hiddenDeleted.has(n.id)) return [];
          transaction = { id: n.id };
        } else {
          transaction = liveById.get(n.id);
          // Private, or gone again since: nothing to say.
          if (!transaction) return [];
        }
        const eventId = uuidv7();
        const payload: Payload = {
          type,
          timestamp: n.at.toISOString(),
          data: { workspaceId, transaction },
        };
        return hooks
          .filter((h) => h.events.includes(type))
          .map((h) => ({
            id: uuidv7(),
            webhookId: h.id,
            eventId,
            event: type,
            payload,
            nextAttemptAt: new Date(),
          }));
      });
      for (let i = 0; i < deliveries.length; i += 500) {
        await tx.insert(webhookDeliveries).values(deliveries.slice(i, i + 500));
      }
    }
    return rows.length;
  });
}

/**
 * Sends deliveries that are due, a few at a time, and schedules retries for failures. A webhook
 * failing for three days is turned off, as is one whose receiver answers 410 Gone.
 */
export async function deliverDue(
  db: Executor,
  env: SecretEnv,
  sender: WebhookSender,
  logger: Logger,
  limit = 50,
): Promise<number> {
  // Claim with a lease, so a crash mid-send just means a later retry.
  const claimed = await db.execute<{
    id: string;
    webhook_id: string;
    event_id: string;
    payload: Payload;
    attempts: number;
  }>(sql`
    update webhook_deliveries d set next_attempt_at = now() + interval '5 minutes'
    where d.id in (
      select id from webhook_deliveries
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at, id
      limit ${limit}
      for update skip locked
    )
    returning d.id, d.webhook_id, d.event_id, d.payload, d.attempts
  `);
  if (claimed.rows.length === 0) return 0;
  const hookRows = await db
    .select()
    .from(webhooks)
    .where(inArray(webhooks.id, [...new Set(claimed.rows.map((r) => r.webhook_id))]));
  const hooks = new Map(hookRows.map((h) => [h.id, h]));

  const queue = [...claimed.rows];
  async function worker() {
    for (let d = queue.shift(); d; d = queue.shift()) {
      const hook = hooks.get(d.webhook_id);
      const attempts = Number(d.attempts) + 1;
      if (!hook?.enabled) {
        await db
          .update(webhookDeliveries)
          .set({ status: 'failed', error: 'The webhook is turned off', completedAt: new Date() })
          .where(eq(webhookDeliveries.id, d.id));
        continue;
      }
      let secret: string;
      try {
        secret = openSecret(env, hook.secretSealed);
      } catch {
        await disable(db, hook.id, 'Its signing secret can’t be read (the server key changed)');
        continue;
      }
      const result = await attempt(sender, hook.url, secret, d.event_id, d.payload);
      const done = result.ok || attempts >= MAX_ATTEMPTS;
      await db
        .update(webhookDeliveries)
        .set({
          status: result.ok ? 'succeeded' : done ? 'failed' : 'pending',
          attempts,
          responseStatus: result.responseStatus,
          error: result.error,
          completedAt: done ? new Date() : null,
          nextAttemptAt: done ? null : new Date(Date.now() + RETRY_MINUTES[attempts - 1]! * 60_000),
        })
        .where(eq(webhookDeliveries.id, d.id));
      if (result.ok) {
        hook.failingSince = null;
        await db
          .update(webhooks)
          .set({ lastSuccessAt: new Date(), failingSince: null })
          .where(eq(webhooks.id, hook.id));
      } else if (result.responseStatus === 410) {
        hook.enabled = false;
        await disable(db, hook.id, 'The receiver answered 410 Gone');
      } else {
        hook.failingSince ??= new Date();
        await db
          .update(webhooks)
          .set({ failingSince: sql`coalesce(${webhooks.failingSince}, now())` })
          .where(eq(webhooks.id, hook.id));
        if (Date.now() - hook.failingSince.getTime() > GIVE_UP_AFTER_MS) {
          hook.enabled = false;
          await disable(db, hook.id, 'Turned off after failing for three days');
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  logger.debug({ sent: claimed.rows.length }, 'webhook deliveries sent');
  return claimed.rows.length;
}

async function disable(db: Executor, webhookId: string, reason: string) {
  await db
    .update(webhooks)
    .set({ enabled: false, disabledReason: reason })
    .where(eq(webhooks.id, webhookId));
  await db
    .update(webhookDeliveries)
    .set({ status: 'failed', error: reason, completedAt: new Date(), nextAttemptAt: null })
    .where(
      and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.status, 'pending')),
    );
}

/** Runs the outbox and sends whatever is due, until there's nothing left to do right now. */
export async function runWebhooks(
  db: Executor,
  env: SecretEnv,
  sender: WebhookSender,
  logger: Logger,
) {
  while ((await processOutbox(db)) > 0) {
    // keep going while the outbox has more
  }
  while ((await deliverDue(db, env, sender, logger)) > 0) {
    // and while deliveries are due
  }
}

export async function pruneDeliveries(db: Executor, days = 30) {
  await db.execute(sql`
    delete from webhook_deliveries
    where status <> 'pending' and created_at < now() - make_interval(days => ${days})
  `);
}
