import { z } from 'zod';
import { adToBs, BS_LAST_YEAR, bsDaysInMonth, bsToAd, isBsSupported } from './bs';
import { adDaysInMonth, addDays, diffDays, type IsoDate, parseIsoDate, toIsoDate } from './dates';
import { CADENCES } from './patterns';
import { Id, IsoDateSchema, TransactionSchema } from './schemas';

/**
 * Recurring transactions: rent on the 1st of every Bikram Sambat month, a yearly insurance
 * premium, a weekly allowance. A schedule is anchored at its next date; occurrence n is computed
 * from the anchor (not from the previous occurrence), so "the 31st" or "the last day" never
 * drifts after a short month.
 */

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface Schedule {
  frequency: Frequency;
  /** Every `interval` days/weeks/months/years. */
  interval: number;
  /** Which calendar's months and years to follow (monthly and yearly only). */
  calendar: 'bs' | 'ad';
  /** Occurrence 0. */
  startDate: IsoDate;
  /** Monthly and yearly: fall on the month's last day instead of the start date's day. */
  lastDayOfMonth: boolean;
}

function monthParts(date: IsoDate, calendar: 'bs' | 'ad') {
  return calendar === 'bs' && isBsSupported(date) ? adToBs(date) : parseIsoDate(date);
}

/** The date of occurrence `index` (0 = start), or null past the end of the BS calendar table. */
export function occurrenceAt(s: Schedule, index: number): IsoDate | null {
  if (s.frequency === 'daily') return addDays(s.startDate, index * s.interval);
  if (s.frequency === 'weekly') return addDays(s.startDate, index * s.interval * 7);
  const calendar = s.calendar === 'bs' && isBsSupported(s.startDate) ? 'bs' : 'ad';
  const start = monthParts(s.startDate, calendar);
  const step = s.frequency === 'yearly' ? 12 * s.interval : s.interval;
  const total = start.year * 12 + (start.month - 1) + index * step;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (calendar === 'bs') {
    if (year > BS_LAST_YEAR) return null;
    const dim = bsDaysInMonth(year, month);
    return bsToAd({ year, month, day: s.lastDayOfMonth ? dim : Math.min(start.day, dim) });
  }
  const dim = adDaysInMonth(year, month);
  return toIsoDate({ year, month, day: s.lastDayOfMonth ? dim : Math.min(start.day, dim) });
}

/** The first occurrence index whose date is on or after `date`. */
export function indexOnOrAfter(s: Schedule, date: IsoDate): number {
  const days = diffDays(s.startDate, date);
  if (days <= 0) return 0;
  let index: number;
  if (s.frequency === 'daily' || s.frequency === 'weekly') {
    const step = s.interval * (s.frequency === 'weekly' ? 7 : 1);
    return Math.ceil(days / step);
  }
  // Months and years vary in length: estimate low, then walk forward.
  const perStep = (s.frequency === 'yearly' ? 365 : 28) * s.interval;
  index = Math.max(0, Math.floor(days / (perStep + 4)) - 1);
  for (;;) {
    const d = occurrenceAt(s, index);
    if (d === null || d >= date) return index;
    index++;
  }
}

/** Occurrences from index `from` up to and including `until` (at most `max`). */
export function occurrencesUntil(
  s: Schedule,
  from: number,
  until: IsoDate,
  max = 50,
): Array<{ index: number; date: IsoDate }> {
  const out: Array<{ index: number; date: IsoDate }> = [];
  for (let i = from; out.length < max; i++) {
    const date = occurrenceAt(s, i);
    if (date === null || date > until) break;
    out.push({ index: i, date });
  }
  return out;
}

/** How many times per month something on this schedule happens, on average. */
export function perMonth(frequency: Frequency, interval: number): number {
  const perYear = { daily: 365.25, weekly: 365.25 / 7, monthly: 12, yearly: 1 }[frequency];
  return perYear / 12 / interval;
}

// ---------------------------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------------------------

export const RecurringKindSchema = z.enum(['expense', 'income', 'transfer']);
export type RecurringKind = z.infer<typeof RecurringKindSchema>;
export const RecurringModeSchema = z.enum(['auto', 'remind']);

const RecurringFields = {
  name: z.string().trim().min(1, { error: 'Give it a name' }).max(80),
  kind: RecurringKindSchema,
  accountId: Id,
  /** Transfers only. */
  toAccountId: Id.nullable(),
  /** Always positive; the kind decides the direction. For a variable bill, the usual amount. */
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** Transfers between currencies: the amount that arrives. */
  toAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  /** The amount changes each time (electricity, water): always ask before recording. */
  variableAmount: z.boolean(),
  payee: z.string().trim().max(120).nullable(),
  categoryId: Id.nullable(),
  notes: z.string().trim().max(1000),
  tagIds: z.array(Id).max(20),
  frequency: z.enum(FREQUENCIES),
  interval: z.number().int().min(1).max(365),
  calendar: z.enum(['bs', 'ad']),
  /** When it happens next (the schedule is anchored here). */
  nextDate: IsoDateSchema,
  lastDayOfMonth: z.boolean(),
  /** Stop after this date … */
  endDate: IsoDateSchema.nullable(),
  /** … or after this many more times. */
  remaining: z.number().int().min(1).max(1000).nullable(),
  /** auto: added on the day without asking. remind: shown as due until recorded or skipped. */
  mode: RecurringModeSchema,
  remindDaysBefore: z.number().int().min(0).max(30),
  active: z.boolean(),
};

