import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DualPaneView, type PaneBinding, type PaneHandlers } from './DualPaneView';
import type { Drive, PanelState, PanelTab } from '../types';
import type { ThemeConfig } from '../services/themeManager';

const captured: Array<Record<string, unknown>> = [];

vi.mock('./PanelView', () => ({
  PanelView: (props: Record<string, unknown>) => {
    captured.push(props);
    return null;
  },
}));

const theme = {} as ThemeConfig;
const drive = { id: 'real_C', letter: 'C:' } as unknown as Drive;
const tab = { id: 'tab-1', driveId: 'real_C', currentPath: 'C:\\', selectedIds: [] } as unknown as PanelTab;
const panelState = { panelView: 'files' } as unknown as PanelState;

const binding = (overrides: Partial<PaneBinding> = {}): PaneBinding => ({
  panel: panelState,
  setPanel: vi.fn(),
  tab,
  items: [],
  otherItems: [],
  otherTab: tab,
  drive,
  isFilterOpen: false,
  setIsFilterOpen: vi.fn(),
  onRefresh: vi.fn(),
  onGoParent: vi.fn(),
  onSort: vi.fn(),
  onSelectIndex: vi.fn(),
  onToggleSelect: vi.fn(),
  onContextMenu: vi.fn(),
  onItemHover: vi.fn(),
  ...overrides,
});

const makeHandlers = (): PaneHandlers => ({
  navigate: vi.fn(),
  selectDrive: vi.fn(),
  selectTab: vi.fn(),
  newTab: vi.fn(),
  closeTab: vi.fn(),
  toggleLockTab: vi.fn(),
  duplicateTab: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  dropItems: vi.fn(),
  openItem: vi.fn(),
});

const renderView = (
  options: { handlers?: PaneHandlers; stacked?: boolean; ratio?: number; onDragStart?: () => void } = {},
) =>
  render(
    <DualPaneView
      theme={theme}
      themeForFileList={theme}
      lang="es"
      settings={{} as never}
      activePanel="left"
      setActivePanel={vi.fn()}
      quickSearchQuery=""
      drives={[drive]}
      stacked={options.stacked ?? false}
      ratio={options.ratio ?? 55}
      dragging={false}
      onDragStart={options.onDragStart ?? vi.fn()}
      left={binding()}
      right={binding()}
      handlers={options.handlers ?? makeHandlers()}
    />,
  );

beforeEach(() => {
  captured.length = 0;
});

describe('DualPaneView', () => {
  /**
   * The sides share one set of handlers, so the view is what supplies the side:
   * a click on the right pane must never navigate the left one.
   */
  it('binds the shared handlers to the side that called them', () => {
    const handlers = makeHandlers();
    renderView({ handlers });

    const [leftProps, rightProps] = captured;
    (leftProps.onNavigate as (path: string) => void)('raiz');
    (rightProps.onNewTab as () => void)();

    expect(handlers.navigate).toHaveBeenCalledWith('left', 'raiz');
    expect(handlers.newTab).toHaveBeenCalledWith('right');
  });

  it('gives each pane its share of the split, and says which axis it is on', () => {
    const { getByRole } = renderView({ ratio: 55 });

    expect(captured[0].widthPercent).toBe(55);
    expect(captured[1].widthPercent).toBe(45);
    expect(getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('reports a drag from the divider instead of tracking it here', () => {
    const onDragStart = vi.fn();
    const { getByRole } = renderView({ stacked: true, onDragStart });

    const divider = getByRole('separator');
    fireEvent.mouseDown(divider);

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
  });
});
