import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { translations } from './i18n/translations';
import type { UserSettings } from './types';

/**
 * Enabling the app lock in Settings must take effect right away, not on the next
 * launch. `AppModals` is mocked only to capture the `setSettings` dispatcher App
 * hands down, so the test performs the exact state update the Settings modal does
 * on save without driving its whole form. `PanelView` is mocked for the same
 * reason as in App.test.tsx: the lock contract does not depend on the panes.
 */

let capturedSetSettings: React.Dispatch<React.SetStateAction<UserSettings>> | null = null;

vi.mock('./components/AppModals', () => ({
  AppModals: (props: { setSettings: React.Dispatch<React.SetStateAction<UserSettings>> }) => {
    capturedSetSettings = props.setSettings;
    return React.createElement('div', { 'data-testid': 'app-modals' });
  },
}));

vi.mock('./components/PanelView', () => ({
  PanelView: (props: { side: string }) => React.createElement('div', { 'data-testid': `panel-${props.side}` }),
}));

vi.mock('./services/soundEffects', () => ({
  soundManager: {
    playSuccess: vi.fn(),
    playDiskAccess: vi.fn(),
    playKeyTick: vi.fn(),
    playBeep: vi.fn(),
    playSelectSound: vi.fn(),
    playError: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
  },
}));

import App from './App';

// jsdom does not implement matchMedia; usePWAInstall calls it during render.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const baseSettings: UserSettings = {
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

function seedSettings(overrides: Partial<UserSettings>) {
  localStorage.setItem('nc_settings_v1', JSON.stringify({ ...baseSettings, ...overrides }));
}

function updateSettings(overrides: Partial<UserSettings>) {
  return act(async () => {
    capturedSetSettings!((prev) => ({ ...prev, ...overrides }));
  });
}

const unlockButton = () => screen.queryByText(translations.es.lockUnlockBtn);

describe('App lock activation from Settings', () => {
  beforeEach(() => {
    localStorage.clear();
    capturedSetSettings = null;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('locks the app as soon as the settings enable the lock', async () => {
    seedSettings({ appLockEnabled: false, appPasswordHash: 'hash', appPasswordSalt: 'salt' });
    render(<App />);

    // Stored but disabled: the session starts unlocked.
    expect(unlockButton()).toBeNull();

    await updateSettings({ appLockEnabled: true });

    expect(await screen.findByText(translations.es.lockUnlockBtn)).toBeTruthy();
  });

  it('does not lock when the lock is enabled with no stored password', async () => {
    seedSettings({ appLockEnabled: false, appPasswordHash: '', appPasswordSalt: '' });
    render(<App />);

    await updateSettings({ appLockEnabled: true });

    // Fail closed the other way too: a lock with nothing to verify against would
    // be unopenable, so it must stay disengaged.
    expect(unlockButton()).toBeNull();
  });

  it('stays unlocked while the lock remains disabled', async () => {
    seedSettings({ appLockEnabled: false, appPasswordHash: 'hash', appPasswordSalt: 'salt' });
    render(<App />);

    await updateSettings({ crtEffectEnabled: false });

    expect(unlockButton()).toBeNull();
  });
});
