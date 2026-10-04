import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { todayIn } from '@et/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { webhookDeliveries, webhookOutbox, webhooks } from '../src/db/schema';
import { httpSender, isPublicAddress } from '../src/lib/webhook-http';
import { netChange, runWebhooks } from '../src/services/webhooks';
import { type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const { db, env, logger, receiver } = testApp();
const run = () => runWebhooks(db, env, receiver.send, logger);

let n = 0;
let url = '';
beforeEach(() => {
  url = `https://hooks.example.com/${++n}`;
});

async function addHook(f: Fixture, events?: string[], target = url) {
  const res = await f.client.post(`${f.base}/webhooks`, {
    url: target,
    description: 'Spreadsheet',
    events: events ?? ['transaction.created', 'transaction.updated', 'transaction.deleted'],
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; secret: string };
}

const spend = (f: Fixture, extra: Record<string, unknown> = {}) =>
  f.client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Cash,
    date: todayIn('Asia/Kathmandu'),
    amountMinor: -45_000,
    payee: 'Bhojan Griha',
    categoryId: f.categories['Dining Out'],
    ...extra,
  });

/** Checks a delivery the way a receiver would (Standard Webhooks, written out independently). */
function verify(secret: string, r: { body: string; headers: Record<string, string> }) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signed = `${r.headers['webhook-id']}.${r.headers['webhook-timestamp']}.${r.body}`;
  const expected = createHmac('sha256', key).update(signed).digest('base64');
  return r.headers['webhook-signature'] === `v1,${expected}`;
}

