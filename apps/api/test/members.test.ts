import { todayIn } from '@et/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { invitations } from '../src/db/schema';
import { Client, type Fixture, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const tokenOf = (link: string) => link.split('/invite/')[1]!;

/** Invites a brand-new user into `f`'s workspace and has them accept. */
async function join(f: Fixture, role: 'admin' | 'editor' | 'viewer' = 'editor', name = 'Sita') {
  const person = await signUp(name);
  const invite = await f.client.post(`${f.base}/invitations`, { email: person.email, role });
  expect(invite.status).toBe(201);
  const accepted = await person.post(`/api/v1/invitations/${tokenOf(invite.body.link)}/accept`);
  expect(accepted.status).toBe(200);
  return person;
}

async function spend(client: Client, f: Fixture) {
  const res = await client.post(`${f.base}/transactions`, {
    accountId: f.accounts.Cash,
    date: todayIn('Asia/Kathmandu'),
    amountMinor: -10_000,
  });
  return res;
}

describe('invitations', () => {
  it('invites by email, previews the link and joins with the right role', async () => {
    const { outbox } = testApp();
    const f = await setupWorkspace();
    const person = await signUp('Sita');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: person.email.toUpperCase(),
      role: 'editor',
    });
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({
      invitation: { email: person.email, role: 'editor', invitedByName: 'Test User' },
      emailed: true,
    });
    expect(invite.body.link).toMatch(/^http:\/\/localhost:5173\/invite\/[\w-]{40,}$/);
    const mail = outbox.find((m) => m.to === person.email)!;
    expect(mail.subject).toBe('Test User invited you to “Home”');
    expect(mail.text).toContain(invite.body.link);

    const token = tokenOf(invite.body.link);
    const preview = await new Client().get(`/api/v1/invitations/${token}`);
    expect(preview.body).toEqual({
      workspaceId: f.ws.id,
      workspaceName: 'Home',
      invitedByName: 'Test User',
      role: 'editor',
      email: person.email,
      status: 'pending',
    });
    expect((await f.client.get(`${f.base}/members`)).body.invitations).toHaveLength(1);

    const accepted = await person.post(`/api/v1/invitations/${token}/accept`);
    expect(accepted.body).toMatchObject({ id: f.ws.id, name: 'Home', role: 'editor' });
    // Accepting again just returns the workspace.
    expect((await person.post(`/api/v1/invitations/${token}/accept`)).status).toBe(200);
    expect((await new Client().get(`/api/v1/invitations/${token}`)).body.status).toBe('accepted');
    const me = await person.get('/api/v1/me');
    expect(me.body.workspaces.map((w: { id: string }) => w.id)).toEqual([f.ws.id]);
    expect(me.body.defaultWorkspaceId).toBe(f.ws.id);

    const members = await f.client.get(`${f.base}/members`);
    expect(members.body.members.map((m: any) => [m.name, m.role, m.you])).toEqual([
      ['Test User', 'owner', true],
      ['Sita', 'editor', false],
    ]);
    expect(members.body.invitations).toEqual([]);
  });

  it('only works for the invited address, once, before it expires', async () => {
    const { db } = testApp();
    const f = await setupWorkspace();
    const invited = await signUp('Invited');
    const stranger = await signUp('Stranger');
    const invite = await f.client.post(`${f.base}/invitations`, { email: invited.email });
    const token = tokenOf(invite.body.link);

    const wrong = await stranger.post(`/api/v1/invitations/${token}/accept`);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toContain(invited.email);
    expect((await new Client().post(`/api/v1/invitations/${token}/accept`)).status).toBe(401);
    expect((await invited.post('/api/v1/invitations/not-a-real-token-1234567/accept')).status).toBe(
      404,
    );

    // Inviting again replaces the link.
    const again = await f.client.post(`${f.base}/invitations`, {
      email: invited.email,
      role: 'viewer',
    });
    expect((await invited.post(`/api/v1/invitations/${token}/accept`)).status).toBe(404);
    const newToken = tokenOf(again.body.link);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, again.body.invitation.id));
    expect((await new Client().get(`/api/v1/invitations/${newToken}`)).body.status).toBe('expired');
    expect((await invited.post(`/api/v1/invitations/${newToken}/accept`)).status).toBe(409);

    const renewed = await f.client.post(`${f.base}/invitations/${again.body.invitation.id}/renew`);
    expect(renewed.status).toBe(200);
    expect(renewed.body.invitation.expired).toBe(false);
    const joined = await invited.post(`/api/v1/invitations/${tokenOf(renewed.body.link)}/accept`);
    expect(joined.body.role).toBe('viewer');

    // Already a member.
    expect((await f.client.post(`${f.base}/invitations`, { email: invited.email })).status).toBe(
      409,
    );
  });

  it('can be cancelled, and only owners and admins invite', async () => {
    const f = await setupWorkspace();
    const invite = await f.client.post(`${f.base}/invitations`, { email: 'friend@example.com' });
    const id = invite.body.invitation.id;
    expect((await f.client.delete(`${f.base}/invitations/${id}`)).status).toBe(204);
    expect(
      (await new Client().get(`/api/v1/invitations/${tokenOf(invite.body.link)}`)).status,
    ).toBe(404);
    expect((await f.client.delete(`${f.base}/invitations/${id}`)).status).toBe(404);
    expect(
      (await f.client.post(`${f.base}/invitations`, { email: 'x@example.com', role: 'owner' }))
        .status,
    ).toBe(400);
    expect((await f.client.post(`${f.base}/invitations`, { email: 'not an email' })).status).toBe(
      400,
    );

    const editor = await join(f, 'editor');
    const res = await editor.post(`${f.base}/invitations`, { email: 'someone@example.com' });
    expect(res.status).toBe(403);
    const members = await editor.get(`${f.base}/members`);
    expect(members.status).toBe(200);
    expect(members.body.invitations).toEqual([]);
  });
});

