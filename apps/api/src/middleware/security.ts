import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { ApiError, forbidden, notFound } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must come from one of
 * our own origins. Combined with SameSite=Lax cookies and JSON-only bodies this blocks
 * cross-site form posts and fetches.
 */
export function originCheck(allowedOrigins: string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin));
  return async (c, next) => {
    // Access tokens travel in a header a cross-site page can't set, so there's nothing to forge.
    if (!SAFE_METHODS.has(c.req.method) && !c.get('token')) {
      const origin = c.req.header('origin');
      const requestOrigin = new URL(c.req.url).origin;
      if (!origin || (origin !== requestOrigin && !allowed.has(origin))) {
        throw forbidden('Request origin not allowed');
      }
    }
    await next();
  };
}

/**
 * Small fixed-window rate limiter for write requests, keyed by user (or IP when signed out).
 * In-memory, so limits are per process; that is enough for a single-server deployment.
 */
export function writeRateLimit(maxPerMinute: number): MiddlewareHandler<AppEnv> {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || maxPerMinute <= 0) return next();
    const now = Date.now();
    const key =
      c.get('user')?.id ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous';
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 60_000 };
      windows.set(key, entry);
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
      }
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new ApiError(429, 'rate_limited', 'Too many requests, please slow down');
    }
    await next();
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Workspace endpoints that stay with the app: who's in it, its tokens and integrations. */
const APP_ONLY = /^\/(invitations|tokens|webhooks|email-in|bank|transfer-ownership)(\/|$)/;

/**
 * What an access token may reach: `GET /me`, `GET /workspaces` and its own workspace's
 * endpoints, apart from managing the workspace itself (settings, members, tokens). Read tokens
 * can only read. Everything else (your profile, sign-in, other workspaces) needs the app.
 */
export function tokenAccess(prefix: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.get('token');
    if (!token) return next();
    const path = c.req.path.slice(prefix.length);
    const safe = SAFE_METHODS.has(c.req.method);
    const appOnly = () => forbidden('Access tokens can’t be used for this; use the app');

    if (path === '/me' || path === '/workspaces') {
      if (!safe) throw appOnly();
      return next();
    }
    const m = /^\/workspaces\/([^/]+)(\/.*)?$/.exec(path);
    if (!m) throw appOnly();
    const [, wid, rest = ''] = m;
    if (UUID_RE.test(wid!) && wid !== token.workspaceId) throw notFound('Workspace');
    if (wid !== token.workspaceId) throw appOnly();
    if ((rest === '' || rest.startsWith('/members')) && !safe) throw appOnly();
    if (APP_ONLY.test(rest)) throw appOnly();
    if (token.scope === 'read' && !safe) throw forbidden('This access token can only read');
    await next();
  };
}

/** Requests per minute for each access token (reads included, unlike the write limit). */
export function tokenRateLimit(maxPerMinute: number): MiddlewareHandler<AppEnv> {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const token = c.get('token');
    if (!token || maxPerMinute <= 0) return next();
    const now = Date.now();
    let entry = windows.get(token.id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 60_000 };
      windows.set(token.id, entry);
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
      }
    }
    entry.count++;
    c.header('RateLimit-Limit', String(maxPerMinute));
    c.header('RateLimit-Remaining', String(Math.max(0, maxPerMinute - entry.count)));
    if (entry.count > maxPerMinute) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new ApiError(429, 'rate_limited', 'Too many requests, please slow down');
    }
    await next();
  };
}
