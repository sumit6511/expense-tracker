import { describe, expect, it } from 'vitest';
import {
  detectDateFormat,
  findDuplicates,
  guessMapping,
  type ImportMapping,
  normalizeRows,
  parseStatementAmount,
  parseStatementDate,
} from './import';
import {
  cleanPayeeName,
  guessPayeeFromDescription,
  normalizePayeeName,
  payeeSimilarity,
} from './text';

describe('parseStatementDate', () => {
  it('parses common formats', () => {
    expect(parseStatementDate('2026-09-30', 'ymd')).toBe('2026-09-30');
    expect(parseStatementDate('30/09/2026', 'dmy')).toBe('2026-09-30');
    expect(parseStatementDate('09/30/2026', 'mdy')).toBe('2026-09-30');
    expect(parseStatementDate('30-Sep-2026', 'dmy')).toBe('2026-09-30');
    expect(parseStatementDate('30 September 2026', 'dmy')).toBe('2026-09-30');
    expect(parseStatementDate('30.09.26', 'dmy')).toBe('2026-09-30');
    expect(parseStatementDate('2026-09-30 14:05:00', 'ymd')).toBe('2026-09-30');
    expect(parseStatementDate('2026-09-30T08:00:00Z', 'ymd')).toBe('2026-09-30');
  });

  it('parses Bikram Sambat and Excel serial dates', () => {
    expect(parseStatementDate('2083-06-14', 'bs-ymd')).toBe('2026-09-30');
    expect(parseStatementDate('२०८३/०६/१४', 'bs-ymd')).toBe('2026-09-30');
    expect(parseStatementDate('46295', 'dmy')).toBe('2026-09-30');
  });

  it('rejects impossible dates', () => {
    expect(parseStatementDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseStatementDate('13/13/2026', 'dmy')).toBeNull();
    expect(parseStatementDate('hello', 'ymd')).toBeNull();
    expect(parseStatementDate('', 'ymd')).toBeNull();
  });
});

describe('detectDateFormat', () => {
  it('prefers the only format that parses every sample', () => {
    expect(detectDateFormat(['2026-09-30', '2026-10-01'])).toBe('ymd');
    expect(detectDateFormat(['30/09/2026', '01/10/2026'])).toBe('dmy');
    expect(detectDateFormat(['09/30/2026', '10/01/2026'])).toBe('mdy');
    expect(detectDateFormat(['2083-06-14', '2083-06-15'])).toBe('bs-ymd');
    // Ambiguous (both ≤ 12): day-first is the Nepal convention.
    expect(detectDateFormat(['01/02/2026'])).toBe('dmy');
    expect(detectDateFormat(['30/09/2026', '01/10/2026', 'Closing balance'])).toBe('dmy');
    expect(detectDateFormat(['nope'])).toBeNull();
    expect(detectDateFormat([])).toBeNull();
  });
});

describe('parseStatementAmount', () => {
  it('reads statement conventions', () => {
    expect(parseStatementAmount('1,23,456.78', 2)).toBe(12345678);
    expect(parseStatementAmount('(500.00)', 2)).toBe(-50000);
    expect(parseStatementAmount('500.00 Dr', 2)).toBe(-50000);
    expect(parseStatementAmount('500.00 CR', 2)).toBe(50000);
    expect(parseStatementAmount('-1,000', 2)).toBe(-100000);
    expect(parseStatementAmount('NPR 1,000.00', 2)).toBe(100000);
  });

  it('treats blanks and expressions as missing', () => {
    expect(parseStatementAmount('', 2)).toBeNull();
    expect(parseStatementAmount('-', 2)).toBeNull();
    expect(parseStatementAmount('10+5', 2)).toBeNull();
    expect(parseStatementAmount('2026-09-30', 2)).toBeNull();
  });
});

