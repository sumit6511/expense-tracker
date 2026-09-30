import {
  AttachmentSchema,
  FinishReconcileSchema,
  Id,
  ReconcileQuerySchema,
  ReconcileStateSchema,
  ReconciliationSchema,
  TransactionChangeSchema,
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
  WidIdParams,
} from '../lib/openapi';
import {
  addAttachment,
  deleteAttachment,
  getAttachmentFile,
  listAttachments,
} from '../services/attachments';
import { transactionHistory } from '../services/audit';
import { finishReconciliation, listReconciliations, reconcileState } from '../services/reconcile';

/** History, reconciliation and attachments: keeping the books trustworthy. */
export const ledgerRouter = createRouter();

ledgerRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/transactions/{id}/history',
    tags: ['Transactions'],
    summary: 'Who changed a transaction, and what changed (newest first)',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(z.array(TransactionChangeSchema)), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await transactionHistory(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id),
      200,
    ),
);

// Reconciliation -------------------------------------------------------------------------------

ledgerRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/accounts/{id}/reconcile',
    tags: ['Accounts'],
    summary: 'Start reconciling: the reconciled balance and the transactions not yet reconciled',
    request: { params: WidIdParams, query: ReconcileQuerySchema },
    responses: { 200: jsonContent(ReconcileStateSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await reconcileState(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('query').statementDate,
      ),
      200,
    ),
);

ledgerRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/accounts/{id}/reconcile',
    tags: ['Accounts'],
    summary: 'Finish reconciling against a statement',
    description:
      'Marks the given transactions reconciled. Fails with 409 `reconcile_mismatch` (details.differenceMinor) unless they add up to the statement balance or `adjust` is set.',
    request: { params: WidIdParams, ...jsonBody(FinishReconcileSchema) },
    responses: { 201: jsonContent(ReconciliationSchema, 'Reconciled'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await finishReconciliation(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      201,
    ),
);

ledgerRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/accounts/{id}/reconciliations',
    tags: ['Accounts'],
    summary: 'Past reconciliations of an account',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(z.array(ReconciliationSchema)), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await listReconciliations(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id),
      200,
    ),
);

// Attachments ----------------------------------------------------------------------------------

ledgerRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/transactions/{id}/attachments',
    tags: ['Attachments'],
    summary: 'Files attached to a transaction',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(z.array(AttachmentSchema)), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await listAttachments(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id),
      200,
    ),
);

ledgerRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/transactions/{id}/attachments',
    tags: ['Attachments'],
    summary:
      'Attach a receipt: multipart/form-data with a "file" field (JPEG, PNG, WebP or PDF, ≤ 5 MB)',
    request: {
      params: WidIdParams,
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
    responses: { 201: jsonContent(AttachmentSchema, 'Attached'), ...errorResponses },
  }),
  async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badRequest('Send the file in a "file" form field');
    const attachment = await addAttachment(
      c.get('deps').db,
      c.get('workspace').id,
      c.get('user')!.id,
      c.req.valid('param').id,
      { name: file.name, data: Buffer.from(await file.arrayBuffer()) },
    );
    return c.json(attachment, 201);
  },
);

const AttachmentParams = z.object({ wid: Id, attachmentId: Id });

ledgerRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/attachments/{attachmentId}',
    tags: ['Attachments'],
    summary: 'Download an attachment (images open inline, PDFs download)',
    request: { params: AttachmentParams },
    responses: {
      200: {
        description: 'The file',
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      ...errorResponses,
    },
  }),
  async (c) => {
    const file = await getAttachmentFile(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').attachmentId,
    );
    const image = file.contentType.startsWith('image/');
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, max-age=86400, immutable',
      // Nothing in an attachment may run scripts or load anything.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
    });
  },
);

ledgerRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/attachments/{attachmentId}',
    tags: ['Attachments'],
    summary: 'Remove an attachment',
    request: { params: AttachmentParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteAttachment(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').attachmentId,
    );
    return c.body(null, 204);
  },
);
