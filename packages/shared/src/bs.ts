import { BS_EPOCH_AD, BS_FIRST_YEAR, BS_MONTH_LENGTHS } from './bs-data';
import { type DateParts, type DateStyle, fromEpochDay, type IsoDate, toEpochDay } from './dates';

/**
 * Bikram Sambat (Vikram Samvat), Nepal's official calendar. The year starts on 1 Baisakh (mid
 * April) and months have 29–32 days that vary year to year, so conversion is table-driven.
 * All conversions are O(log n) over precomputed year offsets.
 */
export const BS_LAST_YEAR = BS_FIRST_YEAR + BS_MONTH_LENGTHS.length - 1;

export const BS_MONTH_NAMES = [
  'Baisakh',
  'Jestha',
  'Asar',
  'Shrawan',
  'Bhadra',
  'Asoj',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

export const BS_MONTH_NAMES_NE = [
  'बैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कात्तिक',
  'मंसिर',
  'पुस',
  'माघ',
  'फागुन',
  'चैत',
] as const;

const EPOCH_DAY = toEpochDay(BS_EPOCH_AD);

/** yearStart[i] = epoch day of 1 Baisakh of year BS_FIRST_YEAR + i (plus one sentinel entry). */
const yearStart: number[] = [];
{
  let day = EPOCH_DAY;
  for (const row of BS_MONTH_LENGTHS) {
    yearStart.push(day);
    for (const ch of row) day += 29 + Number(ch);
  }
  yearStart.push(day);
}

export const BS_MIN_AD: IsoDate = BS_EPOCH_AD;
export const BS_MAX_AD: IsoDate = fromEpochDay(yearStart[yearStart.length - 1]! - 1);

export function bsDaysInMonth(year: number, month: number): number {
  const row = BS_MONTH_LENGTHS[year - BS_FIRST_YEAR];
  if (!row || month < 1 || month > 12) {
    throw new RangeError(`No Bikram Sambat data for ${year}-${month}`);
  }
  return 29 + Number(row[month - 1]);
}

export function isBsSupported(date: IsoDate): boolean {
  return date >= BS_MIN_AD && date <= BS_MAX_AD;
}

export function isValidBsDate({ year, month, day }: DateParts): boolean {
  if (year < BS_FIRST_YEAR || year > BS_LAST_YEAR || month < 1 || month > 12) return false;
  return Number.isInteger(day) && day >= 1 && day <= bsDaysInMonth(year, month);
}

/** AD calendar date → BS date parts. */
export function adToBs(date: IsoDate): DateParts {
  const epochDay = toEpochDay(date);
  if (epochDay < yearStart[0]! || epochDay >= yearStart[yearStart.length - 1]!) {
    throw new RangeError(`${date} is outside the supported Bikram Sambat range`);
  }
  // Binary search for the BS year containing this day.
  let lo = 0;
  let hi = yearStart.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (yearStart[mid]! <= epochDay) lo = mid;
    else hi = mid - 1;
  }
  const year = BS_FIRST_YEAR + lo;
  let remaining = epochDay - yearStart[lo]!;
  for (let month = 1; month <= 12; month++) {
    const length = bsDaysInMonth(year, month);
    if (remaining < length) return { year, month, day: remaining + 1 };
    remaining -= length;
  }
  throw new Error('unreachable: BS year table is inconsistent');
}

/** BS date parts → AD calendar date. */
export function bsToAd({ year, month, day }: DateParts): IsoDate {
  if (!isValidBsDate({ year, month, day })) {
    throw new RangeError(`Invalid Bikram Sambat date: ${year}-${month}-${day}`);
  }
  let epochDay = yearStart[year - BS_FIRST_YEAR]!;
  for (let m = 1; m < month; m++) epochDay += bsDaysInMonth(year, m);
  return fromEpochDay(epochDay + day - 1);
}

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function toDevanagariDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]!);
}

export interface BsFormatOptions {
  style?: DateStyle;
  /** 'en' → "14 Asoj 2083"; 'ne' → "१४ असोज २०८३". */
  lang?: 'en' | 'ne';
}

/** "14 Asoj" (short), "14 Asoj 2083" (medium/long). */
export function formatBsDate(date: IsoDate, options: BsFormatOptions = {}): string {
  const { style = 'medium', lang = 'en' } = options;
  const { year, month, day } = adToBs(date);
  const monthName = (lang === 'ne' ? BS_MONTH_NAMES_NE : BS_MONTH_NAMES)[month - 1]!;
  const text = style === 'short' ? `${day} ${monthName}` : `${day} ${monthName} ${year}`;
  return lang === 'ne' ? toDevanagariDigits(text) : text;
}

/** "2083-06-14" style BS string, handy for inputs and CSV exports. */
export function toBsIsoString(date: IsoDate): string {
  const { year, month, day } = adToBs(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parses "2083-06-14" or "2083/6/14" as a BS date and returns the AD date, or null. */
export function parseBsString(value: string): IsoDate | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidBsDate(parts) ? bsToAd(parts) : null;
}
