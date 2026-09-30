import { afterAll, describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from '../src/push';
import { type Candidate, deliver } from '../src/services/notifications';
import { sendPendingPushes } from '../src/services/push';
import { setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

let n = 0;
const endpoint = (tag = '') => `https://fcm.googleapis.com/fcm/send/${tag}${Date.now()}-${n++}`;
const subscription = (url: string, label = 'Chrome on Android') => ({
  endpoint: url,
  keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'authSecret' },
  label,
});
const note = (title: string): Candidate => ({
  kind: 'goal',
  title,
  body: `${title} body`,
  link: '/budgets?view=goals',
  dedupeKey: `test:${title}:${Date.now()}:${n++}`,
});
/** Messages the fake pusher sent to one endpoint. */
const sentTo = (url: string) =>
  testApp()
    .pushed.filter((p) => p.target.endpoint === url)
    .map((p) => p.message);

describe('push endpoints', () => {
  it('only sends to the browsers’ own push services', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGz',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isAllowedPushEndpoint(ok)).toBe(true);
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pass@fcm.googleapis.com/x',
      'https://evil-fcm.googleapis.com.example.com/x',
      'https://localhost/x',
      'https://169.254.169.254/latest',
      'not a url',
    ]) {
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    }
    expect(isAllowedPushEndpoint('https://push.example.org/x', ['push.example.org'])).toBe(true);
  });
});

describe('web push', () => {
  it('subscribes a device, sends a test and forgets it on request', async () => {
    const f = await setupWorkspace();
    const settings = await f.client.get('/api/v1/me/push');
    expect(settings.body).toEqual({ available: true, publicKey: 'BTestPublicKey', devices: [] });

    for (const bad of ['https://evil.example.com/push', 'http://localhost:9000/x']) {
      const res = await f.client.post('/api/v1/me/push/subscriptions', subscription(bad));
      expect(res.status).toBe(400);
    }
    const url = endpoint();
    const res = await f.client.post('/api/v1/me/push/subscriptions', subscription(url));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ label: 'Chrome on Android', endpoint: url, lastSentAt: null });
    // Subscribing again (same browser) doesn't add a second device.
    await f.client.post('/api/v1/me/push/subscriptions', subscription(url, 'Chrome'));
    let devices = (await f.client.get('/api/v1/me/push')).body.devices;
    expect(devices).toHaveLength(1);
    expect(devices[0].label).toBe('Chrome');

    const test = await f.client.post('/api/v1/me/push/test');
    expect(test.body).toEqual({ sent: 1 });
    expect(sentTo(url)).toEqual([
      expect.objectContaining({ title: 'Notifications are on', tag: 'test' }),
    ]);
    devices = (await f.client.get('/api/v1/me/push')).body.devices;
    expect(devices[0].lastSentAt).not.toBeNull();

    // Someone else signing in on that browser takes the subscription over.
    const other = await signUp('Hari');
    await other.post('/api/v1/me/push/subscriptions', subscription(url));
    expect((await f.client.get('/api/v1/me/push')).body.devices).toHaveLength(0);
    expect((await other.get('/api/v1/me/push')).body.devices).toHaveLength(1);

    const unsub = await other.post('/api/v1/me/push/unsubscribe', { endpoint: url });
    expect(unsub.status).toBe(204);
    expect((await other.get('/api/v1/me/push')).body.devices).toHaveLength(0);

    const second = await f.client.post('/api/v1/me/push/subscriptions', subscription(endpoint()));
    expect((await other.delete(`/api/v1/me/push/subscriptions/${second.body.id}`)).status).toBe(
      404,
    );
    expect((await f.client.delete(`/api/v1/me/push/subscriptions/${second.body.id}`)).status).toBe(
      204,
    );
  });

  it('pushes new notifications once, to devices subscribed before them', async () => {
    const { db, pusher } = testApp();
    const f = await setupWorkspace();
    await deliver(db, f.ws.id, [note('Before subscribing')], [f.client.userId]);
    const url = endpoint();
    await f.client.post('/api/v1/me/push/subscriptions', subscription(url));
    await deliver(db, f.ws.id, [note('Goal reached: Bike')], [f.client.userId]);
    await sendPendingPushes(db, pusher);
    expect(sentTo(url)).toEqual([
      {
        title: 'Goal reached: Bike',
        body: 'Goal reached: Bike body',
        url: `/budgets?view=goals&ws=${f.ws.id}`,
        tag: expect.any(String),
      },
    ]);
    // Already pushed: not again.
    await sendPendingPushes(db, pusher);
    expect(sentTo(url)).toHaveLength(1);

    // Read in the app before the job ran: not pushed.
    await deliver(db, f.ws.id, [note('Seen already')], [f.client.userId]);
    await f.client.post('/api/v1/me/notifications/read', { workspaceId: f.ws.id });
    await sendPendingPushes(db, pusher);
    expect(sentTo(url)).toHaveLength(1);

    // Lots at once: one summary.
    await deliver(
      db,
      f.ws.id,
      ['A', 'B', 'C', 'D'].map((t) => note(t)),
      [f.client.userId],
    );
    await sendPendingPushes(db, pusher);
    expect(sentTo(url).at(-1)).toMatchObject({
      title: '4 new notifications',
      body: 'B · C · D',
      url: `/?ws=${f.ws.id}`,
    });
  });

  it('forgets devices whose subscription has ended', async () => {
    const { db, pusher } = testApp();
    const f = await setupWorkspace();
    await f.client.post('/api/v1/me/push/subscriptions', subscription(endpoint('gone-')));
    await deliver(db, f.ws.id, [note('Bill due')], [f.client.userId]);
    await sendPendingPushes(db, pusher);
    expect((await f.client.get('/api/v1/me/push')).body.devices).toHaveLength(0);
  });
});
