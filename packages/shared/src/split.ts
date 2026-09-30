import { z } from 'zod';
import { allocate, type Minor } from './money';
import { CurrencyCode, Id, IsoDateSchema } from './schemas';

/**
 * Split groups: trips, flatmates, a dinner with friends. Someone pays, the cost is shared, and
 * the group keeps a running balance of who owes whom until people settle up. Members can be
 * people who use the app or just names. Each group uses one currency.
 */

export const SPLIT_METHODS = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export interface ShareInput {
  memberId: string;
  /** exact: amount in minor units; percent: basis points (2500 = 25%); shares: a whole number. */
  value?: number | null;
}

export interface Share {
  memberId: string;
  amountMinor: Minor;
}

export type ShareResult = { ok: true; shares: Share[] } | { ok: false; error: string };

/**
 * Works out what each person's part of `total` is. Rounding never loses or invents a paisa: the
 * parts always add up to the total exactly (leftover paisa go to the largest remainders).
 */
export function computeShares(
  total: Minor,
  method: SplitMethod,
  inputs: ShareInput[],
): ShareResult {
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: 'Enter an amount' };
  if (inputs.length === 0) return { ok: false, error: 'Choose who shares this' };
  if (new Set(inputs.map((i) => i.memberId)).size !== inputs.length)
    return { ok: false, error: 'Someone is listed twice' };
  const values = inputs.map((i) => i.value ?? 0);
  const make = (amounts: number[]): ShareResult => ({
    ok: true,
    shares: inputs.map((i, n) => ({ memberId: i.memberId, amountMinor: amounts[n]! })),
  });

  switch (method) {
    case 'equal':
      return make(
        allocate(
          total,
          inputs.map(() => 1),
        ),
      );
    case 'exact': {
      if (values.some((v) => !Number.isSafeInteger(v) || v < 0))
        return { ok: false, error: 'Amounts can’t be negative' };
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== total) {
        return {
          ok: false,
          error:
            sum < total
              ? 'The amounts add up to less than the total'
              : 'The amounts add up to more than the total',
        };
      }
      return make(values);
    }
    case 'percent': {
      if (values.some((v) => !Number.isSafeInteger(v) || v < 0))
        return { ok: false, error: 'Percentages can’t be negative' };
      if (values.reduce((a, b) => a + b, 0) !== 10_000)
        return { ok: false, error: 'Percentages must add up to 100%' };
      return make(allocate(total, values));
    }
    case 'shares': {
      if (values.some((v) => !Number.isSafeInteger(v) || v < 0))
        return { ok: false, error: 'Shares must be whole numbers' };
      if (values.every((v) => v === 0)) return { ok: false, error: 'Give someone a share' };
      return make(allocate(total, values));
    }
  }
}

export interface GroupExpense {
  paidByMemberId: string;
  amountMinor: Minor;
  shares: Share[];
}

export interface GroupSettlement {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: Minor;
}

export interface Debt {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: Minor;
}

/**
 * Each member's net position: positive means the group owes them, negative that they owe the
 * group. Paying for something adds to it, your share of anything takes away, and a settlement
 * moves money from the payer's debt to the receiver's credit.
 */
export function groupBalances(
  memberIds: readonly string[],
  expenses: readonly GroupExpense[],
  settlements: readonly GroupSettlement[],
): Map<string, Minor> {
  const net = new Map(memberIds.map((id) => [id, 0]));
  const add = (id: string, amount: number) => net.set(id, (net.get(id) ?? 0) + amount);
  for (const e of expenses) {
    add(e.paidByMemberId, e.amountMinor);
    for (const s of e.shares) add(s.memberId, -s.amountMinor);
  }
  for (const s of settlements) {
    add(s.fromMemberId, s.amountMinor);
    add(s.toMemberId, -s.amountMinor);
  }
  return net;
}

/**
 * The fewest payments that settle everyone up: the biggest debtor pays the biggest creditor,
 * repeatedly. At most (members − 1) payments.
 */
export function simplifyDebts(balances: ReadonlyMap<string, Minor>): Debt[] {
  const creditors = [...balances]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, left: v }))
    .sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  const debtors = [...balances]
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, left: -v }))
    .sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  const out: Debt[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]!;
    const debtor = debtors[d]!;
    const amount = Math.min(creditor.left, debtor.left);
    out.push({ fromMemberId: debtor.id, toMemberId: creditor.id, amountMinor: amount });
    creditor.left -= amount;
    debtor.left -= amount;
    if (creditor.left === 0) c++;
    if (debtor.left === 0) d++;
  }
  return out;
}

/**
 * Who owes whom without simplifying: each person owes whoever paid for their share, netted per
 * pair of people (and reduced by what they've paid each other).
 */
export function pairwiseDebts(
  expenses: readonly GroupExpense[],
  settlements: readonly GroupSettlement[],
): Debt[] {
  // owed.get("a|b") = what a owes b (before netting with b owing a).
  const owed = new Map<string, number>();
  const add = (from: string, to: string, amount: number) => {
    if (from === to || amount === 0) return;
    const key = `${from}|${to}`;
    owed.set(key, (owed.get(key) ?? 0) + amount);
  };
  for (const e of expenses) {
    for (const s of e.shares) add(s.memberId, e.paidByMemberId, s.amountMinor);
  }
  // A payment from a to b cancels what a owed b (or becomes b owing a).
  for (const s of settlements) add(s.toMemberId, s.fromMemberId, s.amountMinor);
  const out: Debt[] = [];
  const seen = new Set<string>();
  for (const key of owed.keys()) {
    const [a, b] = key.split('|') as [string, string];
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const net = (owed.get(`${a}|${b}`) ?? 0) - (owed.get(`${b}|${a}`) ?? 0);
    if (net > 0) out.push({ fromMemberId: a, toMemberId: b, amountMinor: net });
    else if (net < 0) out.push({ fromMemberId: b, toMemberId: a, amountMinor: -net });
  }
  return out.sort((x, y) => y.amountMinor - x.amountMinor);
}

