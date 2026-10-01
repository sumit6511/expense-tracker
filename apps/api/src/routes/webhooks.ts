import {
  CreatedWebhookSchema,
  CreateWebhookSchema,
  UpdateWebhookSchema,
  WebhookDeliverySchema,
  WebhookSchema,
  WebhookSecretSchema,
  WebhookTestResultSchema,
} from '@et/shared';
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
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  retryDelivery,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
} from '../services/webhooks';

export const webhooksRouter = createRouter();

const tags = ['Webhooks'];
const description =
  'Owners and admins only, from the app. Deliveries are JSON POSTs signed the Standard Webhooks ' +
  'way: verify `webhook-signature` (v1, HMAC-SHA256 of "<webhook-id>.<webhook-timestamp>.<body>" ' +
  'with the secret after `whsec_`, base64-decoded). Failed deliveries are retried for about a day.';

webhooksRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/webhooks',
    tags,
    summary: 'Webhooks for this workspace',
    description,
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(WebhookSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listWebhooks(c.get('deps').db, c.get('workspace')), 200),
);

webhooksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/webhooks',
    tags,
    summary: 'Add a webhook (the response includes its signing secret)',
    description,
    request: { params: WidParams, ...jsonBody(CreateWebhookSchema) },
    responses: { 201: jsonContent(CreatedWebhookSchema, 'Created'), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    return c.json(await createWebhook(db, env, c.get('workspace'), c.req.valid('json')), 201);
  },
);

webhooksRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/webhooks/{id}',
    tags,
    summary: 'Change a webhook, or turn it on or off',
    request: { params: WidIdParams, ...jsonBody(UpdateWebhookSchema) },
    responses: { 200: jsonContent(WebhookSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    const { id } = c.req.valid('param');
    return c.json(await updateWebhook(db, env, c.get('workspace'), id, c.req.valid('json')), 200);
  },
);

webhooksRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/webhooks/{id}',
    tags,
    summary: 'Remove a webhook',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteWebhook(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);

webhooksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/webhooks/{id}/secret',
    tags,
    summary: 'Replace the signing secret',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(WebhookSecretSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    const { id } = c.req.valid('param');
    return c.json(await rotateWebhookSecret(db, env, c.get('workspace'), id), 200);
  },
);

webhooksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/webhooks/{id}/test',
    tags,
    summary: 'Send a "ping" now and see what the receiver answers',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(WebhookTestResultSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env, webhookSender } = c.get('deps');
    const { id } = c.req.valid('param');
    return c.json(await testWebhook(db, env, webhookSender, c.get('workspace'), id), 200);
  },
);

webhooksRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/webhooks/{id}/deliveries',
    tags,
    summary: 'The latest 50 deliveries',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(z.array(WebhookDeliverySchema)), ...errorResponses },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await listDeliveries(c.get('deps').db, c.get('workspace'), id), 200);
  },
);

webhooksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/webhooks/{id}/deliveries/{deliveryId}/retry',
    tags,
    summary: 'Send a delivery again',
    request: { params: WidIdParams.extend({ deliveryId: z.uuid() }) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const { id, deliveryId } = c.req.valid('param');
    await retryDelivery(c.get('deps').db, c.get('workspace'), id, deliveryId);
    return c.body(null, 204);
  },
);
