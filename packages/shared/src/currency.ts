import { CURRENCY_DATA } from './currency-data';

export interface Currency {
  code: string;
  /** Number of minor-unit digits (NPR 2 → paisa, JPY 0, KWD 3). */
  digits: number;
  name: string;
  /** Short display symbol. Falls back to the ISO code when there is no unambiguous symbol. */
  symbol: string;
}

/**
 * Symbols we are confident are unambiguous for our users. Everything else shows its ISO code,
 * which is clearer than Intl's localized symbols (e.g. "¥" for both JPY and CNY).
 */
const SYMBOLS: Record<string, string> = {
  NPR: 'Rs.',
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  KRW: '₩',
  AUD: 'A$',
  CAD: 'CA$',
  CNY: 'CN¥',
};

/**
 * Currencies shown first in pickers: home currency, the INR peg partner, USD, then the main
 * remittance and travel currencies for Nepal.
 */
export const FEATURED_CURRENCIES = [
  'NPR',
  'INR',
  'USD',
  'QAR',
  'AED',
  'SAR',
  'MYR',
  'KRW',
  'JPY',
  'KWD',
  'EUR',
  'GBP',
  'AUD',
  'CAD',
  'CNY',
] as const;

export const DEFAULT_CURRENCY = 'NPR';

const BY_CODE = new Map<string, Currency>(
  CURRENCY_DATA.map(([code, digits, name]) => [
    code,
    { code, digits, name, symbol: SYMBOLS[code] ?? code },
  ]),
);

export const CURRENCY_CODES: readonly string[] = CURRENCY_DATA.map(([code]) => code);

export function isCurrencyCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function getCurrency(code: string): Currency {
  const currency = BY_CODE.get(code);
  if (!currency) throw new Error(`Unknown currency: ${code}`);
  return currency;
}

export function currencyDigits(code: string): number {
  return getCurrency(code).digits;
}

/** All currencies, featured first (in featured order), then the rest alphabetically. */
export function listCurrencies(): Currency[] {
  const featured = FEATURED_CURRENCIES.map((c) => getCurrency(c));
  const rest = CURRENCY_CODES.filter(
    (c) => !(FEATURED_CURRENCIES as readonly string[]).includes(c),
  ).map((c) => getCurrency(c));
  return [...featured, ...rest];
}
