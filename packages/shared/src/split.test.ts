import { describe, expect, it } from 'vitest';
import { computeShares, groupBalances, pairwiseDebts, simplifyDebts } from './split';

const amounts = (r: ReturnType<typeof computeShares>) =>
  r.ok ? r.shares.map((s) => s.amountMinor) : r.error;

describe('computeShares', () => {
  const three = [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }];

  it('splits equally without losing a paisa', () => {
    expect(amounts(computeShares(100_000, 'equal', three))).toEqual([33_334, 33_333, 33_333]);
    expect(amounts(computeShares(1, 'equal', three))).toEqual([1, 0, 0]);
  });

  it('takes exact amounts that must add up', () => {
    const ok = computeShares(1_000, 'exact', [
      { memberId: 'a', value: 700 },
      { memberId: 'b', value: 300 },
    ]);
    expect(amounts(ok)).toEqual([700, 300]);
    expect(amounts(computeShares(1_000, 'exact', [{ memberId: 'a', value: 900 }]))).toBe(
      'The amounts add up to less than the total',
    );
    expect(amounts(computeShares(1_000, 'exact', [{ memberId: 'a', value: 1_100 }]))).toBe(
      'The amounts add up to more than the total',
    );
  });

  it('splits by percentage and by shares', () => {
    const pct = computeShares(100_001, 'percent', [
      { memberId: 'a', value: 5_000 },
      { memberId: 'b', value: 2_500 },
      { memberId: 'c', value: 2_500 },
    ]);
    expect(amounts(pct)).toEqual([50_001, 25_000, 25_000]);
    expect(amounts(computeShares(1_000, 'percent', [{ memberId: 'a', value: 9_000 }]))).toBe(
      'Percentages must add up to 100%',
    );
    const shares = computeShares(90_000, 'shares', [
      { memberId: 'a', value: 2 },
      { memberId: 'b', value: 1 },
      { memberId: 'c', value: 0 },
    ]);
    expect(amounts(shares)).toEqual([60_000, 30_000, 0]);
  });

  it('rejects nonsense', () => {
    expect(amounts(computeShares(0, 'equal', three))).toBe('Enter an amount');
    expect(amounts(computeShares(100, 'equal', []))).toBe('Choose who shares this');
    expect(amounts(computeShares(100, 'equal', [{ memberId: 'a' }, { memberId: 'a' }]))).toBe(
      'Someone is listed twice',
    );
  });
});

describe('balances and debts', () => {
  // Asha paid 3,000 for dinner for three; Bikash paid 600 for taxis for Asha and himself;
  // Chandra then paid Asha back 500.
  const expenses = [
    {
      paidByMemberId: 'asha',
      amountMinor: 3_000,
      shares: [
        { memberId: 'asha', amountMinor: 1_000 },
        { memberId: 'bikash', amountMinor: 1_000 },
        { memberId: 'chandra', amountMinor: 1_000 },
      ],
    },
    {
      paidByMemberId: 'bikash',
      amountMinor: 600,
      shares: [
        { memberId: 'asha', amountMinor: 300 },
        { memberId: 'bikash', amountMinor: 300 },
      ],
    },
  ];
  const settlements = [{ fromMemberId: 'chandra', toMemberId: 'asha', amountMinor: 500 }];

  it('nets what each person paid against their share', () => {
    const net = groupBalances(['asha', 'bikash', 'chandra', 'dev'], expenses, settlements);
    expect(Object.fromEntries(net)).toEqual({ asha: 1_200, bikash: -700, chandra: -500, dev: 0 });
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('simplifies to the fewest payments', () => {
    const net = groupBalances(['asha', 'bikash', 'chandra'], expenses, settlements);
    expect(simplifyDebts(net)).toEqual([
      { fromMemberId: 'bikash', toMemberId: 'asha', amountMinor: 700 },
      { fromMemberId: 'chandra', toMemberId: 'asha', amountMinor: 500 },
    ]);
    // A chain collapses: a owes b 100, b owes c 100 → a pays c.
    expect(
      simplifyDebts(
        new Map([
          ['a', -100],
          ['b', 0],
          ['c', 100],
        ]),
      ),
    ).toEqual([{ fromMemberId: 'a', toMemberId: 'c', amountMinor: 100 }]);
  });

  it('can list debts per pair instead', () => {
    expect(pairwiseDebts(expenses, settlements)).toEqual([
      { fromMemberId: 'bikash', toMemberId: 'asha', amountMinor: 700 },
      { fromMemberId: 'chandra', toMemberId: 'asha', amountMinor: 500 },
    ]);
    // Overpaying flips the direction.
    expect(
      pairwiseDebts(expenses, [
        { fromMemberId: 'chandra', toMemberId: 'asha', amountMinor: 1_200 },
      ]),
    ).toContainEqual({ fromMemberId: 'asha', toMemberId: 'chandra', amountMinor: 200 });
  });
});
