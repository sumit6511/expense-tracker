import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';

/** Loads the signed-in user (if any) from the session cookie. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { auth } = c.get('deps');
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set(
    'user',
    result ? { id: result.user.id, email: result.user.email, name: result.user.name } : null,
  );
  await next();
};
