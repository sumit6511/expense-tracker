import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Column names are snake_case in the database (see `casing` in db/client.ts and drizzle.config.ts).

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Binary data (Buffer in, Buffer out). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const money = (name?: string) =>
  name ? bigint(name, { mode: 'number' }) : bigint({ mode: 'number' });

// ---------------------------------------------------------------------------------------------
// Auth (tables required by Better Auth; ids are strings it generates)
// ---------------------------------------------------------------------------------------------

export const numberGroupingEnum = pgEnum('number_grouping', ['lakh', 'international']);

export const user = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  numberGrouping: numberGroupingEnum().notNull().default('lakh'),
  defaultWorkspaceId: uuid(),
  ...timestamps,
});

export const session = pgTable(
  'session',
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.identifier)],
);

// ---------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------

export const calendarEnum = pgEnum('calendar_system', ['bs', 'ad']);
export const roleEnum = pgEnum('workspace_role', ['owner', 'admin', 'editor', 'viewer']);

export const workspaces = pgTable('workspaces', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  baseCurrency: char({ length: 3 }).notNull(),
  calendar: calendarEnum().notNull().default('bs'),
  monthStartDay: smallint().notNull().default(1),
  weekStart: smallint().notNull().default(0),
  timezone: text().notNull().default('Asia/Kathmandu'),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: roleEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

// ---------------------------------------------------------------------------------------------
// Accounts, categories, payees, tags
// ---------------------------------------------------------------------------------------------

export const accountTypeEnum = pgEnum('account_type', [
  'cash',
  'checking',
  'savings',
  'credit_card',
  'e_wallet',
  'loan',
  'investment',
  'other',
]);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: accountTypeEnum().notNull(),
    currency: char({ length: 3 }).notNull(),
    openingBalanceMinor: money().notNull().default(0),
    openingDate: date({ mode: 'string' }).notNull(),
    creditLimitMinor: money(),
    institution: text(),
    icon: text().notNull().default('wallet'),
    color: text().notNull().default('#64748b'),
    onBudget: boolean().notNull().default(true),
    inNetWorth: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.workspaceId)],
);

export const categoryKindEnum = pgEnum('category_kind', ['expense', 'income']);

export const categoryGroups = pgTable(
  'category_groups',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: categoryKindEnum().notNull(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.workspaceId)],
);

export const rolloverEnum = pgEnum('budget_rollover', ['none', 'surplus', 'all']);

export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    groupId: uuid()
      .notNull()
      .references(() => categoryGroups.id),
    name: text().notNull(),
    icon: text().notNull().default('tag'),
    color: text().notNull().default('#64748b'),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    /** What happens to this category's leftover budget at the end of a month. */
    budgetRollover: rolloverEnum().notNull().default('none'),
    /** First budget month whose leftover carries over. */
    rolloverSince: date({ mode: 'string' }),
    /** Left out of reports and dashboard totals (budgets still track it). */
    excludeFromReports: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index().on(t.workspaceId), index().on(t.groupId)],
);

export const payees = pgTable(
  'payees',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    normalizedName: text().notNull(),
    defaultCategoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.normalizedName)],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    color: text().notNull().default('#64748b'),
    ...timestamps,
  },
  (t) => [uniqueIndex('tags_workspace_name_idx').on(t.workspaceId, sql`lower(${t.name})`)],
);

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export const transactionStatusEnum = pgEnum('transaction_status', [
  'pending',
  'cleared',
  'reconciled',
]);

export const importSourceEnum = pgEnum('import_source', [
  'csv',
  'xlsx',
  'backup',
  'ofx',
  'qif',
  'camt',
  'sms',
]);

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    source: importSourceEnum().notNull(),
    fileName: text().notNull(),
    mapping: jsonb(),
    createdCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    revertedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);

