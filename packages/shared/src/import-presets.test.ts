import { describe, expect, it } from 'vitest';
import { detectAppExport, matchCategory, readAppExport } from './import-presets';

const csv = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => line.split('|').map((c) => c.trim()));

const YNAB = csv(`
Account|Flag|Date|Payee|Category Group/Category|Category Group|Category|Memo|Outflow|Inflow|Cleared
Checking||09/01/2026|Starting Balance|Inflow: Ready to Assign|Inflow|Ready to Assign||$0.00|$5,000.00|Cleared
Checking||09/03/2026|Bhat Bhateni|Everyday: Groceries|Everyday|Groceries|weekly shop|$1,234.50|$0.00|Cleared
Checking||09/05/2026|Transfer : Savings|||||$500.00|$0.00|Cleared
Savings||09/05/2026|Transfer : Checking|||||$0.00|$500.00|Cleared
Checking||09/15/2026|Employer|Inflow: Ready to Assign|Inflow|Ready to Assign||$0.00|$3,000.00|Cleared
`);

const ACTUAL = csv(`
Account|Date|Payee|Notes|Category|Amount|Split_Amount|Cleared
Cash|2026-09-02|Momo House|with Sita|Dining Out|-450.00|0|true
Cash|2026-09-03|Nabil Bank||| -2000.00|0|true
Nabil Bank|2026-09-03|Cash|||2000.00|0|true
Nabil Bank|2026-09-10|Employer||Salary|125000|0|true
`);

const MINT = csv(`
Date|Description|Original Description|Amount|Transaction Type|Category|Account Name|Labels|Notes
9/04/2026|Coffee Shop|SQ *COFFEE SHOP 1234|4.50|debit|Coffee Shops|Visa||
9/05/2026|Payroll|ACME PAYROLL|2500.00|credit|Paycheck|Checking||
9/06/2026|Visa Payment|ONLINE PAYMENT|300.00|debit|Credit Card Payment|Checking||
`);

const SPLITWISE = csv(`
Date|Description|Category|Cost|Currency|Asha Test|Bikash|Sita
2026-09-01|Dinner by the lake|Dining out|3000.00|NPR|2000.00|-1000.00|-1000.00
2026-09-02|Taxi to Sarangkot|Taxi|1200.00|NPR|-600.00|1200.00|-600.00
2026-09-03|Sita's museum ticket|Entertainment|500.00|NPR|0.00|-500.00|500.00
2026-09-04|Settle up|Payment|1000.00|NPR|-1000.00|1000.00|0.00
|Total balance||| NPR|400.00|-300.00|-100.00
`);

describe('import presets', () => {
  it('recognises each app by its columns', () => {
    expect(detectAppExport(YNAB[0]!)).toBe('ynab');
    expect(detectAppExport(ACTUAL[0]!)).toBe('actual');
    expect(detectAppExport(MINT[0]!)).toBe('mint');
    expect(detectAppExport(SPLITWISE[0]!)).toBe('splitwise');
    expect(detectAppExport(['Date', 'Narration', 'Debit', 'Credit', 'Balance'])).toBeNull();
  });

  it('reads YNAB, leaving out transfers and starting balances', () => {
    const all = readAppExport(YNAB, 'ynab', { digits: 2 });
    expect(all.accounts).toEqual(['Checking', 'Savings']);
    const r = readAppExport(YNAB, 'ynab', { digits: 2, account: 'Checking' });
    expect(r.rows).toEqual([
      expect.objectContaining({
        date: '2026-09-03',
        amountMinor: -123_450,
        payee: 'Bhat Bhateni',
        category: 'Groceries',
        notes: 'weekly shop',
      }),
      expect.objectContaining({ date: '2026-09-15', amountMinor: 300_000, category: '' }),
    ]);
    expect(r.errors.map((e) => e.message)).toEqual([
      'Starting balance (set it on the account instead)',
      'Transfer between accounts (left out)',
    ]);
  });

  it('reads Actual, spotting transfers by the account names', () => {
    const r = readAppExport(ACTUAL, 'actual', { digits: 2, account: 'Cash' });
    expect(r.rows).toEqual([
      expect.objectContaining({
        amountMinor: -45_000,
        payee: 'Momo House',
        notes: 'with Sita',
        category: 'Dining Out',
      }),
    ]);
    expect(r.errors).toEqual([{ line: 2, message: 'Transfer between accounts (left out)' }]);
  });

  it('reads Mint, signing amounts by transaction type', () => {
    const r = readAppExport(MINT, 'mint', { digits: 2 });
    expect(r.accounts).toEqual(['Visa', 'Checking']);
    expect(r.rows.map((x) => [x.date, x.amountMinor, x.payee, x.category])).toEqual([
      ['2026-09-04', -450, 'Coffee Shop', 'Coffee Shops'],
      ['2026-09-05', 250_000, 'Payroll', 'Paycheck'],
    ]);
    expect(r.rows[0]!.description).toBe('SQ *COFFEE SHOP 1234');
  });

  it('reads Splitwise as your share of each expense', () => {
    const nobody = readAppExport(SPLITWISE, 'splitwise', { digits: 2 });
    expect(nobody.people).toEqual(['Asha Test', 'Bikash', 'Sita']);
    expect(nobody.rows).toEqual([]);

    const r = readAppExport(SPLITWISE, 'splitwise', { digits: 2, you: 'Asha Test' });
    expect(r.rows.map((x) => [x.payee, x.amountMinor, x.category])).toEqual([
      // You paid 3,000 and are owed 2,000: your share was 1,000.
      ['Dinner by the lake', -100_000, 'Dining out'],
      // Bikash paid; you owe 600.
      ['Taxi to Sarangkot', -60_000, 'Taxi'],
    ]);
    expect(r.errors).toEqual([{ line: 4, message: 'Settling up (left out)' }]);
  });

  it('matches category names across apps', () => {
    const ours = [
      { id: 'd', name: 'Dining Out' },
      { id: 'g', name: 'Food & Groceries' },
    ];
    expect(matchCategory('Dining out', ours)?.id).toBe('d');
    expect(matchCategory('Everyday: Dining Out', ours)?.id).toBe('d');
    expect(matchCategory('food and groceries', ours)?.id).toBe('g');
    expect(matchCategory('Taxi', ours)).toBeNull();
    expect(matchCategory('', ours)).toBeNull();
  });
});