// ---------------------------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------------------------

const Name = z.string().trim().min(1, { error: 'Required' }).max(60);

export const SplitMemberSchema = z.object({
  id: Id,
  name: z.string(),
  /** The app user this member is (a member of the workspace), if any. */
  userId: z.string().nullable(),
  /** This member is the person asking. */
  you: z.boolean(),
  /** Positive: the group owes them. Negative: they owe the group. */
  balanceMinor: z.number(),
  paidMinor: z.number(),
  shareMinor: z.number(),
});
export type SplitMember = z.infer<typeof SplitMemberSchema>;

export const DebtSchema = z.object({
  fromMemberId: Id,
  toMemberId: Id,
  amountMinor: z.number(),
});

export const SplitExpenseSchema = z.object({
  type: z.literal('expense'),
  id: Id,
  date: z.string(),
  description: z.string(),
  amountMinor: z.number(),
  paidByMemberId: Id,
  method: z.enum(SPLIT_METHODS),
  shares: z.array(
    z.object({ memberId: Id, amountMinor: z.number(), value: z.number().nullable() }),
  ),
  /** The transaction recorded in your accounts for this, if any. */
  linkedTransactionId: Id.nullable(),
  createdAt: z.string(),
});
export type SplitExpense = z.infer<typeof SplitExpenseSchema>;

export const SplitSettlementSchema = z.object({
  type: z.literal('settlement'),
  id: Id,
  date: z.string(),
  fromMemberId: Id,
  toMemberId: Id,
  amountMinor: z.number(),
  notes: z.string(),
  linkedTransactionId: Id.nullable(),
  createdAt: z.string(),
});
export type SplitSettlement = z.infer<typeof SplitSettlementSchema>;

export const SplitGroupSummarySchema = z.object({
  id: Id,
  name: z.string(),
  currency: z.string(),
  memberCount: z.number(),
  /** Your balance in this group (null when you're not in it). */
  yourBalanceMinor: z.number().nullable(),
  totalSpentMinor: z.number(),
  archived: z.boolean(),
  updatedAt: z.string(),
});
export type SplitGroupSummary = z.infer<typeof SplitGroupSummarySchema>;

export const SplitGroupSchema = z.object({
  id: Id,
  name: z.string(),
  currency: z.string(),
  simplifyDebts: z.boolean(),
  /** Category used when recording this group's costs in your accounts. */
  categoryId: Id.nullable(),
  archived: z.boolean(),
  members: z.array(SplitMemberSchema),
  /** Payments that would settle everyone up. */
  suggested: z.array(DebtSchema),
  totalSpentMinor: z.number(),
  activity: z.array(z.discriminatedUnion('type', [SplitExpenseSchema, SplitSettlementSchema])),
});
export type SplitGroup = z.infer<typeof SplitGroupSchema>;

const MemberInput = z.object({
  name: Name,
  /** Link to someone in this workspace (so the group knows it's them). */
  userId: z.string().min(1).max(100).nullable().optional(),
});

export const CreateSplitGroupSchema = z.object({
  name: Name,
  currency: CurrencyCode,
  simplifyDebts: z.boolean().default(true),
  categoryId: Id.nullable().default(null),
  /** Other people; you are added automatically. */
  members: z.array(MemberInput).max(50).default([]),
});
export type CreateSplitGroupInput = z.input<typeof CreateSplitGroupSchema>;

export const UpdateSplitGroupSchema = z.object({
  name: Name.optional(),
  simplifyDebts: z.boolean().optional(),
  categoryId: Id.nullable().optional(),
  archived: z.boolean().optional(),
});

export const AddSplitMemberSchema = MemberInput;
export const RenameSplitMemberSchema = z.object({ name: Name });

/** Record this in your own accounts too (see the group's notes on how). */
export const RecordInLedgerSchema = z.object({
  accountId: Id,
  categoryId: Id.nullable().optional(),
});

export const SplitExpenseBodySchema = z.object({
  date: IsoDateSchema,
  description: z.string().trim().min(1, { error: 'What was it for?' }).max(120),
  amountMinor: z.number().int().positive({ error: 'Enter an amount' }),
  paidByMemberId: Id,
  method: z.enum(SPLIT_METHODS).default('equal'),
  shares: z
    .array(z.object({ memberId: Id, value: z.number().int().min(0).nullable().optional() }))
    .min(1, { error: 'Choose who shares this' })
    .max(50),
  record: RecordInLedgerSchema.nullable().optional(),
});
export type SplitExpenseBody = z.input<typeof SplitExpenseBodySchema>;

export const SplitSettlementBodySchema = z
  .object({
    date: IsoDateSchema,
    fromMemberId: Id,
    toMemberId: Id,
    amountMinor: z.number().int().positive({ error: 'Enter an amount' }),
    notes: z.string().trim().max(200).default(''),
    record: RecordInLedgerSchema.nullable().optional(),
  })
  .refine((s) => s.fromMemberId !== s.toMemberId, {
    error: 'Choose two different people',
    path: ['toMemberId'],
  });
export type SplitSettlementBody = z.input<typeof SplitSettlementBodySchema>;
