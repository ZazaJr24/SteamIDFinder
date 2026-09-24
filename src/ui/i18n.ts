import en from '../../data/lang/en.json';
import de from '../../data/lang/de.json';
import type { Language } from '../core/settings';

export type TranslationKey = keyof typeof en;

const TABLES: Record<Language, Record<string, string>> = { en, de };

let current: Language = 'en';

export function setLanguage(lang: Language): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLanguage(): Language {
  return current;
}

/** Translates a key; `{name}` placeholders are filled from `vars`. English is the fallback. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  let text = TABLES[current][key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars))
      text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}
