import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import type { UserSettings } from '../../types';
import { MODAL_FOCUSABLE_SELECTOR } from '../../hooks/useModalDialog';

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

describe('SettingsModal accessibility', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is exposed as a labelled modal dialog', () => {
    render(
      <SettingsModal
        theme={themes.classic_blue}
        lang="es"
        settings={settings}
        onUpdateSettings={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(translations.es.settingsTitle);
  });

  it('keeps Tab focus inside the dialog', () => {
    render(
      <SettingsModal
        theme={themes.classic_blue}
        lang="es"
        settings={settings}
        onUpdateSettings={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    // Same selector the trap walks: a window is also moved and sized from its
    // title bar and its corner, and those are tab stops of the ring too.
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
    expect(focusables.length).toBeGreaterThan(2);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('gives the close control an accessible name', () => {
    render(
      <SettingsModal
        theme={themes.classic_blue}
        lang="es"
        settings={settings}
        onUpdateSettings={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Header close button (X icon) has aria-label="Cancelar"
    const closeButtons = screen.getAllByRole('button', { name: 'Cancelar' });
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);
    // The first one is the header X button
    expect(closeButtons[0]).toBeTruthy();
  });
});
