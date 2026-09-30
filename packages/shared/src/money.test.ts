import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  convertBetween,
  convertMinor,
  formatAmount,
  formatMoney,
  formatMoneyCompact,
  normalizeDigits,
  parseAmountInput,
  parseDecimal,
  splitEvenly,
  toDecimalString,
} from './money';

describe('toDecimalString', () => {
  it('formats minor units as an exact decimal', () => {
    expect(toDecimalString(123456, 2)).toBe('1234.56');
    expect(toDecimalString(-5, 2)).toBe('-0.05');
    expect(toDecimalString(0, 2)).toBe('0.00');
    expect(toDecimalString(500, 0)).toBe('500');
    expect(toDecimalString(1234, 3)).toBe('1.234');
    expect(toDecimalString(Number.MAX_SAFE_INTEGER, 2)).toBe('90071992547409.91');
  });
});

describe('parseDecimal', () => {
  it('parses plain decimals exactly', () => {
    expect(parseDecimal('1234.56', 2)).toBe(123456);
    expect(parseDecimal('-0.05', 2)).toBe(-5);
    expect(parseDecimal('.5', 2)).toBe(50);
    expect(parseDecimal('7', 0)).toBe(7);
  });

  it('rounds extra digits half away from zero', () => {
    expect(parseDecimal('1.005', 2)).toBe(101); // a float would give 1.00
    expect(parseDecimal('-1.005', 2)).toBe(-101);
    expect(parseDecimal('1.004', 2)).toBe(100);
  });

  it('rejects non-decimals', () => {
    expect(parseDecimal('abc', 2)).toBeNull();
    expect(parseDecimal('', 2)).toBeNull();
    expect(parseDecimal('1,000', 2)).toBeNull();
  });

  it('round-trips with toDecimalString', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), fc.integer({ min: 0, max: 3 }), (n, d) => {
        expect(parseDecimal(toDecimalString(n, d), d)).toBe(n);
      }),
    );
  });
});

describe('parseAmountInput', () => {
  it('accepts grouping, symbols and spaces', () => {
    expect(parseAmountInput('1,23,456.78', 2)).toBe(12345678);
    expect(parseAmountInput('Rs. 500', 2)).toBe(50000);
    expect(parseAmountInput('NPR 1,000.50', 2)).toBe(100050);
    expect(parseAmountInput('₹ 99', 2)).toBe(9900);
    expect(parseAmountInput(' 12 000 ', 2)).toBe(1200000);
  });

  it('accepts Devanagari digits', () => {
    expect(normalizeDigits('१२३.४५')).toBe('123.45');
    expect(parseAmountInput('रु. १,५००', 2)).toBe(150000);
  });

  it('evaluates simple arithmetic exactly', () => {
    expect(parseAmountInput('120+45.5', 2)).toBe(16550);
    expect(parseAmountInput('3*80', 2)).toBe(24000);
    expect(parseAmountInput('3x80', 2)).toBe(24000);
    expect(parseAmountInput('100/3', 2)).toBe(3333);
    expect(parseAmountInput('(10+5)*2-1', 2)).toBe(2900);
    expect(parseAmountInput('0.1+0.2', 2)).toBe(30);
    expect(parseAmountInput('-50', 2)).toBe(-5000);
  });

  it('rejects garbage and division by zero', () => {
    expect(parseAmountInput('', 2)).toBeNull();
    expect(parseAmountInput('abc', 2)).toBeNull();
    expect(parseAmountInput('5/0', 2)).toBeNull();
    expect(parseAmountInput('5+', 2)).toBeNull();
    expect(parseAmountInput('(5', 2)).toBeNull();
    expect(parseAmountInput('1.2.3', 2)).toBeNull();
  });
});

describe('allocate', () => {
  it('splits evenly with the remainder going to the first parts', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(-100, 3)).toEqual([-34, -33, -33]);
    expect(splitEvenly(0, 2)).toEqual([0, 0]);
  });

  it('splits by weights and percentages', () => {
    expect(allocate(10000, [70, 30])).toEqual([7000, 3000]);
    expect(allocate(100, [33.3, 33.3, 33.4])).toEqual([33, 33, 34]);
    expect(allocate(5, [0, 1])).toEqual([0, 5]);
  });

  it('always sums to the total and never deviates by more than one unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocate(total, weights);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          const weightSum = weights.reduce((a, b) => a + b, 0);
          parts.forEach((p, i) => {
            expect(Math.abs(p - (total * weights[i]!) / weightSum)).toBeLessThan(1.0001);
          });
        },
      ),
    );
  });

  it('rejects invalid weights', () => {
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(100, [0, 0])).toThrow();
    expect(() => allocate(100, [-1, 2])).toThrow();
    expect(() => splitEvenly(100, 0)).toThrow();
  });
});