export const importProfiles = pgTable(
  'import_profiles',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    mapping: jsonb().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      // No ON DELETE action: deleting an account with transactions fails, but deleting the whole
      // workspace (which cascades to both) works, because the check runs at the end of the statement.
      .references(() => accounts.id),
    date: date({ mode: 'string' }).notNull(),
    /** Signed amount in the account currency (negative = money out). */
    amountMinor: money().notNull(),
    payeeId: uuid().references(() => payees.id, { onDelete: 'set null' }),
    rawDescription: text().notNull().default(''),
    notes: text().notNull().default(''),
    originalAmountMinor: money(),
    originalCurrency: char({ length: 3 }),
    status: transactionStatusEnum().notNull().default('cleared'),
    needsReview: boolean().notNull().default(false),
    /** Both legs of a transfer share this id. Transfers have no splits. */
    transferGroupId: uuid(),
    importBatchId: uuid().references(() => importBatches.id, { onDelete: 'set null' }),
    /** The recurring series this was recorded from. */
    recurringId: uuid().references(() => recurring.id, { onDelete: 'set null' }),
    externalId: text(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index().on(t.workspaceId, t.date.desc(), t.id.desc()),
    index().on(t.accountId, t.date),
    index().on(t.payeeId),
    index().on(t.transferGroupId),
    index().on(t.importBatchId),
    index().on(t.recurringId),
    uniqueIndex()
      .on(t.accountId, t.externalId)
      .where(sql`${t.externalId} is not null and ${t.deletedAt} is null`),
    index('transactions_search_idx').using(
      'gin',
      sql`(${t.rawDescription} || ' ' || ${t.notes}) gin_trgm_ops`,
    ),
  ],
);

export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: uuid().primaryKey(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: uuid().references(() => categories.id),
    amountMinor: money().notNull(),
    memo: text().notNull().default(''),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [index().on(t.transactionId), index().on(t.categoryId)],
);

export const transactionTags = pgTable(
  'transaction_tags',
  {
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] }), index().on(t.tagId)],
);

/** A statement reconciled against an account: everything up to it is locked in. */
export const reconciliations = pgTable(
  'reconciliations',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    statementDate: date({ mode: 'string' }).notNull(),
    statementBalanceMinor: money().notNull(),
    /** A balancing transaction added to make the books match, if any. */
    adjustmentMinor: money().notNull().default(0),
    transactionCount: integer().notNull(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.accountId, t.statementDate)],
);

export const auditActionEnum = pgEnum('audit_action', ['update', 'delete', 'restore', 'reconcile']);

/** Who changed what on a transaction (creation is implied by the row itself). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    action: auditActionEnum().notNull(),
    userId: text().references(() => user.id, { onDelete: 'set null' }),
    /** field → [before, after] */
    changes: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.transactionId, t.createdAt)],
);

/** Receipts and bills attached to transactions, stored in the database. */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    data: bytea().notNull(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.transactionId), index().on(t.workspaceId)],
);

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export const ruleMatchEnum = pgEnum('rule_match', ['all', 'any']);

/** Categorization rules; conditions and actions are validated by RuleBodySchema in @et/shared. */
export const rules = pgTable(
  'rules',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    enabled: boolean().notNull().default(true),
    /** Rules run in ascending priority; later matches override earlier ones. */
    priority: integer().notNull().default(0),
    match: ruleMatchEnum().notNull().default('all'),
    conditions: jsonb().notNull(),
    actions: jsonb().notNull(),
    stopProcessing: boolean().notNull().default(false),
    hitCount: integer().notNull().default(0),
    lastHitAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.workspaceId, t.priority)],
);

// ---------------------------------------------------------------------------------------------
// Recurring transactions
// ---------------------------------------------------------------------------------------------

