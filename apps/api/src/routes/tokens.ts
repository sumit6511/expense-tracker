import { ApiTokenSchema, CreateApiTokenSchema, CreatedApiTokenSchema } from '@et/shared';
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
import { createToken, listTokens, revokeToken } from '../services/tokens';

export const tokensRouter = createRouter();

const tags = ['Access tokens'];

tokensRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/tokens',
    tags,
    summary: 'Your access tokens for this workspace (owners and admins see everyone’s)',
    description: 'Only from the app: access tokens can’t manage tokens.',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(ApiTokenSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listTokens(c.get('deps').db, c.get('workspace')), 200),
);

tokensRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/tokens',
    tags,
    summary: 'Make an access token for your scripts and tools',
    description:
      'The response is the only time the full token is shown. Viewers can only make read tokens.',
    request: { params: WidParams, ...jsonBody(CreateApiTokenSchema) },
    responses: { 201: jsonContent(CreatedApiTokenSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(await createToken(c.get('deps').db, c.get('workspace'), c.req.valid('json')), 201),
);

tokensRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/tokens/{id}',
    tags,
    summary: 'Revoke an access token',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await revokeToken(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);
