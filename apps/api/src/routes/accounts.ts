import { AccountSchema, CreateAccountSchema, UpdateAccountSchema } from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  NoContent,
  WidIdParams,
  WidParams,
} from '../lib/openapi';
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../services/accounts';

export const accountsRouter = createRouter();

accountsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/accounts',
    tags: ['Accounts'],
    summary: 'Accounts with current balances',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(AccountSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listAccounts(c.get('deps').db, c.get('workspace')), 200),
);

accountsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/accounts',
    tags: ['Accounts'],
    summary: 'Create an account',
    request: { params: WidParams, ...jsonBody(CreateAccountSchema) },
    responses: { 201: jsonContent(AccountSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(await createAccount(c.get('deps').db, c.get('workspace'), c.req.valid('json')), 201),
);

accountsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/accounts/{id}',
    tags: ['Accounts'],
    summary: 'One account',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(AccountSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await getAccount(c.get('deps').db, c.get('workspace'), c.req.valid('param').id), 200),
);

accountsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/accounts/{id}',
    tags: ['Accounts'],
    summary: 'Update or archive an account (currency cannot change)',
    request: { params: WidIdParams, ...jsonBody(UpdateAccountSchema) },
    responses: { 200: jsonContent(AccountSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateAccount(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

accountsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/accounts/{id}',
    tags: ['Accounts'],
    summary: 'Delete an account that has no transactions',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteAccount(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);
