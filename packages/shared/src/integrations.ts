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

/**
 * Webhooks: the server POSTs to your URL when transactions change, signed the Standard Webhooks
 * way (`webhook-id`, `webhook-timestamp`, `webhook-signature` headers; see standardwebhooks.com).
 * Only transactions in shared accounts are sent; private accounts stay private.
 */
export const WEBHOOK_EVENTS = [
  'transaction.created',
  'transaction.updated',
  'transaction.deleted',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'transaction.created': 'Transaction added (or restored from the trash)',
  'transaction.updated': 'Transaction changed',
  'transaction.deleted': 'Transaction deleted',
};

/** At most this many webhooks per workspace. */
export const MAX_WEBHOOKS = 10;

const WebhookUrlSchema = z
  .url({ protocol: /^https?$/, error: 'Enter a web address starting with https:// or http://' })
  .max(2000);

export const WebhookSchema = z.object({
  id: Id,
  url: z.string(),
  description: z.string(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  enabled: z.boolean(),
  /** Why the server turned it off (e.g. after failing for days); null when on or turned off by hand. */
  disabledReason: z.string().nullable(),
  createdAt: z.string(),
  lastSuccessAt: z.string().nullable(),
  /** Deliveries have been failing since then. */
  failingSince: z.string().nullable(),
  /** Deliveries in the last 7 days. */
  recent: z.object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    pending: z.number().int(),
  }),
});
export type Webhook = z.infer<typeof WebhookSchema>;

export const CreateWebhookSchema = z.object({
  url: WebhookUrlSchema,
  description: z.string().trim().max(100).default(''),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, { error: 'Choose at least one event' }),
});
export type CreateWebhook = z.input<typeof CreateWebhookSchema>;

export const UpdateWebhookSchema = z.object({
  url: WebhookUrlSchema.optional(),
  description: z.string().trim().max(100).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, { error: 'Choose at least one event' }).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWebhook = z.infer<typeof UpdateWebhookSchema>;

export const WebhookSecretSchema = z.object({
  /** `whsec_…`: the key that signs deliveries. Shown when made or replaced. */
  secret: z.string(),
});

export const CreatedWebhookSchema = WebhookSchema.extend(WebhookSecretSchema.shape);
export type CreatedWebhook = z.infer<typeof CreatedWebhookSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed'] as const;

export const WebhookDeliverySchema = z.object({
  id: Id,
  /** Same for every attempt (and the `webhook-id` header), so receivers can skip repeats. */
  eventId: Id,
  event: z.string(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  attempts: z.number().int(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export const WebhookTestResultSchema = z.object({
  ok: z.boolean(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  ms: z.number().int(),
});
export type WebhookTestResult = z.infer<typeof WebhookTestResultSchema>;
