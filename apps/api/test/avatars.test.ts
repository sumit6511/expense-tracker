import { afterAll, describe, expect, it } from 'vitest';
import { type Client, ORIGIN, setupWorkspace, signUp, testApp } from './helpers';

afterAll(async () => {
  await testApp().pool.end();
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 7),
]);

async function upload(client: Client, data: Buffer, name = 'me.png') {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)]), name);
  const res = await testApp().app.request('/api/v1/me/avatar', {
    method: 'POST',
    body: form,
    headers: { origin: ORIGIN, cookie: client.cookie },
  });
  return { status: res.status, body: (await res.json()) as any };
}

function fetchPhoto(client: Client, url: string) {
  return testApp().app.request(url, { headers: { cookie: client.cookie } });
}

describe('profile pictures', () => {
  it('chooses a ready-made avatar, or none', async () => {
    const asha = await signUp('Asha');
    expect((await asha.get('/api/v1/me')).body.user.avatar).toBeNull();
    const chosen = await asha.patch('/api/v1/me', { avatar: 'preset:panda' });
    expect(chosen.body.user.avatar).toBe('preset:panda');
    const unknown = await asha.patch('/api/v1/me', { avatar: 'preset:dragon' });
    expect(unknown.status).toBe(400);
    const cleared = await asha.patch('/api/v1/me', { avatar: null });
    expect(cleared.body.user.avatar).toBeNull();
  });

  it('keeps an uploaded photo, shown only to people who share a workspace', async () => {
    const f = await setupWorkspace();
    const up = await upload(f.client, PNG);
    expect(up.status).toBe(200);
    const url = up.body.user.avatar as string;
    expect(url).toMatch(/^\/api\/v1\/avatars\/.+\?v=\w+$/);

    const mine = await fetchPhoto(f.client, url);
    expect(mine.status).toBe(200);
    expect(mine.headers.get('content-type')).toBe('image/png');
    expect(mine.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await mine.arrayBuffer()).equals(PNG)).toBe(true);

    // A stranger can't see it; someone in the same workspace can, and sees it in the list.
    const stranger = await signUp('Stranger');
    expect((await fetchPhoto(stranger, url)).status).toBe(404);
    const sita = await signUp('Sita');
    const invite = await f.client.post(`${f.base}/invitations`, {
      email: sita.email,
      role: 'editor',
    });
    await sita.post(`/api/v1/invitations/${invite.body.link.split('/invite/')[1]}/accept`);
    expect((await fetchPhoto(sita, url)).status).toBe(200);
    const members = (await sita.get(`${f.base}/members`)).body.members;
    expect(members.find((m: { you: boolean }) => !m.you).avatar).toBe(url);

    // A new photo gets a new address; choosing a preset lets the photo go.
    const again = await upload(f.client, Buffer.concat([PNG, Buffer.from([1])]));
    expect(again.body.user.avatar).not.toBe(url);
    await f.client.patch('/api/v1/me', { avatar: 'preset:mountain' });
    expect((await fetchPhoto(f.client, again.body.user.avatar)).status).toBe(404);
  });

  it('takes only real images, and not too large', async () => {
    const asha = await signUp('Asha');
    const text = await upload(asha, Buffer.from('<svg onload="alert(1)"></svg>'), 'x.png');
    expect(text.status).toBe(400);
    expect(text.body.error.message).toBe('Use a JPG, PNG or WebP photo');
    const huge = await upload(asha, Buffer.concat([PNG, Buffer.alloc(600 * 1024)]));
    expect(huge.status).toBe(413);
  });
});
