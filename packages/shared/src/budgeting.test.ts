import { describe, expect, it } from 'vitest';
import { bsToAd } from './bs';
import { carryForward, envelopeMonths, GoalBodySchema, goalPlan } from './budgeting';

const months = [
  { budgetedMinor: 10_000, spentMinor: 7_000 }, // +3,000
  { budgetedMinor: 10_000, spentMinor: 15_000 }, // −5,000 (after carry: −2,000)
  { budgetedMinor: 10_000, spentMinor: 4_000 }, // +6,000
];

describe('carryForward', () => {
  it('starts fresh without rollover', () => {
    expect(carryForward('none', months)).toBe(0);
  });
  it('carries leftovers but forgives overspending with "surplus"', () => {
    // 3,000 → (3,000 + 10,000 − 15,000 = −2,000 → 0) → 6,000
    expect(carryForward('surplus', months)).toBe(6_000);
  });
  it('carries overspending too with "all"', () => {
    // 3,000 → −2,000 → 4,000
    expect(carryForward('all', months)).toBe(4_000);
  });
});

describe('goalPlan', () => {
  const bs = { calendar: 'bs' as const, monthStartDay: 1 };
  const today = bsToAd({ year: 2083, month: 6, day: 14 }); // mid-Asoj
  it('spreads what is left over the budget months until the target', () => {
    // Asoj, Kartik, Mangsir, Poush → 4 months including this one.
    const target = bsToAd({ year: 2083, month: 9, day: 10 });
    expect(goalPlan(100_000, 20_000, today, target, bs)).toEqual({
      monthsLeft: 4,
      monthlyNeededMinor: 20_000,
    });
  });
  it('handles no date, reached goals and passed dates', () => {
    expect(goalPlan(100_000, 0, today, null, bs)).toEqual({
      monthsLeft: null,
      monthlyNeededMinor: null,
    });
    expect(goalPlan(100_000, 150_000, today, today, bs).monthlyNeededMinor).toBe(0);
    expect(goalPlan(100_000, 40_000, today, '2020-01-01', bs)).toEqual({
      monthsLeft: 0,
      monthlyNeededMinor: 60_000,
    });
  });
});

describe('GoalBodySchema', () => {
  it('needs the account or category its kind refers to', () => {
    expect(
      GoalBodySchema.safeParse({ name: 'Bike', kind: 'account', targetMinor: 1 }).success,
    ).toBe(false);
    expect(GoalBodySchema.safeParse({ name: 'Bike', kind: 'manual', targetMinor: 1 }).success).toBe(
      true,
    );
  });
});

describe('envelopeMonths', () => {
  it('assigns income, carries leftovers and charges overspending to next month', () => {
    const [first, second, third] = envelopeMonths(10_000, [
      {
        incomeMinor: 50_000,
        uncategorizedSpentMinor: 1_000,
        lines: [
          { categoryId: 'food', budgetedMinor: 20_000, spentMinor: 15_000 },
          { categoryId: 'fun', budgetedMinor: 5_000, spentMinor: 8_000 },
        ],
      },
      {
        incomeMinor: 0,
        uncategorizedSpentMinor: 0,
        lines: [{ categoryId: 'food', budgetedMinor: 10_000, spentMinor: 12_000 }],
      },
      { incomeMinor: 0, uncategorizedSpentMinor: 0, lines: [] },
    ]);
    // 10,000 + 50,000 − 25,000 assigned − 1,000 uncategorized.
    expect(first!.readyToAssignMinor).toBe(34_000);
    expect(first!.overspentMinor).toBe(3_000);
    expect(first!.lines.get('fun')).toEqual({ carryInMinor: 0, availableMinor: -3_000 });
    // Food keeps its 5,000; fun's 3,000 overspending comes out of Ready to assign.
    expect(second!.lines.get('food')).toEqual({ carryInMinor: 5_000, availableMinor: 3_000 });
    expect(second!.lines.has('fun')).toBe(false);
    expect(second!.overspentLastMonthMinor).toBe(3_000);
    expect(second!.readyToAssignMinor).toBe(34_000 - 10_000 - 3_000);
    expect(third!.lines.get('food')).toEqual({ carryInMinor: 3_000, availableMinor: 3_000 });
    expect(third!.readyToAssignMinor).toBe(21_000);
  });
});
