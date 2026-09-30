import {
  AiStatusSchema,
  AskAnswerSchema,
  AskSchema,
  CategorizeResultSchema,
  CategorizeSchema,
  ParseTextSchema,
  ReceiptDraftSchema,
  StatementExtractSchema,
  TransactionDraftSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../context';
import { badRequest } from '../lib/errors';
import { createRouter, errorResponses, jsonBody, jsonContent, WidParams } from '../lib/openapi';
import {
  aiStatus,
  askMoney,
  draftFromText,
  RECEIPT_TYPES,
  readStatement,
  scanReceipt,
  suggestCategories,
} from '../services/ai';
import { sniffType } from '../services/attachments';

export const aiRouter = createRouter();

const tags = ['AI helpers'];

const deps = (c: Context<AppEnv>) => {
  const { db, env, ai } = c.get('deps');
  return { db, env, ai };
};

const fileBody = (description: string) => ({
  required: true,
  description,
  content: {
    'multipart/form-data': {
      schema: {
        type: 'object' as const,
        properties: { file: { type: 'string' as const, format: 'binary' } },
        required: ['file'],
      },
    },
  },
});

/** The uploaded file, typed by its contents rather than by what the browser claims. */
async function uploaded(c: Context<AppEnv>, allowed: string[]) {
  const file = (await c.req.parseBody()).file;
  if (!(file instanceof File)) throw badRequest('Send the file in a "file" form field');
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffType(data)?.type;
  if (!type || !allowed.includes(type))
    throw badRequest(
      allowed.length === 1 ? 'Choose a PDF file' : 'Use a JPEG, PNG or WebP photo, or a PDF',
    );
  return { data, mediaType: type };
}

aiRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/ai',
    tags,
    summary: 'Whether the AI helpers can be used here, and today’s usage',
    request: { params: WidParams },
    responses: { 200: jsonContent(AiStatusSchema), ...errorResponses },
  }),
  async (c) => c.json(await aiStatus(deps(c), c.get('workspace')), 200),
);

aiRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/ai/parse',
    tags,
    summary: 'Turn a sentence into a transaction draft (rules first, AI only as a fallback)',
    request: { params: WidParams, ...jsonBody(ParseTextSchema) },
    responses: { 200: jsonContent(TransactionDraftSchema), ...errorResponses },
  }),
  async (c) => c.json(await draftFromText(deps(c), c.get('workspace'), c.req.valid('json')), 200),
);

aiRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/ai/receipt',
    tags,
    summary: 'Read a receipt photo or PDF into a transaction draft',
    request: {
      params: WidParams,
      body: fileBody('A "file" field: JPEG, PNG, WebP or PDF, ≤ 5 MB'),
    },
    responses: { 200: jsonContent(ReceiptDraftSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await scanReceipt(deps(c), c.get('workspace'), await uploaded(c, RECEIPT_TYPES)), 200),
);

aiRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/ai/categorize',
    tags,
    summary: 'Suggest categories for uncategorized transactions; they wait in the review inbox',
    request: { params: WidParams, ...jsonBody(CategorizeSchema) },
    responses: { 200: jsonContent(CategorizeResultSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await suggestCategories(deps(c), c.get('workspace'), c.req.valid('json')), 200),
);

aiRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/ai/statement',
    tags,
    summary: 'Read the transactions out of a PDF bank statement, for the import preview',
    request: { params: WidParams, body: fileBody('A "file" field: a PDF, ≤ 5 MB') },
    responses: { 200: jsonContent(StatementExtractSchema), ...errorResponses },
  }),
  async (c) => {
    const { data } = await uploaded(c, ['application/pdf']);
    return c.json(await readStatement(deps(c), c.get('workspace'), data), 200);
  },
);

aiRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/ai/ask',
    tags,
    summary: 'Ask a question about your money; answered from the report API only',
    description: 'Read-only, so viewers can ask too.',
    request: { params: WidParams, ...jsonBody(AskSchema) },
    responses: { 200: jsonContent(AskAnswerSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(await askMoney(deps(c), c.get('workspace'), c.req.valid('json').question), 200),
);
