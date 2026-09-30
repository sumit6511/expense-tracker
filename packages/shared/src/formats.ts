import { type IsoDate, isIsoDate, toIsoDate } from './dates';
import {
  type DateFormat,
  detectDateFormat,
  type NormalizedRow,
  parseStatementAmount,
  parseStatementDate,
  type RowError,
} from './import';
import type { Minor } from './money';
import { cleanPayeeName, guessPayeeFromDescription } from './text';

/**
 * Bank statement files that carry their own structure (no column mapping needed):
 * OFX/QFX (Open Financial Exchange, SGML or XML), QIF (Quicken) and CAMT.053 (ISO 20022 XML).
 */
export type StatementFormat = 'ofx' | 'qif' | 'camt';

export interface ParsedStatement {
  format: StatementFormat;
  /** Currency the file declares, if any. */
  currency: string | null;
  /** Account number or IBAN the file declares, if any (for display only). */
  account: string | null;
  rows: NormalizedRow[];
  errors: RowError[];
  /** Closing balance the file reports, if any. */
  balance: { amountMinor: Minor; date: IsoDate | null } | null;
}

/** Recognizes a structured statement by its content (the file name is only a hint). */
export function detectStatementFormat(text: string, fileName = ''): StatementFormat | null {
  const head = text.slice(0, 2000);
  if (/<OFX>|OFXHEADER:|<\?OFX/i.test(head)) return 'ofx';
  if (/<BkToCstmrStmt>|camt\.05[234]/i.test(head)) return 'camt';
  if (/^\s*!Type:/im.test(head) || /\.qif$/i.test(fileName)) return 'qif';
  if (/\.(ofx|qfx)$/i.test(fileName)) return 'ofx';
  return null;
}

export function parseStatementFile(
  text: string,
  digits: number,
  fileName = '',
): ParsedStatement | null {
  switch (detectStatementFormat(text, fileName)) {
    case 'ofx':
      return parseOfx(text, digits);
    case 'qif':
      return parseQif(text, digits);
    case 'camt':
      return parseCamt053(text, digits);
    default:
      return null;
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function row(
  line: number,
  date: IsoDate,
  amountMinor: Minor,
  fields: { payee?: string; description?: string; notes?: string; externalId?: string | null },
): NormalizedRow {
  const description = (fields.description ?? '').replace(/\s+/g, ' ').trim();
  const payee = cleanPayeeName(fields.payee ?? '') || guessPayeeFromDescription(description);
  return {
    line,
    date,
    amountMinor,
    payee,
    description,
    notes: (fields.notes ?? '').trim(),
    externalId: fields.externalId?.trim() || null,
  };
}

// ---------------------------------------------------------------------------------------------
// OFX / QFX
// ---------------------------------------------------------------------------------------------

/** OFX dates: YYYYMMDD[HHMMSS[.XXX]][[+-]h[:tz]]. The date part is what we need. */
function ofxDate(value: string): IsoDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = toIsoDate({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  return isIsoDate(iso) ? iso : null;
}

/**
 * Reads a leaf element's value. Works for XML (<NAME>x</NAME>) and SGML, where leaf elements
 * aren't closed (<NAME>x followed by the next tag).
 */
function ofxField(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? decodeEntities(m[1]!).trim() : null;
}

export function parseOfx(text: string, digits: number): ParsedStatement {
  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0]!;
    const date = ofxDate(ofxField(block, 'DTPOSTED') ?? ofxField(block, 'DTUSER') ?? '');
    const amount = parseStatementAmount(ofxField(block, 'TRNAMT') ?? '', digits);
    if (!date || amount === null || amount === 0) {
      errors.push({ line: i, message: 'Transaction without a readable date or amount' });
      return;
    }
    const name = ofxField(block, 'NAME') ?? '';
    const memo = ofxField(block, 'MEMO') ?? '';
    rows.push(
      row(i, date, amount, {
        payee: name,
        description: [name, memo].filter(Boolean).join(' ').trim(),
        externalId: ofxField(block, 'FITID') ?? ofxField(block, 'CHECKNUM'),
      }),
    );
  });
  const ledger = text.split(/<LEDGERBAL>/i)[1];
  const balanceAmount = ledger
    ? parseStatementAmount(ofxField(ledger, 'BALAMT') ?? '', digits)
    : null;
  return {
    format: 'ofx',
    currency: ofxField(text, 'CURDEF')?.toUpperCase() ?? null,
    account: ofxField(text, 'ACCTID'),
    rows,
    errors,
    balance:
      balanceAmount !== null
        ? { amountMinor: balanceAmount, date: ofxDate(ofxField(ledger!, 'DTASOF') ?? '') }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------
// QIF
// ---------------------------------------------------------------------------------------------

/** QIF writes years like 9/30'26 or 9/30/2026; the apostrophe means 2000+. */
function qifDateText(value: string) {
  return value.trim().replace(/'\s*(\d{1,2})$/, (_, y: string) => `/${2000 + Number(y)}`);
}

export function parseQif(text: string, digits: number, dateFormat?: DateFormat): ParsedStatement {
  const records: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};
  let currencyHint: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith('!')) {
      // !Type:Bank, !Account… headers carry no transactions.
      continue;
    }
    if (line === '^') {
      if (Object.keys(current).length) records.push(current);
      current = {};
      continue;
    }
    const code = line[0]!;
    const value = line.slice(1);
    // Split lines (S/E/$) repeat; keep the first of each.
    if (!(code in current)) current[code] = value;
    if (code === 'T' && /NPR|INR|USD/i.test(value)) currencyHint = value.match(/NPR|INR|USD/i)![0]!;
  }
  if (Object.keys(current).length) records.push(current);

  const format =
    dateFormat ??
    detectDateFormat(records.map((r) => qifDateText(r.D ?? ''))) ??
    // US software writes month first; with no evidence either way assume that.
    'mdy';
  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  records.forEach((r, i) => {
    const date = parseStatementDate(qifDateText(r.D ?? ''), format);
    const amount = parseStatementAmount(r.T ?? r.U ?? '', digits);
    if (!date || amount === null || amount === 0) {
      errors.push({ line: i, message: 'Record without a readable date or amount' });
      return;
    }
    const payee = r.P ?? '';
    const memo = r.M ?? '';
    rows.push(
      row(i, date, amount, {
        payee,
        description: [payee, memo].filter(Boolean).join(' ').trim(),
        notes: r.L && !r.L.startsWith('[') ? r.L : '',
        externalId: r.N && /\d/.test(r.N) ? r.N : null,
      }),
    );
  });
  return {
    format: 'qif',
    currency: currencyHint?.toUpperCase() ?? null,
    account: null,
    rows,
    errors,
    balance: null,
  };
}

