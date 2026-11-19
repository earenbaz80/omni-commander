import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserSettings } from '../../types';
import { getTranslations } from '../../i18n/translations';
import { themes } from '../../services/themeManager';
import { setPlatformInfo, type PlatformInfo } from '../../services/platform';
import { SettingsModal } from './SettingsModal';

/**
 * "Move deleted files to the recycle bin" is a switch over what the host
 * implements. Where the adapter declares no trash the switch would save a
 * setting the server ignores, so it is not offered there.
 */
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

const withTrash: PlatformInfo = {
  platform: 'win32',
  caseSensitive: false,
  separator: '\\',
  capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
};

const withoutTrash: PlatformInfo = {
  platform: 'linux',
  caseSensitive: true,
  separator: '/',
  capabilities: { paths: true, volumes: true, cleanup: false, trash: false, openWith: false },
};

afterEach(() => setPlatformInfo(withTrash));

/** Opens the Files tab, which is the one that holds the delete settings. */
const openFilesTab = async () => {
  const user = userEvent.setup();
  render(
    <SettingsModal
      theme={themes.classic_blue}
      lang="en"
      settings={settings}
      onUpdateSettings={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: t.settingsTabBehavior }));
};

describe('SettingsModal recycle bin switch', () => {
  it('is offered where the adapter implements a trash', async () => {
    setPlatformInfo(withTrash);

    await openFilesTab();

    expect(screen.getByText(t.settingsUseRecycleBin)).toBeDefined();
  });

  it('is not offered where the adapter declares none', async () => {
    setPlatformInfo(withoutTrash);

    await openFilesTab();

    expect(screen.queryByText(t.settingsUseRecycleBin)).toBeNull();
    // The tab still rendered its other file settings, so the switch is what
    // went missing and not the page.
    expect(screen.getByText(t.settingsShowSystem)).toBeDefined();
  });
});
