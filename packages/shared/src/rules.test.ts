import { describe, expect, it } from 'vitest';
import {
  conditionMatches,
  describeCondition,
  evaluateRules,
  type Rule,
  RuleBodySchema,
  type RuleSubject,
} from './rules';
import { descriptionKeyword } from './text';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const TRANSPORT = '00000000-0000-4000-8000-000000000001';
const FOOD = '00000000-0000-4000-8000-000000000002';
const HOUSEHOLD = '00000000-0000-4000-8000-000000000003';
const TAG = '00000000-0000-4000-8000-000000000004';

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  payee: 'Pathao Nepal',
  description: 'FONEPAY/QR/PATHAO NEPAL/12345',
  notes: '',
  amountMinor: -25_000,
  accountId: A,
  ...over,
});

const rule = (over: Partial<Rule>): Rule => ({
  id: over.id ?? 'r1',
  name: 'rule',
  enabled: true,
  match: 'all',
  conditions: [],
  actions: [],
  stopProcessing: false,
  priority: 0,
  hitCount: 0,
  lastHitAt: null,
  ...over,
});

describe('conditions', () => {
  it('matches text case-insensitively', () => {
    expect(
      conditionMatches({ field: 'description', op: 'contains', value: 'pathao' }, subject()),
    ).toBe(true);
    expect(
      conditionMatches({ field: 'payee', op: 'equals', value: 'pathao nepal' }, subject()),
    ).toBe(true);
    expect(conditionMatches({ field: 'payee', op: 'startsWith', value: 'PATH' }, subject())).toBe(
      true,
    );
    expect(conditionMatches({ field: 'payee', op: 'endsWith', value: 'nepal' }, subject())).toBe(
      true,
    );
    expect(
      conditionMatches({ field: 'description', op: 'matches', value: 'qr/pat\\w+' }, subject()),
    ).toBe(true);
    expect(conditionMatches({ field: 'notes', op: 'contains', value: 'x' }, subject())).toBe(false);
  });

  it('never throws on a bad pattern', () => {
    expect(conditionMatches({ field: 'payee', op: 'matches', value: '([' }, subject())).toBe(false);
  });

  it('compares absolute amounts', () => {
    expect(conditionMatches({ field: 'amount', op: 'equals', value: 25_000 }, subject())).toBe(
      true,
    );
    expect(conditionMatches({ field: 'amount', op: 'gt', value: 10_000 }, subject())).toBe(true);
    expect(conditionMatches({ field: 'amount', op: 'lte', value: 10_000 }, subject())).toBe(false);
    expect(
      conditionMatches(
        { field: 'amount', op: 'between', value: 20_000, value2: 30_000 },
        subject(),
      ),
    ).toBe(true);
  });

  it('checks account and direction', () => {
    expect(conditionMatches({ field: 'account', op: 'is', value: A }, subject())).toBe(true);
    expect(conditionMatches({ field: 'account', op: 'isNot', value: A }, subject())).toBe(false);
    expect(conditionMatches({ field: 'direction', op: 'is', value: 'out' }, subject())).toBe(true);
    expect(
      conditionMatches({ field: 'direction', op: 'is', value: 'in' }, subject({ amountMinor: 5 })),
    ).toBe(true);
  });
});

