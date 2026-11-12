// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { darken, relativeLuminance } from '../utils/contrast';
import { buildFileListTheme, FILE_SELECTOR_PALETTE } from './fileListTheme';
import { themes } from './themeManager';

/** Nothing overridden: every colour still comes from the theme and palette. */
const untouched = {
  customFolderColor: '',
  customTextColor: '',
  customSelectorColor: '',
  fileSelectorColor: 'blue',
} as const;

describe('buildFileListTheme', () => {
  it('applies the folder, text and selector overrides over Matrix', () => {
    const matrix = themes.matrix_green;
    const built = buildFileListTheme(matrix, {
      ...untouched,
      customFolderColor: '#ff00ff',
      customTextColor: '#00ffff',
      customSelectorColor: '#ff0000',
    });

    expect(built.folderText).toBe('#ff00ff');
    // One text colour means one text colour: every role the list prints follows.
    for (const role of ['itemText', 'dirText', 'exeText', 'zipText', 'docText', 'mediaText'] as const) {
      expect(built[role]).toBe('#00ffff');
    }
    expect(built.cursorBg).toBe('#ff0000');
    // The selection stays distinguishable from the cursor painted on it.
    expect(built.selectedBg).toBe('#8c0000');
    // The rest of Matrix is untouched.
    expect(built.bgPanel).toBe(matrix.bgPanel);
    expect(built.accent).toBe(matrix.accent);
    expect(built.itemText).not.toBe(matrix.itemText);
  });

  it('leaves Matrix to its own colours when nothing is overridden', () => {
    const matrix = themes.matrix_green;
    const built = buildFileListTheme(matrix, { ...untouched, fileSelectorColor: 'cyan' });

    // Matrix sets no folder colour, so the icon falls back to its accent.
    expect(built.folderText).toBeUndefined();
    expect(built.itemText).toBe(matrix.itemText);
    expect(built.dirText).toBe(matrix.dirText);
    expect(built.cursorBg).toBe('#06b6d4');
    expect(built.selectedBg).toBe('#155e75');
  });

  it('darkens the selection under a custom selector colour', () => {
    const matrix = themes.matrix_green;

    for (const colour of ['#ff0000', '#00ff00', '#a855f7', '#0000ff']) {
      const built = buildFileListTheme(matrix, { ...untouched, customSelectorColor: colour });

      expect(built.cursorBg).toBe(colour);
      // The row behind the cursor keeps the chosen hue but darker, so the
      // cursor still stands out without inventing a second colour.
      expect(built.selectedBg).toBe(darken(colour, 0.45));
      expect(built.selectedBg).not.toBe(FILE_SELECTOR_PALETTE.blue.selected);
      expect(relativeLuminance(built.selectedBg)).toBeLessThan(relativeLuminance(colour));
    }
  });

  it('keeps the classic yellow and never mutates the theme it was given', () => {
    const classic = themes.classic_blue;
    const built = buildFileListTheme(classic, untouched);

    expect(built.folderText).toBe('#ffd700');
    expect(built).not.toBe(classic);
    expect(classic.folderText).toBe('#ffd700');
  });
});
