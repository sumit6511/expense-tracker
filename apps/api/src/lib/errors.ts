import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

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

/** "openingBalanceMinor" → "Opening balance", "splits.1.amountMinor" → "Amount". */
function fieldLabel(path: readonly PropertyKey[]): string {
  const key = [...path].reverse().find((p): p is string => typeof p === 'string');
  if (!key) return 'Value';
  const words = key
    .replace(/(Minor|Id|Ids)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One validation problem in words a person can act on. */
export function describeIssue(issue: z.core.$ZodIssue): string {
  const field = fieldLabel(issue.path);
  if (issue.code === 'too_big' && issue.origin === 'string')
    return `${field} is too long (at most ${issue.maximum} characters)`;
  if (issue.code === 'too_big' && (issue.origin === 'number' || issue.origin === 'int'))
    return `${field} is too large`;
  if (issue.code === 'too_big' && issue.origin === 'array')
    return `${field}: at most ${issue.maximum} allowed`;
  if (issue.code === 'too_small' && issue.origin === 'string')
    return Number(issue.minimum) <= 1
      ? `${field} is required`
      : `${field} is too short (at least ${issue.minimum} characters)`;
  if (issue.code === 'too_small' && (issue.origin === 'number' || issue.origin === 'int'))
    return Number(issue.minimum) === 0 && !issue.inclusive
      ? `${field} must be greater than zero`
      : `${field} must be at least ${issue.minimum}`;
  if (issue.code === 'invalid_format') return `${field} isn’t valid`;
  if (issue.message === 'Required') return `${field} is required`;
  return `${field}: ${issue.message}`;
}

/** A request that didn't pass validation, described by its first problem. */
export function validationError(issues: readonly z.core.$ZodIssue[]): ApiError {
  const first = issues[0];
  return new ApiError(
    400,
    'validation_error',
    first ? describeIssue(first) : 'Invalid request',
    issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}
