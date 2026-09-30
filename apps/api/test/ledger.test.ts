import { afterAll, describe, expect, it } from 'vitest';
import { type Fixture, ORIGIN, setupWorkspace, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

async function tx(f: Fixture, body: Record<string, unknown>) {
  const res = await f.client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Bank,
    date: '2026-09-10',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number };
}

async function bank(f: Fixture) {
  const accounts = (await f.client.get(`${f.base}/accounts`)).body;
  return accounts.find((a: { name: string }) => a.name === 'Bank');
}

describe('cleared balance and reconciliation', () => {
  it('tracks pending transactions separately', async () => {
    const f = await setupWorkspace();
    await tx(f, { amountMinor: 100_000 });
    await tx(f, { amountMinor: -5_000, status: 'pending' });
    expect(await bank(f)).toMatchObject({
      balanceMinor: 95_000,
      clearedBalanceMinor: 100_000,
      pendingCount: 1,
      reconciledThrough: null,
    });
  });

  it('reconciles against a statement, with an adjustment when needed', async () => {
    const f = await setupWorkspace();
    const salary = await tx(f, { amountMinor: 100_000, date: '2026-09-01' });
    const rent = await tx(f, { amountMinor: -20_000, date: '2026-09-05' });
    const pending = await tx(f, { amountMinor: -5_000, date: '2026-09-06', status: 'pending' });
    await tx(f, { amountMinor: -1_000, date: '2026-10-05' }); // after the statement

    const state = await f.client.get(
      `${f.base}/accounts/${f.accounts.Bank}/reconcile?statementDate=2026-09-30`,
    );
    expect(state.status).toBe(200);
    expect(state.body.reconciledBalanceMinor).toBe(0);
    expect(state.body.candidates.map((t: { id: string }) => t.id)).toEqual([
      salary.id,
      rent.id,
      pending.id,
    ]);

    const url = `${f.base}/accounts/${f.accounts.Bank}/reconcile`;
    const mismatch = await f.client.post(url, {
      statementDate: '2026-09-30',
      statementBalanceMinor: 79_000,
      transactionIds: [salary.id, rent.id],
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatchObject({
      code: 'reconcile_mismatch',
      details: { differenceMinor: -1_000 },
    });

    const done = await f.client.post(url, {
      statementDate: '2026-09-30',
      statementBalanceMinor: 80_000,
      transactionIds: [salary.id, rent.id],
    });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ adjustmentMinor: 0, transactionCount: 2 });
    expect((await bank(f)).reconciledThrough).toBe('2026-09-30');
    const reconciled = await f.client.get(`${f.base}/transactions/${rent.id}`);
    expect(reconciled.body.status).toBe('reconciled');

    // Already reconciled transactions can't be reconciled again.
    expect(
      (
        await f.client.post(url, {
          statementDate: '2026-10-31',
          statementBalanceMinor: 0,
          transactionIds: [rent.id],
        })
      ).status,
    ).toBe(400);

    // Next statement: the bank charged a fee nobody recorded.
    const next = await f.client.post(url, {
      statementDate: '2026-10-31',
      statementBalanceMinor: 73_500,
      transactionIds: [pending.id],
      adjust: true,
    });
    expect(next.body).toMatchObject({ adjustmentMinor: -1_500, transactionCount: 2 });
    const after = await f.client.get(
      `${f.base}/accounts/${f.accounts.Bank}/reconcile?statementDate=2026-10-31`,
    );
    expect(after.body.reconciledBalanceMinor).toBe(73_500);
    expect(after.body.candidates).toHaveLength(1); // the 5 Oct transaction
    expect(
      (await f.client.get(`${f.base}/accounts/${f.accounts.Bank}/reconciliations`)).body,
    ).toHaveLength(2);
  });

  it('asks before changing the amount of a reconciled transaction', async () => {
    const f = await setupWorkspace();
    const t = await tx(f, { amountMinor: -20_000 });
    await f.client.post(`${f.base}/accounts/${f.accounts.Bank}/reconcile`, {
      statementDate: '2026-09-30',
      statementBalanceMinor: -20_000,
      transactionIds: [t.id],
    });
    const blocked = await f.client.patch(`${f.base}/transactions/${t.id}`, {
      amountMinor: -21_000,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('reconciled');
    const notes = await f.client.patch(`${f.base}/transactions/${t.id}`, { notes: 'Rent' });
    expect(notes.status).toBe(200);
    const bulk = await f.client.post(`${f.base}/transactions/bulk`, {
      action: 'setStatus',
      ids: [t.id],
      status: 'pending',
    });
    expect(bulk.body).toEqual({ updated: 0, skipped: 1 });
    const confirmed = await f.client.patch(`${f.base}/transactions/${t.id}`, {
      amountMinor: -21_000,
      confirmReconciled: true,
    });
    expect(confirmed.status).toBe(200);
  });
});

describe('change history', () => {
  it('records edits, bulk changes, deletes and restores with who did them', async () => {
    const f = await setupWorkspace();
    const t = await tx(f, { amountMinor: -10_000, payee: 'Bhat Bhateni' });
    await f.client.patch(`${f.base}/transactions/${t.id}`, {
      amountMinor: -12_500,
      notes: 'Groceries',
    });
    // Saving without changes leaves no entry.
    await f.client.patch(`${f.base}/transactions/${t.id}`, { notes: 'Groceries' });
    await f.client.post(`${f.base}/transactions/bulk`, {
      action: 'setCategory',
      ids: [t.id],
      categoryId: f.categories['Food & Groceries'],
    });
    await f.client.delete(`${f.base}/transactions/${t.id}`);
    await f.client.post(`${f.base}/transactions/${t.id}/restore`);

    const history = await f.client.get(`${f.base}/transactions/${t.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual([
      'restore',
      'delete',
      'update',
      'update',
    ]);
    const [, , bulk, edit] = history.body;
    expect(edit.changes).toEqual({ amount: [-10_000, -12_500], notes: ['', 'Groceries'] });
    expect(edit.userName).toBe('Test User');
    expect(bulk.changes.categories).toEqual([[[null]], [[f.categories['Food & Groceries']]]]);

    const other = await setupWorkspace();
    expect((await other.client.get(`${f.base}/transactions/${t.id}/history`)).status).toBe(404);
  });
});

describe('attachments', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(100, 1),
  ]);

  async function upload(f: Fixture, transactionId: string, data: Buffer, name: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), name);
    const res = await testApp().app.request(`${f.base}/transactions/${transactionId}/attachments`, {
      method: 'POST',
      body: form,
      headers: { origin: ORIGIN, cookie: f.client.cookie },
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  it('stores, lists, serves and deletes receipts', async () => {
    const f = await setupWorkspace();
    const t = await tx(f, { amountMinor: -10_000 });
    const up = await upload(f, t.id, PNG, '../../bill "march".png');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      fileName: 'bill march.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });

    const list = await f.client.get(`${f.base}/transactions/${t.id}/attachments`);
    expect(list.body).toHaveLength(1);
    const detail = await f.client.get(`${f.base}/transactions/${t.id}`);
    expect(detail.body.attachmentCount).toBe(1);

    const file = await testApp().app.request(`${f.base}/attachments/${up.body.id}`, {
      headers: { cookie: f.client.cookie },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

    const other = await setupWorkspace();
    const stolen = await testApp().app.request(`${f.base}/attachments/${up.body.id}`, {
      headers: { cookie: other.client.cookie },
    });
    expect(stolen.status).toBe(404);

    expect((await f.client.delete(`${f.base}/attachments/${up.body.id}`)).status).toBe(204);
    expect((await f.client.get(`${f.base}/transactions/${t.id}/attachments`)).body).toHaveLength(0);
  });

  it('rejects files that are not images or PDFs, and big ones', async () => {
    const f = await setupWorkspace();
    const t = await tx(f, { amountMinor: -10_000 });
    const html = await upload(f, t.id, Buffer.from('<script>alert(1)</script>'), 'receipt.jpg');
    expect(html.status).toBe(400);
    const big = await upload(
      f,
      t.id,
      Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
      'huge.png',
    );
    expect(big.status).toBe(413);
    const pdf = await upload(f, t.id, Buffer.from('%PDF-1.4\n%fake'), 'statement');
    expect(pdf.body).toMatchObject({ contentType: 'application/pdf', fileName: 'statement.pdf' });
  });
});
