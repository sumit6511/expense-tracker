import {
  CreateWorkspaceSchema,
  MeSchema,
  SessionInfoSchema,
  SignInOptionsSchema,
  UpdateMeSchema,
  WorkspaceSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { badRequest } from '../lib/errors';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  NoContent,
  requireUser,
} from '../lib/openapi';
import { getAvatarPhoto, setAvatarPhoto } from '../services/avatars';
import { restoreBackup } from '../services/backup';
import { listSessions, revokeOtherSessions, revokeSession } from '../services/sessions';
import { createWorkspace, getMe, listWorkspaces, updateMe } from '../services/workspaces';

export const meRouter = createRouter();

meRouter.openapi(
  createRoute({
    method: 'get',
    path: '/sign-in-options',
    tags: ['Me'],
    summary: 'What the sign-in page can offer on this server (no sign-in needed)',
    responses: { 200: jsonContent(SignInOptionsSchema) },
  }),
  (c) => {
    const { env, mailer } = c.get('deps');
    return c.json({ signUp: env.ALLOW_SIGNUP, passwordReset: mailer !== null }, 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'get',
    path: '/me',
    tags: ['Me'],
    summary: 'The signed-in user, their workspaces and preferences',
    responses: { 200: jsonContent(MeSchema), 401: errorResponses[401] },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const me = await getMe(c.get('deps').db, user.id);
    // An access token only reaches its own workspace.
    const token = c.get('token');
    if (token) {
      me.workspaces = me.workspaces.filter((w) => w.id === token.workspaceId);
      me.defaultWorkspaceId = token.workspaceId;
    }
    return c.json(me, 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/me',
    tags: ['Me'],
    summary: 'Update name and preferences',
    request: jsonBody(UpdateMeSchema),
    responses: { 200: jsonContent(MeSchema), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    return c.json(await updateMe(c.get('deps').db, user.id, c.req.valid('json')), 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'get',
    path: '/me/sessions',
    tags: ['Me'],
    summary: 'Devices and browsers signed in to your account',
    responses: { 200: jsonContent(z.array(SessionInfoSchema)), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    return c.json(await listSessions(c.get('deps').db, user.id, c.get('sessionId')), 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/me/sessions/{id}',
    tags: ['Me'],
    summary: 'Sign out one of your other devices',
    request: { params: z.object({ id: z.string().min(1).max(100) }) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { id } = c.req.valid('param');
    await revokeSession(c.get('deps').db, user.id, c.get('sessionId'), id);
    return c.body(null, 204);
  },
);

meRouter.openapi(
  createRoute({
    method: 'post',
    path: '/me/sessions/sign-out-others',
    tags: ['Me'],
    summary: 'Sign out everywhere except this device',
    responses: {
      200: jsonContent(z.object({ signedOut: z.number().int() })),
      ...errorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const signedOut = await revokeOtherSessions(c.get('deps').db, user.id, c.get('sessionId'));
    return c.json({ signedOut }, 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'post',
    path: '/me/avatar',
    tags: ['Me'],
    summary: 'Upload a profile photo (JPG, PNG or WebP, at most 512 KB)',
    request: {
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: { file: { type: 'string', format: 'binary' } },
              required: ['file'],
            },
          },
        },
      },
    },
    responses: { 200: jsonContent(MeSchema), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const file = (await c.req.parseBody()).file;
    if (!(file instanceof File)) throw badRequest('Send the photo in a "file" form field');
    const db = c.get('deps').db;
    await setAvatarPhoto(db, user.id, Buffer.from(await file.arrayBuffer()));
    return c.json(await getMe(db, user.id), 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'get',
    path: '/avatars/{userId}',
    tags: ['Me'],
    summary: "Someone's profile photo (yours, or a person you share a workspace with)",
    request: { params: z.object({ userId: z.string().min(1).max(100) }) },
    responses: {
      200: {
        description: 'The photo',
        content: { 'image/*': { schema: { type: 'string', format: 'binary' } } },
      },
      ...errorResponses,
    },
  }),
  async (c) => {
    const viewer = requireUser(c.get('user'));
    const photo = await getAvatarPhoto(c.get('deps').db, viewer.id, c.req.valid('param').userId);
    return c.body(new Uint8Array(photo.data), 200, {
      'Content-Type': photo.contentType,
      'Content-Length': String(photo.data.length),
      // The address changes with each new photo, so it can be kept.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
  },
);

meRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces',
    tags: ['Workspaces'],
    summary: 'Workspaces the user belongs to',
    responses: { 200: jsonContent(z.array(WorkspaceSchema)), 401: errorResponses[401] },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const list = await listWorkspaces(c.get('deps').db, user.id);
    const token = c.get('token');
    return c.json(token ? list.filter((w) => w.id === token.workspaceId) : list, 200);
  },
);

meRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces',
    tags: ['Workspaces'],
    summary: 'Create a workspace, optionally with starter categories and accounts',
    request: jsonBody(CreateWorkspaceSchema),
    responses: { 201: jsonContent(WorkspaceSchema, 'Created'), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    return c.json(await createWorkspace(c.get('deps').db, user.id, c.req.valid('json')), 201);
  },
);

meRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/restore',
    tags: ['Workspaces'],
    summary: 'Restore a JSON backup into a new workspace',
    request: jsonBody(
      z.object({ backup: z.unknown(), name: z.string().trim().min(1).max(60).optional() }),
    ),
    responses: { 201: jsonContent(WorkspaceSchema, 'Restored'), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { backup, name } = c.req.valid('json');
    return c.json(await restoreBackup(c.get('deps').db, user.id, backup, name), 201);
  },
);
