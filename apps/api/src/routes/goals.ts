import { ContributeSchema, GoalBodySchema, GoalPatchSchema, GoalSchema } from '@et/shared';
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
import { contribute, createGoal, deleteGoal, listGoals, updateGoal } from '../services/goals';

export const goalsRouter = createRouter();

const tags = ['Goals'];

goalsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/goals',
    tags,
    summary: 'Savings goals with progress and the monthly amount needed',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(GoalSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listGoals(c.get('deps').db, c.get('workspace')), 200),
);

goalsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/goals',
    tags,
    summary: 'Create a goal',
    request: { params: WidParams, ...jsonBody(GoalBodySchema) },
    responses: { 201: jsonContent(GoalSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(await createGoal(c.get('deps').db, c.get('workspace'), c.req.valid('json')), 201),
);

goalsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/goals/{id}',
    tags,
    summary: 'Change a goal',
    request: { params: WidIdParams, ...jsonBody(GoalPatchSchema) },
    responses: { 200: jsonContent(GoalSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateGoal(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

goalsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/goals/{id}',
    tags,
    summary: 'Delete a goal',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteGoal(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);

goalsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/goals/{id}/contribute',
    tags,
    summary: 'Add money to (or take it from) a manual goal',
    request: { params: WidIdParams, ...jsonBody(ContributeSchema) },
    responses: { 200: jsonContent(GoalSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await contribute(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json').amountMinor,
      ),
      200,
    ),
);
