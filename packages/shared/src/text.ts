const COMPANY_SUFFIXES =
  /\b(pvt\.?|p\.?|private|public)?\s*(ltd\.?|limited|inc\.?|llc|co\.?|corp\.?|company)\s*$/i;

/** Tidies a payee name for display: trims and collapses whitespace. */
export function cleanPayeeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Key used to recognise the same payee written differently:
 * "Bhat-Bhateni Supermarket Pvt. Ltd." and "bhat bhateni supermarket" → "bhat bhateni supermarket".
 */
export function normalizePayeeName(name: string): string {
  let s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Keep combining marks (\p{M}): Devanagari vowel signs are marks, not letters.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip company suffixes, possibly repeated ("pvt ltd").
  for (let i = 0; i < 2; i++) s = s.replace(COMPANY_SUFFIXES, '').trim();
  return s;
}

function tokens(name: string): Set<string> {
  return new Set(normalizePayeeName(name).split(' ').filter(Boolean));
}

/** Jaccard similarity of the words in two payee names, 0–1. */
export function payeeSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

const DESCRIPTION_NOISE = [
  /\b(pos|ecom|atm|nfc|upi|ips|connectips|fonepay|qr|imps|neft|rtgs|ft|trf|txn|ref|chq|cheque)\b[:/#-]*/gi,
  /\b(purchase|payment|paid|transfer(red)?|to|from|by|at|via|for)\b/gi,
  /[#*:/\\|_]+/g,
  /\b[a-z]*\d[a-z\d-]{3,}\b/gi, // reference numbers, card fragments
  /\b\d+\b/g,
];

/**
 * Best guess at a payee from a bank statement narration, used when the statement has no
 * separate payee column: "POS/BHAT BHATENI SUPERMARKET/KTM/12345" → "Bhat Bhateni Supermarket KTM".
 */
export function guessPayeeFromDescription(description: string): string {
  let s = description;
  for (const re of DESCRIPTION_NOISE) s = s.replace(re, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const words = s.split(' ').slice(0, 5);
  return words
    .map((w) =>
      w.length <= 3 && w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ');
}

/**
 * A short, distinctive word from a bank narration for a "description contains …" rule:
 * "FONEPAY/QR/PATHAO RIDE KTM" → "pathao", "NTC TOPUP 98XXXXXXXX" → "ntc topup".
 */
export function descriptionKeyword(description: string): string {
  const words = guessPayeeFromDescription(description).toLowerCase().split(' ').filter(Boolean);
  if (words.length === 0) return description.trim().toLowerCase().slice(0, 40);
  return (words[0]!.length >= 4 ? words[0]! : words.slice(0, 2).join(' ')).slice(0, 40);
}
