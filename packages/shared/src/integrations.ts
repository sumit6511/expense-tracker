import { z } from 'zod';
import { Id } from './schemas';

/**
 * Personal access tokens let your own scripts and tools use the API (`Authorization: Bearer
 * et_…`). Each token belongs to one person and one workspace, never does more than that person
 * may, and can be limited to reading.
 */
export const TOKEN_SCOPES = ['read', 'write'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** How long a new token lasts; null = until it's revoked. */
export const TOKEN_LIFETIMES = [30, 90, 365] as const;

/** Tokens start with this, so they're easy to recognise (and for secret scanners to find). */
export const TOKEN_PREFIX = 'et_';

export const ApiTokenSchema = z.object({
  id: Id,
  name: z.string(),
  /** The first characters, to tell tokens apart: "et_Ab12Cd". */
  hint: z.string(),
  scope: z.enum(TOKEN_SCOPES),
  /** Who made it. Owners and admins also see (and can revoke) other people's tokens. */
  user: z.object({ id: z.string(), name: z.string() }),
  mine: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;

export const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(TOKEN_SCOPES),
  /** Days until it stops working; null for no expiry. */
  expiresInDays: z
    .number()
    .int()
    .refine((d) => (TOKEN_LIFETIMES as readonly number[]).includes(d), {
      error: 'Choose 30, 90 or 365 days',
    })
    .nullable(),
});
export type CreateApiToken = z.infer<typeof CreateApiTokenSchema>;

export const CreatedApiTokenSchema = ApiTokenSchema.extend({
  /** The full token. Shown once: only a hash is kept. */
  token: z.string(),
});
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>;
