import { z } from 'zod';
import { Id, IsoDateSchema } from './schemas';

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

/**
 * Email in: each workspace gets a private address. Forward receipts (photos or PDFs, with "lunch
 * 450" as the subject if you like) or have your bank's alert emails sent there, and they become
 * transactions waiting in the review inbox. Only mail from members, or from senders you trust
 * (such as your bank's alert address), is read.
 */
export const INBOUND_EMAIL_STATUSES = ['recorded', 'needs_review', 'duplicate', 'ignored'] as const;
export type InboundEmailStatus = (typeof INBOUND_EMAIL_STATUSES)[number];

export const InboundEmailFileSchema = z.object({
  id: Id,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
});

export const InboundEmailSchema = z.object({
  id: Id,
  from: z.string(),
  fromName: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  /**
   * recorded: became a transaction; needs_review: nothing to go on (no amount), kept for you to
   * add by hand; duplicate: you already had it; ignored: not from a member or a trusted sender.
   */
  status: z.enum(INBOUND_EMAIL_STATUSES),
  detail: z.string(),
  transactionIds: z.array(Id),
  /** Files kept until it's added or dismissed (30 days at most). */
  files: z.array(InboundEmailFileSchema),
  /** What could be read, to start the transaction from. */
  draft: z
    .object({
      accountId: Id.nullable(),
      date: z.string().nullable(),
      amountMinor: z.number().int().nullable(),
      payee: z.string().nullable(),
      notes: z.string().nullable(),
    })
    .nullable(),
});
export type InboundEmail = z.infer<typeof InboundEmailSchema>;

/** An exact address ("alerts@bank.com.np") or a whole domain ("@bank.com.np"). */
export const EmailSenderPattern = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[^@\s]+)?@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/, {
    error: 'Enter an email address, or @ and a domain (e.g. @nabilbank.com)',
  });

export const EmailSenderSchema = z.object({
  id: Id,
  sender: z.string(),
  /** Alerts from this sender are for this account (else the default account). */
  accountId: Id.nullable(),
  createdAt: z.string(),
});
export type EmailSender = z.infer<typeof EmailSenderSchema>;

export const EmailSenderInputSchema = z.object({
  sender: EmailSenderPattern,
  accountId: Id.nullable(),
});
export type EmailSenderInput = z.infer<typeof EmailSenderInputSchema>;

export const EmailInSchema = z.object({
  /** Whether this server receives email at all. */
  available: z.boolean(),
  /** The workspace's address (null when email in isn't set up on the server). */
  address: z.string().nullable(),
  /** Where receipts and alerts go when nothing says otherwise. */
  defaultAccountId: Id.nullable(),
  senders: z.array(EmailSenderSchema),
  /** The latest 50 emails. */
  messages: z.array(InboundEmailSchema),
});
export type EmailIn = z.infer<typeof EmailInSchema>;

export const UpdateEmailInSchema = z.object({ defaultAccountId: Id.nullable() });

/**
 * Bank sync, through providers that read your bank accounts for you (read-only). No provider
 * covers Nepal yet (there's no open-banking API), so this is for accounts abroad; in Nepal,
 * email in, SMS alerts and statement import fill the gap.
 */
export const BANK_PROVIDERS = ['simplefin'] as const;
export type BankProviderId = (typeof BANK_PROVIDERS)[number];

export const BankProviderInfoSchema = z.object({
  id: z.enum(BANK_PROVIDERS),
  label: z.string(),
  /** Where its banks are. */
  coverage: z.string(),
  /** Where to get the setup token. */
  signupUrl: z.string(),
});
export type BankProviderInfo = z.infer<typeof BankProviderInfoSchema>;

export const BankAccountLinkSchema = z.object({
  id: Id,
  name: z.string(),
  institution: z.string(),
  currency: z.string(),
  /** Our account it fills; null = not synced. */
  accountId: Id.nullable(),
  /** Transactions on or after this date are brought in. */
  syncFrom: IsoDateSchema,
  /** The balance the bank reported last. */
  balanceMinor: z.number().int().nullable(),
  balanceAt: z.string().nullable(),
});
export type BankAccountLink = z.infer<typeof BankAccountLinkSchema>;

export const BankConnectionSchema = z.object({
  id: Id,
  provider: z.enum(BANK_PROVIDERS),
  label: z.string(),
  status: z.enum(['ok', 'error']),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  accounts: z.array(BankAccountLinkSchema),
});
export type BankConnection = z.infer<typeof BankConnectionSchema>;

export const BankSyncSchema = z.object({
  /** Whether this server allows bank sync. */
  available: z.boolean(),
  providers: z.array(BankProviderInfoSchema),
  connections: z.array(BankConnectionSchema),
});
export type BankSync = z.infer<typeof BankSyncSchema>;

export const ConnectBankSchema = z.object({
  provider: z.enum(BANK_PROVIDERS),
  /** What the provider gave you to connect with (SimpleFIN: the setup token). */
  setupToken: z.string().trim().min(10).max(4000),
});
export type ConnectBank = z.infer<typeof ConnectBankSchema>;

export const UpdateBankLinkSchema = z.object({
  accountId: Id.nullable().optional(),
  syncFrom: IsoDateSchema.optional(),
});
export type UpdateBankLink = z.infer<typeof UpdateBankLinkSchema>;

export const BankSyncResultSchema = z.object({
  /** New transactions added (waiting in review). */
  created: z.number().int(),
  /** Bank transactions that matched ones you'd already entered. */
  matched: z.number().int(),
  errors: z.array(z.string()),
});
export type BankSyncResult = z.infer<typeof BankSyncResultSchema>;
