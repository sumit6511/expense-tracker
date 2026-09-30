import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { ApiError, forbidden } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must come from one of
 * our own origins. Combined with SameSite=Lax cookies and JSON-only bodies this blocks
 * cross-site form posts and fetches.
 */
export function originCheck(allowedOrigins: string[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin));
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
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
