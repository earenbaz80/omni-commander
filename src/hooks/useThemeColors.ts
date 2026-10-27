import { useMemo } from 'react';
import { ThemeId } from '../types';
import { ThemeConfig, themes } from '../services/themeManager';

/**
 * Extracts semantic color values from a ThemeConfig for use in previews, etc.
 */
export function themeConfigToColors(theme: ThemeConfig) {
  return {
    bg: theme.bgApp,
    panel: theme.bgPanel,
    accent: theme.accent,
    accentWarn: theme.accentWarn,
    accentDanger: theme.accentDanger,
    accentOk: theme.accentOk,
    text: theme.itemText,
    border: theme.borderPanel,
    headerBg: theme.headerBg,
    headerText: theme.headerText,
    modalBg: theme.modalBg,
    modalBorder: theme.modalBorder,
    modalHeaderBg: theme.modalHeaderBg,
    modalHeaderText: theme.modalHeaderText,
  } as const;
}

/**
 * Hook to get the color palette for a given theme ID.
 * Uses the exported themes record so it always reflects the current theme definitions.
 */
export function useThemeColors(themeId: ThemeId) {
  return useMemo(() => {
    const theme = themes[themeId];
    return themeConfigToColors(theme);
  }, [themeId]);
}
