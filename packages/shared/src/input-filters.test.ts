import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { filterAmountInput, filterDecimalInput, filterIntegerInput } from './input-filters';
import { formatAmount, parseAmountInput } from './money';

describe('filterAmountInput', () => {
  it('drops letters but keeps what amounts are written with', () => {
    expect(filterAmountInput('abc')).toBe('');
    expect(filterAmountInput('12a3')).toBe('123');
    expect(filterAmountInput('1,23,456.50')).toBe('1,23,456.50');
    expect(filterAmountInput('१,५००')).toBe('१,५००');
    expect(filterAmountInput('120+45.5')).toBe('120+45.5');
    expect(filterAmountInput('(250+50)/3')).toBe('(250+50)/3');
    expect(filterAmountInput('3x80')).toBe('3×80');
    expect(filterAmountInput('3*80 ÷ 2')).toBe('3*80 ÷ 2');
  });

  it('drops a currency label pasted with the number', () => {
    expect(filterAmountInput('Rs. 1,500')).toBe('1,500');
    expect(filterAmountInput('NPR 250')).toBe('250');
    expect(filterAmountInput('रु. ५००')).toBe('५००');
    expect(filterAmountInput('$12.99')).toBe('12.99');
  });

  it('keeps a leading minus only where negative amounts make sense', () => {
    expect(filterAmountInput('-500')).toBe('500');
    expect(filterAmountInput('-500', { negative: true })).toBe('-500');
    expect(filterAmountInput('500-50')).toBe('500-50');
    expect(filterAmountInput('−5,000', { negative: true })).toBe('-5,000');
  });

  it('without sums, takes digits, a point and grouping only', () => {
    expect(filterAmountInput('120+45', { expressions: false })).toBe('12045');
    expect(filterAmountInput('3x8', { expressions: false })).toBe('38');
    expect(filterAmountInput('5-0', { expressions: false, negative: true })).toBe('50');
    expect(filterAmountInput('-5', { expressions: false, negative: true })).toBe('-5');
  });

  it('is idempotent, and never changes what a typed amount is worth', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = filterAmountInput(s, { negative: true });
        expect(filterAmountInput(once, { negative: true })).toBe(once);
        expect(once).not.toMatch(/[a-wyzA-WYZ]/);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 12 }), fc.boolean(), (minor, label) => {
        const typed = `${label ? 'Rs. ' : ''}${formatAmount(minor, 2)}`;
        expect(parseAmountInput(filterAmountInput(typed), 2)).toBe(parseAmountInput(typed, 2));
      }),
    );
  });
});

describe('filterDecimalInput', () => {
  it('keeps one decimal point and plain digits', () => {
    expect(filterDecimalInput('12.5')).toBe('12.5');
    expect(filterDecimalInput('1.2.3')).toBe('1.23');
    expect(filterDecimalInput('abc')).toBe('');
    expect(filterDecimalInput('1,021.50')).toBe('1021.50');
    expect(filterDecimalInput('५१२.३')).toBe('512.3');
    expect(filterDecimalInput('12%')).toBe('12');
  });

  it('limits the decimals and the sign', () => {
    expect(filterDecimalInput('33.3333', { maxDecimals: 2 })).toBe('33.33');
    expect(filterDecimalInput('7.5', { maxDecimals: 0 })).toBe('7');
    expect(filterDecimalInput('-4')).toBe('4');
    expect(filterDecimalInput('-4', { negative: true })).toBe('-4');
    expect(filterDecimalInput('4-', { negative: true })).toBe('4');
  });
});

describe('filterIntegerInput', () => {
  it('keeps digits only, up to a length', () => {
    expect(filterIntegerInput('12a')).toBe('12');
    expect(filterIntegerInput('१२३ ४५६', 6)).toBe('123456');
    expect(filterIntegerInput('1234567', 6)).toBe('123456');
  });
});
