import { z } from 'zod';
import type { IsoDate } from './dates';
import type { Minor } from './money';
import { listMonthPeriods, type PeriodSettings } from './periods';
import { Id, IsoDateSchema } from './schemas';

/**
 * Rollover: what's left in a category at the end of a month moves into the next one.
 * - none:    every month starts fresh.
 * - surplus: leftover money carries over; overspending doesn't (the next month starts at its
 *            own budget).
 * - all:     leftover and overspending both carry over, so overspending is paid back next month.
 */
export const ROLLOVER_MODES = ['none', 'surplus', 'all'] as const;
export type RolloverMode = (typeof ROLLOVER_MODES)[number];

/** The amount carried into the month after `months` (oldest first). */
export function carryForward(
  mode: RolloverMode,
  months: ReadonlyArray<{ budgetedMinor: Minor; spentMinor: Minor }>,
): Minor {
  if (mode === 'none') return 0;
  let carry = 0;
  for (const m of months) {
    const left = carry + m.budgetedMinor - m.spentMinor;
    carry = mode === 'surplus' ? Math.max(0, left) : left;
  }
  return carry;
}

export const SetRolloverSchema = z.object({
  categoryId: Id,
  mode: z.enum(ROLLOVER_MODES),
  /** Carry over starting with this budget month's leftover (default: the current month). */
  fromPeriodStart: IsoDateSchema.optional(),
});
export type SetRolloverInput = z.input<typeof SetRolloverSchema>;

export const SetBudgetCapSchema = z.object({
  periodStart: IsoDateSchema,
  /** The most to spend in a month, across all categories; 0 removes the limit. */
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type SetBudgetCapInput = z.input<typeof SetBudgetCapSchema>;

// ---------------------------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------------------------

/**
 * - account:  saving up in an account (e.g. a savings account); progress is its balance.
 * - category: a sinking fund; progress is what's available in a rollover category.
 * - manual:   progress is what you record yourself ("add money").
 */
export const GOAL_KINDS = ['account', 'category', 'manual'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

const GoalFields = {
  name: z.string().trim().min(1, { error: 'Give the goal a name' }).max(80),
  kind: z.enum(GOAL_KINDS),
  targetMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  targetDate: IsoDateSchema.nullable(),
  accountId: Id.nullable(),
  categoryId: Id.nullable(),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  archived: z.boolean(),
};

function checkGoal(
  g: { kind: GoalKind; accountId: string | null; categoryId: string | null },
  ctx: z.RefinementCtx,
) {
  if (g.kind === 'account' && !g.accountId) {
    ctx.addIssue({ code: 'custom', message: 'Choose the account', path: ['accountId'] });
  }
  if (g.kind === 'category' && !g.categoryId) {
    ctx.addIssue({ code: 'custom', message: 'Choose the category', path: ['categoryId'] });
  }
}

export const GoalBodySchema = z
  .object({
    ...GoalFields,
    targetDate: GoalFields.targetDate.default(null),
    accountId: GoalFields.accountId.default(null),
    categoryId: GoalFields.categoryId.default(null),
    icon: GoalFields.icon.default('piggy-bank'),
    color: GoalFields.color.default('#0f766e'),
    archived: GoalFields.archived.default(false),
    /** Manual goals: what's already saved. */
    savedMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .superRefine(checkGoal);
export type GoalInput = z.input<typeof GoalBodySchema>;
export type GoalBody = z.output<typeof GoalBodySchema>;
/** No defaults: Zod 4 would apply them to omitted fields and reset them. */
export const GoalPatchSchema = z
  .object({ ...GoalFields, savedMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
  .partial();

export const ContributeSchema = z.object({
  /** Positive to add, negative to take out. */
  amountMinor: z
    .number()
    .int()
    .refine((v) => v !== 0, { error: 'Enter an amount' }),
});

export const GoalSchema = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(GOAL_KINDS),
  targetMinor: z.number(),
  targetDate: z.string().nullable(),
  accountId: Id.nullable(),
  categoryId: Id.nullable(),
  icon: z.string(),
  color: z.string(),
  archived: z.boolean(),
  /** In the workspace currency. */
  currentMinor: z.number(),
  /** 0–1 (capped). */
  progress: z.number(),
  /** Budget months left until the target date, including this one (null without a date). */
  monthsLeft: z.number().nullable(),
  /** What to put aside each month to reach the target on time. */
  monthlyNeededMinor: z.number().nullable(),
  reached: z.boolean(),
  createdAt: z.string(),
});
export type Goal = z.infer<typeof GoalSchema>;

/** Months left (the current one included) and the monthly amount needed to reach a target. */
export function goalPlan(
  targetMinor: Minor,
  currentMinor: Minor,
  today: IsoDate,
  targetDate: IsoDate | null,
  settings: PeriodSettings,
): { monthsLeft: number | null; monthlyNeededMinor: Minor | null } {
  if (!targetDate) return { monthsLeft: null, monthlyNeededMinor: null };
  const monthsLeft = targetDate < today ? 0 : listMonthPeriods(today, targetDate, settings).length;
  const remaining = Math.max(0, targetMinor - currentMinor);
  return {
    monthsLeft,
    monthlyNeededMinor:
      remaining === 0 ? 0 : monthsLeft === 0 ? remaining : Math.ceil(remaining / monthsLeft),
  };
}
