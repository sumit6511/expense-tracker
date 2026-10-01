import { timingSafeEqual } from 'node:crypto';
import {
  CreateTransactionSchema,
  EmailInSchema,
  EmailSenderInputSchema,
  TransactionSchema,
  UpdateEmailInSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { ApiError } from '../lib/errors';
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
  addSender,
  dismissEmail,
  getEmailIn,
  getInboundFile,
  linkEmail,
  newEmailAddress,
  receiveEmail,
  recordFromEmail,
  removeSender,
  updateEmailIn,
} from '../services/email-in';

export const emailInRouter = createRouter();

const tags = ['Email in'];

emailInRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/email-in',
    tags,
    summary: 'The workspace’s email-in address, trusted senders and latest emails',
    request: { params: WidParams },
    responses: { 200: jsonContent(EmailInSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    return c.json(await getEmailIn(db, env, c.get('workspace')), 200);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/email-in',
    tags,
    summary: 'Choose the account emailed receipts go to (owners and admins)',
    request: { params: WidParams, ...jsonBody(UpdateEmailInSchema) },
    responses: { 200: jsonContent(EmailInSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    return c.json(await updateEmailIn(db, env, c.get('workspace'), c.req.valid('json')), 200);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/email-in/address',
    tags,
    summary: 'Make a new address (the old one stops working)',
    request: { params: WidParams },
    responses: { 200: jsonContent(EmailInSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    return c.json(await newEmailAddress(db, env, c.get('workspace')), 200);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/email-in/senders',
    tags,
    summary: 'Trust a sender (an address or @domain), optionally for one account',
    request: { params: WidParams, ...jsonBody(EmailSenderInputSchema) },
    responses: { 200: jsonContent(EmailInSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    return c.json(await addSender(db, env, c.get('workspace'), c.req.valid('json')), 200);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/email-in/senders/{id}',
    tags,
    summary: 'Stop trusting a sender',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(EmailInSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, env } = c.get('deps');
    return c.json(await removeSender(db, env, c.get('workspace'), c.req.valid('param').id), 200);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/email-in/messages/{id}/transaction',
    tags,
    summary: 'Add the transaction for an email that couldn’t be read, with its files attached',
    request: { params: WidIdParams, ...jsonBody(CreateTransactionSchema) },
    responses: { 201: jsonContent(TransactionSchema, 'Created'), ...errorResponses },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const tx = await recordFromEmail(c.get('deps').db, c.get('workspace'), id, c.req.valid('json'));
    return c.json(tx, 201);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/email-in/messages/{id}/link',
    tags,
    summary: 'Mark an email as handled by a transaction you added',
    request: { params: WidIdParams, ...jsonBody(z.object({ transactionId: z.uuid() })) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await linkEmail(c.get('deps').db, c.get('workspace'), id, c.req.valid('json').transactionId);
    return c.body(null, 204);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/email-in/messages/{id}',
    tags,
    summary: 'Dismiss an email (and any files kept from it)',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await dismissEmail(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);

emailInRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/email-in/messages/{id}/files/{fileId}',
    tags,
    summary: 'A file kept from an email',
    request: { params: WidIdParams.extend({ fileId: z.uuid() }) },
    responses: { 200: { description: 'The file' }, ...errorResponses },
  }),
  async (c) => {
    const { id, fileId } = c.req.valid('param');
    const file = await getInboundFile(c.get('deps').db, c.get('workspace'), id, fileId);
    return c.body(new Uint8Array(file.data), 200, {
      'content-type': file.contentType,
      'content-disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`,
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    });
  },
);

/**
 * POST /api/inbound/email: raw messages (RFC 822) from a mail service or a forwarding worker,
 * authorised with EMAIL_IN_SECRET. `?to=` may give the address it was delivered to.
 */
export function mountInboundEmail(app: Hono<AppEnv>) {
  app.post(
    '/api/inbound/email',
    bodyLimit({
      maxSize: 30 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: { code: 'too_large', message: 'Emails can be at most 30 MB' } }, 413),
    }),
    async (c) => {
      const deps = c.get('deps');
      const secret = deps.env.EMAIL_IN_SECRET;
      if (!secret || !deps.env.EMAIL_IN_ADDRESS) {
        throw new ApiError(404, 'not_found', 'Email in isn’t set up on this server');
      }
      const given = Buffer.from(
        /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1] ?? '',
      );
      const expected = Buffer.from(secret);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new ApiError(401, 'unauthorized', 'Wrong or missing secret');
      }
      const raw = Buffer.from(await c.req.arrayBuffer());
      if (raw.length === 0) throw new ApiError(400, 'empty', 'No message in the request');
      const results = await receiveEmail(deps, raw, c.req.query('to') ?? undefined);
      return c.json({ received: results.length, results }, 202);
    },
  );
}