describe('normalizeRows', () => {
  const rows = [
    ['Txn Date', 'Description', 'Withdrawal', 'Deposit', 'Balance', 'Ref No'],
    ['30/09/2026', 'POS/BHAT BHATENI SUPERMARKET/KTM', '2,450.00', '', '50,000.00', 'R1'],
    ['01/10/2026', 'Salary for Asoj', '', '85,000.00', '1,35,000.00', 'R2'],
    ['', '', '', '', '', ''],
    ['bad date', 'Something', '10', '', '', ''],
    ['02/10/2026', 'Zero row', '', '', '', ''],
  ];

  it('maps debit/credit columns and reports bad rows', () => {
    const mapping: ImportMapping = {
      hasHeader: true,
      date: 0,
      dateFormat: 'dmy',
      amount: { kind: 'debitCredit', debit: 2, credit: 3 },
      description: 1,
      externalId: 5,
    };
    const result = normalizeRows(rows, mapping, 2);
    expect(result.rows).toEqual([
      {
        line: 1,
        date: '2026-09-30',
        amountMinor: -245000,
        payee: 'Bhat Bhateni Supermarket KTM',
        description: 'POS/BHAT BHATENI SUPERMARKET/KTM',
        notes: '',
        externalId: 'R1',
      },
      {
        line: 2,
        date: '2026-10-01',
        amountMinor: 8500000,
        payee: 'Salary Asoj',
        description: 'Salary for Asoj',
        notes: '',
        externalId: 'R2',
      },
    ]);
    expect(result.errors).toEqual([
      { line: 4, message: 'Unreadable date "bad date"' },
      { line: 5, message: 'Missing or unreadable amount' },
    ]);
  });

  it('supports a single signed column, optionally negated', () => {
    const data = [['2026-09-30', 'Tea', '150']];
    const base = { hasHeader: false, date: 0, dateFormat: 'ymd' as const, payee: 1 };
    expect(
      normalizeRows(data, { ...base, amount: { kind: 'single', column: 2 } }, 2).rows[0]
        ?.amountMinor,
    ).toBe(15000);
    expect(
      normalizeRows(data, { ...base, amount: { kind: 'single', column: 2, negate: true } }, 2)
        .rows[0]?.amountMinor,
    ).toBe(-15000);
  });

  it('guesses a mapping from headers', () => {
    expect(guessMapping(rows)).toEqual({
      hasHeader: true,
      date: 0,
      dateFormat: 'dmy',
      description: 1,
      payee: null,
      externalId: 5,
      amount: { kind: 'debitCredit', debit: 2, credit: 3 },
    });
    expect(
      guessMapping([
        ['Date', 'Payee', 'Amount'],
        ['2026-09-30', 'Tea shop', '-150'],
      ]),
    ).toMatchObject({
      date: 0,
      payee: 1,
      amount: { kind: 'single', column: 2 },
      dateFormat: 'ymd',
    });
  });
});

describe('findDuplicates', () => {
  const existing = [
    { id: 'a', date: '2026-09-30', amountMinor: -245000, payee: 'Bhat Bhateni' },
    { id: 'b', date: '2026-09-28', amountMinor: -50000, payee: 'Daraz' },
    { id: 'c', date: '2026-09-20', amountMinor: -10000, payee: null, externalId: 'X9' },
  ];

  it('matches by amount, nearby date and similar payee', () => {
    expect(
      findDuplicates(
        [
          { date: '2026-10-01', amountMinor: -245000, payee: 'BHAT BHATENI SUPERMARKET' },
          { date: '2026-09-30', amountMinor: -50000, payee: 'Daraz Online' },
          { date: '2026-09-30', amountMinor: -50000, payee: 'Something Else' },
          { date: '2026-10-10', amountMinor: -245000, payee: 'Bhat Bhateni' },
        ],
        existing,
      ),
    ).toEqual(['a', 'b', null, null]);
  });

  it('matches by external id and never reuses an existing transaction', () => {
    expect(
      findDuplicates(
        [
          { date: '2026-09-22', amountMinor: -10000, externalId: 'X9' },
          { date: '2026-09-30', amountMinor: -245000, payee: 'Bhat Bhateni' },
          { date: '2026-09-30', amountMinor: -245000, payee: 'Bhat Bhateni' },
        ],
        existing,
      ),
    ).toEqual(['c', 'a', null]);
  });

  it('treats same-day, same-amount rows without payees as duplicates', () => {
    expect(findDuplicates([{ date: '2026-09-20', amountMinor: -10000 }], existing)).toEqual(['c']);
    expect(findDuplicates([{ date: '2026-09-21', amountMinor: -10000 }], existing)).toEqual([null]);
  });
});

describe('payee text helpers', () => {
  it('normalizes names', () => {
    expect(normalizePayeeName('Bhat-Bhateni Supermarket Pvt. Ltd.')).toBe(
      'bhat bhateni supermarket',
    );
    expect(normalizePayeeName('  NEA   ')).toBe('nea');
    expect(normalizePayeeName('Tom & Jerry Café')).toBe('tom and jerry cafe');
    expect(normalizePayeeName('भाटभटेनी')).toBe('भाटभटेनी');
    expect(cleanPayeeName('  Big   Mart ')).toBe('Big Mart');
  });

  it('scores similarity', () => {
    expect(payeeSimilarity('Bhat Bhateni', 'BHAT BHATENI SUPERMARKET')).toBeCloseTo(2 / 3);
    expect(payeeSimilarity('Daraz', 'Foodmandu')).toBe(0);
    expect(payeeSimilarity('', 'x')).toBe(0);
  });

  it('guesses payees from narrations', () => {
    expect(guessPayeeFromDescription('FONEPAY/QR/Himalayan Java Coffee/123456789')).toBe(
      'Himalayan Java Coffee',
    );
    expect(guessPayeeFromDescription('ATM WDL 00123456')).toBe('WDL');
    expect(guessPayeeFromDescription('123 456')).toBe('');
  });
});
