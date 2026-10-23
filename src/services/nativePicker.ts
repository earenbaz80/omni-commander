import { LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';

export type PickMode = 'files' | 'folders';

interface ElectronPickerBridge {
  pickPaths?: (mode: PickMode, title?: string) => Promise<string[]>;
}

function pickerBridge(): ElectronPickerBridge | undefined {
  return (window as unknown as { electronAPI?: ElectronPickerBridge }).electronAPI;
}

/** The native dialog only exists in the Electron shell, never in a browser build. */
export function canPickPaths(): boolean {
  return typeof pickerBridge()?.pickPaths === 'function';
}

/**
 * Opens the native picker and returns absolute paths.
 *
 * Everything that is not a usable path is dropped here, and any failure looks
 * the same as a cancelled dialog: the list stays as it was, which is the only
 * outcome the caller can act on anyway.
 */
export async function pickPathsFromDisk(mode: PickMode, lang: LanguageCode): Promise<string[]> {
  const bridge = pickerBridge();
  if (typeof bridge?.pickPaths !== 'function') return [];

  const t = getTranslations(lang);
  const title = mode === 'folders' ? t.transferAddDialogFolder : t.transferAddDialogFile;

  try {
    const picked = await bridge.pickPaths(mode, title);
    if (!Array.isArray(picked)) return [];
    return picked.filter(path => typeof path === 'string' && path.trim().length > 0);
  } catch {
    return [];
  }
}
