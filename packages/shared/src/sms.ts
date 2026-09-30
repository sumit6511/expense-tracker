import type { IsoDate } from './dates';
import { type NormalizedRow, parseStatementAmount, parseStatementDate } from './import';
import { normalizeDigits } from './money';
import { cleanPayeeName, guessPayeeFromDescription } from './text';

/**
 * Reads transaction alerts that Nepali banks and wallets send by SMS, e.g.
 * "Dear Customer, your A/C 01XXXX456 has been debited by NPR 2,500.00 on 15/09/2026.
 *  Remarks: POS/BHAT BHATENI. Bal: NPR 45,000.00".
 * There is no standard format, so this looks for the pieces every alert has: an amount with a
 * currency, whether money went out or came in, and usually a date, a counterparty and a
 * reference number. Anything it can't read is returned untouched for the person to handle.
 */

export interface SmsParseResult {
  rows: Array<NormalizedRow & { text: string; currency: string | null }>;
  /** Messages with no recognizable amount. */
  unreadable: string[];
}

const CURRENCY = String.raw`(?:NPR|Rs\.?|INR|IRs\.?|USD|\$)`;
const NUMBER = String.raw`\d[\d,]*(?:\.\d{1,2})?`;
const AMOUNT = new RegExp(
  String.raw`(${CURRENCY})\s*(${NUMBER})|(${NUMBER})\s*(NPR|INR|USD)\b`,
  'gi',
);
/** Amounts right after these words are balances or limits, not the transaction. */
const NOT_THE_AMOUNT = /(bal(ance)?|avl\.?|available|limit|min(imum)?\s+due|fee|charge)\W*$/i;
const OUT =
  /\b(debit(ed)?|withdrawn|withdrawal|paid|payment\s+of|spent|purchase|deducted|sent|transferred\s+to|dr)\b/i;
const IN = /\b(credit(ed)?|received|deposit(ed)?|refund(ed)?|reversed|added|loaded|cr)\b/i;

function currencyCode(token: string) {
  const t = token.toUpperCase();
  if (t.startsWith('INR') || t.startsWith('IRS')) return 'INR';
  if (t.startsWith('USD') || t === '$') return 'USD';
  return 'NPR';
}

function findDate(text: string): IsoDate | null {
  const candidates: Array<[RegExp, 'dmy' | 'ymd']> = [
    [/\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/, 'ymd'],
    [/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/, 'dmy'],
    [
      /\b(\d{1,2}[-\s](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-\s,]+\d{2,4})\b/i,
      'dmy',
    ],
  ];
  for (const [re, format] of candidates) {
    const m = re.exec(text);
    if (!m) continue;
    const value = m[1]!;
    // Year-first dates from 2060 on are Bikram Sambat (e.g. 2083-06-14).
    const bs = format === 'ymd' && Number(value.slice(0, 4)) >= 2060;
    const date = parseStatementDate(value, bs ? 'bs-ymd' : format);
    if (date) return date;
  }
  return null;
}

const STOP = String.raw`(?=\s+(?:on|from|via|using|at|for|with|ref|txn|dated)\b|[.,;]\s|[.,;]?$|\s*\()`;
const COUNTERPARTY: RegExp[] = [
  /(?:remarks?|narration|desc(?:ription)?|particulars?|details?)\s*[:-]\s*(.+?)(?=\.\s|\s+(?:bal|avl|available)\b|$)/i,
  // "paid to X", "paid Rs. 250 to X", "payment of NPR 500 for X"
  new RegExp(
    String.raw`\b(?:paid|sent|transferred|payment(?:\s+of)?)\s+(?:${CURRENCY}\s*${NUMBER}\s+)?(?:to|for)\s+(.+?)${STOP}`,
    'i',
  ),
  new RegExp(String.raw`\bat\s+([A-Za-z][\w &'./-]{1,60}?)${STOP}`, 'i'),
  new RegExp(String.raw`\bfrom\s+(?!your\b|a\/c\b|ac\b|account\b)(.+?)${STOP}`, 'i'),
  new RegExp(String.raw`\bfor\s+(.+?)${STOP}`, 'i'),
];
const REFERENCE =
  /\b(?:txn|transaction|trans\.?|ref(?:erence)?|rrn|stan|trace)\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i;

function parseOne(text: string, today: IsoDate, digits: number) {
  const clean = normalizeDigits(text).replace(/\s+/g, ' ').trim();
  let amountMatch: RegExpExecArray | null = null;
  for (const m of clean.matchAll(AMOUNT)) {
    if (NOT_THE_AMOUNT.test(clean.slice(Math.max(0, m.index! - 24), m.index!))) continue;
    amountMatch = m as RegExpExecArray;
    break;
  }
  if (!amountMatch) return null;
  const amount = parseStatementAmount(amountMatch[2] ?? amountMatch[3] ?? '', digits);
  if (amount === null || amount === 0) return null;
  const currency = currencyCode(amountMatch[1] ?? amountMatch[4] ?? 'NPR');

  const out = OUT.exec(clean);
  const inn = IN.exec(clean);
  // Whichever word comes first decides; alerts without either are usually spending.
  const incoming = inn !== null && (out === null || inn.index < out.index);

  let counterparty = '';
  for (const re of COUNTERPARTY) {
    const m = re.exec(clean);
    if (m?.[1] && !/^(your|a\/c|ac|account)\b/i.test(m[1])) {
      counterparty = m[1].trim();
      break;
    }
  }
  const ref = REFERENCE.exec(clean)?.[1] ?? null;
  return {
    date: findDate(clean) ?? today,
    amountMinor: incoming ? Math.abs(amount) : -Math.abs(amount),
    currency,
    payee: cleanPayeeName(guessPayeeFromDescription(counterparty) || counterparty),
    description: counterparty,
    externalId: ref,
  };
}

/** Parses one or more pasted alerts (separated by blank lines, or one per line). */
export function parseBankSms(
  input: string,
  options: { today: IsoDate; digits: number },
): SmsParseResult {
  const blocks = input
    .split(/\r?\n\s*\r?\n/)
    .flatMap((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      // Several one-line alerts pasted without blank lines between them.
      const eachHasAmount =
        lines.length > 1 && lines.every((l) => new RegExp(AMOUNT.source, 'i').test(l));
      return eachHasAmount ? lines : [lines.join(' ')];
    })
    .filter(Boolean);
  const rows: SmsParseResult['rows'] = [];
  const unreadable: string[] = [];
  blocks.forEach((text, line) => {
    const parsed = parseOne(text, options.today, options.digits);
    if (!parsed) {
      unreadable.push(text);
      return;
    }
    rows.push({ line, notes: '', text, ...parsed });
  });
  return { rows, unreadable };
}
