import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../i18n/translations';
import { themes } from '../services/themeManager';
import { PanelTab } from '../types';

/**
 * The toolbar can be switched off, but the shortcut for the Run line has to keep
 * reaching it. The compromise under test is the one-line row: only the launcher,
 * only while it is in use, and closable from itself, so the toolbar setting is
 * never changed behind the user.
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

beforeEach(() => {
  localStorage.clear();
});

describe('Toolbar launcher with the toolbar switched off', () => {
  it('renders nothing at all when the shortcut has not asked for the line', () => {
    render(<Toolbar {...baseProps} showToolbar={false} />);

    expect(screen.queryByLabelText(t.runPlaceholder)).toBeNull();
  });

  it('renders only the Run line when the shortcut asks for it', () => {
    render(<Toolbar {...baseProps} showToolbar={false} launcherOnly onLauncherDismiss={vi.fn()} />);

    expect(screen.getByLabelText(t.runPlaceholder)).toBeDefined();
    expect(screen.getByRole('button', { name: t.runDismiss })).toBeDefined();
    // The rest of the row is still off: this is not the toolbar coming back.
    expect(screen.queryByTitle(t.toolbarNewFolder)).toBeNull();
    expect(screen.queryByTitle(t.toolbarSearch)).toBeNull();
  });

  it('closes that row from its own button', () => {
    const onLauncherDismiss = vi.fn();
    render(<Toolbar {...baseProps} showToolbar={false} launcherOnly onLauncherDismiss={onLauncherDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: t.runDismiss }));

    expect(onLauncherDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the line inside the full row, with nothing to close', () => {
    render(<Toolbar {...baseProps} showToolbar onLauncherDismiss={vi.fn()} />);

    expect(screen.getByLabelText(t.runPlaceholder)).toBeDefined();
    expect(screen.queryByRole('button', { name: t.runDismiss })).toBeNull();
    expect(screen.getByTitle(t.toolbarNewFolder)).toBeDefined();
  });
});
