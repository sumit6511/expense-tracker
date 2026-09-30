import { getCurrency } from './currency';

/**
 * Money is always an integer number of minor units (paisa for NPR, cents for USD).
 * JS numbers are exact for integers up to 2^53, i.e. about 90 trillion rupees, which is plenty.
 * Floating point is never used for money arithmetic; conversions use BigInt.
 */
export type Minor = number;

export type NumberGrouping = 'lakh' | 'international';

export function isMinor(value: unknown): value is Minor {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertMinor(value: number, label = 'amount'): Minor {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} must be an integer minor amount`);
  return value;
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) total += v;
  return assertMinor(total, 'sum');
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** 123456 with 2 digits → "1234.56"; -5 → "-0.05"; 500 with 0 digits → "500". */
export function toDecimalString(minor: Minor, digits: number): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = BigInt(Math.abs(minor));
  if (digits === 0) return `${negative ? '-' : ''}${abs}`;
  const scale = pow10(digits);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

// ---------------------------------------------------------------------------------------------
// Exact rational arithmetic, used for parsing, expressions and conversion.
// ---------------------------------------------------------------------------------------------

interface Rational {
  n: bigint;
  d: bigint; // always > 0
}

const abs = (x: bigint) => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1n;
}

function rat(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new RangeError('Division by zero');
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

/** Parses a plain decimal literal ("12", "-3.5", ".75") into an exact rational. */
function parseRational(literal: string): Rational | null {
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(literal);
  if (!m) return null;
  const [, sign, int = '', frac = ''] = m;
  if (int === '' && frac === '') return null;
  const n = BigInt((int || '0') + frac) * (sign === '-' ? -1n : 1n);
  return rat(n, pow10(frac.length));
}

/** Rounds a rational to an integer, half away from zero (what people expect from a till). */
function roundHalfAwayFromZero(r: Rational): bigint {
  const q = r.n / r.d; // truncates toward zero
  const rem = abs(r.n % r.d);
  if (rem * 2n >= r.d) return r.n < 0n ? q - 1n : q + 1n;
  return q;
}

function rationalToMinor(r: Rational, digits: number): Minor {
  const scaled = roundHalfAwayFromZero(rat(r.n * pow10(digits), r.d));
  const value = Number(scaled);
  if (!Number.isSafeInteger(value)) throw new RangeError('Amount is too large');
  return value;
}

/**
 * Parses a plain decimal string ("1234.5") to minor units, rounding extra digits half away from
 * zero. Returns null for anything that is not a plain decimal.
 */
export function parseDecimal(value: string, digits: number): Minor | null {
  const r = parseRational(value.trim());
  return r ? rationalToMinor(r, digits) : null;
}

const DEVANAGARI_ZERO = 0x0966;

/** Converts Devanagari digits (०-९) to ASCII so Nepali keyboards work in amount fields. */
export function normalizeDigits(input: string): string {
  return input.replace(/[०-९]/g, (ch) => String(ch.charCodeAt(0) - DEVANAGARI_ZERO));
}

/**
 * Parses what a person types into an amount field: grouping separators ("1,23,456.50"),
 * currency symbols ("Rs. 500"), Devanagari digits, and simple arithmetic ("120+45.5", "3*80").
 * Returns null when the input can't be understood. The sign of the result is kept.
 */
export function parseAmountInput(input: string, digits: number): Minor | null {
  const cleaned = normalizeDigits(input)
    .replace(/(rs\.?|npr|inr|usd|रु\.?|रू\.?|[₹$€£¥₩])/gi, '')
    .replace(/[,\s_']/g, '')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-');
  if (cleaned === '') return null;
  const value = evaluateExpression(cleaned);
  return value ? rationalToMinor(value, digits) : null;
}

/** Tiny recursive-descent evaluator for + - * / and parentheses over exact rationals. */
function evaluateExpression(expr: string): Rational | null {
  let pos = 0;
  const peek = () => expr[pos];

  function number(): Rational | null {
    const m = /^\d*\.?\d*/.exec(expr.slice(pos));
    const literal = m?.[0] ?? '';
    if (literal === '' || literal === '.') return null;
    pos += literal.length;
    return parseRational(literal);
  }

  function factor(): Rational | null {
    const ch = peek();
    if (ch === '+' || ch === '-') {
      pos++;
      const inner = factor();
      return inner && ch === '-' ? rat(-inner.n, inner.d) : inner;
    }
    if (ch === '(') {
      pos++;
      const inner = sum();
      if (!inner || peek() !== ')') return null;
      pos++;
      return inner;
    }
    return number();
  }

  function product(): Rational | null {
    let left = factor();
    while (left && (peek() === '*' || peek() === '/')) {
      const op = expr[pos++];
      const right = factor();
      if (!right) return null;
      if (op === '/' && right.n === 0n) return null;
      left =
        op === '*'
          ? rat(left.n * right.n, left.d * right.d)
          : rat(left.n * right.d, left.d * right.n);
    }
    return left;
  }

  function sum(): Rational | null {
    let left = product();
    while (left && (peek() === '+' || peek() === '-')) {
      const op = expr[pos++];
      const right = product();
      if (!right) return null;
      const n =
        op === '+' ? left.n * right.d + right.n * left.d : left.n * right.d - right.n * left.d;
      left = rat(n, left.d * right.d);
    }
    return left;
  }

  const result = sum();
  return result && pos === expr.length ? result : null;
}

// ---------------------------------------------------------------------------------------------
// Allocation and conversion
// ---------------------------------------------------------------------------------------------

/**
 * Splits `total` in proportion to `weights` so the parts always add up exactly to the total
 * (largest-remainder method). allocate(1000, [1, 1, 1]) → [334, 333, 333].
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  assertMinor(total);
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('weights must be finite and non-negative');
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) throw new RangeError('weights must not all be zero');

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  // Integer weights (shares, equal splits) are used as-is so shares are exact; fractional weights
  // (percentages like 33.3) are scaled to integers first.
  const scaled = weights.every(Number.isSafeInteger)
    ? weights.map((w) => BigInt(w))
    : weights.map((w) => BigInt(Math.round((w / weightSum) * 1e12)));
  const scaledSum = scaled.reduce((a, b) => a + b, 0n);
  const bigTotal = BigInt(absTotal);

  const floors = scaled.map((w) => (bigTotal * w) / scaledSum);
  const remainders = scaled.map((w, i) => ({ i, rem: (bigTotal * w) % scaledSum }));
  let leftover = Number(bigTotal - floors.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));

  const parts = floors.map(Number);
  for (const { i } of remainders) {
    if (leftover <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    leftover--;
  }
  return parts.map((p) => (p === 0 ? 0 : p * sign));
}

export function splitEvenly(total: Minor, parts: number): Minor[] {
  if (!Number.isInteger(parts) || parts < 1)
    throw new RangeError('parts must be a positive integer');
  return allocate(
    total,
    Array.from({ length: parts }, () => 1),
  );
}

/**
 * Converts an amount between currencies. `rate` is how many units of the target currency one
 * unit of the source currency buys (e.g. USD→NPR 133.25), as a decimal string or number.
 * Exact: uses rational arithmetic and rounds half away from zero once, at the end.
 */
export function convertMinor(
  minor: Minor,
  fromDigits: number,
  toDigits: number,
  rate: string | number,
): Minor {
  assertMinor(minor);
  const r = parseRational(typeof rate === 'number' ? rateToString(rate) : rate.trim());
  if (!r || r.n <= 0n) throw new RangeError(`Invalid exchange rate: ${rate}`);
  const value = rat(BigInt(minor) * r.n * pow10(toDigits), r.d * pow10(fromDigits));
  const out = Number(roundHalfAwayFromZero(value));
  if (!Number.isSafeInteger(out)) throw new RangeError('Converted amount is too large');
  return out;
}

function rateToString(rate: number): string {
  if (!Number.isFinite(rate)) return 'NaN';
  // toFixed avoids exponent notation; 12 places is far beyond what any rate needs.
  return rate.toFixed(12).replace(/\.?0+$/, '');
}

/** Exact decimal string for a rational, rounded half away from zero to `precision` places. */
function rationalToDecimal(r: Rational, precision: number): string {
  const scaled = roundHalfAwayFromZero(rat(r.n * pow10(precision), r.d));
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(precision + 1, '0');
  const whole = digits.slice(0, digits.length - precision);
  const frac = digits.slice(digits.length - precision).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Divides two decimal rates exactly (to 12 places): used to cross currencies through NPR, e.g.
 * USD→INR = (NPR per USD) / (NPR per INR).
 */
export function divideRates(numerator: string, denominator: string, precision = 12): string {
  const a = parseRational(numerator.trim());
  const b = parseRational(denominator.trim());
  if (!a || !b || b.n === 0n) throw new RangeError('Invalid rate');
  return rationalToDecimal(rat(a.n * b.d, a.d * b.n), precision);
}

/** Mean of two decimal strings, exact (used for NRB mid rates from buying and selling rates). */
export function averageDecimals(a: string, b: string, divisor = 1, precision = 10): string {
  const x = parseRational(a.trim());
  const y = parseRational(b.trim());
  if (!x || !y || divisor <= 0) throw new RangeError('Invalid decimal');
  return rationalToDecimal(rat(x.n * y.d + y.n * x.d, x.d * y.d * 2n * BigInt(divisor)), precision);
}

export function convertBetween(
  minor: Minor,
  fromCurrency: string,
  toCurrency: string,
  rate: string | number,
): Minor {
  if (fromCurrency === toCurrency) return minor;
  return convertMinor(
    minor,
    getCurrency(fromCurrency).digits,
    getCurrency(toCurrency).digits,
    rate,
  );
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

export interface FormatMoneyOptions {
  grouping?: NumberGrouping;
  /** 'symbol' → "Rs. 1,000.00", 'code' → "NPR 1,000.00", 'none' → "1,000.00". */
  display?: 'symbol' | 'code' | 'none';
  /** 'auto' shows "-" for negatives; 'always' also shows "+"; 'never' drops the sign. */
  sign?: 'auto' | 'always' | 'never';
  /** Hide ".00" when the amount is a whole number. */
  trimZeroFraction?: boolean;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormat(grouping: NumberGrouping, minDigits: number, maxDigits: number) {
  const key = `${grouping}|${minDigits}|${maxDigits}`;
  let nf = formatterCache.get(key);
  if (!nf) {
    // en-IN gives South Asian lakh/crore grouping (1,23,45,678); en-US gives 12,345,678.
    nf = new Intl.NumberFormat(grouping === 'lakh' ? 'en-IN' : 'en-US', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    formatterCache.set(key, nf);
  }
  return nf;
}

function prefixFor(currency: string, display: 'symbol' | 'code' | 'none'): string {
  if (display === 'none') return '';
  const label = display === 'code' ? currency : getCurrency(currency).symbol;
  // "Rs. 500", "QAR 500" read better with a space; "$500", "₹500" don't need one.
  return /[A-Za-z.]$/.test(label) ? `${label} ` : label;
}

/** Formats a number of minor units without any currency, e.g. 12345678 → "1,23,456.78". */
export function formatAmount(
  minor: Minor,
  digits: number,
  grouping: NumberGrouping = 'lakh',
  trimZeroFraction = false,
): string {
  const whole = digits === 0 || Math.abs(minor) % 10 ** digits === 0;
  const minDigits = trimZeroFraction && whole ? 0 : digits;
  const nf = numberFormat(grouping, minDigits, digits);
  return nf.format(toDecimalString(Math.abs(minor), digits) as Intl.StringNumericLiteral);
}

export function formatMoney(
  minor: Minor,
  currency: string,
  options: FormatMoneyOptions = {},
): string {
  const {
    grouping = 'lakh',
    display = 'symbol',
    sign = 'auto',
    trimZeroFraction = false,
  } = options;
  const { digits } = getCurrency(currency);
  const body = formatAmount(minor, digits, grouping, trimZeroFraction);
  const signText =
    sign === 'never' ? '' : minor < 0 ? '-' : sign === 'always' && minor > 0 ? '+' : '';
  return `${signText}${prefixFor(currency, display)}${body}`;
}

/**
 * Short form for charts and tight spaces. Lakh grouping uses K / L (lakh) / Cr (crore):
 * 150000 NPR → "Rs. 1.5L". International grouping uses K / M / B.
 */
export function formatMoneyCompact(
  minor: Minor,
  currency: string,
  options: Pick<FormatMoneyOptions, 'grouping' | 'display'> = {},
): string {
  const { grouping = 'lakh', display = 'symbol' } = options;
  const { digits } = getCurrency(currency);
  const major = Math.abs(minor) / 10 ** digits;
  const steps: Array<[number, string]> =
    grouping === 'lakh'
      ? [
          [1e7, 'Cr'],
          [1e5, 'L'],
          [1e3, 'K'],
        ]
      : [
          [1e9, 'B'],
          [1e6, 'M'],
          [1e3, 'K'],
        ];
  const step = steps.find(([size]) => major >= size);
  let body: string;
  if (step) {
    const scaled = major / step[0];
    const decimals = scaled >= 100 ? 0 : 1;
    body = `${Number(scaled.toFixed(decimals))}${step[1]}`;
  } else {
    body = String(Math.round(major));
  }
  return `${minor < 0 ? '-' : ''}${prefixFor(currency, display)}${body}`;
}
