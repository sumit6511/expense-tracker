import { type Locale, toDevanagariDigits } from '@et/shared';
import { type ReactNode, useCallback } from 'react';
import { NE } from './locales/ne';
import { useOptionalSession } from './session';

/**
 * Translations. The English text is the key, so untranslated text simply stays English:
 * t('Budgets') → "बजेट" in Nepali. Placeholders: t('{count} to review', { count: 3 }); numbers
 * in placeholders are written in Devanagari digits in Nepali.
 */
export type Vars = Record<string, string | number>;

export function translate(locale: Locale, text: string, vars?: Vars): string {
  const template = locale === 'ne' ? (NE[text] ?? text) : text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return locale === 'ne' && typeof value === 'number' ? toDevanagariDigits(value) : String(value);
  });
}

export type Translate = (text: string, vars?: Vars) => string;

/** `t()` in the signed-in person's language (English before anyone signs in). */
export function useT(): Translate {
  const locale = useOptionalSession()?.me.user.locale ?? 'en';
  return useCallback((text: string, vars?: Vars) => translate(locale, text, vars), [locale]);
}

/** Translates a label if it's plain text; anything else is left as it is. */
export function useTr() {
  const t = useT();
  return (node: ReactNode) => (typeof node === 'string' ? t(node) : node);
}