describe('convertMinor', () => {
  it('converts with exponent differences', () => {
    expect(convertMinor(10000, 2, 2, '133.25')).toBe(1332500); // $100 → Rs. 13,325
    expect(convertMinor(10000, 2, 2, '1.6')).toBe(16000); // ₹100 → Rs. 160
    expect(convertMinor(1000, 0, 2, '0.9')).toBe(90000); // ¥1000 → 900.00
    expect(convertMinor(1000, 3, 2, '3.25')).toBe(325); // KWD 1.000 → 3.25
  });

  it('rounds once, half away from zero', () => {
    expect(convertMinor(1, 2, 2, '0.5')).toBe(1);
    expect(convertMinor(-1, 2, 2, '0.5')).toBe(-1);
    expect(convertMinor(1, 2, 2, '0.49')).toBe(0);
  });

  it('accepts numeric rates without float noise', () => {
    expect(convertMinor(100, 2, 2, 0.1 + 0.2)).toBe(30);
  });

  it('rejects bad rates', () => {
    expect(() => convertMinor(100, 2, 2, '0')).toThrow();
    expect(() => convertMinor(100, 2, 2, '-1')).toThrow();
    expect(() => convertMinor(100, 2, 2, 'abc')).toThrow();
  });

  it('is identity for the same currency', () => {
    expect(convertBetween(12345, 'NPR', 'NPR', '999')).toBe(12345);
    expect(convertBetween(10000, 'INR', 'NPR', '1.6')).toBe(16000);
  });
});

describe('formatting', () => {
  it('uses lakh/crore grouping by default', () => {
    expect(formatMoney(1234567890, 'NPR')).toBe('Rs. 1,23,45,678.90');
    expect(formatMoney(-50000, 'NPR')).toBe('-Rs. 500.00');
    expect(formatMoney(50000, 'NPR', { sign: 'always' })).toBe('+Rs. 500.00');
    expect(formatMoney(0, 'NPR', { sign: 'always' })).toBe('Rs. 0.00');
  });

  it('supports international grouping, codes and other currencies', () => {
    expect(formatMoney(1234567890, 'NPR', { grouping: 'international' })).toBe('Rs. 12,345,678.90');
    expect(formatMoney(150000, 'USD', { grouping: 'international' })).toBe('$1,500.00');
    expect(formatMoney(150000, 'INR')).toBe('₹1,500.00');
    expect(formatMoney(150000, 'QAR')).toBe('QAR 1,500.00');
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
    expect(formatMoney(1500, 'KWD')).toBe('KWD 1.500');
    expect(formatMoney(150000, 'NPR', { display: 'code' })).toBe('NPR 1,500.00');
    expect(formatMoney(150000, 'NPR', { display: 'none' })).toBe('1,500.00');
  });

  it('can trim a zero fraction', () => {
    expect(formatMoney(150000, 'NPR', { trimZeroFraction: true })).toBe('Rs. 1,500');
    expect(formatMoney(150050, 'NPR', { trimZeroFraction: true })).toBe('Rs. 1,500.50');
    expect(formatAmount(12345600, 2, 'lakh', true)).toBe('1,23,456');
  });

  it('formats large amounts exactly', () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, 'NPR', { grouping: 'international' })).toBe(
      'Rs. 90,071,992,547,409.91',
    );
  });

  it('formats compact amounts', () => {
    expect(formatMoneyCompact(15000000, 'NPR')).toBe('Rs. 1.5L');
    expect(formatMoneyCompact(2500000000, 'NPR')).toBe('Rs. 2.5Cr');
    expect(formatMoneyCompact(1234500, 'NPR')).toBe('Rs. 12.3K');
    expect(formatMoneyCompact(95000, 'NPR')).toBe('Rs. 950');
    expect(formatMoneyCompact(150000000, 'USD', { grouping: 'international' })).toBe('$1.5M');
    expect(formatMoneyCompact(-15000000, 'NPR')).toBe('-Rs. 1.5L');
  });
});
