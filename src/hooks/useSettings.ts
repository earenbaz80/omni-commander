import { useEffect, useState } from 'react';
import { UserSettings } from '../types';

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
      authorName: 'earenbaz020880@gmail.com',
      appLockEnabled: false,
      appUsername: 'admin',
      appPasswordHash: 'admin123',
      appPasswordSalt: '',
      protectedFolders: {},
      customShortcuts: {},
      keybindingPreset: 'norton',
      useRecycleBin: true
    };

    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nc_settings_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            ...defaultSettings,
            ...parsed,
            protectedFolders: parsed?.protectedFolders || {}
          };
        }
      } catch { /* ignore */ }
    }
    return defaultSettings;
  });

  // Save settings on update
  useEffect(() => {
    try {
      localStorage.setItem('nc_settings_v1', JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [settings]);

  return { settings, setSettings };
}
