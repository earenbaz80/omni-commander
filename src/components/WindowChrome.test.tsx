import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowChrome, type WindowChromeProps } from './WindowChrome';
import type { PanelState, PanelTab, UserSettings, FileItem } from '../types';
import type { ThemeConfig } from '../services/themeManager';

const captured: { menu: Record<string, unknown> | null; toolbar: Record<string, unknown> | null } = {
  menu: null,
  toolbar: null,
};

vi.mock('./HeaderMenuBar', () => ({
  HeaderMenuBar: (props: Record<string, unknown>) => {
    captured.menu = props;
    return null;
  },
}));

vi.mock('./Toolbar', () => ({
  Toolbar: (props: Record<string, unknown>) => {
    captured.toolbar = props;
    return null;
  },
}));

const theme = {} as ThemeConfig;
const panelState = (overrides: Partial<PanelState> = {}) =>
  ({ panelView: 'files', isQuickView: false, isTreeVisible: false, ...overrides }) as unknown as PanelState;
const tab = { id: 'tab-1', driveId: 'real_C', currentPath: 'carpeta', selectedIds: [] } as unknown as PanelTab;

const baseProps = () => ({
  theme,
  lang: 'es' as const,
  settings: {
    crtEffectEnabled: false,
    crtIntensity: 'subtle',
    showClock: true,
    clockPosition: 'right',
    menuBarHoverOpen: false,
    showToolbar: true,
    toolbarItems: [],
    splitLayout: 'vertical',
  } as unknown as UserSettings,
  setSettings: vi.fn(),
  activePanel: 'left' as const,
  activePanelState: panelState(),
  inactivePanelState: panelState(),
  setLeftPanel: vi.fn(),
  rightPanel: panelState(),
  setRightPanel: vi.fn(),
  leftTab: tab,
  rightTab: tab,
  activeFocusedItem: null as FileItem | null,
  setSelectedFileForModal: vi.fn(),
  setActiveModal: vi.fn(),
  setCleanupTarget: vi.fn(),
  setFsTick: vi.fn(),
  isAppLocked: false,
  lockApp: vi.fn(),
  unlockApp: vi.fn(),
  onSelectAll: vi.fn(),
  onInvertSelection: vi.fn(),
  onSwapPanels: vi.fn(),
  onNewTab: vi.fn(),
  onSelectDrive: vi.fn(),
  onNavigate: vi.fn(),
  runLauncherOpenRequest: 0,
  launcherOnly: false,
  setLauncherOnly: vi.fn(),
  stackedPanels: false,
});

const renderChrome = (overrides: Partial<WindowChromeProps> = {}) => {
  const props = { ...baseProps(), ...overrides } as WindowChromeProps;
  return render(<WindowChrome {...props} />);
};

/** Applies the updater the component handed to setSettings, like React would. */
const lastUpdater = (setSettings: unknown, previous: UserSettings): UserSettings => {
  const calls = (setSettings as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0](previous);
};

beforeEach(() => {
  captured.menu = null;
  captured.toolbar = null;
});

describe('WindowChrome', () => {
  it('keeps the CRT overlay off until the setting is on, then paints the chosen intensity', () => {
    const { container, rerender } = renderChrome();
    expect(container.querySelector('.crt-overlay-subtle')).toBeNull();

    rerender(
      <WindowChrome
        {...(baseProps() as WindowChromeProps)}
        settings={{ ...baseProps().settings, crtEffectEnabled: true, crtIntensity: 'intense' }}
      />,
    );
    expect(container.querySelector('.crt-overlay-intense')).not.toBeNull();
  });

  /** The toolbar and the menu both flip the pane that is not being worked on. */
  it('flips the quick view of the other pane, not the active one', () => {
    const setLeftPanel = vi.fn();
    const setRightPanel = vi.fn();
    renderChrome({ activePanel: 'left', setLeftPanel, setRightPanel });

    (captured.menu?.onToggleQuickView as () => void)();

    expect(setRightPanel).toHaveBeenCalledTimes(1);
    expect(setLeftPanel).not.toHaveBeenCalled();
  });

  it('writes the CRT toggle into settings rather than tracking it', () => {
    const setSettings = vi.fn();
    const settings = baseProps().settings;
    renderChrome({ setSettings });

    (captured.menu?.onToggleCrt as () => void)();
    const next = lastUpdater(setSettings, settings);

    expect(next.crtEffectEnabled).toBe(true);
  });

  it('locks the app from the menu instead of opening a dialog', () => {
    const lockApp = vi.fn();
    const setActiveModal = vi.fn();
    renderChrome({ lockApp, setActiveModal });

    (captured.menu?.onOpenModal as (modal: string) => void)('app_lock');

    expect(lockApp).toHaveBeenCalledTimes(1);
    expect(setActiveModal).not.toHaveBeenCalled();
  });

  it('hands the cleanup target over before opening the dialog', () => {
    const setCleanupTarget = vi.fn();
    const setActiveModal = vi.fn();
    renderChrome({ setCleanupTarget, setActiveModal });

    (captured.toolbar?.onCleanup as (target: string) => void)('user-temp');

    expect(setCleanupTarget).toHaveBeenCalledWith('user-temp');
    expect(setActiveModal).toHaveBeenCalledWith('cleanup');
  });
});
