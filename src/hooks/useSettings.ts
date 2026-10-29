import { useEffect, useState } from 'react';
import { FolderPasswordRecord, UserSettings } from '../types';
import { migrateThemeId } from '../services/themeManager';

/**
 * Reads the saved folder protections into the shape the app verifies against.
 *
 * Older builds stored the password exactly as typed, so a saved string becomes a
 * record with an empty salt: it still opens its folder, because a saltless value
 * is verified as the plaintext it is, and the first successful unlock replaces it
 * with a derived one. Anything that is neither a record nor a string is dropped
 * rather than half-trusted.
 */
export function normalizeProtectedFolders(saved: unknown): Record<string, FolderPasswordRecord> {
  if (!saved || typeof saved !== 'object') return {};
  const records: Record<string, FolderPasswordRecord> = {};
  for (const [folderPath, value] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (value) records[folderPath] = { salt: '', hash: value };
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const record = value as { salt?: unknown; hash?: unknown };
    if (typeof record.hash !== 'string' || !record.hash) continue;
    records[folderPath] = { salt: typeof record.salt === 'string' ? record.salt : '', hash: record.hash };
  }
  return records;
}

/**
 * Global system settings: loads from localStorage on first render and persists
 * on every change. Extracted from App to keep the component focused.
 */
export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const defaultSettings: UserSettings = {
      theme: 'classic_blue',
      language: 'es',
      showHiddenFiles: true,
      showSystemFiles: true,
      showToolbar: true,
      menuBarHoverOpen: false,
      confirmDelete: true,
      confirmCopyOverwrite: true,
      retroDosBorders: true,
      soundEffects: true,
      fontSize: 'normal',
      fontFamily: 'mono',
      splitLayout: 'horizontal',
      dualPaneRatio: 50,
      quickPreviewAutoPlay: true,
      showCommandLine: true,
      showFunctionBar: true,
      showDriveButtons: true,
      showHoverTooltips: true,
      showImageHoverThumbnails: true,
      showCollapsibleInfoDrawer: true,
      showClock: true,
      clockPosition: 'header',
      crtEffectEnabled: true,
      crtIntensity: 'subtle',
      blinkingCursorEnabled: true,
      cursorBlinkColor: 'cyan',
      fileSelectorColor: 'blue',
      authorName: 'Edel Arencibia Baez',
      appLockEnabled: false,
      appUsername: 'admin',
      appPasswordHash: '',
      appPasswordSalt: '',
      protectedFolders: {},
      customShortcuts: {},
      useRecycleBin: true,
    };

    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nc_settings_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            ...defaultSettings,
            ...parsed,
            // Saved by an older build that named the theme differently.
            theme: migrateThemeId(parsed?.theme),
            protectedFolders: normalizeProtectedFolders(parsed?.protectedFolders),
          };
        }
      } catch {
        /* ignore */
      }
    }
    return defaultSettings;
  });

  // Save settings on update
  useEffect(() => {
    try {
      localStorage.setItem('nc_settings_v1', JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  return { settings, setSettings };
}
