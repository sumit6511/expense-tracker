import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { ApiError } from '../lib/errors';
import { authenticateToken } from '../services/tokens';

/**
 * Works out who is asking: a personal access token (`Authorization: Bearer et_…`) or the session
 * cookie. A request with a token never falls back to cookies, and a bad token is an error rather
 * than an anonymous request.
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { auth, db } = c.get('deps');
  const authorization = c.req.header('authorization');
  if (authorization !== undefined) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    const found = match ? await authenticateToken(db, match[1]!) : null;
    if (!found) {
      c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new ApiError(401, 'invalid_token', 'This access token is not valid (or has expired)');
    }
    c.set('user', found.user);
    c.set('token', found.token);
    return next();
  }
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set(
    'user',
    result ? { id: result.user.id, email: result.user.email, name: result.user.name } : null,
  );
  c.set('sessionId', result?.session.id ?? null);
  await next();
};
