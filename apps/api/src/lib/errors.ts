import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Please sign in');
export const forbidden = (message = 'You do not have permission to do that') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'conflict', message, details);

interface PgErrorLike {
  code?: string;
  constraint?: string;
  detail?: string;
}

/** Finds the underlying Postgres error, which Drizzle wraps in `cause`. */
export function pgError(err: unknown): PgErrorLike | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    const candidate = current as PgErrorLike & { cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code))
      return candidate;
    current = candidate.cause;
  }
  return null;
}

/** Maps database constraint errors to client errors; returns null for anything else. */
export function mapDatabaseError(err: unknown): ApiError | null {
  const pg = pgError(err);
  if (!pg) return null;
  switch (pg.code) {
    case '23505':
      return conflict('That already exists', { constraint: pg.constraint });
    case '23503':
      return conflict('That is still in use or refers to something that does not exist', {
        constraint: pg.constraint,
      });
    case '23514':
      return badRequest('The change would break a data consistency rule', {
        constraint: pg.constraint,
      });
    case '22003':
      return badRequest('A number is out of range');
    default:
      return null;
  }
}