type RecurringCheck = {
  kind: RecurringKind;
  accountId: string;
  toAccountId: string | null;
  variableAmount: boolean;
  mode: 'auto' | 'remind';
  nextDate: string;
  endDate: string | null;
};

export function checkRecurring(r: RecurringCheck, ctx: z.RefinementCtx) {
  if (r.kind === 'transfer' && (!r.toAccountId || r.toAccountId === r.accountId)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Choose two different accounts',
      path: ['toAccountId'],
    });
  }
  if (r.variableAmount && r.mode === 'auto') {
    ctx.addIssue({
      code: 'custom',
      message: 'Amounts that change each time can’t be added automatically',
      path: ['mode'],
    });
  }
  if (r.endDate && r.endDate < r.nextDate) {
    ctx.addIssue({
      code: 'custom',
      message: 'The end date is before the next date',
      path: ['endDate'],
    });
  }
}

export const RecurringBodySchema = z
  .object({
    ...RecurringFields,
    toAccountId: RecurringFields.toAccountId.default(null),
    toAmountMinor: RecurringFields.toAmountMinor.default(null),
    variableAmount: RecurringFields.variableAmount.default(false),
    payee: RecurringFields.payee.default(null),
    categoryId: RecurringFields.categoryId.default(null),
    notes: RecurringFields.notes.default(''),
    tagIds: RecurringFields.tagIds.default([]),
    interval: RecurringFields.interval.default(1),
    lastDayOfMonth: RecurringFields.lastDayOfMonth.default(false),
    endDate: RecurringFields.endDate.default(null),
    remaining: RecurringFields.remaining.default(null),
    mode: RecurringFields.mode.default('remind'),
    remindDaysBefore: RecurringFields.remindDaysBefore.default(3),
    active: RecurringFields.active.default(true),
  })
  .superRefine(checkRecurring);
export type RecurringBody = z.infer<typeof RecurringBodySchema>;
export type RecurringInput = z.input<typeof RecurringBodySchema>;
/**
 * Fields that can be changed; the merged result is checked again on the server. (No defaults
 * here: Zod 4 would apply them to omitted fields and reset them.)
 */
export const RecurringPatchSchema = z.object(RecurringFields).partial();

export const RecurringSchema = z.object({
  id: Id,
  name: z.string(),
  kind: RecurringKindSchema,
  accountId: Id,
  toAccountId: Id.nullable(),
  currency: z.string(),
  amountMinor: z.number(),
  toAmountMinor: z.number().nullable(),
  variableAmount: z.boolean(),
  payeeName: z.string().nullable(),
  categoryId: Id.nullable(),
  notes: z.string(),
  tagIds: z.array(Id),
  frequency: z.enum(FREQUENCIES),
  interval: z.number(),
  calendar: z.enum(['bs', 'ad']),
  lastDayOfMonth: z.boolean(),
  /** Null once the series has ended. */
  nextDate: z.string().nullable(),
  endDate: z.string().nullable(),
  remaining: z.number().nullable(),
  mode: RecurringModeSchema,
  remindDaysBefore: z.number(),
  active: z.boolean(),
  lastPostedDate: z.string().nullable(),
  /** Average signed amount per month in the workspace currency (null if no exchange rate). */
  monthlyBaseMinor: z.number().nullable(),
  createdAt: z.string(),
});
export type Recurring = z.infer<typeof RecurringSchema>;

export const UpcomingItemSchema = z.object({
  recurringId: Id,
  name: z.string(),
  kind: RecurringKindSchema,
  date: z.string(),
  /** Signed, in the account currency. */
  amountMinor: z.number(),
  currency: z.string(),
  accountId: Id,
  categoryId: Id.nullable(),
  variableAmount: z.boolean(),
  mode: RecurringModeSchema,
  /** A reminder whose date has passed without being recorded or skipped. */
  overdue: z.boolean(),
  /** The first of its series in this list: the one that "Record" and "Skip" act on. */
  isNext: z.boolean(),
});
export type UpcomingItem = z.infer<typeof UpcomingItemSchema>;

export const UpcomingQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export const RecordRecurringSchema = z.object({
  /** Defaults to the occurrence's date. */
  date: IsoDateSchema.optional(),
  /** Defaults to the usual amount (required for variable amounts). Positive. */
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  toAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  accountId: Id.optional(),
});
export type RecordRecurringInput = z.input<typeof RecordRecurringSchema>;

export const RecordRecurringResultSchema = z.object({
  transaction: TransactionSchema,
  recurring: RecurringSchema,
});

export const RecurringSuggestionSchema = z.object({
  payeeId: Id,
  payeeName: z.string(),
  accountId: Id,
  categoryId: Id.nullable(),
  kind: z.enum(['expense', 'income']),
  /** Positive; the most recent amount. */
  amountMinor: z.number(),
  currency: z.string(),
  cadence: z.enum(CADENCES),
  /** The schedule that matches the cadence (quarterly = every 3 months). */
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  interval: z.number(),
  /** The same amount each time (a subscription) rather than a bill that varies. */
  fixed: z.boolean(),
  count: z.number(),
  lastDate: z.string(),
  nextDate: z.string(),
  /** What to pass to "dismiss" to stop suggesting it. */
  dismissKey: z.string(),
});
export type RecurringSuggestion = z.infer<typeof RecurringSuggestionSchema>;
