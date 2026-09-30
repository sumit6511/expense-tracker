import { z } from 'zod';
import { allocate, type Minor } from './money';
import { TransactionSchema } from './schemas';

/**
 * Rules turn messy bank descriptions into clean, categorized transactions:
 * "if the description contains PATHAO, set category Transport and payee Pathao".
 * They run on imported rows, fill gaps on manually entered transactions, and can be applied
 * retroactively. Evaluation is pure so the web app can preview exactly what the API will do.
 */

const Id = z.uuid();

export const TextField = z.enum(['payee', 'description', 'notes']);
export const TextOp = z.enum(['contains', 'equals', 'startsWith', 'endsWith', 'matches']);
export const AmountOp = z.enum(['equals', 'gt', 'gte', 'lt', 'lte', 'between']);

export const RuleConditionSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('payee'), op: TextOp, value: z.string().trim().min(1).max(200) }),
  z.object({
    field: z.literal('description'),
    op: TextOp,
    value: z.string().trim().min(1).max(200),
  }),
  z.object({ field: z.literal('notes'), op: TextOp, value: z.string().trim().min(1).max(200) }),
  z.object({
    field: z.literal('amount'),
    op: AmountOp,
    /** Absolute amount in minor units of the transaction's currency. */
    value: z.number().int().min(0),
    value2: z.number().int().min(0).optional(),
  }),
  z.object({ field: z.literal('account'), op: z.enum(['is', 'isNot']), value: Id }),
  z.object({ field: z.literal('direction'), op: z.literal('is'), value: z.enum(['out', 'in']) }),
]);
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

export const RuleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setCategory'), categoryId: Id.nullable() }),
  z.object({ type: z.literal('setPayee'), payee: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal('addTags'), tagIds: z.array(Id).min(1).max(10) }),
  z.object({ type: z.literal('setNotes'), notes: z.string().trim().max(1000) }),
  z.object({ type: z.literal('markReviewed') }),
  z.object({
    type: z.literal('splitByPercent'),
    lines: z
      .array(z.object({ categoryId: Id.nullable(), percent: z.number().positive().max(100) }))
      .min(2)
      .max(10)
      .refine((lines) => Math.abs(lines.reduce((s, l) => s + l.percent, 0) - 100) < 1e-9, {
        error: 'Percentages must add up to 100',
      }),
  }),
]);
export type RuleAction = z.infer<typeof RuleActionSchema>;

export const RuleBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(RuleConditionSchema).min(1).max(10),
    actions: z.array(RuleActionSchema).min(1).max(10),
    stopProcessing: z.boolean().default(false),
  })
  .superRefine((rule, ctx) => {
    for (const [i, c] of rule.conditions.entries()) {
      if (
        c.field === 'amount' &&
        c.op === 'between' &&
        (c.value2 === undefined || c.value2 < c.value)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter an upper amount above the lower one',
          path: ['conditions', i],
        });
      }
      if (
        'op' in c &&
        c.op === 'matches' &&
        typeof c.value === 'string' &&
        !isValidPattern(c.value)
      ) {
        ctx.addIssue({ code: 'custom', message: 'Not a valid pattern', path: ['conditions', i] });
      }
    }
    const kinds = rule.actions.map((a) => a.type);
    if (kinds.includes('setCategory') && kinds.includes('splitByPercent')) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use either “set category” or “split”, not both',
        path: ['actions'],
      });
    }
  });
export type RuleBody = z.infer<typeof RuleBodySchema>;
export type RuleInput = z.input<typeof RuleBodySchema>;

export const RuleSchema = z.object({
  id: Id,
  name: z.string(),
  enabled: z.boolean(),
  match: z.enum(['all', 'any']),
  conditions: z.array(RuleConditionSchema),
  actions: z.array(RuleActionSchema),
  stopProcessing: z.boolean(),
  priority: z.number(),
  hitCount: z.number(),
  lastHitAt: z.string().nullable(),
});
export type Rule = z.infer<typeof RuleSchema>;

export const ReorderRulesSchema = z.object({ ids: z.array(Id).min(1).max(500) });

/** Test a (possibly unsaved) rule against existing transactions. */
export const RulePreviewRequestSchema = z.object({
  rule: RuleBodySchema,
  onlyUncategorized: z.boolean().default(false),
});
export const RulePreviewSchema = z.object({
  /** Transactions the rule matches (transfers are never matched). */
  count: z.number(),
  /** Of those, how many would change. */
  changeCount: z.number(),
  items: z.array(TransactionSchema),
});
export type RulePreview = z.infer<typeof RulePreviewSchema>;

export const ApplyRuleSchema = z.object({
  /** Leave transactions that already have a category alone. */
  onlyUncategorized: z.boolean().default(true),
});
export const ApplyRuleResultSchema = z.object({ updated: z.number() });

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

/** What a rule sees about a transaction. Amounts are signed minor units. */
export interface RuleSubject {
  payee: string;
  description: string;
  notes: string;
  amountMinor: Minor;
  accountId: string;
}

