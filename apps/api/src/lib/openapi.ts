import { ApiErrorSchema, Id } from '@et/shared';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv, SessionUser } from '../context';
import { unauthorized, validationError } from './errors';

/** A router whose request validation failures use the API's error envelope. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const error = validationError(result.error.issues);
        return c.json(
          { error: { code: error.code, message: error.message, details: error.details } },
          400,
        );
      }
    },
  });
}

export const WidParams = z.object({ wid: Id });
export const WidIdParams = z.object({ wid: Id, id: Id });

export function jsonContent<T extends z.ZodType>(schema: T, description = 'OK') {
  return { description, content: { 'application/json': { schema } } };
}

export function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { content: { 'application/json': { schema } }, required: true } };
}

const errorResponse = (description: string) => jsonContent(ApiErrorSchema, description);

export const errorResponses = {
  400: errorResponse('Invalid request'),
  401: errorResponse('Not signed in'),
  403: errorResponse('Not allowed'),
  404: errorResponse('Not found'),
  409: errorResponse('Conflict'),
} as const;

export const NoContent = { description: 'Done' } as const;

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw unauthorized();
  return user;
}
