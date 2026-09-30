import {
  type DateFormat,
  detectDateFormat,
  type NormalizedRow,
  parseStatementAmount,
  parseStatementDate,
  type RowError,
} from './import';
import { cleanPayeeName, guessPayeeFromDescription, normalizePayeeName } from './text';

/**
 * Moving from another app: YNAB, Actual Budget, Mint and Splitwise all export CSV files with
 * fixed columns. These presets recognise them by their header row and read them without any
 * column mapping, keeping the other app's category names so they can be matched to ours.
 */

export const APP_PRESETS = ['ynab', 'actual', 'mint', 'splitwise'] as const;
export type AppPreset = (typeof APP_PRESETS)[number];

export const APP_PRESET_NAMES: Record<AppPreset, string> = {
  ynab: 'YNAB',
  actual: 'Actual Budget',
  mint: 'Mint',
  splitwise: 'Splitwise',
};

export interface AppExportRow extends NormalizedRow {
  /** The category it had in the other app ("" when none). */
  category: string;
}

export interface AppExport {
  preset: AppPreset;
  rows: AppExportRow[];
  /** Rows left out, and why (unreadable, transfers, starting balances, settlements…). */
  errors: RowError[];
  /** Accounts in the file (YNAB, Actual, Mint export several at once). */
  accounts: string[];
  /** Splitwise: the people in the group; one of them is you. */
  people: string[];
}

const key = (s: string) => s.trim().toLowerCase();

function headerIndex(header: readonly string[]) {
  const map = new Map(header.map((h, i) => [key(String(h ?? '')), i]));
  return (name: string) => map.get(key(name)) ?? -1;
}

/** Which app exported this file, judging by its header row. */
export function detectAppExport(header: readonly string[]): AppPreset | null {
  const has = (...names: string[]) => {
    const at = headerIndex(header);
    return names.every((n) => at(n) !== -1);
  };
  if (has('Account', 'Date', 'Payee', 'Category', 'Memo', 'Outflow', 'Inflow')) return 'ynab';
  if (has('Account', 'Date', 'Payee', 'Notes', 'Category', 'Amount')) return 'actual';
  if (has('Date', 'Description', 'Amount', 'Transaction Type', 'Category', 'Account Name'))
    return 'mint';
  if (has('Date', 'Description', 'Category', 'Cost', 'Currency')) return 'splitwise';
  return null;
}

const PRESET_DATE_FORMAT: Partial<Record<AppPreset, DateFormat>> = {
  mint: 'mdy',
  actual: 'ymd',
  splitwise: 'ymd',
};

/** Splitwise's fixed columns; everything after them is a person. */
const SPLITWISE_FIXED = ['date', 'description', 'category', 'cost', 'currency'];

/**
 * Reads an export from another app. `account` keeps only that account's rows (multi-account
 * exports); `you` is which Splitwise person you are (your share becomes the expense).
 */
