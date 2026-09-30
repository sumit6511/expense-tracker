import { parseBsString } from './bs';
import { addDays, diffDays, type IsoDate, isIsoDate, toIsoDate } from './dates';
import { type Minor, normalizeDigits, parseAmountInput } from './money';
import { cleanPayeeName, guessPayeeFromDescription, payeeSimilarity } from './text';

/**
 * Bank statement import: turns rows from a CSV or Excel sheet into normalized transactions.
 * Parsing the file itself happens in the browser; this module only deals with cell strings,
 * so it is shared by the web app (preview) and the API (validation, duplicate detection).
 */

export const DATE_FORMATS = ['ymd', 'dmy', 'mdy', 'bs-ymd'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  ymd: 'Year-Month-Day (2026-09-30)',
  dmy: 'Day/Month/Year (30/09/2026)',
  mdy: 'Month/Day/Year (09/30/2026)',
  'bs-ymd': 'Bikram Sambat Year-Month-Day (2083-06-14)',
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Excel stores dates as days since 1899-12-30. */
function fromExcelSerial(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return null;
  return addDays('1899-12-30', Math.floor(serial));
}

function toYear(value: string): number {
  const n = Number(value);
  return value.length <= 2 ? 2000 + n : n;
}

function toMonth(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  return MONTHS[value.toLowerCase().slice(0, 4)] ?? MONTHS[value.toLowerCase().slice(0, 3)] ?? NaN;
}

/** Parses a statement date cell with the given format. Returns null when it doesn't fit. */
export function parseStatementDate(raw: string, format: DateFormat): IsoDate | null {
  const value = normalizeDigits(raw).trim();
  if (!value) return null;
  if (/^\d{5}(\.\d+)?$/.test(value)) return fromExcelSerial(Number(value));

  // Drop a trailing time ("2026-09-30 14:05:00", "2026-09-30T14:05").
  const dateOnly = value.replace(
    /[T\s]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?(Z|[+-]\d{2}:?\d{2})?$/i,
    '',
  );
  const parts = dateOnly.split(/[-/.\s,]+/).filter(Boolean);
  if (parts.length !== 3) return null;

  if (format === 'bs-ymd') return parseBsString(parts.join('-'));

  const [a, b, c] = parts as [string, string, string];
  let year: number;
  let month: number;
  let day: number;
  if (format === 'ymd') {
    [year, month, day] = [toYear(a), toMonth(b), Number(c)];
  } else if (format === 'dmy') {
    [day, month, year] = [Number(a), toMonth(b), toYear(c)];
  } else {
    [month, day, year] = [toMonth(a), Number(b), toYear(c)];
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const iso = toIsoDate({ year, month, day });
  return isIsoDate(iso) ? iso : null;
}

/**
 * Picks the date format that parses the most samples (at least half of them), so one stray
 * footer row doesn't defeat detection. Four-digit years from 2060 on are read as Bikram Sambat,
 * since Nepali statements often use BS dates. Ties go to year-first, then day-first (the Nepal
 * convention), then month-first.
 */
export function detectDateFormat(samples: readonly string[]): DateFormat | null {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return null;
  const count = (format: DateFormat) =>
    values.filter((v) => parseStatementDate(v, format) !== null).length;
  const bsLike = values.filter((v) => {
    const m = /^(\d{4})[-/.]\d{1,2}[-/.]\d{1,2}/.exec(normalizeDigits(v));
    return m !== null && Number(m[1]) >= 2060;
  }).length;
  const candidates: DateFormat[] =
    bsLike * 2 >= values.length ? ['bs-ymd', 'ymd', 'dmy', 'mdy'] : ['ymd', 'dmy', 'mdy'];
  let best: { format: DateFormat; hits: number } | null = null;
  for (const format of candidates) {
    const hits = count(format);
    if (hits * 2 >= values.length && (!best || hits > best.hits)) best = { format, hits };
  }
  return best?.format ?? null;
}

/**
 * Parses a statement amount: "1,23,456.78", "(500.00)" → negative, "500 Dr" → negative,
 * "500 Cr" → positive, "NPR 1,000". Returns null for empty or unreadable cells.
 */
export function parseStatementAmount(raw: string, digits: number): Minor | null {
  let value = raw.trim();
  if (!value || value === '-') return null;
  let negative = false;
  const drcr = /\s*\b(dr|cr)\.?$/i.exec(value);
  if (drcr) {
    negative = drcr[1]!.toLowerCase() === 'dr';
    value = value.slice(0, drcr.index);
  }
  const parens = /^\((.*)\)$/.exec(value);
  if (parens) {
    negative = true;
    value = parens[1]!;
  }
  // A statement cell is a number, not an expression: reject anything with operators mid-string.
  const compact = value.replace(/[,\s]/g, '');
  if (/\d[+*/x×]\d|\d-\d/i.test(compact)) return null;
  const parsed = parseAmountInput(value, digits);
  if (parsed === null) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export type AmountMapping =
  /** One signed column. `negate` flips signs for statements that show spending as positive. */
  | { kind: 'single'; column: number; negate?: boolean }
  /** Separate withdrawal (debit, money out) and deposit (credit, money in) columns. */
  | { kind: 'debitCredit'; debit: number; credit: number };

export interface ImportMapping {
  hasHeader: boolean;
  date: number;
  dateFormat: DateFormat;
  amount: AmountMapping;
  payee?: number | null;
  description?: number | null;
  notes?: number | null;
  externalId?: number | null;
}

export interface NormalizedRow {
  /** 0-based index into the source rows (including the header row, if any). */
  line: number;
  date: IsoDate;
  amountMinor: Minor;
  payee: string;
  description: string;
  notes: string;
  externalId: string | null;
}

export interface RowError {
  line: number;
  message: string;
}

const cell = (row: readonly string[], index: number | null | undefined) =>
  index === null || index === undefined ? '' : (row[index] ?? '').toString().trim();

export function normalizeRows(
  rows: readonly (readonly string[])[],
  mapping: ImportMapping,
  digits: number,
): { rows: NormalizedRow[]; errors: RowError[] } {
  const out: NormalizedRow[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, line) => {
    if (line === 0 && mapping.hasHeader) return;
    if (row.every((c) => String(c ?? '').trim() === '')) return;

    const date = parseStatementDate(cell(row, mapping.date), mapping.dateFormat);
    if (!date) {
      errors.push({ line, message: `Unreadable date "${cell(row, mapping.date)}"` });
      return;
    }

    let amount: Minor | null;
    if (mapping.amount.kind === 'single') {
      amount = parseStatementAmount(cell(row, mapping.amount.column), digits);
      if (amount !== null && mapping.amount.negate) amount = -amount;
    } else {
      const debit = parseStatementAmount(cell(row, mapping.amount.debit), digits);
      const credit = parseStatementAmount(cell(row, mapping.amount.credit), digits);
      amount =
        debit === null && credit === null
          ? null
          : (credit === null ? 0 : Math.abs(credit)) - (debit === null ? 0 : Math.abs(debit));
    }
    if (amount === null) {
      errors.push({ line, message: 'Missing or unreadable amount' });
      return;
    }
    if (amount === 0) {
      errors.push({ line, message: 'Amount is zero' });
      return;
    }

    const description = cell(row, mapping.description).slice(0, 500);
    const payeeCell = cleanPayeeName(cell(row, mapping.payee));
    out.push({
      line,
      date,
      amountMinor: amount,
      payee: payeeCell || guessPayeeFromDescription(description),
      description,
      notes: cell(row, mapping.notes).slice(0, 1000),
      externalId: cell(row, mapping.externalId).slice(0, 100) || null,
    });
  });
  return { rows: out, errors };
}

const HEADER_HINTS = {
  date: /^(txn\.?\s*|transaction\s*|tran\s*|value\s*|posting\s*|book(ing)?\s*)?date|मिति/i,
  debit: /debit|withdraw|dr\.?$|paid\s*out|money\s*out|outflow|expense/i,
  credit: /credit|deposit|cr\.?$|paid\s*in|money\s*in|inflow|income/i,
  amount: /amount|amt|रकम/i,
  payee: /payee|merchant|party|beneficiary|counterparty|name/i,
  description:
    /description|narration|particulars|remarks|details|memo|transaction\s*details|विवरण/i,
  externalId: /ref(erence)?|cheque|chq|transaction\s*id|txn\s*id|trace/i,
  balance: /balance/i,
};

/** Guesses a column mapping from the header row and a few data rows. */
export function guessMapping(rows: readonly (readonly string[])[]): Partial<ImportMapping> {
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const find = (re: RegExp, exclude: RegExp[] = []) => {
    const i = header.findIndex((h) => re.test(h) && !exclude.some((x) => x.test(h)));
    return i === -1 ? null : i;
  };
  const date = find(HEADER_HINTS.date);
  const hasHeader = date !== null || header.some((h) => /[a-z]{3,}/i.test(h) && !/\d/.test(h));
  const debit = find(HEADER_HINTS.debit, [HEADER_HINTS.balance]);
  const credit = find(HEADER_HINTS.credit, [HEADER_HINTS.balance]);
  const amount = find(HEADER_HINTS.amount, [
    HEADER_HINTS.balance,
    HEADER_HINTS.debit,
    HEADER_HINTS.credit,
  ]);
  const mapping: Partial<ImportMapping> = {
    hasHeader,
    payee: find(HEADER_HINTS.payee),
    description: find(HEADER_HINTS.description),
    externalId: find(HEADER_HINTS.externalId, [HEADER_HINTS.date]),
  };
  if (date !== null) mapping.date = date;
  if (debit !== null && credit !== null && debit !== credit) {
    mapping.amount = { kind: 'debitCredit', debit, credit };
  } else if (amount !== null) {
    mapping.amount = { kind: 'single', column: amount };
  }
  if (mapping.date !== undefined) {
    const samples = rows.slice(hasHeader ? 1 : 0, 30).map((r) => String(r[mapping.date!] ?? ''));
    const format = detectDateFormat(samples);
    if (format) mapping.dateFormat = format;
  }
  return mapping;
}

// ---------------------------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------------------------

export interface DuplicateCandidate {
  date: IsoDate;
  amountMinor: Minor;
  payee?: string | null;
  externalId?: string | null;
}

export interface ExistingTransaction extends DuplicateCandidate {
  id: string;
}

/** How many days apart a bank posting date and a manually entered date may be. */
export const DUPLICATE_WINDOW_DAYS = 3;

/**
 * Matches import rows against transactions already in the account. Each existing transaction
 * can match at most one row, so two genuine identical purchases on the same day both survive
 * when only one was already recorded. Returns the matched existing id per row (or null).
 */
export function findDuplicates(
  rows: readonly DuplicateCandidate[],
  existing: readonly ExistingTransaction[],
  windowDays = DUPLICATE_WINDOW_DAYS,
): (string | null)[] {
  const used = new Set<string>();
  const byExternalId = new Map<string, ExistingTransaction>();
  for (const e of existing) if (e.externalId) byExternalId.set(e.externalId, e);

  return rows.map((row) => {
    if (row.externalId) {
      const match = byExternalId.get(row.externalId);
      if (match && !used.has(match.id)) {
        used.add(match.id);
        return match.id;
      }
    }
    let best: { id: string; score: number } | null = null;
    for (const e of existing) {
      if (used.has(e.id) || e.amountMinor !== row.amountMinor) continue;
      // Rows with different bank reference numbers are different transactions.
      if (row.externalId && e.externalId && row.externalId !== e.externalId) continue;
      const gap = Math.abs(diffDays(e.date, row.date));
      if (gap > windowDays) continue;
      const similarity = row.payee && e.payee ? payeeSimilarity(row.payee, e.payee) : null;
      // Same amount on the same day is a duplicate unless the payees clearly differ; a few days
      // apart we want some evidence that it's the same payee.
      const isMatch =
        similarity === null ? gap === 0 : similarity >= 0.5 || (gap === 0 && similarity > 0);
      if (!isMatch) continue;
      const score = (similarity ?? 0.5) - gap * 0.1;
      if (!best || score > best.score) best = { id: e.id, score };
    }
    if (best) used.add(best.id);
    return best?.id ?? null;
  });
}
