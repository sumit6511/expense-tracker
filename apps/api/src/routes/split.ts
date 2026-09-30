import {
  AddSplitMemberSchema,
  CreateSplitGroupSchema,
  RenameSplitMemberSchema,
  SplitExpenseBodySchema,
  SplitGroupSchema,
  SplitGroupSummarySchema,
  SplitSettlementBodySchema,
  UpdateSplitGroupSchema,
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
  addMember,
  createExpense,
  createGroup,
  createSettlement,
  deleteExpense,
  deleteGroup,
  deleteSettlement,
  getGroup,
  listGroups,
  removeMember,
  renameMember,
  updateExpense,
  updateGroup,
} from '../services/split';

export const splitRouter = createRouter();

const tags = ['Split groups'];
const base = '/workspaces/{wid}/split-groups';
const ItemParams = z.object({ wid: z.uuid(), id: z.uuid(), itemId: z.uuid() });
const group = { 200: jsonContent(SplitGroupSchema), ...errorResponses };

splitRouter.openapi(
  createRoute({
    method: 'get',
    path: base,
    tags,
    summary: 'Split groups with your balance in each',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(SplitGroupSummarySchema)), ...errorResponses },
  }),
  async (c) => c.json(await listGroups(c.get('deps').db, c.get('workspace')), 200),
);

splitRouter.openapi(
  createRoute({
    method: 'post',
    path: base,
    tags,
    summary: 'Start a group (you are added automatically)',
    request: { params: WidParams, ...jsonBody(CreateSplitGroupSchema) },
    responses: { 201: jsonContent(SplitGroupSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(await createGroup(c.get('deps').db, c.get('workspace'), c.req.valid('json')), 201),
);

splitRouter.openapi(
  createRoute({
    method: 'get',
    path: `${base}/{id}`,
    tags,
    summary: 'A group: members, balances, suggested payments and activity',
    request: { params: WidIdParams },
    responses: group,
  }),
  async (c) =>
    c.json(await getGroup(c.get('deps').db, c.get('workspace'), c.req.valid('param').id), 200),
);

splitRouter.openapi(
  createRoute({
    method: 'patch',
    path: `${base}/{id}`,
    tags,
    summary: 'Rename, archive, or change how debts are shown',
    request: { params: WidIdParams, ...jsonBody(UpdateSplitGroupSchema) },
    responses: group,
  }),
  async (c) =>
    c.json(
      await updateGroup(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

splitRouter.openapi(
  createRoute({
    method: 'delete',
    path: `${base}/{id}`,
    tags,
    summary: 'Delete a group and its history (recorded transactions stay)',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteGroup(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);

splitRouter.openapi(
  createRoute({
    method: 'post',
    path: `${base}/{id}/members`,
    tags,
    summary: 'Add someone to the group',
    request: { params: WidIdParams, ...jsonBody(AddSplitMemberSchema) },
    responses: group,
  }),
  async (c) =>
    c.json(
      await addMember(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

splitRouter.openapi(
  createRoute({
    method: 'patch',
    path: `${base}/{id}/members/{itemId}`,
    tags,
    summary: 'Rename someone',
    request: { params: ItemParams, ...jsonBody(RenameSplitMemberSchema) },
    responses: group,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(
      await renameMember(
        c.get('deps').db,
        c.get('workspace'),
        id,
        itemId,
        c.req.valid('json').name,
      ),
      200,
    );
  },
);

splitRouter.openapi(
  createRoute({
    method: 'delete',
    path: `${base}/{id}/members/{itemId}`,
    tags,
    summary: 'Remove someone who has no expenses or payments in the group',
    request: { params: ItemParams },
    responses: group,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(await removeMember(c.get('deps').db, c.get('workspace'), id, itemId), 200);
  },
);

splitRouter.openapi(
  createRoute({
    method: 'post',
    path: `${base}/{id}/expenses`,
    tags,
    summary: 'Add a shared expense (optionally recording what you paid in your accounts)',
    request: { params: WidIdParams, ...jsonBody(SplitExpenseBodySchema) },
    responses: { 201: jsonContent(SplitGroupSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await createExpense(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      201,
    ),
);

splitRouter.openapi(
  createRoute({
    method: 'put',
    path: `${base}/{id}/expenses/{itemId}`,
    tags,
    summary: 'Change a shared expense',
    request: { params: ItemParams, ...jsonBody(SplitExpenseBodySchema) },
    responses: group,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(
      await updateExpense(c.get('deps').db, c.get('workspace'), id, itemId, c.req.valid('json')),
      200,
    );
  },
);

splitRouter.openapi(
  createRoute({
    method: 'delete',
    path: `${base}/{id}/expenses/{itemId}`,
    tags,
    summary: 'Delete a shared expense',
    request: { params: ItemParams },
    responses: group,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(await deleteExpense(c.get('deps').db, c.get('workspace'), id, itemId), 200);
  },
);

splitRouter.openapi(
  createRoute({
    method: 'post',
    path: `${base}/{id}/settlements`,
    tags,
    summary: 'Record a payment between two people (settling up)',
    request: { params: WidIdParams, ...jsonBody(SplitSettlementBodySchema) },
    responses: { 201: jsonContent(SplitGroupSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await createSettlement(
        c.get('deps').db,
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      201,
    ),
);

splitRouter.openapi(
  createRoute({
    method: 'delete',
    path: `${base}/{id}/settlements/{itemId}`,
    tags,
    summary: 'Delete a payment',
    request: { params: ItemParams },
    responses: group,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(await deleteSettlement(c.get('deps').db, c.get('workspace'), id, itemId), 200);
  },
);
