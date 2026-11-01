// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { translations, getTranslations } from './translations';

/**
 * The English table is the reference. Every other language must define exactly
 * the same key set, never an empty value, so no language renders blank text.
 */
const reference = Object.keys(translations.en).sort();
const languages = Object.keys(translations) as Array<keyof typeof translations>;

describe('i18n translations', () => {
  it('uses English as a non-empty reference table', () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  it('every language defines exactly the same keys as English', () => {
    const mismatches: Record<string, string[]> = {};
    for (const lang of languages) {
      const keys = Object.keys(translations[lang]).sort();
      const missing = reference.filter((k) => !keys.includes(k)).map((k) => `-${k}`);
      const extra = keys.filter((k) => !reference.includes(k)).map((k) => `+${k}`);
      if (missing.length || extra.length) mismatches[lang] = [...missing, ...extra];
    }
    expect(mismatches).toEqual({});
  });

  it('has no empty or whitespace-only value in any language', () => {
    const empties: string[] = [];
    for (const lang of languages) {
      for (const [key, value] of Object.entries(translations[lang])) {
        if (value.trim() === '') empties.push(`${lang}.${key}`);
      }
    }
    expect(empties).toEqual([]);
  });

  it('getTranslations returns every English key for each language', () => {
    for (const lang of languages) {
      const merged = getTranslations(lang);
      for (const key of reference as (keyof typeof merged)[]) {
        expect(merged[key]).toBeTypeOf('string');
        expect(merged[key].length).toBeGreaterThan(0);
      }
    }
  });

  it('getTranslations merges English with the language, the language winning on conflicts', () => {
    for (const lang of languages) {
      expect(getTranslations(lang)).toEqual({ ...translations.en, ...translations[lang] });
    }
    // A key translated in a non-English language overrides the English value.
    expect(getTranslations('de').fullscreenMode).toBe(translations.de.fullscreenMode);
    expect(getTranslations('de').fullscreenMode).not.toBe(translations.en.fullscreenMode);
  });
});
