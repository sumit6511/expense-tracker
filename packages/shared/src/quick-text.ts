import { addDays, dayOfWeek, type IsoDate, isIsoDate } from './dates';
import { normalizeDigits, parseDecimal } from './money';
import { cleanPayeeName, normalizePayeeName } from './text';

/**
 * Natural-language quick add, the deterministic way: "lunch 450 at Bhojan Griha yesterday via
 * eSewa" → Rs. 450, yesterday, eSewa, payee Bhojan Griha, Dining Out. Handles amounts with
 * symbols, "1.2k" and "2 lakh", Devanagari digits, relative dates, account and category names.
 * No AI: the server only asks a model when this leaves the amount (or everything else) unknown.
 */

export interface QuickTextContext {
  today: IsoDate;
  accounts: ReadonlyArray<{ id: string; name: string }>;
  categories: ReadonlyArray<{ id: string; name: string; kind: 'expense' | 'income' }>;
  /** Minor-unit digits of the currency the amount is in. */
  digits: number;
}

export interface QuickTextResult {
  /** Positive; null when no amount was found. */
  amountMinor: number | null;
  direction: 'expense' | 'income';
  date: IsoDate | null;
  accountId: string | null;
  categoryId: string | null;
  payee: string | null;
  notes: string | null;
}

const WORD_START = '(?<![\\p{L}\\p{M}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{M}\\p{N}])';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A phrase as a whole-word, case-insensitive pattern (spaces match any whitespace). */
const phrase = (s: string) =>
  `${WORD_START}${s.trim().split(/\s+/).map(escapeRegExp).join('\\s+')}${WORD_END}`;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  hajar: 1_000,
  hazar: 1_000,
  lakh: 100_000,
  lac: 100_000,
  lakhs: 100_000,
};

const AMOUNT_RE = new RegExp(
  `(\\+)?(?:(?:rs\\.?|npr|inr|usd|रु\\.?|रू\\.?|[₹$€£])\\s*)?(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s*(k|thousand|hajar|hazar|lakhs?|lac)${WORD_END})?(?:\\s*(?:rs|rupees?|npr|inr|usd|dollars?)${WORD_END})?`,
  'iu',
);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const INCOME_WORDS = new RegExp(
  `${WORD_START}(?:salary|received|receive|got|income|refund|refunded|earned|bonus|interest|dividend|sold)${WORD_END}`,
  'iu',
);

/**
 * Everyday words that point at one of the starter categories (only used when a category with
 * that exact name exists).
 */
const KEYWORDS: Record<string, string[]> = {
  'Dining Out': [
    'खाना',
    'खाजा',
    'चिया',
    'मम',
    'lunch',
    'dinner',
    'breakfast',
    'coffee',
    'tea',
    'momo',
    'snacks',
    'restaurant',
    'cafe',
    'khaja',
  ],
  'Food & Groceries': [
    'groceries',
    'grocery',
    'vegetables',
    'veggies',
    'fruits',
    'milk',
    'eggs',
    'तरकारी',
    'फलफूल',
    'दूध',
    'किराना',
  ],
  Transport: [
    'taxi',
    'bus',
    'pathao',
    'indrive',
    'fuel',
    'petrol',
    'diesel',
    'parking',
    'uber',
    'ट्याक्सी',
    'बस',
    'पेट्रोल',
  ],
  Shopping: ['clothes', 'shoes', 'shopping'],
  Utilities: ['electricity', 'water bill', 'gas', 'internet'],
  'Mobile & Data': ['recharge', 'topup', 'top-up', 'top up', 'data pack'],
  Rent: ['rent', 'भाडा'],
  Health: ['medicine', 'pharmacy', 'doctor', 'hospital', 'clinic', 'औषधि'],
  Education: ['tuition', 'school fees', 'books'],
  Entertainment: ['movie', 'cinema', 'concert'],
};

const LEADING = new RegExp(
  `^(?:(?:for|on|at|to|paid|spent|bought|the|a|an|and|of|in)${WORD_END}|[,;:.\\-–])\\s*`,
  'iu',
);
const TRAILING = new RegExp(
  `\\s*(?:${WORD_START}(?:for|on|at|to|paid|spent|the|a|and|of|in|via|with|by|from)|[,;:.\\-–])$`,
  'iu',
);

/** Collapses whitespace and trims filler words and punctuation from both ends. */
function tidy(s: string) {
  let out = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 8; i++) {
    const before = out;
    out = out.replace(LEADING, '').replace(TRAILING, '').trim();
    if (out === before) break;
  }
  return out;
}

