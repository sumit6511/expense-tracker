import { describe, expect, it } from 'vitest';
import { parseQuickText, type QuickTextContext } from './quick-text';

const ctx: QuickTextContext = {
  today: '2026-09-30', // a Wednesday
  digits: 2,
  accounts: [
    { id: 'cash', name: 'Cash' },
    { id: 'esewa', name: 'eSewa' },
    { id: 'nabil', name: 'Nabil Bank' },
  ],
  categories: [
    { id: 'dining', name: 'Dining Out', kind: 'expense' },
    { id: 'food', name: 'Food & Groceries', kind: 'expense' },
    { id: 'transport', name: 'Transport', kind: 'expense' },
    { id: 'salary', name: 'Salary', kind: 'income' },
  ],
};
const parse = (text: string) => parseQuickText(text, ctx);

describe('parseQuickText', () => {
  it('reads a whole sentence', () => {
    expect(parse('lunch 450 at Bhojan Griha yesterday via eSewa')).toEqual({
      amountMinor: 45_000,
      direction: 'expense',
      date: '2026-09-29',
      accountId: 'esewa',
      categoryId: 'dining',
      payee: 'Bhojan Griha',
      notes: 'lunch',
    });
  });

  it('knows income, lakh grouping and category names', () => {
    expect(parse('Salary 1,25,000 to Nabil Bank')).toMatchObject({
      amountMinor: 12_500_000,
      direction: 'income',
      accountId: 'nabil',
      categoryId: 'salary',
      payee: null,
    });
    expect(parse('received 5000 from Hari')).toMatchObject({
      direction: 'income',
      amountMinor: 500_000,
      payee: 'Hari',
      notes: 'received',
    });
  });

  it('understands symbols, shorthand and Devanagari digits', () => {
    expect(parse('Rs 1.2k taxi')).toMatchObject({ amountMinor: 120_000, categoryId: 'transport' });
    expect(parse('2 lakh')).toMatchObject({ amountMinor: 20_000_000 });
    expect(parse('५०० momo')).toMatchObject({ amountMinor: 50_000, categoryId: 'dining' });
    expect(parse('$12.50 coffee')).toMatchObject({ amountMinor: 1_250 });
  });

  it('takes the leftover words as the payee', () => {
    expect(parse('2300 Bhat Bhateni 2026-09-12')).toMatchObject({
      amountMinor: 230_000,
      date: '2026-09-12',
      payee: 'Bhat Bhateni',
      categoryId: null,
    });
    expect(parse('food and groceries 800 cash')).toMatchObject({
      categoryId: 'food',
      accountId: 'cash',
      payee: null,
    });
  });

  it('works out relative dates', () => {
    expect(parse('500 last friday').date).toBe('2026-09-25');
    expect(parse('500 wednesday').date).toBe('2026-09-30');
    expect(parse('500 last wednesday').date).toBe('2026-09-23');
    expect(parse('3 days ago 200 bus')).toMatchObject({ date: '2026-09-27', amountMinor: 20_000 });
    expect(parse('day before yesterday 100').date).toBe('2026-09-28');
    expect(parse('100').date).toBeNull();
  });

  it('understands a little Nepali', () => {
    expect(parse('खाना ४५० हिजो, eSewa बाट')).toEqual({
      amountMinor: 45_000,
      direction: 'expense',
      date: '2026-09-29',
      accountId: 'esewa',
      categoryId: 'dining',
      payee: null,
      notes: 'खाना',
    });
    expect(parse('तरकारी ३२० आज')).toMatchObject({
      amountMinor: 32_000,
      date: '2026-09-30',
      categoryId: 'food',
    });
    expect(parse('ट्याक्सी ५०० अस्ति').date).toBe('2026-09-28');
  });

  it('leaves the amount empty when there is none', () => {
    expect(parse('coffee with Sita')).toMatchObject({ amountMinor: null, categoryId: 'dining' });
  });
});
