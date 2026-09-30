import { z } from 'zod';
import { isCurrencyCode } from './currency';
import { isIsoDate, isValidTimeZone } from './dates';
import { DATE_FORMATS } from './import';

/**
 * Request and response shapes shared by the API (validation + OpenAPI docs) and the web app
 * (types + form validation). Amounts are integer minor units in the relevant currency.
 */

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

export const Id = z.uuid();
export const IsoDateSchema = z
  .string()
  .refine(isIsoDate, { error: 'Expected a date as YYYY-MM-DD' });
export const CurrencyCode = z
  .string()
  .transform((s) => s.toUpperCase())
  .refine(isCurrencyCode, { error: 'Unknown currency code' });
export const MinorAmount = z
  .number()
  .int()
  .refine(Number.isSafeInteger, { error: 'Amount out of range' });
export const Color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: 'Expected a hex colour like #16a34a' });
export const IconName = z.string().regex(/^[a-z0-9-]{1,40}$/);
const Name = (max = 80) => z.string().trim().min(1, { error: 'Required' }).max(max);
const OptionalText = (max: number) => z.string().trim().max(max);

/** Comma-separated ids in a query string ("a,b,c") → string[]. */
const IdList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(z.union([Id, z.literal('none')])).max(200));

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const AccountTypeSchema = z.enum([
  'cash',
  'checking',
  'savings',
  'credit_card',
  'e_wallet',
  'loan',
  'investment',
  'other',
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const CategoryKindSchema = z.enum(['expense', 'income']);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

export const CalendarSchema = z.enum(['bs', 'ad']);
export const NumberGroupingSchema = z.enum(['lakh', 'international']);
export const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;
export const TransactionStatusSchema = z.enum(['pending', 'cleared', 'reconciled']);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export const TransactionTypeSchema = z.enum(['expense', 'income', 'transfer']);

// ---------------------------------------------------------------------------------------------
// Me / workspaces
// ---------------------------------------------------------------------------------------------

export const WorkspaceSettingsSchema = z.object({
  name: Name(60),
  baseCurrency: CurrencyCode,
  calendar: CalendarSchema,
  monthStartDay: z.number().int().min(1).max(28),
  weekStart: z.number().int().min(0).max(6),
  timezone: z.string().refine(isValidTimeZone, { error: 'Unknown time zone' }),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const WorkspaceSchema = WorkspaceSettingsSchema.extend({
  id: Id,
  role: RoleSchema,
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const StarterAccountSchema = z.object({
  name: Name(),
  type: AccountTypeSchema,
  currency: CurrencyCode,
  openingBalanceMinor: MinorAmount.default(0),
  icon: IconName.optional(),
  color: Color.optional(),
});

export const CreateWorkspaceSchema = WorkspaceSettingsSchema.partial({
  monthStartDay: true,
  weekStart: true,
  timezone: true,
}).extend({
  starterCategories: z.boolean().default(true),
  accounts: z.array(StarterAccountSchema).max(20).default([]),
});
export type CreateWorkspaceInput = z.input<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = WorkspaceSettingsSchema.partial();
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const MeSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    numberGrouping: NumberGroupingSchema,
  }),
  workspaces: z.array(WorkspaceSchema),
  defaultWorkspaceId: z.string().nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeSchema = z.object({
  name: Name(80).optional(),
  numberGrouping: NumberGroupingSchema.optional(),
  defaultWorkspaceId: Id.optional(),
});
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

export const CreateAccountSchema = z.object({
  name: Name(),
  type: AccountTypeSchema,
  currency: CurrencyCode,
  openingBalanceMinor: MinorAmount.default(0),
  openingDate: IsoDateSchema.optional(),
  creditLimitMinor: MinorAmount.nullable().optional(),
  institution: OptionalText(80).nullable().optional(),
  icon: IconName.optional(),
  color: Color.optional(),
  onBudget: z.boolean().default(true),
  inNetWorth: z.boolean().default(true),
});
export type CreateAccountInput = z.input<typeof CreateAccountSchema>;

export const UpdateAccountSchema = CreateAccountSchema.omit({ currency: true })
  .partial()
  .extend({
    archived: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  });
export type UpdateAccountInput = z.input<typeof UpdateAccountSchema>;

export const AccountSchema = z.object({
  id: Id,
  name: z.string(),
  type: AccountTypeSchema,
  currency: z.string(),
  openingBalanceMinor: MinorAmount,
  openingDate: z.string(),
  creditLimitMinor: MinorAmount.nullable(),
  institution: z.string().nullable(),
  icon: z.string(),
  color: z.string(),
  onBudget: z.boolean(),
  inNetWorth: z.boolean(),
  archived: z.boolean(),
  sortOrder: z.number(),
  balanceMinor: MinorAmount,
  /** Balance converted to the workspace base currency (null when no rate is known). */
  balanceBaseMinor: MinorAmount.nullable(),
  transactionCount: z.number(),
  lastTransactionDate: z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

// ---------------------------------------------------------------------------------------------
// Categories, payees, tags
// ---------------------------------------------------------------------------------------------

export const CreateCategoryGroupSchema = z.object({ name: Name(60), kind: CategoryKindSchema });
export const UpdateCategoryGroupSchema = z.object({
  name: Name(60).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  archived: z.boolean().optional(),
});

export const CreateCategorySchema = z.object({
  groupId: Id,
  name: Name(60),
  icon: IconName.default('tag'),
  color: Color.default('#64748b'),
});
export type CreateCategoryInput = z.input<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({
  groupId: Id.optional(),
  name: Name(60).optional(),
  icon: IconName.optional(),
  color: Color.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  archived: z.boolean().optional(),
});
export type UpdateCategoryInput = z.input<typeof UpdateCategorySchema>;

export const CategorySchema = z.object({
  id: Id,
  groupId: Id,
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  sortOrder: z.number(),
  archived: z.boolean(),
  transactionCount: z.number(),
});
export type Category = z.infer<typeof CategorySchema>;

export const CategoryGroupSchema = z.object({
  id: Id,
  name: z.string(),
  kind: CategoryKindSchema,
  sortOrder: z.number(),
  archived: z.boolean(),
  categories: z.array(CategorySchema),
});
export type CategoryGroup = z.infer<typeof CategoryGroupSchema>;

export const PayeeSchema = z.object({
  id: Id,
  name: z.string(),
  defaultCategoryId: Id.nullable(),
  /** Most used category for this payee, learned from history. */
  suggestedCategoryId: Id.nullable(),
  transactionCount: z.number(),
  lastUsed: z.string().nullable(),
});
export type Payee = z.infer<typeof PayeeSchema>;

export const UpdatePayeeSchema = z.object({
  name: Name(120).optional(),
  defaultCategoryId: Id.nullable().optional(),
});
export const MergePayeeSchema = z.object({ targetId: Id });

export const TagSchema = z.object({
  id: Id,
  name: z.string(),
  color: z.string(),
  transactionCount: z.number(),
});
export type Tag = z.infer<typeof TagSchema>;
export const CreateTagSchema = z.object({
  name: z
    .string()
    .trim()
    .transform((s) => s.replace(/^#/, ''))
    .pipe(Name(40)),
  color: Color.default('#64748b'),
});
export const UpdateTagSchema = CreateTagSchema.partial();

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export const SplitInputSchema = z.object({
  categoryId: Id.nullable(),
  amountMinor: MinorAmount,
  memo: OptionalText(200).optional(),
});
export type SplitInput = z.infer<typeof SplitInputSchema>;

export const OriginalAmountSchema = z.object({
  amountMinor: MinorAmount,
  currency: CurrencyCode,
});

const TransactionFields = {
  accountId: Id,
  date: IsoDateSchema,
  /** Signed, in the account's currency: negative = money out, positive = money in. */
  amountMinor: MinorAmount.refine((v) => v !== 0, { error: 'Amount must not be zero' }),
  /** Payee name; matched to an existing payee (case/punctuation-insensitive) or created. */
  payee: OptionalText(120).nullable().optional(),
  /** Shorthand for a single split. Ignored when `splits` is given. */
  categoryId: Id.nullable().optional(),
  /** Two or more lines that must add up to `amountMinor`. */
  splits: z.array(SplitInputSchema).min(2).max(50).optional(),
  notes: OptionalText(1000).nullable().optional(),
  tagIds: z.array(Id).max(20).optional(),
  status: TransactionStatusSchema.optional(),
  /** Amount in the currency actually paid, when different from the account currency. */
  original: OriginalAmountSchema.nullable().optional(),
};

function splitsMatchTotal(value: { amountMinor?: number; splits?: SplitInput[] | undefined }) {
  if (!value.splits || value.amountMinor === undefined) return true;
  return value.splits.reduce((sum, s) => sum + s.amountMinor, 0) === value.amountMinor;
}

export const CreateTransactionSchema = z
  .object({
    /** Optional client-generated id, so retries and offline replays can't create duplicates. */
    id: Id.optional(),
    ...TransactionFields,
  })
  .refine(splitsMatchTotal, { error: 'Split amounts must add up to the total', path: ['splits'] });
export type CreateTransactionInput = z.input<typeof CreateTransactionSchema>;

export const UpdateTransactionSchema = z
  .object({
    ...TransactionFields,
    needsReview: z.boolean().optional(),
    /** Version the client last saw; the update is rejected with 409 if it changed since. */
    version: z.number().int().optional(),
  })
  .partial()
  .refine(splitsMatchTotal, { error: 'Split amounts must add up to the total', path: ['splits'] });
export type UpdateTransactionInput = z.input<typeof UpdateTransactionSchema>;

export const TransactionSplitSchema = z.object({
  id: Id,
  categoryId: Id.nullable(),
  amountMinor: MinorAmount,
  memo: z.string(),
});

export const TransactionSchema = z.object({
  id: Id,
  accountId: Id,
  date: z.string(),
  amountMinor: MinorAmount,
  currency: z.string(),
  payeeId: Id.nullable(),
  payeeName: z.string().nullable(),
  notes: z.string(),
  rawDescription: z.string(),
  status: TransactionStatusSchema,
  needsReview: z.boolean(),
  transfer: z
    .object({
      groupId: Id,
      peerTransactionId: Id,
      peerAccountId: Id,
      peerAmountMinor: MinorAmount,
    })
    .nullable(),
  splits: z.array(TransactionSplitSchema),
  tagIds: z.array(Id),
  original: z.object({ amountMinor: MinorAmount, currency: z.string() }).nullable(),
  importBatchId: Id.nullable(),
  deleted: z.boolean(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Running account balance after this transaction (only when listing a single account). */
  runningBalanceMinor: MinorAmount.nullable(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const ListTransactionsQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  accountIds: IdList.optional(),
  /** "none" matches uncategorized transactions. */
  categoryIds: IdList.optional(),
  payeeIds: IdList.optional(),
  tagIds: IdList.optional(),
  type: TransactionTypeSchema.optional(),
  q: z.string().trim().max(100).optional(),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().min(0).optional(),
  needsReview: z.enum(['true', 'false']).optional(),
  importBatchId: Id.optional(),
  deleted: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListTransactionsQuery = z.input<typeof ListTransactionsQuerySchema>;

export const TransactionPageSchema = z.object({
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable(),
  /** Totals over every transaction matching the filters (not just this page), in base currency. */
  totals: z.object({
    count: z.number(),
    inflowBaseMinor: MinorAmount,
    outflowBaseMinor: MinorAmount,
  }),
});
export type TransactionPage = z.infer<typeof TransactionPageSchema>;

export const BulkTransactionActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setCategory'),
    ids: z.array(Id).min(1).max(1000),
    categoryId: Id.nullable(),
  }),
  z.object({
    action: z.literal('addTags'),
    ids: z.array(Id).min(1).max(1000),
    tagIds: z.array(Id).min(1),
  }),
  z.object({
    action: z.literal('removeTags'),
    ids: z.array(Id).min(1).max(1000),
    tagIds: z.array(Id).min(1),
  }),
  z.object({ action: z.literal('delete'), ids: z.array(Id).min(1).max(1000) }),
  z.object({ action: z.literal('restore'), ids: z.array(Id).min(1).max(1000) }),
  z.object({ action: z.literal('markReviewed'), ids: z.array(Id).min(1).max(1000) }),
  z.object({
    action: z.literal('setStatus'),
    ids: z.array(Id).min(1).max(1000),
    status: TransactionStatusSchema,
  }),
]);
export type BulkTransactionAction = z.infer<typeof BulkTransactionActionSchema>;

export const CreateTransferSchema = z
  .object({
    fromAccountId: Id,
    toAccountId: Id,
    date: IsoDateSchema,
    /** Positive amount leaving the source account, in its currency. */
    amountMinor: MinorAmount.refine((v) => v > 0, { error: 'Amount must be positive' }),
    /** Amount arriving, in the destination currency. Required when the currencies differ. */
    toAmountMinor: MinorAmount.refine((v) => v > 0, {
      error: 'Amount must be positive',
    }).optional(),
    notes: OptionalText(1000).nullable().optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    error: 'Choose two different accounts',
    path: ['toAccountId'],
  });
export type CreateTransferInput = z.input<typeof CreateTransferSchema>;

// ---------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------

export const PeriodSchema = z.object({
  start: z.string(),
  end: z.string(),
  calendar: CalendarSchema,
  year: z.number(),
  month: z.number(),
  label: z.string(),
});
export type PeriodDto = z.infer<typeof PeriodSchema>;

export const BudgetCategoryLineSchema = z.object({
  categoryId: Id,
  budgetedMinor: MinorAmount,
  spentMinor: MinorAmount,
  remainingMinor: MinorAmount,
  /** Average monthly spending over the previous three periods. */
  averageMinor: MinorAmount,
  lastPeriodSpentMinor: MinorAmount,
});

export const BudgetMonthSchema = z.object({
  period: PeriodSchema,
  currency: z.string(),
  totals: z.object({
    budgetedMinor: MinorAmount,
    spentMinor: MinorAmount,
    remainingMinor: MinorAmount,
    /** Spending in categories without a budget (and uncategorized spending). */
    unbudgetedSpentMinor: MinorAmount,
    incomeMinor: MinorAmount,
  }),
  lines: z.array(BudgetCategoryLineSchema),
});
export type BudgetMonth = z.infer<typeof BudgetMonthSchema>;

export const SetBudgetsSchema = z.object({
  periodStart: IsoDateSchema,
  items: z
    .array(z.object({ categoryId: Id, amountMinor: MinorAmount.refine((v) => v >= 0) }))
    .min(1)
    .max(500),
});
export const CopyBudgetsSchema = z.object({
  fromPeriodStart: IsoDateSchema,
  toPeriodStart: IsoDateSchema,
  overwrite: z.boolean().default(false),
});
export const FillAverageBudgetsSchema = z.object({
  periodStart: IsoDateSchema,
  months: z.number().int().min(1).max(12).default(3),
  overwrite: z.boolean().default(false),
});

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export const ReportQuerySchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  accountIds: IdList.optional(),
});
export type ReportQuery = z.input<typeof ReportQuerySchema>;

export const CategoryAmountSchema = z.object({
  categoryId: Id.nullable(),
  amountMinor: MinorAmount,
  count: z.number(),
});

export const SpendingByCategorySchema = z.object({
  currency: z.string(),
  expense: z.array(CategoryAmountSchema),
  income: z.array(CategoryAmountSchema),
  totalExpenseMinor: MinorAmount,
  totalIncomeMinor: MinorAmount,
  /** Rates were missing for some foreign-currency amounts; they were left out of the totals. */
  missingRates: z.array(z.string()),
});
export type SpendingByCategory = z.infer<typeof SpendingByCategorySchema>;

export const CashFlowSchema = z.object({
  currency: z.string(),
  periods: z.array(
    PeriodSchema.extend({
      incomeMinor: MinorAmount,
      expenseMinor: MinorAmount,
      netMinor: MinorAmount,
    }),
  ),
  missingRates: z.array(z.string()),
});
export type CashFlow = z.infer<typeof CashFlowSchema>;

export const CategoryTrendsSchema = z.object({
  currency: z.string(),
  periods: z.array(PeriodSchema),
  series: z.array(z.object({ categoryId: Id.nullable(), valuesMinor: z.array(MinorAmount) })),
  missingRates: z.array(z.string()),
});
export type CategoryTrends = z.infer<typeof CategoryTrendsSchema>;

export const BudgetVsActualSchema = z.object({
  currency: z.string(),
  periods: z.array(PeriodSchema.extend({ budgetedMinor: MinorAmount, spentMinor: MinorAmount })),
});
export type BudgetVsActual = z.infer<typeof BudgetVsActualSchema>;

export const DashboardSchema = z.object({
  today: z.string(),
  currency: z.string(),
  period: PeriodSchema,
  daysLeft: z.number(),
  budget: z.object({
    budgetedMinor: MinorAmount,
    spentMinor: MinorAmount,
    remainingMinor: MinorAmount,
    /** Remaining budget divided by the days left, or null with no budget. */
    safePerDayMinor: MinorAmount.nullable(),
  }),
  cashFlow: z.object({
    incomeMinor: MinorAmount,
    expenseMinor: MinorAmount,
    netMinor: MinorAmount,
  }),
  previousPeriodExpenseMinor: MinorAmount,
  /** Spending up to the same day in the previous period, for a fair comparison. */
  previousPeriodToDateExpenseMinor: MinorAmount,
  topCategories: z.array(CategoryAmountSchema),
  dailyExpense: z.array(z.object({ date: z.string(), amountMinor: MinorAmount })),
  netWorthMinor: MinorAmount,
  uncategorizedCount: z.number(),
  needsReviewCount: z.number(),
  missingRates: z.array(z.string()),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

// ---------------------------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------------------------

export const ImportRowSchema = z.object({
  date: IsoDateSchema,
  amountMinor: MinorAmount.refine((v) => v !== 0),
  payee: OptionalText(120).default(''),
  description: OptionalText(500).default(''),
  notes: OptionalText(1000).default(''),
  externalId: OptionalText(100).nullable().default(null),
});
export type ImportRow = z.input<typeof ImportRowSchema>;

export const PreviewImportSchema = z.object({
  accountId: Id,
  rows: z.array(ImportRowSchema).min(1).max(5000),
});

export const ImportPreviewSchema = z.object({
  rows: z.array(
    z.object({
      duplicateOfId: Id.nullable(),
      payeeId: Id.nullable(),
      suggestedCategoryId: Id.nullable(),
    }),
  ),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

const MappingSchema = z.object({
  hasHeader: z.boolean(),
  date: z.number().int().min(0),
  dateFormat: z.enum(DATE_FORMATS),
  amount: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('single'),
      column: z.number().int().min(0),
      negate: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('debitCredit'),
      debit: z.number().int().min(0),
      credit: z.number().int().min(0),
    }),
  ]),
  payee: z.number().int().min(0).nullable().optional(),
  description: z.number().int().min(0).nullable().optional(),
  notes: z.number().int().min(0).nullable().optional(),
  externalId: z.number().int().min(0).nullable().optional(),
});

export { MappingSchema as ImportMappingSchema };

export const CommitImportSchema = z.object({
  accountId: Id,
  fileName: OptionalText(200).default('import'),
  source: z.enum(['csv', 'xlsx']),
  mapping: MappingSchema.optional(),
  rows: z
    .array(
      ImportRowSchema.extend({
        categoryId: Id.nullable().optional(),
        skip: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(5000),
});
export type CommitImportInput = z.input<typeof CommitImportSchema>;

export const ImportBatchSchema = z.object({
  id: Id,
  accountId: Id,
  fileName: z.string(),
  source: z.string(),
  createdAt: z.string(),
  revertedAt: z.string().nullable(),
  created: z.number(),
  skipped: z.number(),
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export const ImportProfileSchema = z.object({
  id: Id,
  name: z.string(),
  mapping: MappingSchema,
  createdAt: z.string(),
});
export type ImportProfile = z.infer<typeof ImportProfileSchema>;
export const CreateImportProfileSchema = z.object({ name: Name(80), mapping: MappingSchema });

// ---------------------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------------------

export const RateSourceSchema = z.enum(['nrb', 'peg', 'manual']);
export const ExchangeRateSchema = z.object({
  base: z.string(),
  quote: z.string(),
  date: z.string(),
  /** Units of `quote` per one unit of `base`, as a decimal string. */
  rate: z.string(),
  source: RateSourceSchema,
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

export const RateStringSchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,10})?$/, { error: 'Expected a positive decimal rate' })
  .refine((s) => Number(s) > 0, { error: 'Rate must be greater than zero' });

export const SetManualRateSchema = z.object({
  base: CurrencyCode,
  quote: CurrencyCode,
  date: IsoDateSchema,
  rate: RateStringSchema,
});

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
