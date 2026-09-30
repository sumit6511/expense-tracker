import {
  CategoryGroupSchema,
  CreateCategoryGroupSchema,
  CreateCategorySchema,
  CreateTagSchema,
  Id,
  MergePayeeSchema,
  PayeeSchema,
  TagSchema,
  UpdateCategoryGroupSchema,
  UpdateCategorySchema,
  UpdatePayeeSchema,
  UpdateTagSchema,
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
  createCategory,
  createCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  listCategoryGroups,
  updateCategory,
  updateCategoryGroup,
} from '../services/categories';
import { deletePayee, listPayees, mergePayees, updatePayee } from '../services/payees';
import { createTag, deleteTag, listTags, updateTag } from '../services/tags';

/** Categories, payees and tags: the labels transactions are organised by. */
export const labelsRouter = createRouter();

const Created = jsonContent(z.object({ id: Id }), 'Created');
const Groups = jsonContent(z.array(CategoryGroupSchema));

labelsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/categories',
    tags: ['Categories'],
    summary: 'Category groups with their categories',
    request: { params: WidParams },
    responses: { 200: Groups, ...errorResponses },
  }),
  async (c) => c.json(await listCategoryGroups(c.get('deps').db, c.get('workspace')), 200),
);

labelsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/category-groups',
    tags: ['Categories'],
    summary: 'Create a category group',
    request: { params: WidParams, ...jsonBody(CreateCategoryGroupSchema) },
    responses: { 201: Created, ...errorResponses },
  }),
  async (c) =>
    c.json(
      {
        id: await createCategoryGroup(c.get('deps').db, c.get('workspace').id, c.req.valid('json')),
      },
      201,
    ),
);

labelsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/category-groups/{id}',
    tags: ['Categories'],
    summary: 'Rename, reorder or archive a category group',
    request: { params: WidIdParams, ...jsonBody(UpdateCategoryGroupSchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await updateCategoryGroup(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.body(null, 204);
  },
);

labelsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/category-groups/{id}',
    tags: ['Categories'],
    summary: 'Delete an empty category group',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteCategoryGroup(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);

labelsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/categories',
    tags: ['Categories'],
    summary: 'Create a category',
    request: { params: WidParams, ...jsonBody(CreateCategorySchema) },
    responses: { 201: Created, ...errorResponses },
  }),
  async (c) =>
    c.json(
      { id: await createCategory(c.get('deps').db, c.get('workspace').id, c.req.valid('json')) },
      201,
    ),
);

labelsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/categories/{id}',
    tags: ['Categories'],
    summary: 'Rename, recolour, move, reorder or archive a category',
    request: { params: WidIdParams, ...jsonBody(UpdateCategorySchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await updateCategory(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.body(null, 204);
  },
);

labelsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/categories/{id}',
    tags: ['Categories'],
    summary: 'Delete a category, moving its transactions to another category (or none)',
    request: {
      params: WidIdParams,
      query: z.object({ reassignTo: z.union([Id, z.literal('none')]).optional() }),
    },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const { reassignTo } = c.req.valid('query');
    await deleteCategory(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').id,
      reassignTo === undefined ? undefined : reassignTo === 'none' ? null : reassignTo,
    );
    return c.body(null, 204);
  },
);

// Payees ---------------------------------------------------------------------------------------

labelsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/payees',
    tags: ['Payees'],
    summary: 'Payees, most recently used first, with suggested categories',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(PayeeSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listPayees(c.get('deps').db, c.get('workspace')), 200),
);

labelsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/payees/{id}',
    tags: ['Payees'],
    summary: 'Rename a payee or set its default category (renaming onto another payee merges them)',
    request: { params: WidIdParams, ...jsonBody(UpdatePayeeSchema) },
    responses: { 200: jsonContent(z.object({ id: Id })), ...errorResponses },
  }),
  async (c) => {
    const id = await updatePayee(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json({ id }, 200);
  },
);

labelsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/payees/{id}/merge',
    tags: ['Payees'],
    summary: 'Merge this payee into another one',
    request: { params: WidIdParams, ...jsonBody(MergePayeeSchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await mergePayees(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').id,
      c.req.valid('json').targetId,
    );
    return c.body(null, 204);
  },
);

labelsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/payees/{id}',
    tags: ['Payees'],
    summary: 'Delete a payee (its transactions are kept without a payee)',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deletePayee(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);

// Tags -----------------------------------------------------------------------------------------

labelsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/tags',
    tags: ['Tags'],
    summary: 'Tags',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(TagSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listTags(c.get('deps').db, c.get('workspace')), 200),
);

labelsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/tags',
    tags: ['Tags'],
    summary: 'Create a tag',
    request: { params: WidParams, ...jsonBody(CreateTagSchema) },
    responses: { 201: Created, ...errorResponses },
  }),
  async (c) =>
    c.json(
      { id: await createTag(c.get('deps').db, c.get('workspace').id, c.req.valid('json')) },
      201,
    ),
);

labelsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/tags/{id}',
    tags: ['Tags'],
    summary: 'Rename or recolour a tag',
    request: { params: WidIdParams, ...jsonBody(UpdateTagSchema) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await updateTag(
      c.get('deps').db,
      c.get('workspace').id,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.body(null, 204);
  },
);

labelsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/tags/{id}',
    tags: ['Tags'],
    summary: 'Delete a tag (removed from its transactions)',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteTag(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);
