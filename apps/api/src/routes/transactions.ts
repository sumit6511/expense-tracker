import {
  BulkTransactionActionSchema,
  CreateTransactionSchema,
  CreateTransferSchema,
  Id,
  ListTransactionsQuerySchema,
  TransactionPageSchema,
  TransactionSchema,
  UpdateTransactionSchema,
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
  bulkUpdate,
  createTransaction,
  createTransfer,
  deleteTransaction,
  getTransaction,
  getTransfer,
  listTransactions,
  restoreTransactions,
  updateTransaction,
  updateTransfer,
} from '../services/transactions';

export const transactionsRouter = createRouter();

const TransferSchema = z.object({ from: TransactionSchema, to: TransactionSchema });
const BulkResultSchema = z.object({ updated: z.number(), skipped: z.number() });

transactionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/transactions',
    tags: ['Transactions'],
    summary: 'List transactions (newest first) with filters, cursor pagination and totals',
    request: { params: WidParams, query: ListTransactionsQuerySchema },
    responses: { 200: jsonContent(TransactionPageSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await listTransactions(c.get('deps').db, c.get('workspace'), c.req.valid('query')), 200),
);

transactionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/transactions',
    tags: ['Transactions'],
    summary: 'Create a transaction. Sending the same client id twice returns the original (200).',
    request: { params: WidParams, ...jsonBody(CreateTransactionSchema) },
    responses: {
      201: jsonContent(TransactionSchema, 'Created'),
      200: jsonContent(TransactionSchema, 'Already existed (idempotent retry)'),
      ...errorResponses,
    },
  }),
  async (c) => {
    const user = c.get('user')!;
    const { transaction, created } = await createTransaction(
      c.get('deps').db,
      c.get('workspace'),
      user.id,
      c.req.valid('json'),
    );
    return created ? c.json(transaction, 201) : c.json(transaction, 200);
  },
);

transactionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/transactions/bulk',
    tags: ['Transactions'],
    summary: 'Apply one action to many transactions (categorize, tag, delete, restore, …)',
    request: { params: WidParams, ...jsonBody(BulkTransactionActionSchema) },
    responses: { 200: jsonContent(BulkResultSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await bulkUpdate(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('json'),
      ),
      200,
    ),
);

transactionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/transactions/{id}',
    tags: ['Transactions'],
    summary: 'One transaction',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(TransactionSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await getTransaction(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id),
      200,
    ),
);

transactionsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/transactions/{id}',
    tags: ['Transactions'],
    summary: 'Update a transaction. Send `version` to detect conflicting edits (409).',
    request: { params: WidIdParams, ...jsonBody(UpdateTransactionSchema) },
    responses: { 200: jsonContent(TransactionSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateTransaction(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

transactionsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/transactions/{id}',
    tags: ['Transactions'],
    summary: 'Move a transaction to the trash (both legs of a transfer). Restorable for 30 days.',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteTransaction(
      c.get('deps').db,
      c.get('workspace').id,
      c.get('user')!.id,
      c.req.valid('param').id,
    );
    return c.body(null, 204);
  },
);

transactionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/transactions/{id}/restore',
    tags: ['Transactions'],
    summary: 'Restore a transaction from the trash',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(TransactionSchema), ...errorResponses },
  }),
  async (c) => {
    const { db } = c.get('deps');
    const ws = c.get('workspace');
    const { id } = c.req.valid('param');
    await db.transaction((tx) => restoreTransactions(tx, ws.id, c.get('user')!.id, [id]));
    return c.json(await getTransaction(db, ws.id, id), 200);
  },
);

// Transfers ------------------------------------------------------------------------------------

const TransferParams = z.object({ wid: Id, groupId: Id });

transactionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/transfers',
    tags: ['Transfers'],
    summary: 'Move money between two accounts (also used for credit card payments)',
    request: { params: WidParams, ...jsonBody(CreateTransferSchema) },
    responses: { 201: jsonContent(TransferSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await createTransfer(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('json'),
      ),
      201,
    ),
);

transactionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/transfers/{groupId}',
    tags: ['Transfers'],
    summary: 'Both legs of a transfer',
    request: { params: TransferParams },
    responses: { 200: jsonContent(TransferSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await getTransfer(c.get('deps').db, c.get('workspace').id, c.req.valid('param').groupId),
      200,
    ),
);

transactionsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/transfers/{groupId}',
    tags: ['Transfers'],
    summary: 'Change a transfer’s accounts, amounts, date or notes',
    request: {
      params: TransferParams,
      ...jsonBody(
        z.object({
          fromAccountId: Id.optional(),
          toAccountId: Id.optional(),
          date: CreateTransferSchema.shape.date.optional(),
          amountMinor: z.number().int().positive().optional(),
          toAmountMinor: z.number().int().positive().optional(),
          notes: z.string().trim().max(1000).nullable().optional(),
        }),
      ),
    },
    responses: { 200: jsonContent(TransferSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateTransfer(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('param').groupId,
        c.req.valid('json'),
      ),
      200,
    ),
);
