import {
  CommitImportSchema,
  CreateImportProfileSchema,
  Id,
  ImportBatchSchema,
  ImportPreviewSchema,
  ImportProfileSchema,
  PreviewImportSchema,
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
  commitImport,
  createProfile,
  deleteProfile,
  listBatches,
  listProfiles,
  previewImport,
  revertBatch,
} from '../services/imports';

export const importsRouter = createRouter();

importsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/imports/preview',
    tags: ['Import & export'],
    summary: 'Check parsed statement rows for duplicates and suggest payees and categories',
    request: { params: WidParams, ...jsonBody(PreviewImportSchema) },
    responses: { 200: jsonContent(ImportPreviewSchema), ...errorResponses },
  }),
  async (c) => {
    const { accountId, rows } = c.req.valid('json');
    return c.json(await previewImport(c.get('deps').db, c.get('workspace'), accountId, rows), 200);
  },
);

importsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/imports',
    tags: ['Import & export'],
    summary: 'Import statement rows as transactions (they land in "needs review")',
    request: { params: WidParams, ...jsonBody(CommitImportSchema) },
    responses: { 201: jsonContent(ImportBatchSchema, 'Imported'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await commitImport(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('json'),
      ),
      201,
    ),
);

importsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/imports',
    tags: ['Import & export'],
    summary: 'Recent imports',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(ImportBatchSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listBatches(c.get('deps').db, c.get('workspace')), 200),
);

importsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/imports/{id}/revert',
    tags: ['Import & export'],
    summary: 'Undo an import (its transactions move to the trash)',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(ImportBatchSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await revertBatch(
        c.get('deps').db,
        c.get('workspace'),
        c.get('user')!.id,
        c.req.valid('param').id,
      ),
      200,
    ),
);

importsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/import-profiles',
    tags: ['Import & export'],
    summary: 'Saved column mappings (one per bank statement format)',
    request: { params: WidParams },
    responses: { 200: jsonContent(z.array(ImportProfileSchema)), ...errorResponses },
  }),
  async (c) => c.json(await listProfiles(c.get('deps').db, c.get('workspace').id), 200),
);

importsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/import-profiles',
    tags: ['Import & export'],
    summary: 'Save a column mapping',
    request: { params: WidParams, ...jsonBody(CreateImportProfileSchema) },
    responses: { 201: jsonContent(z.object({ id: Id }), 'Created'), ...errorResponses },
  }),
  async (c) =>
    c.json(
      { id: await createProfile(c.get('deps').db, c.get('workspace').id, c.req.valid('json')) },
      201,
    ),
);

importsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/import-profiles/{id}',
    tags: ['Import & export'],
    summary: 'Delete a saved column mapping',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await deleteProfile(c.get('deps').db, c.get('workspace').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);
