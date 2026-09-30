import { CreateWorkspaceSchema, MeSchema, UpdateMeSchema, WorkspaceSchema } from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { createRouter, errorResponses, jsonBody, jsonContent, requireUser } from '../lib/openapi';
import { restoreBackup } from '../services/backup';
import { createWorkspace, getMe, listWorkspaces, updateMe } from '../services/workspaces';

export const meRouter = createRouter();

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
    return c.json(await getMe(c.get('deps').db, user.id), 200);
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
    path: '/workspaces',
    tags: ['Workspaces'],
    summary: 'Workspaces the user belongs to',
    responses: { 200: jsonContent(z.array(WorkspaceSchema)), 401: errorResponses[401] },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    return c.json(await listWorkspaces(c.get('deps').db, user.id), 200);
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
