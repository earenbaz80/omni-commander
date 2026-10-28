import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import { buildShortcutGroups } from '../../services/shortcutGroups';
import type { UserSettings } from '../../types';

/**
 * Settings > Shortcuts documents this program and nothing else. It used to offer
 * three schemes named after other file managers, all of them describing the same
 * F-keys and none of them changing a single binding; what belongs there is the
 * list of keys Omni Commander really answers to, the same one the manual shows.
 */
const settings: UserSettings = {
  theme: 'classic_blue',
  language: 'es',
  showHiddenFiles: true,
  showSystemFiles: true,
  showToolbar: true,
  confirmDelete: true,
  confirmCopyOverwrite: true,
  retroDosBorders: true,
  soundEffects: false,
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
  authorName: 'tester',
  appLockEnabled: false,
  appUsername: 'admin',
  appPasswordHash: '',
  appPasswordSalt: '',
  protectedFolders: {},
  customShortcuts: {},
  useRecycleBin: true,
};

const t = translations.es;

const openShortcutsTab = () => {
  render(
    <SettingsModal
      theme={themes.classic_blue}
      lang="es"
      settings={settings}
      onUpdateSettings={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settingsTabKeybindings}$`) }));
};

describe('Settings > Shortcuts', () => {
  it('lists every shortcut this app answers to, grouped like the manual', () => {
    openShortcutsTab();

    const groups = buildShortcutGroups(t);
    for (const group of groups) expect(screen.getByText(group.title)).toBeDefined();
    for (const shortcut of groups.flatMap((group) => group.shortcuts)) {
      expect(screen.getByText(shortcut.desc)).toBeDefined();
    }

    const dialog = screen.getByRole('dialog');
    const keys = [...dialog.querySelectorAll('kbd')].map((kbd) => kbd.textContent);
    expect(keys).toEqual(groups.flatMap((group) => group.shortcuts.map((shortcut) => shortcut.key)));
  });

  it('mentions no other file manager', () => {
    openShortcutsTab();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toMatch(/norton|total commander|midnight commander/i);
    // The tab is titled after this program, not after a preset to import.
    expect(screen.getByText(t.settingsKeybindings)).toBeDefined();
  });
});
