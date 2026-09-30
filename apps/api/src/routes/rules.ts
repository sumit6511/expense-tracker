import {
  ApplyRuleResultSchema,
  ApplyRuleSchema,
  ReorderRulesSchema,
  RuleActionSchema,
  RuleBodySchema,
  RuleConditionSchema,
  RulePreviewRequestSchema,
  RulePreviewSchema,
  RuleSchema,
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
  applyRule,
  createRule,
  deleteRule,
  listRules,
  previewRule,
  reorderRules,
  updateRule,
} from '../services/rules';

export const rulesRouter = createRouter();

const tags = ['Rules'];

const RulePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    match: z.enum(['all', 'any']),
    conditions: z.array(RuleConditionSchema).min(1).max(10),
    actions: z.array(RuleActionSchema).min(1).max(10),
    stopProcessing: z.boolean(),
  })
  .partial();

rulesRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/rules',
    tags,
    summary: 'Categorization rules, in the order they run',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(RuleSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listRules(c.get('deps').db, c.get('workspace').id), 200),
);

rulesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/rules',
    tags,
    summary: 'Create a rule (it runs after existing ones)',
    request: { params: WidParams, ...jsonBody(RuleBodySchema) },
    responses: { 201: jsonContent(RuleSchema, 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(await createRule(c.get('deps').db, c.get('workspace').id, c.req.valid('json')), 201),
);

rulesRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/rules/{id}',
    tags,
    summary: 'Change a rule',
    request: { params: WidIdParams, ...jsonBody(RulePatchSchema) },
    responses: { 200: jsonContent(RuleSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateRule(
        c.get('deps').db,
        c.get('workspace').id,
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);

rulesRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/rules/{id}',
    tags,
    summary: 'Delete a rule (transactions it changed stay as they are)',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteRule(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);

rulesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/rules/reorder',
    tags,
    summary: 'Set the order rules run in',
    request: { params: WidParams, ...jsonBody(ReorderRulesSchema) },
    responses: { 200: jsonContent(z.array(RuleSchema)), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await reorderRules(c.get('deps').db, c.get('workspace').id, c.req.valid('json').ids),
      200,
    ),
);

rulesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/rules/preview',
    tags,
    summary: 'See which existing transactions a rule would match',
    request: { params: WidParams, ...jsonBody(RulePreviewRequestSchema) },
    responses: { 200: jsonContent(RulePreviewSchema), ...errorResponses },
  }),
  async (c) => {
    const { rule, onlyUncategorized } = c.req.valid('json');
    return c.json(
      await previewRule(c.get('deps').db, c.get('workspace').id, rule, onlyUncategorized),
      200,
    );
  },
);

rulesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/rules/{id}/apply',
    tags,
    summary: 'Run a rule over existing transactions',
    request: { params: WidIdParams, ...jsonBody(ApplyRuleSchema) },
    responses: { 200: jsonContent(ApplyRuleResultSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await applyRule(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('param').id,
        c.req.valid('json').onlyUncategorized,
      ),
      200,
    ),
);