/** The combined effect of all matching rules. Later rules override earlier single values. */
export interface RuleResult {
  matchedRuleIds: string[];
  categoryId?: string | null;
  split?: Array<{ categoryId: string | null; amountMinor: Minor }>;
  payee?: string;
  tagIds: string[];
  notes?: string;
  markReviewed: boolean;
}

// Very long inputs are cut before regex matching, which bounds the cost of user patterns.
const MAX_TEXT = 500;

function textMatches(op: z.infer<typeof TextOp>, haystack: string, needle: string): boolean {
  const h = haystack.slice(0, MAX_TEXT).toLowerCase();
  const n = needle.toLowerCase();
  switch (op) {
    case 'contains':
      return h.includes(n);
    case 'equals':
      return h.trim() === n.trim();
    case 'startsWith':
      return h.startsWith(n);
    case 'endsWith':
      return h.trimEnd().endsWith(n);
    case 'matches':
      try {
        return new RegExp(needle, 'i').test(haystack.slice(0, MAX_TEXT));
      } catch {
        return false;
      }
  }
}

export function conditionMatches(condition: RuleCondition, subject: RuleSubject): boolean {
  switch (condition.field) {
    case 'payee':
      return textMatches(condition.op, subject.payee, condition.value);
    case 'description':
      return textMatches(condition.op, subject.description, condition.value);
    case 'notes':
      return textMatches(condition.op, subject.notes, condition.value);
    case 'amount': {
      const a = Math.abs(subject.amountMinor);
      switch (condition.op) {
        case 'equals':
          return a === condition.value;
        case 'gt':
          return a > condition.value;
        case 'gte':
          return a >= condition.value;
        case 'lt':
          return a < condition.value;
        case 'lte':
          return a <= condition.value;
        case 'between':
          return a >= condition.value && a <= (condition.value2 ?? condition.value);
      }
      return false;
    }
    case 'account':
      return condition.op === 'is'
        ? subject.accountId === condition.value
        : subject.accountId !== condition.value;
    case 'direction':
      return condition.value === 'out' ? subject.amountMinor < 0 : subject.amountMinor > 0;
  }
}

export function ruleMatches(
  rule: Pick<RuleBody, 'match' | 'conditions'>,
  subject: RuleSubject,
): boolean {
  return rule.match === 'all'
    ? rule.conditions.every((c) => conditionMatches(c, subject))
    : rule.conditions.some((c) => conditionMatches(c, subject));
}

/** Runs enabled rules in order (lowest priority first) and merges their actions. */
export function evaluateRules(
  rules: ReadonlyArray<
    Pick<Rule, 'id' | 'enabled' | 'match' | 'conditions' | 'actions' | 'stopProcessing'>
  >,
  subject: RuleSubject,
): RuleResult {
  const result: RuleResult = { matchedRuleIds: [], tagIds: [], markReviewed: false };
  for (const rule of rules) {
    if (!rule.enabled || !ruleMatches(rule, subject)) continue;
    result.matchedRuleIds.push(rule.id);
    for (const action of rule.actions) {
      switch (action.type) {
        case 'setCategory':
          result.categoryId = action.categoryId;
          result.split = undefined;
          break;
        case 'splitByPercent': {
          const parts = allocate(
            subject.amountMinor,
            action.lines.map((l) => l.percent),
          );
          result.split = action.lines.map((l, i) => ({
            categoryId: l.categoryId,
            amountMinor: parts[i]!,
          }));
          result.categoryId = undefined;
          break;
        }
        case 'setPayee':
          result.payee = action.payee;
          break;
        case 'addTags':
          for (const t of action.tagIds) if (!result.tagIds.includes(t)) result.tagIds.push(t);
          break;
        case 'setNotes':
          result.notes = action.notes;
          break;
        case 'markReviewed':
          result.markReviewed = true;
          break;
      }
    }
    if (rule.stopProcessing) break;
  }
  return result;
}

/** A readable one-line summary, e.g. "Payee contains “pathao” → Transport". */
export function describeCondition(
  c: RuleCondition,
  names: { account?: (id: string) => string; amount?: (minor: Minor) => string } = {},
): string {
  const amount = names.amount ?? ((minor: Minor) => String(minor / 100));
  const opLabels: Record<string, string> = {
    contains: 'contains',
    equals: 'is',
    startsWith: 'starts with',
    endsWith: 'ends with',
    matches: 'matches pattern',
    gt: 'is more than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    between: 'is between',
    is: 'is',
    isNot: 'is not',
  };
  switch (c.field) {
    case 'payee':
    case 'description':
    case 'notes':
      return `${c.field === 'description' ? 'Bank description' : c.field[0]!.toUpperCase() + c.field.slice(1)} ${opLabels[c.op]} “${c.value}”`;
    case 'amount':
      return `Amount ${opLabels[c.op]} ${amount(c.value)}${c.op === 'between' ? ` and ${amount(c.value2 ?? 0)}` : ''}`;
    case 'account':
      return `Account ${opLabels[c.op]} ${names.account?.(c.value) ?? 'an account'}`;
    case 'direction':
      return c.value === 'out' ? 'Money going out' : 'Money coming in';
  }
}
