import { z } from 'zod';
import { Id, IsoDateSchema, MinorAmount } from './schemas';

const Name = (max: number) => z.string().trim().min(1, { error: 'Required' }).max(max);
const OptionalText = (max: number) => z.string().trim().max(max);

/**
 * Investment holdings: shares, mutual fund units, gold… kept in an account (usually an
 * "investment" one). Quantities and prices are decimal strings ("12.5", "1234.56") so nothing is
 * lost to floating point; values are worked out in the account currency's minor units.
 */

/** Up to 8 decimals. */
export const DecimalString = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,8})?$/, { error: 'Enter a number like 25 or 512.50' });

const SCALE = 10n ** 8n;

function toScaled(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.trim().split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0').slice(0, 8));
}

/** quantity × price, in minor units of a currency with `digits` decimals (rounded half up). */
export function holdingValueMinor(quantity: string, price: string, digits: number): number {
  const product = toScaled(quantity) * toScaled(price) * 10n ** BigInt(digits);
  const divisor = SCALE * SCALE;
  const minor = (product + divisor / 2n) / divisor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('That holding is worth too much');
  return Number(minor);
}

export const HoldingSchema = z.object({
  id: Id,
  accountId: Id,
  /** Ticker or short name: NABIL, NICA, GOLD. */
  symbol: z.string(),
  name: z.string(),
  quantity: z.string(),
  /** What it cost in total, in the account currency. */
  costMinor: MinorAmount,
  /** Latest price per unit (major units), null until one is entered. */
  price: z.string().nullable(),
  priceDate: z.string().nullable(),
  /** quantity × price, null without a price. */
  valueMinor: MinorAmount.nullable(),
  /** value − cost, null without a price. */
  gainMinor: MinorAmount.nullable(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const HoldingsSchema = z.object({
  currency: z.string(),
  holdings: z.array(HoldingSchema),
  /** Of the holdings that have a price. */
  valueMinor: MinorAmount,
  costMinor: MinorAmount,
});
export type Holdings = z.infer<typeof HoldingsSchema>;

export const CreateHoldingSchema = z.object({
  symbol: Name(20).transform((s) => s.toUpperCase()),
  name: OptionalText(120).default(''),
  quantity: DecimalString,
  costMinor: MinorAmount.refine((v) => v >= 0, { error: 'Cost can’t be negative' }).default(0),
  price: DecimalString.nullable().default(null),
  priceDate: IsoDateSchema.nullable().optional(),
});
export type CreateHolding = z.input<typeof CreateHoldingSchema>;

export const UpdateHoldingSchema = z.object({
  symbol: Name(20)
    .transform((s) => s.toUpperCase())
    .optional(),
  name: OptionalText(120).optional(),
  quantity: DecimalString.optional(),
  costMinor: MinorAmount.refine((v) => v >= 0, { error: 'Cost can’t be negative' }).optional(),
  price: DecimalString.nullable().optional(),
  priceDate: IsoDateSchema.nullable().optional(),
});
export type UpdateHolding = z.input<typeof UpdateHoldingSchema>;

/** Today's prices for several holdings at once (e.g. pasted from a market website). */
export const UpdatePricesSchema = z.object({
  date: IsoDateSchema.optional(),
  prices: z
    .array(z.object({ holdingId: Id, price: DecimalString }))
    .min(1)
    .max(200),
});
export type UpdatePrices = z.input<typeof UpdatePricesSchema>;

/**
 * Reads "SYMBOL price" lines (tabs, commas or spaces between; thousands separators allowed), as
 * copied from a market website: { NABIL: '512.30', NICA: '845' }.
 */
export function parsePriceList(text: string): Record<string, string> {
  const prices: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m =
      /^\s*([A-Za-z][A-Za-z0-9.&-]{0,19})[\s,;:|]+(?:Rs\.?\s*|NPR\s*)?([\d,]+(?:\.\d+)?)\b/.exec(
        line,
      );
    if (!m) continue;
    const price = m[2]!.replace(/,/g, '');
    if (/^\d{1,15}(\.\d{1,8})?$/.test(price)) prices[m[1]!.toUpperCase()] = price;
  }
  return prices;
}

/** What an account is worth: its balance plus any holdings (in its own currency). */
export function accountValueMinor(a: { balanceMinor: number; holdingsValueMinor: number | null }) {
  return a.balanceMinor + (a.holdingsValueMinor ?? 0);
}

/** The same in the base currency (null when the balance has no exchange rate). */
export function accountValueBaseMinor(a: {
  balanceBaseMinor: number | null;
  holdingsValueBaseMinor: number | null;
}) {
  return a.balanceBaseMinor === null ? null : a.balanceBaseMinor + (a.holdingsValueBaseMinor ?? 0);
}
