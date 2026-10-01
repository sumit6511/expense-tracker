import {
  CreateHoldingSchema,
  HoldingsSchema,
  UpdateHoldingSchema,
  UpdatePricesSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { createRouter, errorResponses, jsonBody, jsonContent, WidIdParams } from '../lib/openapi';
import {
  createHolding,
  deleteHolding,
  listHoldings,
  updateHolding,
  updatePrices,
} from '../services/holdings';

export const holdingsRouter = createRouter();

const tags = ['Investments'];

holdingsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/accounts/{id}/holdings',
    tags,
    summary: 'Investments held in an account, valued at their latest prices',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(HoldingsSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await listHoldings(c.get('deps').db, c.get('workspace'), c.req.valid('param').id), 200),
);

holdingsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/accounts/{id}/holdings',
    tags,
    summary: 'Add a holding (quantity and price are decimal strings)',
    request: { params: WidIdParams, ...jsonBody(CreateHoldingSchema) },
    responses: { 201: jsonContent(HoldingsSchema, 'Added'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await createHolding(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      201,
    ),
);

holdingsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/accounts/{id}/holdings/prices',
    tags,
    summary: 'Update the prices of several holdings at once',
    request: { params: WidIdParams, ...jsonBody(UpdatePricesSchema) },
    responses: { 200: jsonContent(HoldingsSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updatePrices(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

holdingsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/holdings/{id}',
    tags,
    summary: 'Change a holding (bought or sold some, new price…)',
    request: { params: WidIdParams, ...jsonBody(UpdateHoldingSchema) },
    responses: { 200: jsonContent(HoldingsSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateHolding(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

holdingsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/holdings/{id}',
    tags,
    summary: 'Remove a holding',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(HoldingsSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await deleteHolding(c.get('deps').db, c.get('workspace'), c.req.valid('param').id), 200),
);