describe('webhooks', () => {
  it('tells a webhook about added, changed, deleted and restored transactions', async () => {
    const f = await setupWorkspace();
    const hook = await addHook(f);
    expect(hook.secret).toMatch(/^whsec_[\w+/]{32}$/);

    const tx = (await spend(f)).body;
    await run();
    let got = receiver.for(url);
    expect(got).toHaveLength(1);
    expect(got[0]!.json).toMatchObject({
      type: 'transaction.created',
      data: {
        workspaceId: f.ws.id,
        transaction: {
          id: tx.id,
          amountMinor: -45_000,
          payeeName: 'Bhojan Griha',
          splits: [expect.objectContaining({ categoryId: f.categories['Dining Out'] })],
        },
      },
    });
    expect(verify(hook.secret, got[0]!)).toBe(true);
    expect(got[0]!.headers['content-type']).toBe('application/json');

    // A category change touches the transaction and its split: one "updated".
    await f.client.patch(`${f.base}/transactions/${tx.id}`, {
      categoryId: f.categories.Transport,
      notes: 'Taxi, really',
    });
    await run();
    await f.client.delete(`${f.base}/transactions/${tx.id}`);
    await run();
    got = receiver.for(url);
    expect(got.map((r) => r.json.type)).toEqual([
      'transaction.created',
      'transaction.updated',
      'transaction.deleted',
    ]);
    expect(got[1]!.json.data.transaction.notes).toBe('Taxi, really');
    expect(got[2]!.json.data.transaction).toEqual({ id: tx.id });

    await f.client.post(`${f.base}/transactions/${tx.id}/restore`);
    await run();
    expect(receiver.for(url).at(-1)!.json.type).toBe('transaction.created');
    // Each event has its own id; the headers carry it for receivers to skip repeats.
    const ids = receiver.for(url).map((r) => r.headers['webhook-id']);
    expect(new Set(ids).size).toBe(4);
  });

  it('adds up quick changes, and only sends the events asked for', async () => {
    const f = await setupWorkspace();
    await addHook(f);
    const deletesOnly = `${url}/deletes`;
    await addHook(f, ['transaction.deleted'], deletesOnly);

    const kept = (await spend(f)).body;
    await f.client.patch(`${f.base}/transactions/${kept.id}`, { notes: 'edited before sending' });
    const gone = (await spend(f, { payee: 'Mistake' })).body;
    await f.client.delete(`${f.base}/transactions/${gone.id}`);
    await run();

    // Added then edited: one "created" with the edit in it. Added then deleted: nothing at all.
    expect(receiver.for(url).map((r) => [r.json.type, r.json.data.transaction.id])).toEqual([
      ['transaction.created', kept.id],
    ]);
    expect(receiver.for(url)[0]!.json.data.transaction.notes).toBe('edited before sending');
    expect(receiver.for(deletesOnly)).toEqual([]);

    await f.client.post(`${f.base}/transactions/bulk`, { action: 'delete', ids: [kept.id] });
    await run();
    expect(receiver.for(deletesOnly).map((r) => r.json.type)).toEqual(['transaction.deleted']);
  });

  it('keeps private accounts private and stays quiet without webhooks', async () => {
    const f = await setupWorkspace();
    const before = await db.select().from(webhookOutbox);
    await spend(f);
    expect(await db.select().from(webhookOutbox)).toHaveLength(before.length);

    await addHook(f);
    const mine = await f.client.post(`${f.base}/accounts`, {
      name: 'My savings',
      type: 'savings',
      currency: 'NPR',
      visibility: 'private',
    });
    const secret = (await spend(f, { accountId: mine.body.id })).body;
    await f.client.delete(`${f.base}/transactions/${secret.id}`);
    await spend(f, { payee: 'Shared shop' });
    await run();
    expect(receiver.for(url).map((r) => r.json.data.transaction.payeeName)).toEqual([
      'Shared shop',
    ]);
  });

  it('retries failures, then gives up on a webhook failing for days', async () => {
    const f = await setupWorkspace();
    const hook = await addHook(f);
    receiver.answer(url, 500);
    await spend(f);
    await run();

    const [first] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, hook.id));
    expect(first).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 500 });
    expect(first!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);

    // Due again, and the receiver is back.
    receiver.answer(url, 204);
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: sql`now() - interval '1 second'` })
      .where(eq(webhookDeliveries.id, first!.id));
    await run();
    const list = await f.client.get(`${f.base}/webhooks/${hook.id}/deliveries`);
    expect(list.body[0]).toMatchObject({ status: 'succeeded', attempts: 2, responseStatus: 204 });
    expect((await f.client.get(`${f.base}/webhooks`)).body[0]).toMatchObject({
      failingSince: null,
      recent: { succeeded: 1, failed: 0, pending: 0 },
    });
    expect(receiver.for(url).map((r) => r.headers['webhook-id'])).toEqual([
      first!.eventId,
      first!.eventId,
    ]);

    // Failing for three days: turned off, with the reason shown.
    receiver.answer(url, 503);
    await db
      .update(webhooks)
      .set({ failingSince: sql`now() - interval '4 days'` })
      .where(eq(webhooks.id, hook.id));
    await spend(f);
    await run();
    const [off] = (await f.client.get(`${f.base}/webhooks`)).body;
    expect(off).toMatchObject({
      enabled: false,
      disabledReason: 'Turned off after failing for three days',
    });
    // Turned off: changes aren't even queued.
    const queued = await db.select().from(webhookOutbox);
    await spend(f);
    expect(await db.select().from(webhookOutbox)).toHaveLength(queued.length);

    // Turning it back on starts afresh; a failed delivery can be sent again.
    receiver.answer(url, 200);
    const on = await f.client.patch(`${f.base}/webhooks/${hook.id}`, { enabled: true });
    expect(on.body).toMatchObject({ enabled: true, disabledReason: null, failingSince: null });
    const failed = (await f.client.get(`${f.base}/webhooks/${hook.id}/deliveries`)).body.find(
      (d: { status: string }) => d.status === 'failed',
    );
    expect(
      (await f.client.post(`${f.base}/webhooks/${hook.id}/deliveries/${failed.id}/retry`)).status,
    ).toBe(204);
    await run();
    const again = (await f.client.get(`${f.base}/webhooks/${hook.id}/deliveries`)).body.find(
      (d: { id: string }) => d.id === failed.id,
    );
    expect(again).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('stops at once when the receiver says 410 Gone', async () => {
    const f = await setupWorkspace();
    const hook = await addHook(f);
    receiver.answer(url, 410);
    await spend(f);
    await run();
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(row).toMatchObject({ enabled: false, disabledReason: 'The receiver answered 410 Gone' });
  });

  it('sends a test ping and replaces the secret', async () => {
    const f = await setupWorkspace();
    const hook = await addHook(f);
    const ok = await f.client.post(`${f.base}/webhooks/${hook.id}/test`);
    expect(ok.body).toMatchObject({ ok: true, responseStatus: 200, error: null });
    expect(receiver.for(url)[0]!.json).toMatchObject({
      type: 'ping',
      data: { workspaceId: f.ws.id, webhookId: hook.id },
    });

    const rotated = await f.client.post(`${f.base}/webhooks/${hook.id}/secret`);
    expect(rotated.body.secret).not.toBe(hook.secret);
    await f.client.post(`${f.base}/webhooks/${hook.id}/test`);
    const last = receiver.for(url).at(-1)!;
    expect(verify(rotated.body.secret, last)).toBe(true);
    expect(verify(hook.secret, last)).toBe(false);

    const down = await f.client.post(`${f.base}/webhooks`, {
      url: 'https://unreachable.example.com/hook',
      events: ['transaction.created'],
    });
    const failed = await f.client.post(`${f.base}/webhooks/${down.body.id}/test`);
    expect(failed.body).toMatchObject({ ok: false, responseStatus: null });
    expect(failed.body.error).toContain('ECONNREFUSED');
    const log = await f.client.get(`${f.base}/webhooks/${down.body.id}/deliveries`);
    expect(log.body).toEqual([expect.objectContaining({ event: 'ping', status: 'failed' })]);
  });

  it('is for owners and admins, from the app, and not for private addresses', async () => {
    const f = await setupWorkspace();
    const editor = await signUp('Ram');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: editor.email,
      role: 'editor',
    });
    await editor.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    expect((await editor.get(`${f.base}/webhooks`)).status).toBe(403);
    expect(
      (await editor.post(`${f.base}/webhooks`, { url, events: ['transaction.created'] })).status,
    ).toBe(403);

    for (const target of ['http://192.168.1.10/hook', 'http://localhost:8123/x', 'http://[::1]/']) {
      const res = await f.client.post(`${f.base}/webhooks`, {
        url: target,
        events: ['transaction.created'],
      });
      expect([target, res.status, res.body.error.code]).toEqual([target, 400, 'private_address']);
    }
    const bad = await f.client.post(`${f.base}/webhooks`, { url: 'ftp://x.com', events: [] });
    expect(bad.status).toBe(400);

    const token = await f.client.post(`${f.base}/tokens`, {
      name: 'Script',
      scope: 'write',
      expiresInDays: 30,
    });
    const viaToken = await testApp().app.request(`${f.base}/webhooks`, {
      headers: { authorization: `Bearer ${token.body.token}` },
    });
    expect(viaToken.status).toBe(403);
  });
});

