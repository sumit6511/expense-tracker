import {
  BankSyncResultSchema,
  BankSyncSchema,
  ConnectBankSchema,
  UpdateBankLinkSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  WidIdParams,
  WidParams,
} from '../lib/openapi';
import {
  connectBank,
  getBankSync,
  removeBankConnection,
  syncBankNow,
  updateBankLink,
} from '../services/bank';

export const bankRouter = createRouter();

const tags = ['Bank sync'];

bankRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/bank',
    tags,
    summary: 'Bank sync providers, connections and their accounts',
    request: { params: WidParams },
    responses: { 200: jsonContent(BankSyncSchema), ...errorResponses },
  }),
  async (c) => c.json(await getBankSync(c.get('deps'), c.get('workspace')), 200),
);

bankRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/bank/connections',
    tags,
    summary: 'Connect with a provider’s setup token (owners and admins)',
    request: { params: WidParams, ...jsonBody(ConnectBankSchema) },
    responses: { 201: jsonContent(BankSyncSchema, 'Connected'), ...errorResponses },
  }),
  async (c) =>
    c.json(await connectBank(c.get('deps'), c.get('workspace'), c.req.valid('json')), 201),
);

bankRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/bank/connections/{id}',
    tags,
    summary: 'Disconnect (transactions already brought in stay)',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(BankSyncSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await removeBankConnection(c.get('deps'), c.get('workspace'), c.req.valid('param').id),
      200,
    ),
);

bankRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/bank/connections/{id}/sync',
    tags,
    summary: 'Bring in new transactions now',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(BankSyncResultSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await syncBankNow(c.get('deps'), c.get('workspace'), c.req.valid('param').id), 200),
);

bankRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/bank/accounts/{id}',
    tags,
    summary: 'Link a bank account to one of yours (or unlink it), and choose where sync starts',
    request: { params: WidIdParams, ...jsonBody(UpdateBankLinkSchema) },
    responses: { 200: jsonContent(BankSyncSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await updateBankLink(
        c.get('deps'),
        c.get('workspace'),
        c.req.valid('param').id,
        c.req.valid('json'),
      ),
      200,
    ),
);
