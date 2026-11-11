import { describe, expect, it } from 'vitest';
import { migrateThemeId, themes } from './themeManager';

/**
 * Settings live in localStorage across upgrades, so a stored theme name can be
 * one this build no longer defines. Migration is what keeps the user's choice:
 * the old names map to the palette they always rendered, and anything unusable
 * falls back to the default theme instead of leaving the menu with no selection.
 */
describe('theme folder colour', () => {
  it('gives every theme a folder glyph colour of its own', () => {
    for (const [id, theme] of Object.entries(themes)) {
      expect(theme.folderText, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // A single shared amber would be the old hardcoded hue again.
    expect(new Set(Object.values(themes).map((theme) => theme.folderText)).size).toBeGreaterThan(1);
  });
});

describe('migrateThemeId', () => {
  it('maps the retired classic and retro names to their current ids', () => {
    expect(migrateThemeId('norton_classic')).toBe('classic_blue');
    expect(migrateThemeId('total_commander')).toBe('retro_gray');
  });

  it('leaves a current theme id alone', () => {
    for (const id of Object.keys(themes)) {
      expect(migrateThemeId(id)).toBe(id);
    }
  });

  it('falls back to the default theme for a value it cannot use', () => {
    expect(migrateThemeId('some_theme_from_a_future_build')).toBe('classic_blue');
    expect(migrateThemeId(undefined)).toBe('classic_blue');
    expect(migrateThemeId(null)).toBe('classic_blue');
    expect(migrateThemeId(42)).toBe('classic_blue');
  });
});
