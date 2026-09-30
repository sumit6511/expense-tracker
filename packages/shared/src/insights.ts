import { z } from 'zod';
import { CADENCES } from './patterns';
import { RecurringSuggestionSchema } from './recurrence';
import { Id, IdList, IsoDateSchema, MinorAmount, PeriodSchema } from './schemas';

/** Totals for one payee or tag (id null = no payee). */
export const GroupAmountSchema = z.object({
  id: Id.nullable(),
  amountMinor: MinorAmount,
  count: z.number(),
});

export const SpendingByGroupSchema = z.object({
  currency: z.string(),
  expense: z.array(GroupAmountSchema),
  income: z.array(GroupAmountSchema),
  totalExpenseMinor: MinorAmount,
  totalIncomeMinor: MinorAmount,
  missingRates: z.array(z.string()),
});
export type SpendingByGroup = z.infer<typeof SpendingByGroupSchema>;

export const NetWorthSeriesSchema = z.object({
  currency: z.string(),
  points: z.array(
    PeriodSchema.extend({
      /** The day the balances are taken (the month's last day, or today for this month). */
      date: z.string(),
      assetsMinor: MinorAmount,
      /** Negative: what is owed on credit cards and loans. */
      liabilitiesMinor: MinorAmount,
      netMinor: MinorAmount,
    }),
  ),
  missingRates: z.array(z.string()),
});
export type NetWorthSeries = z.infer<typeof NetWorthSeriesSchema>;

export const CompareQuerySchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  compareFrom: IsoDateSchema,
  compareTo: IsoDateSchema,
  accountIds: IdList.optional(),
});
export type CompareQuery = z.input<typeof CompareQuerySchema>;

const PeriodTotals = z.object({
  from: z.string(),
  to: z.string(),
  expenseMinor: MinorAmount,
  incomeMinor: MinorAmount,
});

export const ComparisonSchema = z.object({
  currency: z.string(),
  current: PeriodTotals,
  previous: PeriodTotals,
  /** Spending per category in both periods, biggest change first. */
  categories: z.array(
    z.object({
      categoryId: Id.nullable(),
      currentMinor: MinorAmount,
      previousMinor: MinorAmount,
    }),
  ),
  missingRates: z.array(z.string()),
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const DailySpendingSchema = z.object({
  currency: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      expenseMinor: MinorAmount,
      incomeMinor: MinorAmount,
      count: z.number(),
    }),
  ),
  missingRates: z.array(z.string()),
});
export type DailySpending = z.infer<typeof DailySpendingSchema>;

// ---------------------------------------------------------------------------------------------
// Insights feed
// ---------------------------------------------------------------------------------------------

/**
 * Things worth knowing, found in your own numbers without any AI: spending that stands out, a
 * subscription that got dearer, an account that may run dry before payday, a good month. The
 * API sends the facts; the app words them (in the reader's number format and calendar).
 */
const InsightBase = {
  /** Stable for the same finding, so dismissing it keeps it gone. */
  key: z.string(),
  tone: z.enum(['warning', 'positive', 'info']),
  /** When it became true; newer first. */
  date: z.string(),
};

const PeriodRef = { periodStart: z.string(), periodEnd: z.string() };

export const InsightSchema = z.discriminatedUnion('kind', [
  z.object({
    ...InsightBase,
    kind: z.literal('unusual_spending'),
    ...PeriodRef,
    /** This month so far (rather than last month). */
    current: z.boolean(),
    categoryId: Id.nullable(),
    amountMinor: MinorAmount,
    usualMinor: MinorAmount,
    currency: z.string(),
  }),
  z.object({
    ...InsightBase,
    kind: z.literal('spending_down'),
    ...PeriodRef,
    categoryId: Id.nullable(),
    amountMinor: MinorAmount,
    usualMinor: MinorAmount,
    currency: z.string(),
  }),
  z.object({
    ...InsightBase,
    kind: z.literal('price_change'),
    /** A bill or subscription you pay, or income you receive. */
    flow: z.enum(['expense', 'income']),
    payeeId: Id,
    payeeName: z.string(),
    accountId: Id,
    currency: z.string(),
    fromMinor: MinorAmount,
    toMinor: MinorAmount,
    cadence: z.enum(CADENCES),
    /** The recurring series you track for this, if any… */
    recurringId: Id.nullable(),
    /** …and the amount it still expects. */
    recurringAmountMinor: MinorAmount.nullable(),
  }),
  z.object({
    ...InsightBase,
    kind: z.literal('low_balance'),
    accountId: Id,
    currency: z.string(),
    balanceMinor: MinorAmount,
    /** The first day the scheduled bills take it below zero. */
    negativeDate: z.string(),
    lowestMinor: MinorAmount,
    lowestDate: z.string(),
  }),
  z.object({
    ...InsightBase,
    kind: z.literal('saved'),
    ...PeriodRef,
    incomeMinor: MinorAmount,
    expenseMinor: MinorAmount,
    /** Months in a row (ending with this one) with more in than out. */
    streak: z.number(),
    currency: z.string(),
  }),
  z.object({
    ...InsightBase,
    kind: z.literal('budget_streak'),
    ...PeriodRef,
    categoryId: Id,
    /** Months in a row (ending with this one) within budget. */
    months: z.number(),
    currency: z.string(),
  }),
  z.object({
    ...InsightBase,
    kind: z.literal('new_recurring'),
    suggestion: RecurringSuggestionSchema,
  }),
]);
export type Insight = z.infer<typeof InsightSchema>;
export type InsightKind = Insight['kind'];

export const InsightsSchema = z.object({
  items: z.array(InsightSchema),
  missingRates: z.array(z.string()),
});
export type Insights = z.infer<typeof InsightsSchema>;

export const DismissInsightSchema = z.object({ key: z.string().min(1).max(200) });

// ---------------------------------------------------------------------------------------------
// Cash-flow forecast
// ---------------------------------------------------------------------------------------------

export const ForecastQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(180).default(30),
  /** Which accounts to add up; by default cash, bank and wallet accounts. */
  accountIds: IdList.optional(),
});
export type ForecastQuery = z.input<typeof ForecastQuerySchema>;

export const ForecastSchema = z.object({
  currency: z.string(),
  today: z.string(),
  accountIds: z.array(Id),
  startMinor: MinorAmount,
  /** Everyday money in and out that isn't scheduled, per day on average (usually negative). */
  everydayPerDayMinor: MinorAmount,
  /** How many days of history that average comes from. */
  historyDays: z.number(),
  points: z.array(
    z.object({
      date: z.string(),
      expectedMinor: MinorAmount,
      /** An 80% band: the balance will probably land between these. */
      lowMinor: MinorAmount,
      highMinor: MinorAmount,
    }),
  ),
  /** Scheduled items in the window (overdue reminders count as due today). */
  events: z.array(
    z.object({
      date: z.string(),
      recurringId: Id,
      name: z.string(),
      kind: z.enum(['expense', 'income', 'transfer']),
      /** Signed change to the total, in the workspace currency. */
      amountMinor: MinorAmount,
      variableAmount: z.boolean(),
      overdue: z.boolean(),
    }),
  ),
  lowest: z.object({ date: z.string(), expectedMinor: MinorAmount }),
  missingRates: z.array(z.string()),
});
export type Forecast = z.infer<typeof ForecastSchema>;
