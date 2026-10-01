import { todayIn } from '@et/shared';
import nodemailer from 'nodemailer';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EMAIL_IN_SECRET, type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const { app, ai } = testApp();
beforeEach(() => ai.reset());

/** The smallest valid PNG, standing in for a receipt photo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
let n = 0;

async function compose(mail: {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}) {
  const info = await composer.sendMail({
    messageId: mail.messageId ?? `<test-${++n}-${Date.now()}@example.com>`,
    ...mail,
  });
  return info.message as Buffer;
}

async function deliver(raw: Buffer, opts: { to?: string; secret?: string } = {}) {
  const res = await app.request(
    `/api/inbound/email${opts.to ? `?to=${encodeURIComponent(opts.to)}` : ''}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.secret ?? EMAIL_IN_SECRET}`,
        'content-type': 'message/rfc822',
      },
      body: raw,
    },
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function setup() {
  const f = await setupWorkspace();
  const settings = await f.client.get(`${f.base}/email-in`);
  return { ...f, address: settings.body.address as string };
}

const emailIn = async (f: Fixture) => (await f.client.get(`${f.base}/email-in`)).body;

describe('email in', () => {
  it('gives each workspace its own address, which can be replaced', async () => {
    const f = await setup();
    expect(f.address).toMatch(/^money\+et[a-z2-7]{14}@example\.com$/);
    expect((await emailIn(f)).address).toBe(f.address);
    const other = await setup();
    expect(other.address).not.toBe(f.address);

    const fresh = await f.client.post(`${f.base}/email-in/address`);
    expect(fresh.body.address).not.toBe(f.address);
    // The old address no longer reaches the workspace.
    const raw = await compose({ from: f.client.email, to: f.address, subject: 'tea 50 cash' });
    expect((await deliver(raw)).body.received).toBe(0);
  });

  it('turns a member’s “lunch 450 cash” email into a transaction, receipt attached', async () => {
    const f = await setup();
    const raw = await compose({
      from: `Test User <${f.client.email.toUpperCase()}>`,
      to: f.address,
      subject: 'Fwd: lunch 450 cash at Bhojan Griha',
      text: 'Forwarded receipt',
      attachments: [{ filename: 'receipt.png', content: PNG }],
    });
    const res = await deliver(raw);
    expect(res.status).toBe(202);
    expect(res.body.results).toEqual([{ workspaceId: f.ws.id, status: 'recorded' }]);

    const [message] = (await emailIn(f)).messages;
    expect(message).toMatchObject({
      status: 'recorded',
      subject: 'Fwd: lunch 450 cash at Bhojan Griha',
      detail: 'Read from the subject',
      files: [],
    });
    const tx = (await f.client.get(`${f.base}/transactions/${message.transactionIds[0]}`)).body;
    expect(tx).toMatchObject({
      accountId: f.accounts.Cash,
      amountMinor: -45_000,
      payeeName: 'Bhojan Griha',
      needsReview: true,
      createdBy: f.client.userId,
      attachmentCount: 1,
    });

    // The same message delivered twice is only handled once.
    expect((await deliver(raw)).body.received).toBe(0);
    expect((await emailIn(f)).messages).toHaveLength(1);
  });

  it('reads alerts from a trusted bank address into its account, without duplicates', async () => {
    const f = await setup();
    const added = await f.client.post(`${f.base}/email-in/senders`, {
      sender: 'Alerts@NabilBank.com',
      accountId: f.accounts.Bank,
    });
    expect(added.body.senders).toEqual([
      expect.objectContaining({ sender: 'alerts@nabilbank.com', accountId: f.accounts.Bank }),
    ]);
    const alert = {
      from: 'Nabil Bank <alerts@nabilbank.com>',
      // Auto-forwarded: the token is only in the envelope / Delivered-To.
      to: 'sita@gmail.com',
      subject: 'Transaction Alert',
      html: `<p>Dear Customer,</p><p>Your A/C 01XXXX456 has been debited by NPR 2,500.00 on
        15/09/2026. Remarks: POS/BHAT BHATENI. Ref: TXN123456.</p><p>Bal: NPR 45,000.00</p>`,
    };
    const res = await deliver(await compose(alert), { to: f.address });
    expect(res.body.results).toEqual([{ workspaceId: f.ws.id, status: 'recorded' }]);
    const [message] = (await emailIn(f)).messages;
    expect(message.detail).toBe('Read as a bank alert');
    const tx = (await f.client.get(`${f.base}/transactions/${message.transactionIds[0]}`)).body;
    expect(tx).toMatchObject({
      accountId: f.accounts.Bank,
      date: '2026-09-15',
      amountMinor: -250_000,
      needsReview: true,
      createdBy: null,
    });

    // The bank sends it again (new message, same reference): already there.
    const again = await deliver(await compose(alert), { to: f.address });
    expect(again.body.results[0].status).toBe('duplicate');

    // A whole domain can be trusted too.
    await f.client.post(`${f.base}/email-in/senders`, {
      sender: '@esewa.com.np',
      accountId: f.accounts['INR Wallet'],
    });
    const wallet = await compose({
      from: 'noreply@esewa.com.np',
      to: f.address,
      subject: 'Payment successful',
      text: 'You have paid INR 120.00 to Chiya Pasal on 2026-09-20.',
    });
    expect((await deliver(wallet)).body.results[0].status).toBe('recorded');
  });

  it('ignores strangers, and keeps unreadable receipts for a person to add', async () => {
    const f = await setup();
    const spam = await compose({
      from: 'someone@spam.example',
      to: f.address,
      subject: 'Pay 5000 now',
      text: 'Send NPR 5000 to win',
    });
    expect((await deliver(spam)).body.results[0].status).toBe('ignored');
    expect((await emailIn(f)).messages[0]).toMatchObject({
      status: 'ignored',
      from: 'someone@spam.example',
      detail: 'Not from a member or a trusted sender',
      transactionIds: [],
    });

    const photo = await compose({
      from: f.client.email,
      to: f.address,
      subject: 'Dinner receipt',
      attachments: [{ filename: 'IMG_2041.png', content: PNG }],
    });
    expect((await deliver(photo)).body.results[0].status).toBe('needs_review');
    const waiting = (await emailIn(f)).messages[0];
    expect(waiting).toMatchObject({
      status: 'needs_review',
      detail: 'No amount in the subject; turn on AI helpers to read receipts',
      draft: { accountId: f.accounts.Cash, amountMinor: null, notes: 'Dinner receipt' },
      files: [expect.objectContaining({ fileName: 'IMG_2041.png', contentType: 'image/png' })],
    });
    const file = await f.client.get(
      `${f.base}/email-in/messages/${waiting.id}/files/${waiting.files[0].id}`,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');

    const recorded = await f.client.post(`${f.base}/email-in/messages/${waiting.id}/transaction`, {
      accountId: f.accounts.Cash,
      date: todayIn('Asia/Kathmandu'),
      amountMinor: -120_000,
      payee: 'Thakali Kitchen',
    });
    expect(recorded.status).toBe(201);
    expect(recorded.body.attachmentCount).toBe(1);
    const done = (await emailIn(f)).messages.find((m: { id: string }) => m.id === waiting.id);
    expect(done).toMatchObject({
      status: 'recorded',
      files: [],
      transactionIds: [recorded.body.id],
    });
    const twice = await f.client.post(`${f.base}/email-in/messages/${waiting.id}/transaction`, {
      accountId: f.accounts.Cash,
      date: todayIn('Asia/Kathmandu'),
      amountMinor: -1,
    });
    expect(twice.status).toBe(409);

    // Or added in the app's own dialog, then linked.
    const other = await compose({
      from: f.client.email,
      to: f.address,
      subject: 'Taxi',
      attachments: [{ filename: 'taxi.png', content: PNG }],
    });
    await deliver(other);
    const taxi = (await emailIn(f)).messages[0];
    const added = await f.client.post(`${f.base}/transactions`, {
      accountId: f.accounts.Cash,
      date: todayIn('Asia/Kathmandu'),
      amountMinor: -30_000,
    });
    expect(
      (
        await f.client.post(`${f.base}/email-in/messages/${taxi.id}/link`, {
          transactionId: added.body.id,
        })
      ).status,
    ).toBe(204);
    expect((await emailIn(f)).messages[0]).toMatchObject({
      status: 'recorded',
      files: [],
      transactionIds: [added.body.id],
    });

    expect((await f.client.delete(`${f.base}/email-in/messages/${done.id}`)).status).toBe(204);
    expect((await emailIn(f)).messages.map((m: { id: string }) => m.id)).not.toContain(done.id);
  });

  it('reads receipt photos with AI help when the workspace uses it', async () => {
    const f = await setup();
    await f.client.patch(f.base, { aiEnabled: true });
    ai.next.readReceipt = async () => ({
      direction: 'expense',
      amount: 1_250,
      currency: 'NPR',
      date: '2026-09-28',
      accountId: null,
      categoryId: null,
      payee: 'Bhat-Bhateni',
      notes: null,
      tax: null,
      items: [],
    });
    const photo = await compose({
      from: f.client.email,
      to: f.address,
      subject: 'Groceries',
      attachments: [{ filename: 'bill.png', content: PNG }],
    });
    expect((await deliver(photo)).body.results[0].status).toBe('recorded');
    const [message] = (await emailIn(f)).messages;
    expect(message.detail).toBe('Read with AI help');
    const tx = (await f.client.get(`${f.base}/transactions/${message.transactionIds[0]}`)).body;
    expect(tx).toMatchObject({
      amountMinor: -125_000,
      date: '2026-09-28',
      payeeName: 'Bhat-Bhateni',
      attachmentCount: 1,
    });
    expect(ai.calls.map((c) => c.method)).toEqual(['readReceipt']);
  });

  it('checks the secret, and leaves settings to owners and admins', async () => {
    const f = await setup();
    const raw = await compose({ from: f.client.email, to: f.address, subject: 'tea 50 cash' });
    expect((await deliver(raw, { secret: 'wrong-secret-wrong-secret-12' })).status).toBe(401);
    const none = await app.request('/api/inbound/email', { method: 'POST', body: raw });
    expect(none.status).toBe(401);

    const editor = await signUp('Ram');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: editor.email,
      role: 'editor',
    });
    await editor.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    // Editors see the address and log (and can email it), but don't change who's trusted.
    expect((await editor.get(`${f.base}/email-in`)).body.address).toBe(f.address);
    expect(
      (await editor.post(`${f.base}/email-in/senders`, { sender: '@x.com', accountId: null }))
        .status,
    ).toBe(403);
    expect((await editor.post(`${f.base}/email-in/address`)).status).toBe(403);

    const fromEditor = await compose({ from: editor.email, to: f.address, subject: 'bus 30 cash' });
    expect((await deliver(fromEditor)).body.results[0].status).toBe('recorded');
    const bad = await f.client.post(`${f.base}/email-in/senders`, {
      sender: 'not an address',
      accountId: null,
    });
    expect(bad.status).toBe(400);
  });
});
