import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_ATTACHMENT_BYTES } from '@et/shared';
import { serveStatic } from '@hono/node-server/serve-static';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { sql } from 'drizzle-orm';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Deps } from './context';
import { ApiError, mapDatabaseError } from './lib/errors';
import { createRouter } from './lib/openapi';
import { originCheck, tokenAccess, tokenRateLimit, writeRateLimit } from './middleware/security';
import { loadSession } from './middleware/session';
import { loadWorkspace } from './middleware/workspace';
import { accountsRouter } from './routes/accounts';
import { aiRouter } from './routes/ai';
import { budgetsRouter } from './routes/budgets';
import { labelsRouter } from './routes/categories';
import { goalsRouter } from './routes/goals';
import { importsRouter } from './routes/imports';
import { insightsRouter } from './routes/insights';
import { ledgerRouter } from './routes/ledger';
import { meRouter } from './routes/me';
import { membersRouter } from './routes/members';
import { notificationsRouter } from './routes/notifications';
import { recurringRouter } from './routes/recurring';
import { rulesRouter } from './routes/rules';
import { splitRouter } from './routes/split';
import { tokensRouter } from './routes/tokens';
import { transactionsRouter } from './routes/transactions';
import { webhooksRouter } from './routes/webhooks';
import { workspaceRouter } from './routes/workspace';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Charts and UI primitives set inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function createApp(deps: Deps) {
  const { env, logger } = deps;
  const app = new OpenAPIHono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('user', null);
    c.set('token', null);
    const started = performance.now();
    await next();
    if (c.req.path.startsWith('/api/')) {
      logger.debug(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(performance.now() - started),
        },
        'request',
      );
    }
  });
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: undefined,
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: env.PUBLIC_URL.startsWith('https://')
        ? 'max-age=31536000; includeSubDomains'
        : false,
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/readyz', async (c) => {
    await deps.db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  // Better Auth handles sign-up, sign-in, sessions and account deletion under /api/auth/*.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));

  const api = createRouter();
  api.use('*', loadSession);
  api.use('*', originCheck([env.PUBLIC_URL, ...env.TRUSTED_ORIGINS]));
  api.use('*', tokenAccess('/api/v1'));
  api.use('*', tokenRateLimit(env.NODE_ENV === 'test' ? 0 : 300));
  api.use('*', writeRateLimit(env.NODE_ENV === 'test' ? 0 : 600));
  // Receipts are the only large uploads; everything else is small JSON.
  api.use(
    '/workspaces/:wid/transactions/:id/attachments',
    bodyLimit({
      maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024,
      onError: (c) =>
        c.json({ error: { code: 'too_large', message: 'Files can be at most 5 MB' } }, 413),
    }),
  );
  api.use('/workspaces/:wid', loadWorkspace);
  api.use('/workspaces/:wid/*', loadWorkspace);
  for (const router of [
    meRouter,
    workspaceRouter,
    accountsRouter,
    labelsRouter,
    transactionsRouter,
    budgetsRouter,
    importsRouter,
    rulesRouter,
    recurringRouter,
    goalsRouter,
    ledgerRouter,
    notificationsRouter,
    membersRouter,
    splitRouter,
    insightsRouter,
    aiRouter,
    tokensRouter,
    webhooksRouter,
  ]) {
    api.route('/', router);
  }
  api.openAPIRegistry.registerComponent('securitySchemes', 'accessToken', {
    type: 'http',
    scheme: 'bearer',
    description:
      'A personal access token from Settings → Integrations, sent as `Authorization: Bearer et_…`. ' +
      'It reaches one workspace and does no more than its person may; read tokens only read.',
  });
  api.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'The app’s own sign-in (writes also need a same-origin Origin header).',
  });
  api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Expense Tracker API',
      version: '1.0.0',
      description: [
        'Amounts are integers in minor units (paisa for NPR). Dates are calendar dates (YYYY-MM-DD, AD).',
        '',
        'For your own scripts, make a personal access token under Settings → Integrations and send it as ' +
          '`Authorization: Bearer et_…`. A token reaches one workspace (its id is in `GET /me`), ' +
          'can be read-only, and can’t manage members, tokens or workspace settings. Each token may ' +
          'make 300 requests a minute.',
        '',
        'Errors look like `{ "error": { "code": "…", "message": "…" } }`.',
      ].join('\n'),
    },
    security: [{ accessToken: [] }, { session: [] }],
  });
  app.route('/api/v1', api);
  app.get('/api/docs', Scalar({ url: '/api/v1/openapi.json', pageTitle: 'Expense Tracker API' }));

  app.onError((err, c) => {
    const apiError =
      err instanceof ApiError
        ? err
        : err instanceof HTTPException
          ? new ApiError(
              err.status as ApiError['status'],
              'http_error',
              err.message || 'Request failed',
            )
          : mapDatabaseError(err);
    if (apiError) {
      return c.json(
        { error: { code: apiError.code, message: apiError.message, details: apiError.details } },
        apiError.status,
      );
    }
    logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error');
    return c.json(
      { error: { code: 'internal_error', message: 'Something went wrong on our side' } },
      500,
    );
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404);
    }
    return c.text('Not found', 404);
  });

  if (env.WEB_DIST_DIR) mountWebApp(app, env.WEB_DIST_DIR);
  return app;
}

/** Serves the built single-page app, with long caching for fingerprinted assets. */
function mountWebApp(app: OpenAPIHono<AppEnv>, root: string) {
  const indexPath = path.join(root, 'index.html');
  let indexHtml: Promise<string> | null = null;

  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/'))
      c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  });
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  // Only real files (paths with an extension) are served from disk; every other path is a
  // client-side route and gets index.html below.
  const staticFiles = serveStatic({ root });
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || !/\.[a-z0-9]+$/i.test(c.req.path)) return next();
    if (/^\/(sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(c.req.path)) {
      // The service worker and manifest must be re-checked so updates reach installed apps.
      c.header('Cache-Control', 'no-cache');
    }
    return staticFiles(c, next);
  });
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    indexHtml ??= readFile(indexPath, 'utf8');
    c.header('Cache-Control', 'no-cache');
    return c.html(await indexHtml);
  });
}
