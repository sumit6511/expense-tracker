import { describe, expect, it } from 'vitest';
import { holdingValueMinor, parsePriceList } from './holdings';

describe('holdings', () => {
  it('values quantity × price exactly, in minor units', () => {
    expect(holdingValueMinor('10', '512.3', 2)).toBe(512_300);
    expect(holdingValueMinor('0.1', '0.2', 2)).toBe(2); // 0.02, not 0.020000000000000004
    expect(holdingValueMinor('3', '0.335', 2)).toBe(101); // 1.005 rounds half up
    expect(holdingValueMinor('1.23456789', '1000', 2)).toBe(123_457);
    expect(holdingValueMinor('150', '1234.5', 0)).toBe(185_175);
    expect(() => holdingValueMinor('999999999999999', '1', 2)).toThrow(RangeError);
  });

  it('reads pasted price lists', () => {
    expect(
      parsePriceList(
        'NABIL\t512.30\nnica, 845\nNTC  Rs. 1,021.5\nGBIME 230.00 +1.2%\nnot a price line\n',
      ),
    ).toEqual({ NABIL: '512.30', NICA: '845', NTC: '1021.5', GBIME: '230.00' });
  });
});
