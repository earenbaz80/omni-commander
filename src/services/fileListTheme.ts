import type { UserSettings } from '../types';
import { darken } from '../utils/contrast';
import type { ThemeConfig } from './themeManager';

/**
 * The cursor and selection colours the "file selector colour" setting offers.
 * The theme does not own these: the setting does, and the theme only supplies
 * the rest of the row.
 */
export const FILE_SELECTOR_PALETTE: Record<string, { cursor: string; selected: string }> = {
  blue: { cursor: '#00ffff', selected: '#0000aa' },
  amber: { cursor: '#f59e0b', selected: '#b45309' },
  cyan: { cursor: '#06b6d4', selected: '#155e75' },
  green: { cursor: '#22c55e', selected: '#14532d' },
  red: { cursor: '#ef4444', selected: '#7f1d1d' },
  purple: { cursor: '#a855f7', selected: '#581c87' },
};

export type FileListColourSettings = Pick<
  UserSettings,
  'customFolderColor' | 'customTextColor' | 'customSelectorColor' | 'fileSelectorColor'
>;

/**
 * The theme the file list actually paints with: the selected theme plus the
 * three colours the user can override on its own. An empty override leaves the
 * theme in charge, so switching themes never has to clear anything.
 *
 * The text override covers every text role the list can print (names,
 * directories, executables, archives, documents, media) because a user picking
 * one colour expects one colour, not the labels changing hue by file type.
 */
export function buildFileListTheme(theme: ThemeConfig, settings: FileListColourSettings): ThemeConfig {
  const palette = FILE_SELECTOR_PALETTE[settings.fileSelectorColor || 'blue'] ?? FILE_SELECTOR_PALETTE.blue;
  return {
    ...theme,
    folderText: settings.customFolderColor || theme.folderText,
    cursorBg: settings.customSelectorColor || palette.cursor,
    selectedBg: settings.customSelectorColor ? darken(settings.customSelectorColor, 0.45) : palette.selected,
    ...(settings.customTextColor
      ? {
          itemText: settings.customTextColor,
          dirText: settings.customTextColor,
          exeText: settings.customTextColor,
          zipText: settings.customTextColor,
          docText: settings.customTextColor,
          mediaText: settings.customTextColor,
        }
      : {}),
  };
}
