import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { themes } from '../services/themeManager';
import { setPlatformInfo, type PlatformInfo } from '../services/platform';
import { PanelTab } from '../types';

/**
 * The cleanup menu is one of the commands the row draws, and only the host's
 * adapter decides whether it belongs there: the Linux one declares no cleanup,
 * and the Windows temp folder and Prefetch are folders of a host this may not be.
 */
const tab = (): PanelTab => ({
  id: 'tab1',
  title: 'T',
  driveId: 'C:',
  currentPath: 'C:\\',
  history: [],
  historyIndex: 0,
  viewMode: 'full',
  sortField: 'name',
  sortDirection: 'asc',
  filterText: '',
  selectedIds: [],
  focusedIndex: 0,
});

const t = translations.es;

const baseProps = {
  currentTheme: themes.classic_blue,
  t,
  showToolbar: true,
  activePanel: 'right' as const,
  leftTab: tab(),
  rightTab: tab(),
  setLeftPanel: vi.fn(),
  setRightPanel: vi.fn(),
  setFsTick: vi.fn(),
  activeFocusedItem: null,
  setSelectedFileForModal: vi.fn(),
  setActiveModal: vi.fn(),
  onCleanup: vi.fn(),
  onNavigate: vi.fn(),
};

const { Toolbar } = await import('./Toolbar');

const windows: PlatformInfo = {
  platform: 'win32',
  caseSensitive: false,
  separator: '\\',
  capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
};

const linux: PlatformInfo = {
  platform: 'linux',
  caseSensitive: true,
  separator: '/',
  capabilities: { paths: true, volumes: true, cleanup: false, trash: true, openWith: false },
};

beforeEach(() => {
  localStorage.clear();
  setPlatformInfo(windows);
});

describe('Toolbar cleanup command', () => {
  it('is drawn on a host whose adapter implements cleanup', () => {
    render(<Toolbar {...baseProps} />);

    expect(screen.getByTitle(t.toolbarCleanup)).toBeDefined();
  });

  it('is not drawn at all where the adapter declares no cleanup', () => {
    setPlatformInfo(linux);

    render(<Toolbar {...baseProps} />);

    expect(screen.queryByTitle(t.toolbarCleanup)).toBeNull();
    // The rest of the row is untouched.
    expect(screen.getByTitle(t.toolbarNewFolder)).toBeDefined();
  });

  it('offers the user temp folder, the Windows temp folder and Prefetch on Windows', () => {
    render(<Toolbar {...baseProps} />);

    fireEvent.click(screen.getByTitle(t.toolbarCleanup));

    expect(screen.getByText(t.cleanupTargetUserTemp)).toBeDefined();
    expect(screen.getByText(t.cleanupTargetWindowsTemp)).toBeDefined();
    expect(screen.getByText(t.cleanupTargetPrefetch)).toBeDefined();
  });

  it('leaves the Windows-only folders out on a host that is not Windows', () => {
    // A POSIX adapter that did implement cleanup would still have no Prefetch.
    setPlatformInfo({ ...linux, capabilities: { ...linux.capabilities, cleanup: true } });

    render(<Toolbar {...baseProps} />);

    fireEvent.click(screen.getByTitle(t.toolbarCleanup));

    expect(screen.getByText(t.cleanupTargetUserTemp)).toBeDefined();
    expect(screen.queryByText(t.cleanupTargetWindowsTemp)).toBeNull();
    expect(screen.queryByText(t.cleanupTargetPrefetch)).toBeNull();
  });

  it('follows a capability that arrives after the row was drawn', () => {
    setPlatformInfo(linux);
    render(<Toolbar {...baseProps} />);
    expect(screen.queryByTitle(t.toolbarCleanup)).toBeNull();

    act(() => setPlatformInfo(windows));

    expect(screen.getByTitle(t.toolbarCleanup)).toBeDefined();
  });
});
