import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelView } from './PanelView';
import { themes } from '../services/themeManager';
import { translations } from '../i18n/translations';
import type { Drive, PanelState, PanelTab } from '../types';

/**
 * A machine whose drive list is empty, which is what a boot probe that never
 * gets an answer now reports. The panel used to fall through to the file list,
 * whose own empty state offers a drop target for a folder that does not exist.
 */
const t = translations.es;

const tab: PanelTab = {
  id: 'left_1',
  title: '',
  driveId: '',
  currentPath: '',
  history: [''],
  historyIndex: 0,
  viewMode: 'full',
  sortField: 'name',
  sortDirection: 'asc',
  filterText: '',
  selectedIds: [],
  focusedIndex: 0,
};

const panel: PanelState = {
  id: 'left',
  activeTabId: tab.id,
  tabs: [tab],
  isTreeVisible: false,
  isQuickView: false,
  panelView: 'files',
};

const emptyDrive: Drive = {
  id: '',
  letter: '',
  name: t.panelNoRealDrives,
  type: 'local',
  totalBytes: 0,
  freeBytes: 0,
  isMounted: false,
};

const props = () => ({
  side: 'left' as const,
  widthPercent: 100,
  currentTheme: themes.classic_blue,
  themeForFileList: themes.classic_blue,
  lang: 'es' as const,
  settings: {} as never,
  activePanel: 'left' as const,
  setActivePanel: vi.fn(),
  onRefresh: vi.fn(),
  quickSearchQuery: '',
  drives: [] as Drive[],
  panel,
  setPanel: vi.fn(),
  tab,
  items: [],
  otherItems: [],
  otherTab: tab,
  drive: emptyDrive,
  isFilterOpen: false,
  setIsFilterOpen: vi.fn(),
  onDropItems: vi.fn(),
  onNavigate: vi.fn(),
  onSelectDrive: vi.fn(),
  onSelectTab: vi.fn(),
  onNewTab: vi.fn(),
  onCloseTab: vi.fn(),
  onToggleLockTab: vi.fn(),
  onDuplicateTab: vi.fn(),
  onGoParent: vi.fn(),
  onGoBack: vi.fn(),
  onGoForward: vi.fn(),
  onSort: vi.fn(),
  onSelectIndex: vi.fn(),
  onToggleSelect: vi.fn(),
  onOpenItem: vi.fn(),
  onContextMenu: vi.fn(),
  onItemHover: vi.fn(),
});

describe('PanelView with no drives', () => {
  it('says there are no drives instead of offering an empty folder', () => {
    const { container } = render(<PanelView {...props()} />);

    const notice = container.querySelector('[data-no-drives]') as HTMLElement | null;
    expect(notice).toBeTruthy();
    expect(notice!.textContent).toContain(t.panelNoRealDrives);
    expect(notice!.textContent).toContain(t.panelNoRealDrivesDesc);

    // The file view's empty state is for a folder that exists and has nothing in it.
    expect(container.textContent).not.toContain(t.emptyFolder);
  });
});