export function parseQuickText(text: string, ctx: QuickTextContext): QuickTextResult {
  let rest = ` ${normalizeDigits(text).replace(/\s+/g, ' ').trim()} `;
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };

  // Dates first, so their digits aren't read as the amount.
  let date: IsoDate | null = null;
  const iso = take(/(\d{4}-\d{2}-\d{2})/);
  if (iso && isIsoDate(iso[1]!)) date = iso[1]!;
  if (!date) {
    const ago = take(new RegExp(`${WORD_START}(\\d{1,3})\\s+days?\\s+ago${WORD_END}`, 'iu'));
    if (ago) date = addDays(ctx.today, -Number(ago[1]));
  }
  if (
    !date &&
    take(new RegExp(`${WORD_START}(?:day\\s+before\\s+yesterday|asti|अस्ति)${WORD_END}`, 'iu'))
  )
    date = addDays(ctx.today, -2);
  if (!date && take(new RegExp(`${WORD_START}(?:yesterday|hijo|हिजो)${WORD_END}`, 'iu')))
    date = addDays(ctx.today, -1);
  if (!date && take(new RegExp(`${WORD_START}(?:today|aaja|aja|आज)${WORD_END}`, 'iu')))
    date = ctx.today;
  if (!date) {
    const names = WEEKDAYS.map((d) => `${d}|${d.slice(0, 3)}`).join('|');
    const wd = take(new RegExp(`${WORD_START}(?:(last)\\s+)?(${names})${WORD_END}`, 'iu'));
    if (wd) {
      const target = WEEKDAYS.findIndex((d) => d.startsWith(wd[2]!.toLowerCase().slice(0, 3)));
      let back = (dayOfWeek(ctx.today) - target + 7) % 7;
      if (back === 0 && wd[1]) back = 7;
      date = addDays(ctx.today, -back);
    }
  }

  // The amount.
  let amountMinor: number | null = null;
  let plus = false;
  const amount = take(AMOUNT_RE);
  if (amount) {
    const base = parseDecimal(amount[2]!.replace(/,/g, ''), ctx.digits);
    const multiplier = amount[3] ? (MULTIPLIERS[amount[3].toLowerCase()] ?? 1) : 1;
    if (base !== null && base > 0) amountMinor = base * multiplier;
    plus = !!amount[1];
  }

  // The account, with the word that introduced it ("via eSewa", "from Nabil Bank").
  let accountId: string | null = null;
  for (const a of [...ctx.accounts].sort((x, y) => y.name.length - x.name.length)) {
    if (!a.name.trim()) continue;
    const m = take(
      new RegExp(
        `(?:${WORD_START}(?:on|from|via|with|by|using|through|in|to|into|paid\\s+with)\\s+)?${phrase(a.name)}(?:\\s+(?:बाट|मा|ले)${WORD_END})?`,
        'iu',
      ),
    );
    if (m) {
      accountId = a.id;
      break;
    }
  }

  const direction = plus || INCOME_WORDS.test(rest) ? 'income' : 'expense';

  // A category by name, or by an everyday word that points at one.
  const ofKind = ctx.categories.filter((c) => c.kind === direction);
  let categoryId: string | null = null;
  for (const c of [...ofKind].sort((x, y) => y.name.length - x.name.length)) {
    const variants = [c.name, c.name.replace(/\s*&\s*/g, ' and ')];
    for (const v of variants) {
      if (take(new RegExp(phrase(v), 'iu'))) {
        categoryId = c.id;
        break;
      }
    }
    if (categoryId) break;
  }
  let keyword: string | null = null;
  if (!categoryId) {
    for (const [name, words] of Object.entries(KEYWORDS)) {
      const c = ofKind.find((x) => normalizePayeeName(x.name) === normalizePayeeName(name));
      if (!c) continue;
      const m = words.map((w) => new RegExp(phrase(w), 'iu').exec(rest)).find(Boolean);
      if (m) {
        categoryId = c.id;
        keyword = m[0];
        break;
      }
    }
  }

  // The payee: "at X", "to X", "from X"; otherwise whatever is left, unless it was just the
  // everyday word that picked the category (then it's a note).
  let payee: string | null = null;
  const stops = '(?=\\s+(?:on|via|with|by|using|for|in)\\s|\\s*[,;]|\\s*$)';
  const named = take(
    new RegExp(`${WORD_START}(?:at|to|from|paid\\s+to)\\s+([^,;]+?)${stops}`, 'iu'),
  );
  if (named) payee = cleanPayeeName(tidy(named[1]!)) || null;
  const leftover = tidy(rest);
  let notes: string | null = null;
  if (leftover) {
    const onlyKeyword =
      keyword !== null && normalizePayeeName(leftover) === normalizePayeeName(keyword);
    if (payee || onlyKeyword || INCOME_WORDS.test(` ${leftover} `)) notes = leftover;
    else payee = cleanPayeeName(leftover);
  }

  return { amountMinor, direction, date, accountId, categoryId, payee, notes };
}
