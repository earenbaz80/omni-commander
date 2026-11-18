import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { themes } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import type { UserSettings } from '../../types';

const t = getTranslations('es');

const settings: UserSettings = {
  theme: 'classic_blue',
  language: 'es',
  showHiddenFiles: true,
  showSystemFiles: true,
  showToolbar: true,
  menuBarHoverOpen: false,
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
  customFolderColor: '',
  customTextColor: '',
  customSelectorColor: '',
  authorName: 'tester',
  appLockEnabled: false,
  appUsername: 'admin',
  appPasswordHash: '',
  appPasswordSalt: '',
  protectedFolders: {},
  customShortcuts: {},
  useRecycleBin: true,
};

interface UpdateSnapshot {
  status: string;
  version: string | null;
  percent: number;
  error: string | null;
  enabled: boolean;
  channel: string;
}

/**
 * The card was where a manual check happened, and finding an update there did
 * nothing but print its version: the only way to install was the header chip,
 * which the user had just walked away from. These tests pin the two clicks the
 * card owes whoever asked it.
 */
function openUpdatesTab(snapshot: UpdateSnapshot) {
  const downloadUpdate = vi.fn(async () => snapshot);
  const installUpdate = vi.fn(async () => snapshot);
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    getUpdateState: async () => snapshot,
    checkForUpdates: async () => snapshot,
    downloadUpdate,
    installUpdate,
    onUpdateState: () => () => {},
  };
  render(
    <SettingsModal
      theme={themes.classic_blue}
      lang="es"
      settings={settings}
      onUpdateSettings={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t.settingsTabSecurity }));
  return { downloadUpdate, installUpdate };
}

const snapshot = (patch: Partial<UpdateSnapshot>): UpdateSnapshot => ({
  status: 'idle',
  version: null,
  percent: 0,
  error: null,
  enabled: true,
  channel: 'stable',
  ...patch,
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('updates card actions', () => {
  it('downloads the update it just found, without leaving the card', async () => {
    const { downloadUpdate } = openUpdatesTab(snapshot({ status: 'available', version: '9.9.9' }));

    expect(await screen.findByText(t.updateAvailable.replace('{version}', '9.9.9'))).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: t.updateDownload }));

    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledTimes(1));
    // The restart belongs to the download finishing, not to this click.
    expect(screen.queryByRole('button', { name: t.updateInstall })).toBeNull();
  });

  it('keeps the restart and says why the check after it failed', async () => {
    openUpdatesTab(snapshot({ status: 'downloaded', version: '9.9.9', error: 'net::ERR_INTERNET_DISCONNECTED' }));

    // A check that fails while the installer waits leaves the restart in place;
    // dropping its reason would make the card look like nothing went wrong.
    expect(await screen.findByText(t.updateReadyToInstall)).toBeTruthy();
    expect(await screen.findByText(/net::ERR_INTERNET_DISCONNECTED/)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.updateInstall })).toBeTruthy();
  });

  it('installs a download that already finished, from the same card', async () => {
    const { installUpdate } = openUpdatesTab(snapshot({ status: 'downloaded', version: '9.9.9' }));

    // The button alone says what happens on a click, not what state the download is
    // in: a card that only offered it read as if the transfer had not finished.
    expect(await screen.findByText(t.updateReadyToInstall)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: t.updateInstall }));

    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: t.updateDownload })).toBeNull();
  });
});
