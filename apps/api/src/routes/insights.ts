import {
  DismissInsightSchema,
  ForecastQuerySchema,
  ForecastSchema,
  InsightsSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  NoContent,
  WidParams,
} from '../lib/openapi';
import { dismissInsight, forecast, listInsights } from '../services/insights';

export const insightsRouter = createRouter();

const tags = ['Insights'];

insightsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/insights',
    tags,
    summary: 'Things worth knowing, found in your own numbers',
    request: { params: WidParams },
    responses: { 200: jsonContent(InsightsSchema), ...errorResponses },
  }),
  async (c) => c.json(await listInsights(c.get('deps').db, c.get('workspace')), 200),
);

insightsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/insights/dismiss',
    tags,
    summary: 'Stop showing an insight (or a recurring suggestion) to you',
    description: 'Personal, so viewers can dismiss too.',
    request: { params: WidParams, ...jsonBody(DismissInsightSchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await dismissInsight(c.get('deps').db, c.get('workspace'), c.req.valid('json').key);
    return c.body(null, 204);
  },
);

insightsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/forecast',
    tags,
    summary: 'Where your balance is heading: scheduled items plus everyday spending',
    request: { params: WidParams, query: ForecastQuerySchema },
    responses: { 200: jsonContent(ForecastSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await forecast(c.get('deps').db, c.get('workspace'), c.req.valid('query')), 200),
);
