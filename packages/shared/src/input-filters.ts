import { normalizeDigits } from './money';

/*
 * What number fields let through as people type or paste. Characters a field can't use are
 * dropped before they appear, so a field never holds letters; whether what's left makes a
 * valid number is still checked when the form is saved.
 */

const CURRENCY_LABEL = /(rs\.?|npr|inr|usd|रु\.?|रू\.?|[₹$€£¥₩])/gi;

/**
 * An amount field (read by `parseAmountInput`): digits (also Devanagari), a decimal point,
 * grouping commas and spaces, and, unless `expressions` is off, + − × ÷ and brackets for sums
 * like "120+45". Letters are dropped, and so is a currency label pasted with the number
 * ("Rs. 1,500" → "1,500"); "x" becomes "×". A leading minus is kept only when `negative`.
 */
export function filterAmountInput(
  input: string,
  options: { expressions?: boolean; negative?: boolean } = {},
): string {
  const { expressions = true, negative = false } = options;
  let s = input.replace(CURRENCY_LABEL, '').replace(/[−–]/g, '-');
  if (expressions) s = s.replace(/[xX]/g, '×');
  const allowed = expressions ? /[0-9०-९., +\-*/×÷()]/ : /[0-9०-९., -]/;
  s = Array.from(s)
    .filter((ch) => allowed.test(ch))
    .join('')
    .replace(/^ +/, '');
  if (!expressions) s = s.replace(/(?!^)-/g, '');
  if (!negative) s = s.replace(/^-+/, '');
  return s.slice(0, 40);
}

/**
 * A plain decimal number such as a quantity, price, rate or percentage: digits and one decimal
 * point, at most `maxDecimals` after it. Devanagari digits become 0–9 and grouping commas are
 * dropped ("1,021.50" → "1021.50").
 */
export function filterDecimalInput(
  input: string,
  options: { maxDecimals?: number; negative?: boolean } = {},
): string {
  const { maxDecimals = 8, negative = false } = options;
  let s = normalizeDigits(input)
    .replace(/[−–]/g, '-')
    .replace(/[^0-9.-]/g, '');
  const minus = negative && s.startsWith('-') ? '-' : '';
  s = s.replace(/-/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    const whole = s.slice(0, dot);
    const fraction = s
      .slice(dot + 1)
      .replace(/\./g, '')
      .slice(0, maxDecimals);
    s = maxDecimals > 0 ? `${whole}.${fraction}` : whole;
  }
  return (minus + s).slice(0, 24);
}

/** A whole number (a count, a day, a one-time code): digits only, as 0–9. */
export function filterIntegerInput(input: string, maxLength = 9): string {
  return normalizeDigits(input).replace(/\D/g, '').slice(0, maxLength);
}