export const recurringKindEnum = pgEnum('recurring_kind', ['expense', 'income', 'transfer']);
export const frequencyEnum = pgEnum('recurring_frequency', [
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);
export const recurringModeEnum = pgEnum('recurring_mode', ['auto', 'remind']);

/**
 * A repeating transaction. The schedule is anchored at `startDate`; `nextIndex` is the next
 * occurrence to record and `nextDate` caches its date (null once the series has ended).
 */
export const recurring = pgTable(
  'recurring',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: recurringKindEnum().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    toAccountId: uuid().references(() => accounts.id, { onDelete: 'cascade' }),
    /** Positive; the kind decides the sign. */
    amountMinor: money().notNull(),
    toAmountMinor: money(),
    variableAmount: boolean().notNull().default(false),
    payeeId: uuid().references(() => payees.id, { onDelete: 'set null' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    notes: text().notNull().default(''),
    tagIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    frequency: frequencyEnum().notNull(),
    interval: integer().notNull().default(1),
    calendar: calendarEnum().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    lastDayOfMonth: boolean().notNull().default(false),
    nextIndex: integer().notNull().default(0),
    nextDate: date({ mode: 'string' }),
    endDate: date({ mode: 'string' }),
    remaining: integer(),
    mode: recurringModeEnum().notNull().default('remind'),
    remindDaysBefore: integer().notNull().default(3),
    active: boolean().notNull().default(true),
    lastPostedDate: date({ mode: 'string' }),
    ...timestamps,
  },
  (t) => [index().on(t.workspaceId, t.nextDate)],
);

// ---------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------

export const budgets = pgTable(
  'budgets',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** First day (AD) of the budget month, in the workspace's calendar. */
    periodStart: date({ mode: 'string' }).notNull(),
    amountMinor: money().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.categoryId, t.periodStart)],
);

/** An overall monthly spending limit; it applies from `periodStart` until a later row. */
export const budgetCaps = pgTable(
  'budget_caps',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    periodStart: date({ mode: 'string' }).notNull(),
    /** 0 = no limit from this month on. */
    amountMinor: money().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.periodStart)],
);

export const goalKindEnum = pgEnum('goal_kind', ['account', 'category', 'manual']);

export const goals = pgTable(
  'goals',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: goalKindEnum().notNull(),
    /** In the workspace currency. */
    targetMinor: money().notNull(),
    targetDate: date({ mode: 'string' }),
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    /** Manual goals: what has been put aside so far. */
    savedMinor: money().notNull().default(0),
    icon: text().notNull().default('piggy-bank'),
    color: text().notNull().default('#0f766e'),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.workspaceId)],
);

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

export const notificationKindEnum = pgEnum('notification_kind', [
  'bill',
  'budget',
  'recurring',
  'goal',
]);

/** One notification for one person in one workspace. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum().notNull(),
    title: text().notNull(),
    body: text().notNull().default(''),
    /** In-app path to open, e.g. /recurring. */
    link: text(),
    /** The same event is never announced twice (e.g. "bill:<series>:<date>"). */
    dedupeKey: text().notNull(),
    readAt: timestamp({ withTimezone: true }),
    emailedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.userId, t.workspaceId, t.dedupeKey),
    index().on(t.userId, t.workspaceId, t.createdAt),
  ],
);

/** What each person wants to hear about, and whether by email too. */
export const notificationPrefs = pgTable('notification_prefs', {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  email: boolean().notNull().default(false),
  bills: boolean().notNull().default(true),
  budgets: boolean().notNull().default(true),
  recurring: boolean().notNull().default(true),
  goals: boolean().notNull().default(true),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------------------

export const rateSourceEnum = pgEnum('rate_source', ['nrb', 'peg']);

/** Published rates, shared by all workspaces. `rate` = units of quote per 1 unit of base. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    base: char({ length: 3 }).notNull(),
    quote: char({ length: 3 }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    rate: numeric({ precision: 20, scale: 10 }).notNull(),
    source: rateSourceEnum().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote, t.date, t.source] })],
);

/** Rates a user entered themselves; they take precedence over published rates. */
export const manualRates = pgTable(
  'manual_rates',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    base: char({ length: 3 }).notNull(),
    quote: char({ length: 3 }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    rate: numeric({ precision: 20, scale: 10 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.base, t.quote, t.date] })],
);
