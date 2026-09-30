import { describe, expect, it } from 'vitest';
import { fetchNrbRates, parseNrbResponse, RateBook } from './rates';

// Shape of https://www.nrb.org.np/api/forex/v1/rates responses (trimmed).
const NRB_FIXTURE = {
  status: { code: 200 },
  data: {
    payload: [
      {
        date: '2026-09-29',
        published_on: '2026-09-29 00:00:12',
        rates: [
          {
            currency: { iso3: 'INR', name: 'Indian Rupee', unit: 100 },
            buy: '160.00',
            sell: '160.15',
          },
          {
            currency: { iso3: 'USD', name: 'U.S. Dollar', unit: 1 },
            buy: '133.10',
            sell: '133.70',
          },
          { currency: { iso3: 'JPY', name: 'Japanese Yen', unit: 10 }, buy: 9.12, sell: 9.18 },
          { currency: { iso3: 'XYZ', name: 'Not a currency', unit: 1 }, buy: '1', sell: '1' },
          { currency: { iso3: 'EUR', name: 'Euro', unit: 1 }, buy: null, sell: null },
        ],
      },
    ],
  },
  pagination: { page: 1, pages: 1, per_page: 100, total: 1 },
};

describe('NRB rates', () => {
  it('parses mid rates per single unit', () => {
    expect(parseNrbResponse(NRB_FIXTURE)).toEqual([
      { base: 'INR', date: '2026-09-29', rate: '1.60075' },
      { base: 'USD', date: '2026-09-29', rate: '133.4' },
      { base: 'JPY', date: '2026-09-29', rate: '0.915' },
    ]);
  });

  it('rejects unexpected response shapes', () => {
    expect(() => parseNrbResponse({ data: 'nope' })).toThrow();
  });

  it('fetches every page', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      const page = Number(new URL(url).searchParams.get('page'));
      const body = { ...NRB_FIXTURE, pagination: { page, pages: 2 } };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const rates = await fetchNrbRates('2026-09-01', '2026-09-30', fakeFetch);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('from=2026-09-01&to=2026-09-30');
    expect(rates).toHaveLength(6);
  });

  it('surfaces HTTP errors', async () => {
    const failing = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchNrbRates('2026-09-01', '2026-09-30', failing)).rejects.toThrow('HTTP 503');
  });
});

describe('RateBook', () => {
  const book = new RateBook(
    [
      { base: 'USD', date: '2026-09-01', rate: '133' },
      { base: 'USD', date: '2026-09-10', rate: '134' },
    ],
    [{ base: 'USD', quote: 'NPR', date: '2026-09-10', rate: '135' }],
  );

  it('uses the latest rate on or before the date, preferring manual rates', () => {
    expect(book.rate('USD', 'NPR', '2026-09-05')).toBe('133');
    expect(book.rate('USD', 'NPR', '2026-09-10')).toBe('135');
    expect(book.rate('USD', 'NPR', '2026-12-31')).toBe('135');
    // Before the first known rate: the earliest one is the best guess.
    expect(book.rate('USD', 'NPR', '2020-01-01')).toBe('133');
  });

  it('crosses currencies through NPR and knows the INR peg', () => {
    expect(book.rate('INR', 'NPR', '2026-09-05')).toBe('1.6');
    expect(book.rate('USD', 'INR', '2026-09-05')).toBe('83.125');
    expect(book.rate('NPR', 'USD', '2026-09-05')).toBe('0.007518796992');
    expect(book.convert(10_000, 'USD', 'INR', '2026-09-05')).toBe(831_250);
    expect(book.convert(16_000, 'NPR', 'INR', '2026-09-05')).toBe(10_000);
  });

  it('records currencies without rates', () => {
    const b = new RateBook([], []);
    expect(b.convert(100, 'EUR', 'NPR', '2026-09-01')).toBeNull();
    expect([...b.missing]).toEqual(['EUR']);
    expect(b.convert(100, 'NPR', 'NPR', '2026-09-01')).toBe(100);
  });
});
