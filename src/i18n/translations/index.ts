import { LanguageCode } from '../../types';
import { es } from './es';
import { en } from './en';
import { de } from './de';
import { fr } from './fr';
import { pt } from './pt';
import { it } from './it';
import { ru } from './ru';
import { ja } from './ja';

export const translations = {
  es,
  en,
  de,
  fr,
  pt,
  it,
  ru,
  ja,
} as const;

export type TranslationKey = keyof (typeof translations)['en'];

/**
 * Translation table for a language with per-key fallback to English, so a key
 * that only exists in some languages never renders as blank.
 */
export function getTranslations(lang: LanguageCode): Record<TranslationKey, string> {
  return { ...(translations.en as Record<TranslationKey, string>), ...(translations[lang] as Record<TranslationKey, string>) };
}

/**
 * Module-level language store for code that runs outside the React tree
 * (services, hooks and helpers that have no access to the `lang` prop).
 * App.tsx keeps this in sync via setCurrentLang whenever the setting changes.
 */
let __currentLang: LanguageCode = 'es';

export function setCurrentLang(lang: LanguageCode): void {
  __currentLang = lang;
}

export function getCurrentLang(): LanguageCode {
  return __currentLang;
}

/** Translate a key outside React, falling back to Spanish, then to the key itself. */
export function tGlobal(key: TranslationKey): string {
  const dict = (translations[__currentLang] || translations.es) as Record<TranslationKey, string>;
  return dict[key] ?? translations.es[key] ?? key;
}