describe('webhook helpers', () => {
  it('adds up a run of changes', () => {
    expect(netChange(['created', 'updated', 'updated'])).toBe('created');
    expect(netChange(['created', 'deleted'])).toBeNull();
    expect(netChange(['updated', 'deleted'])).toBe('deleted');
    expect(netChange(['deleted', 'created'])).toBe('updated');
    expect(netChange(['created', 'deleted', 'created'])).toBe('created');
    expect(netChange(['updated'])).toBe('updated');
  });

  it('tells public addresses from private ones', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ]) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
    }
  });

  it('sends for real, but not to private addresses unless allowed', async () => {
    const got: Array<{ body: string; signature?: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        got.push({ body, signature: req.headers['webhook-signature'] as string });
        res.writeHead(req.url === '/gone' ? 410 : 202).end('thanks');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const strict = httpSender({ allowPrivate: false });
      for (const target of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`]) {
        await expect(strict(target, '{}', {})).rejects.toThrow(/private network address/);
      }
      expect(got).toEqual([]);

      const open = httpSender({ allowPrivate: true });
      const sent = await open(`http://localhost:${port}/hook`, '{"type":"ping"}', {
        'content-type': 'application/json',
        'webhook-signature': 'v1,abc',
      });
      expect(sent.status).toBe(202);
      expect(got).toEqual([{ body: '{"type":"ping"}', signature: 'v1,abc' }]);
      expect((await open(`http://127.0.0.1:${port}/gone`, '{}', {})).status).toBe(410);

      const slow = createServer(() => {});
      await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
      const quick = httpSender({ allowPrivate: true, timeoutMs: 200 });
      await expect(
        quick(`http://127.0.0.1:${(slow.address() as AddressInfo).port}/`, '{}', {}),
      ).rejects.toThrow(/No answer within/);
      slow.closeAllConnections();
      slow.close();

      // A receiver that answers, then dribbles out a byte at a time, still hits the deadline.
      const drip = createServer((_req, res) => {
        res.writeHead(200);
        const timer = setInterval(() => res.write('.'), 50);
        res.on('close', () => clearInterval(timer));
      });
      await new Promise<void>((resolve) => drip.listen(0, '127.0.0.1', resolve));
      const started = Date.now();
      await expect(
        quick(`http://127.0.0.1:${(drip.address() as AddressInfo).port}/`, '{}', {}),
      ).rejects.toThrow(/No answer within/);
      expect(Date.now() - started).toBeLessThan(2_000);
      drip.closeAllConnections();
      drip.close();
    } finally {
      server.close();
    }
  });
});
