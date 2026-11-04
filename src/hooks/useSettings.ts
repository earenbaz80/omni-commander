import { useEffect, useState } from 'react';
import { FolderPasswordRecord, UserSettings } from '../types';
import { migrateThemeId } from '../services/themeManager';
import { readStored, writeStored, type StoredSpec } from '../services/storage';

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

const SETTINGS_KEY = 'nc_settings_v1';

type SavedSettings = Partial<UserSettings>;

const isSavedSettings = (value: unknown): value is SavedSettings =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The object this app boots from.
 *
 * Older builds wrote the same key without the envelope, and that object is still
 * valid today: it is read as version 0 and used as it stands. What changed
 * between versions lives inside the object -- a renamed theme, folder passwords
 * saved as plain strings -- and both are normalised below on every read, so the
 * migration never has to know which build wrote it.
 */
const SETTINGS_SPEC: StoredSpec<SavedSettings> = {
  fallback: {},
  validate: isSavedSettings,
  version: 2,
  migrate: (value) => (isSavedSettings(value) ? value : null),
};

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

    // The reader drops what cannot be used and migrates what it can, so this is
    // the only place that turns a saved object into live settings.
    const saved = readStored(SETTINGS_KEY, SETTINGS_SPEC);
    return {
      ...defaultSettings,
      ...saved,
      // Saved by an older build that named the theme differently.
      theme: migrateThemeId(saved.theme),
      protectedFolders: normalizeProtectedFolders(saved.protectedFolders),
    };
  });

  // Save settings on update
  useEffect(() => {
    writeStored(SETTINGS_KEY, settings, SETTINGS_SPEC.version ?? 1);
  }, [settings]);

  return { settings, setSettings };
}
