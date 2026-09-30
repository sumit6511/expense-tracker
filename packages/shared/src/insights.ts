import { z } from 'zod';
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
