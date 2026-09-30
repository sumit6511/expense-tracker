import {
  RecordRecurringResultSchema,
  RecordRecurringSchema,
  RecurringBodySchema,
  RecurringPatchSchema,
  RecurringSchema,
  RecurringSuggestionSchema,
  UpcomingItemSchema,
  UpcomingQuerySchema,
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
  createRecurring,
  deleteRecurring,
  listRecurring,
  recordOccurrence,
  skipOccurrence,
  suggestRecurring,
  upcoming,
  updateRecurring,
} from '../services/recurring';

export const recurringRouter = createRouter();

const tags = ['Recurring'];

recurringRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/recurring',
    tags,
    summary: 'Recurring transactions and bills',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(RecurringSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listRecurring(c.get('deps').db, c.get('workspace')), 200),
);

recurringRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/recurring',
    tags,
    summary: 'Set up a recurring transaction',
    request: { params: WidParams, ...jsonBody(RecurringBodySchema) },
    responses: { 201: jsonContent(RecurringSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(await createRecurring(c.get('deps').db, c.get('workspace'), c.req.valid('json')), 201),
);

recurringRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/recurring/upcoming',
    tags,
    summary: 'What is due soon, including overdue reminders',
    request: { params: WidParams, query: UpcomingQuerySchema },
    responses: { 200: jsonContent(z.array(UpcomingItemSchema)), ...errorResponses },
  }),
  async (c) =>
    c.json(await upcoming(c.get('deps').db, c.get('workspace'), c.req.valid('query').days), 200),
);

recurringRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/recurring/suggestions',
    tags,
    summary: 'Payments that look recurring but are not set up yet',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(RecurringSuggestionSchema)), ...errorResponses },
  }),
  async (c) => c.json(await suggestRecurring(c.get('deps').db, c.get('workspace')), 200),
);

recurringRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/recurring/{id}',
    tags,
    summary: 'Change a recurring transaction (changing the schedule restarts it from nextDate)',
    request: { params: WidIdParams, ...jsonBody(RecurringPatchSchema) },
    responses: { 200: jsonContent(RecurringSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateRecurring(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

recurringRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/recurring/{id}',
    tags,
    summary: 'Stop and remove a recurring transaction (recorded transactions are kept)',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteRecurring(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);

recurringRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/recurring/{id}/record',
    tags,
    summary: 'Record the next occurrence as a transaction',
    request: { params: WidIdParams, ...jsonBody(RecordRecurringSchema) },
    responses: { 201: jsonContent(RecordRecurringResultSchema, 'Recorded'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await recordOccurrence(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      201,
    ),
);

recurringRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/recurring/{id}/skip',
    tags,
    summary: 'Skip the next occurrence',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(RecurringSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await skipOccurrence(c.get('deps').db, c.get('workspace'), c.req.valid('param').id),
      200,
    ),
);
