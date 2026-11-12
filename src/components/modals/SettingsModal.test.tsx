import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UserSettings } from '../../types';
import { getTranslations } from '../../i18n/translations';
import { themes } from '../../services/themeManager';
import { SettingsModal } from './SettingsModal';

const t = getTranslations('en');

const settings: UserSettings = {
  theme: 'classic_blue',
  language: 'en',
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
  customFolderColor: '',
  customTextColor: '',
  customSelectorColor: '',
  authorName: '',
  appLockEnabled: false,
  appUsername: 'admin',
  appPasswordHash: '',
  appPasswordSalt: '',
  protectedFolders: {},
  customShortcuts: {},
  useRecycleBin: true,
};

/**
 * Every control that picks a colour lives on the theme tab, next to the theme
 * supplying its default; the appearance tab keeps the toggles. The pickers once
 * sat apart from the theme they refer to, and a later edit could move them back
 * without any type or lint error, which is what these tests are here to catch.
 */
function setup() {
  const user = userEvent.setup();
  const onUpdateSettings = vi.fn();
  const onClose = vi.fn();
  const { container } = render(
    <SettingsModal
      theme={themes.classic_blue}
      lang="en"
      settings={settings}
      onUpdateSettings={onUpdateSettings}
      onClose={onClose}
    />,
  );

  const pickers = () => [...container.querySelectorAll<HTMLInputElement>('input[type="color"]')];
  // The six-swatch dropdown is the file selector colour; the theme tab is the
  // only place that offers purple for it.
  const selectorSelect = () =>
    [...container.querySelectorAll('select')].find((select) => select.querySelector('option[value="purple"]'));

  return { user, pickers, selectorSelect, onUpdateSettings, onClose };
}

describe('SettingsModal colour controls', () => {
  it('shows the folder, text and selector pickers on the theme tab', () => {
    const { pickers } = setup();

    expect(pickers()).toHaveLength(3);
    const labels = pickers().map((input) => input.closest('label')?.textContent ?? '');
    expect(labels[0]).toContain(t.settingsFolderColor);
    expect(labels[1]).toContain(t.settingsTextColor);
    expect(labels[2]).toContain(t.settingsSelectorColorCustom);
    // The classic theme keeps the DOS yellow as its default folder colour.
    expect(pickers()[0].value).toBe('#ffd700');
  });

  it('shows the file selector dropdown on the theme tab', () => {
    const { selectorSelect } = setup();

    expect(selectorSelect()).toBeDefined();
    expect(selectorSelect()?.value).toBe('blue');
  });

  it('closes the dialog once the settings are saved', async () => {
    const { user, onUpdateSettings, onClose } = setup();

    await user.click(screen.getByRole('button', { name: t.btnSave }));

    expect(onUpdateSettings).toHaveBeenCalledTimes(1);
    // A save that leaves the dialog open looks like it did nothing, and the
    // remaining way out is "Cancel", which reads as undoing it.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves every colour control off the appearance tab', async () => {
    const { user, pickers, selectorSelect } = setup();

    await user.click(screen.getByRole('button', { name: t.settingsTabAppearance }));

    expect(pickers()).toHaveLength(0);
    expect(selectorSelect()).toBeUndefined();

    // Back on the theme tab they are all there again, so the assertion above
    // checked the tab rather than a modal that failed to render.
    await user.click(screen.getByRole('button', { name: t.settingsTabTheme }));

    expect(pickers()).toHaveLength(3);
    expect(selectorSelect()).toBeDefined();
  });
});
