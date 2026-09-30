import {
  ExchangeRateSchema,
  IsoDateSchema,
  ListTransactionsQuerySchema,
  SetManualRateSchema,
  todayIn,
  UpdateWorkspaceSchema,
  WorkspaceSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  NoContent,
  WidParams,
} from '../lib/openapi';
import { requireRole } from '../middleware/workspace';
import { exportBackup, exportTransactionsCsv } from '../services/backup';
import { deleteManualRate, latestRates, setManualRate } from '../services/rates';
import { ctxToDto, deleteWorkspace, updateWorkspace } from '../services/workspaces';

export const workspaceRouter = createRouter();

workspaceRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}',
    tags: ['Workspaces'],
    summary: 'Workspace settings',
    request: { params: WidParams },
    responses: { 200: jsonContent(WorkspaceSchema), ...errorResponses },
  }),
  (c) => c.json(ctxToDto(c.get('workspace')), 200),
);

workspaceRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}',
    tags: ['Workspaces'],
    summary: 'Update workspace settings (owner/admin)',
    request: { params: WidParams, ...jsonBody(UpdateWorkspaceSchema) },
    responses: { 200: jsonContent(WorkspaceSchema), ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    requireRole(['owner', 'admin'], ws.role);
    return c.json(await updateWorkspace(c.get('deps').db, ws, c.req.valid('json')), 200);
  },
);

workspaceRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}',
    tags: ['Workspaces'],
    summary: 'Delete the workspace and all its data (owner only)',
    request: { params: WidParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    requireRole(['owner'], ws.role);
    await deleteWorkspace(c.get('deps').db, ws.id);
    return c.body(null, 204);
  },
);

workspaceRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/backup',
    tags: ['Import & export'],
    summary: 'Download a full JSON backup of the workspace',
    request: { params: WidParams },
    responses: { 200: { description: 'Backup file (JSON)' }, ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    const backup = await exportBackup(c.get('deps').db, ws);
    const date = todayIn(ws.timezone);
    c.header('Content-Disposition', `attachment; filename="expense-tracker-backup-${date}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(backup);
  },
);

workspaceRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/export/transactions.csv',
    tags: ['Import & export'],
    summary: 'Export transactions as CSV (same filters as the transaction list)',
    request: {
      params: WidParams,
      query: ListTransactionsQuerySchema.omit({ cursor: true, limit: true }),
    },
    responses: { 200: { description: 'CSV file' }, ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    const csv = await exportTransactionsCsv(c.get('deps').db, ws, c.req.valid('query'));
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="transactions-${todayIn(ws.timezone)}.csv"`,
    );
    c.header('Cache-Control', 'no-store');
    return c.body(csv);
  },
);

// ---------------------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------------------

workspaceRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/rates',
    tags: ['Exchange rates'],
    summary: 'Latest exchange rates (NRB, INR peg, and your manual rates)',
    request: { params: WidParams, query: z.object({ date: IsoDateSchema.optional() }) },
    responses: { 200: jsonContent(z.array(ExchangeRateSchema)), ...errorResponses },
  }),
  async (c) => {
    const ws = c.get('workspace');
    const date = c.req.valid('query').date ?? todayIn(ws.timezone);
    return c.json(await latestRates(c.get('deps').db, ws.id, date), 200);
  },
);

workspaceRouter.openapi(
  createRoute({
    method: 'put',
    path: '/workspaces/{wid}/rates/manual',
    tags: ['Exchange rates'],
    summary: 'Set a manual exchange rate (units of quote per 1 base) for a date',
    request: { params: WidParams, ...jsonBody(SetManualRateSchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const input = c.req.valid('json');
    if (input.base === input.quote) throw badRequest('Choose two different currencies');
    await setManualRate(c.get('deps').db, c.get('workspace').id, input);
    return c.body(null, 204);
  },
);

workspaceRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/rates/manual',
    tags: ['Exchange rates'],
    summary: 'Remove a manual exchange rate',
    request: {
      params: WidParams,
      query: z.object({
        base: z.string().length(3),
        quote: z.string().length(3),
        date: IsoDateSchema,
      }),
    },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const found = await deleteManualRate(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('query'),
    );
    if (!found) throw notFound('Rate');
    return c.body(null, 204);
  },
);