describe('members', () => {
  it('shows who added each transaction and filters by person', async () => {
    const f = await setupWorkspace();
    const sita = await join(f, 'editor', 'Sita');
    const mine = await spend(f.client, f);
    const hers = await spend(sita, f);
    expect(mine.body.createdBy).toBe(f.client.userId);
    expect(hers.body.createdBy).toBe(sita.userId);
    const list = await f.client.get(`${f.base}/transactions?createdBy=${sita.userId}`);
    expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([hers.body.id]);
  });

  it('changes roles and removes people, within limits', async () => {
    const f = await setupWorkspace();
    const admin = await join(f, 'admin', 'Admin');
    const other = await join(f, 'admin', 'Other admin');
    const editor = await join(f, 'editor', 'Editor');

    // Admins manage editors and viewers, not the owner or other admins.
    expect(
      (await admin.patch(`${f.base}/members/${editor.userId}`, { role: 'viewer' })).status,
    ).toBe(200);
    expect(
      (await admin.patch(`${f.base}/members/${other.userId}`, { role: 'editor' })).status,
    ).toBe(403);
    expect(
      (await admin.patch(`${f.base}/members/${f.client.userId}`, { role: 'editor' })).status,
    ).toBe(403);
    expect(
      (await admin.patch(`${f.base}/members/${admin.userId}`, { role: 'editor' })).status,
    ).toBe(400);
    expect((await admin.delete(`${f.base}/members/${other.userId}`)).status).toBe(403);
    expect(
      (await f.client.patch(`${f.base}/members/${editor.userId}`, { role: 'owner' })).status,
    ).toBe(400);

    // The viewer can read but not write, and can still leave.
    expect((await spend(editor, f)).status).toBe(403);
    expect((await editor.get(`${f.base}/transactions`)).status).toBe(200);
    expect((await editor.delete(`/api/v1/me/workspaces/${f.ws.id}`)).status).toBe(204);
    expect((await editor.get(f.base)).status).toBe(404);

    // The owner removes an admin.
    expect((await f.client.delete(`${f.base}/members/${other.userId}`)).status).toBe(204);
    expect((await other.get(f.base)).status).toBe(404);
    const members = await f.client.get(`${f.base}/members`);
    expect(members.body.members.map((m: { name: string }) => m.name)).toEqual([
      'Test User',
      'Admin',
    ]);
  });

  it('hands over ownership', async () => {
    const f = await setupWorkspace();
    const sita = await join(f, 'editor', 'Sita');
    expect((await f.client.delete(`/api/v1/me/workspaces/${f.ws.id}`)).status).toBe(409);
    expect(
      (await sita.post(`${f.base}/transfer-ownership`, { userId: f.client.userId })).status,
    ).toBe(403);
    const moved = await f.client.post(`${f.base}/transfer-ownership`, { userId: sita.userId });
    expect(moved.status).toBe(200);
    expect(moved.body.members.map((m: any) => [m.name, m.role])).toEqual([
      ['Sita', 'owner'],
      ['Test User', 'admin'],
    ]);
    expect((await f.client.delete(f.base)).status).toBe(403);
    expect((await f.client.delete(`/api/v1/me/workspaces/${f.ws.id}`)).status).toBe(204);
    expect((await sita.get(f.base)).body.role).toBe('owner');
  });

  it('gives shared workspaces a new owner when the owner deletes their account', async () => {
    const f = await setupWorkspace();
    const editor = await join(f, 'editor', 'Editor');
    const admin = await join(f, 'admin', 'Admin');
    const deleted = await f.client.post('/api/auth/delete-user', {
      password: 'correct-horse-battery',
    });
    expect(deleted.status).toBe(200);
    expect((await admin.get(f.base)).body.role).toBe('owner');
    expect((await editor.get(f.base)).body.role).toBe('editor');
    // Their transactions stay.
    expect((await admin.get(`${f.base}/transactions`)).status).toBe(200);
  });
});