// ---------------------------------------------------------------------------------------------
// CAMT.053 (ISO 20022 bank-to-customer statement)
// ---------------------------------------------------------------------------------------------

/** First element named `tag` inside `xml` (namespace prefixes already removed). */
function xmlElement(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1]! : null;
}

function xmlText(xml: string | null, ...path: string[]): string | null {
  let cur = xml;
  for (const tag of path) {
    if (cur === null) return null;
    cur = xmlElement(cur, tag);
  }
  return cur === null
    ? null
    : decodeEntities(cur.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function xmlDate(block: string | null): IsoDate | null {
  if (!block) return null;
  const value = xmlText(block, 'Dt') ?? xmlText(block, 'DtTm');
  const m = value && /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? (`${m[1]}-${m[2]}-${m[3]}` as IsoDate) : null;
}

export function parseCamt053(xmlText0: string, digits: number): ParsedStatement {
  // Namespace prefixes (<ns2:Ntry>) and attributes are irrelevant here.
  const xml = xmlText0.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  const stmt = xmlElement(xml, 'Stmt') ?? xml;
  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  const entries = [...stmt.matchAll(/<Ntry(?:\s[^>]*)?>([\s\S]*?)<\/Ntry>/g)].map((m) => m[1]!);
  entries.forEach((entry, i) => {
    const amountText = xmlText(entry, 'Amt');
    const amount = amountText === null ? null : parseStatementAmount(amountText, digits);
    const debit = /DBIT/.test(xmlText(entry, 'CdtDbtInd') ?? '');
    const date = xmlDate(xmlElement(entry, 'BookgDt')) ?? xmlDate(xmlElement(entry, 'ValDt'));
    if (!date || amount === null || amount === 0) {
      errors.push({ line: i, message: 'Entry without a readable date or amount' });
      return;
    }
    const details = xmlElement(entry, 'TxDtls') ?? entry;
    const party = debit
      ? (xmlText(details, 'RltdPties', 'Cdtr', 'Nm') ??
        xmlText(details, 'RltdPties', 'Cdtr', 'Pty', 'Nm'))
      : (xmlText(details, 'RltdPties', 'Dbtr', 'Nm') ??
        xmlText(details, 'RltdPties', 'Dbtr', 'Pty', 'Nm'));
    const info = xmlText(details, 'RmtInf', 'Ustrd') ?? xmlText(entry, 'AddtlNtryInf') ?? '';
    rows.push(
      row(i, date, debit ? -Math.abs(amount) : Math.abs(amount), {
        payee: party ?? '',
        description: [party, info].filter(Boolean).join(' ').trim(),
        externalId:
          xmlText(entry, 'AcctSvcrRef') ??
          xmlText(details, 'Refs', 'AcctSvcrRef') ??
          xmlText(entry, 'NtryRef') ??
          xmlText(details, 'Refs', 'EndToEndId'),
      }),
    );
  });

  // Closing booked balance ("CLBD").
  let balance: ParsedStatement['balance'] = null;
  for (const m of stmt.matchAll(/<Bal>([\s\S]*?)<\/Bal>/g)) {
    const b = m[1]!;
    if (!/CLBD/.test(xmlText(b, 'Tp') ?? '')) continue;
    const amount = parseStatementAmount(xmlText(b, 'Amt') ?? '', digits);
    if (amount === null) continue;
    const negative = /DBIT/.test(xmlText(b, 'CdtDbtInd') ?? '');
    balance = { amountMinor: negative ? -Math.abs(amount) : amount, date: xmlDate(b) };
  }
  const currency =
    /<Amt\s+Ccy="([A-Z]{3})"/.exec(stmt)?.[1] ?? /<Ccy>([A-Z]{3})</.exec(stmt)?.[1] ?? null;
  return {
    format: 'camt',
    currency,
    account: xmlText(stmt, 'Acct', 'Id', 'IBAN') ?? xmlText(stmt, 'Acct', 'Id', 'Othr', 'Id'),
    rows,
    errors,
    balance,
  };
}