describe('evaluateRules', () => {
  const pathao = rule({
    id: 'pathao',
    conditions: [{ field: 'description', op: 'contains', value: 'pathao' }],
    actions: [
      { type: 'setCategory', categoryId: TRANSPORT },
      { type: 'setPayee', payee: 'Pathao' },
      { type: 'addTags', tagIds: [TAG] },
      { type: 'markReviewed' },
    ],
  });

  it('applies all actions of a matching rule', () => {
    expect(evaluateRules([pathao], subject())).toEqual({
      matchedRuleIds: ['pathao'],
      categoryId: TRANSPORT,
      payee: 'Pathao',
      tagIds: [TAG],
      markReviewed: true,
    });
  });

  it('skips disabled rules and non-matches', () => {
    expect(evaluateRules([{ ...pathao, enabled: false }], subject()).matchedRuleIds).toEqual([]);
    expect(evaluateRules([pathao], subject({ description: 'Daraz' })).matchedRuleIds).toEqual([]);
  });

  it('lets later rules override, unless an earlier rule stops processing', () => {
    const later = rule({
      id: 'later',
      conditions: [{ field: 'direction', op: 'is', value: 'out' }],
      actions: [{ type: 'setCategory', categoryId: FOOD }],
    });
    expect(evaluateRules([pathao, later], subject()).categoryId).toBe(FOOD);
    expect(evaluateRules([{ ...pathao, stopProcessing: true }, later], subject()).categoryId).toBe(
      TRANSPORT,
    );
  });

  it('supports any-of matching', () => {
    const anyRule = rule({
      match: 'any',
      conditions: [
        { field: 'payee', op: 'contains', value: 'nope' },
        { field: 'account', op: 'is', value: A },
      ],
      actions: [{ type: 'setNotes', notes: 'from A' }],
    });
    expect(evaluateRules([anyRule], subject()).notes).toBe('from A');
    expect(evaluateRules([anyRule], subject({ accountId: B })).matchedRuleIds).toEqual([]);
  });

  it('splits by percentage with exact totals', () => {
    const split = rule({
      conditions: [{ field: 'payee', op: 'contains', value: 'mart' }],
      actions: [
        {
          type: 'splitByPercent',
          lines: [
            { categoryId: FOOD, percent: 70 },
            { categoryId: HOUSEHOLD, percent: 30 },
          ],
        },
      ],
    });
    const result = evaluateRules([split], subject({ payee: 'Big Mart', amountMinor: -100_001 }));
    expect(result.split).toEqual([
      { categoryId: FOOD, amountMinor: -70_001 },
      { categoryId: HOUSEHOLD, amountMinor: -30_000 },
    ]);
    expect(result.split!.reduce((s, l) => s + l.amountMinor, 0)).toBe(-100_001);
  });
});

describe('RuleBodySchema', () => {
  const base = {
    name: 'Test',
    conditions: [{ field: 'payee', op: 'contains', value: 'x' }],
    actions: [{ type: 'setCategory', categoryId: FOOD }],
  };

  it('fills defaults', () => {
    expect(RuleBodySchema.parse(base)).toMatchObject({
      enabled: true,
      match: 'all',
      stopProcessing: false,
    });
  });

  it('rejects inconsistent rules', () => {
    expect(
      RuleBodySchema.safeParse({
        ...base,
        conditions: [{ field: 'payee', op: 'matches', value: '([' }],
      }).success,
    ).toBe(false);
    expect(
      RuleBodySchema.safeParse({
        ...base,
        conditions: [{ field: 'amount', op: 'between', value: 10, value2: 5 }],
      }).success,
    ).toBe(false);
    expect(
      RuleBodySchema.safeParse({
        ...base,
        actions: [
          { type: 'setCategory', categoryId: FOOD },
          {
            type: 'splitByPercent',
            lines: [
              { categoryId: FOOD, percent: 50 },
              { categoryId: null, percent: 50 },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RuleBodySchema.safeParse({
        ...base,
        actions: [
          {
            type: 'splitByPercent',
            lines: [
              { categoryId: FOOD, percent: 50 },
              { categoryId: null, percent: 40 },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(RuleBodySchema.safeParse({ ...base, conditions: [] }).success).toBe(false);
  });
});

describe('describeCondition', () => {
  it('reads naturally', () => {
    expect(describeCondition({ field: 'description', op: 'contains', value: 'pathao' })).toBe(
      'Bank description contains “pathao”',
    );
    expect(
      describeCondition(
        { field: 'amount', op: 'between', value: 100, value2: 500 },
        { amount: (m) => `Rs. ${m / 100}` },
      ),
    ).toBe('Amount is between Rs. 1 and Rs. 5');
    expect(
      describeCondition({ field: 'account', op: 'is', value: A }, { account: () => 'Cash' }),
    ).toBe('Account is Cash');
  });
});

describe('descriptionKeyword', () => {
  it('picks a distinctive word from bank narrations', () => {
    expect(descriptionKeyword('FONEPAY/QR/PATHAO RIDE KTM')).toBe('pathao');
    expect(descriptionKeyword('POS/DARAZ KAYMU PVT LTD')).toBe('daraz');
    expect(descriptionKeyword('NTC TOPUP 98XXXXXXXX')).toBe('ntc topup');
    expect(descriptionKeyword('IPS/LANDLORD RENT KARTIK')).toBe('landlord');
    expect(descriptionKeyword('12345')).toBe('12345');
  });
});