export function readAppExport(
  rows: readonly (readonly string[])[],
  preset: AppPreset,
  options: { digits: number; account?: string | null; you?: string | null },
): AppExport {
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const at = headerIndex(header);
  const get = (row: readonly string[], name: string) => String(row[at(name)] ?? '').trim();
  const body = rows.slice(1).map((row, i) => ({ row, line: i + 1 }));
  const errors: RowError[] = [];
  const out: AppExportRow[] = [];

  const accountColumn =
    preset === 'mint' ? 'Account Name' : preset === 'splitwise' ? null : 'Account';
  const accounts = accountColumn
    ? [...new Set(body.map(({ row }) => get(row, accountColumn)).filter(Boolean))]
    : [];
  const people =
    preset === 'splitwise' ? header.filter((h) => h && !SPLITWISE_FIXED.includes(key(h))) : [];

  const dateColumn = 'Date';
  // Mint wrote US dates, Actual and Splitwise ISO ones; YNAB uses each person's own setting.
  const format =
    PRESET_DATE_FORMAT[preset] ??
    detectDateFormat(body.slice(0, 50).map(({ row }) => get(row, dateColumn))) ??
    'ymd';

  for (const { row, line } of body) {
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    if (accountColumn && options.account && get(row, accountColumn) !== options.account) continue;
    // Splitwise ends with a "Total balance" line.
    if (preset === 'splitwise' && /total balance/i.test(get(row, 'Description'))) continue;

    const date = parseStatementDate(get(row, dateColumn), format);
    if (!date) {
      errors.push({ line, message: `Unreadable date "${get(row, dateColumn)}"` });
      continue;
    }

    let amount: number | null = null;
    let payee = '';
    let description = '';
    let notes = '';
    let category = '';

    switch (preset) {
      case 'ynab': {
        payee = get(row, 'Payee');
        if (/^transfer\s*:/i.test(payee)) {
          errors.push({ line, message: 'Transfer between accounts (left out)' });
          continue;
        }
        if (/^starting balance$/i.test(payee)) {
          errors.push({ line, message: 'Starting balance (set it on the account instead)' });
          continue;
        }
        const outflow = parseStatementAmount(get(row, 'Outflow'), options.digits) ?? 0;
        const inflow = parseStatementAmount(get(row, 'Inflow'), options.digits) ?? 0;
        amount = Math.abs(inflow) - Math.abs(outflow);
        category = get(row, 'Category');
        if (/^(inflow: )?ready to assign$|^to be budgeted$/i.test(category)) category = '';
        notes = get(row, 'Memo');
        break;
      }
      case 'actual': {
        payee = get(row, 'Payee');
        amount = parseStatementAmount(get(row, 'Amount'), options.digits);
        if (/^starting balance$/i.test(payee)) {
          errors.push({ line, message: 'Starting balance (set it on the account instead)' });
          continue;
        }
        // Actual names the other account as the payee of a transfer, with no category.
        if (!get(row, 'Category') && accounts.some((a) => key(a) === key(payee))) {
          errors.push({ line, message: 'Transfer between accounts (left out)' });
          continue;
        }
        category = get(row, 'Category');
        notes = get(row, 'Notes');
        break;
      }
      case 'mint': {
        category = get(row, 'Category');
        if (/^(transfer|credit card payment)$/i.test(category)) {
          errors.push({ line, message: 'Transfer between accounts (left out)' });
          continue;
        }
        const value = parseStatementAmount(get(row, 'Amount'), options.digits);
        amount =
          value === null
            ? null
            : /debit/i.test(get(row, 'Transaction Type'))
              ? -Math.abs(value)
              : Math.abs(value);
        payee = get(row, 'Description');
        description = get(row, 'Original Description');
        notes = get(row, 'Notes');
        break;
      }
      case 'splitwise': {
        category = get(row, 'Category');
        if (/^payment$/i.test(category)) {
          errors.push({ line, message: 'Settling up (left out)' });
          continue;
        }
        if (!options.you) continue;
        const cost = parseStatementAmount(get(row, 'Cost'), options.digits);
        const mine = parseStatementAmount(get(row, options.you), options.digits) ?? 0;
        if (cost === null) {
          amount = null;
          break;
        }
        // Your column is what the group owes you (+) or you owe (−) for this expense. If you
        // paid, your share is the cost less what the others owe you.
        const share = mine > 0 ? Math.abs(cost) - mine : -mine;
        if (share === 0) continue; // you weren't part of it
        amount = -share;
        // "Dinner by the lake" is what it was, not a bank narration: keep it as written.
        payee = get(row, 'Description');
        notes = 'From Splitwise';
        break;
      }
    }

    if (amount === null) {
      errors.push({ line, message: 'Missing or unreadable amount' });
      continue;
    }
    if (amount === 0) {
      errors.push({ line, message: 'Amount is zero' });
      continue;
    }
    const cleanPayee = cleanPayeeName(payee);
    out.push({
      line,
      date,
      amountMinor: amount,
      payee: cleanPayee || (description ? guessPayeeFromDescription(description) : ''),
      description: description.slice(0, 500),
      notes: notes.slice(0, 1000),
      externalId: null,
      category,
    });
  }
  return { preset, rows: out, errors, accounts, people };
}

/** Finds our category for another app's category name ("Dining out" → "Dining Out"). */
export function matchCategory<T extends { id: string; name: string }>(
  name: string,
  categories: readonly T[],
): T | null {
  const wanted = normalizePayeeName(name.split(/[:>/]/).at(-1) ?? name);
  if (!wanted) return null;
  return categories.find((c) => normalizePayeeName(c.name) === wanted) ?? null;
}
