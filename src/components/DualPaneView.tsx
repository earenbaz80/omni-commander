import React from 'react';
import { ThemeConfig } from '../services/themeManager';
import { Drive, FileItem, LanguageCode, PanelState, PanelTab, SortField, UserSettings } from '../types';
import { getTranslations } from '../i18n/translations';
import { PanelView } from './PanelView';

/** Everything one side of the split owns, minus the handlers both sides share. */
export interface PaneBinding {
  panel: PanelState;
  setPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  tab: PanelTab;
  items: FileItem[];
  otherItems: FileItem[];
  otherTab: PanelTab;
  drive: Drive;
  isFilterOpen: boolean;
  setIsFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** The left side's directory tree; the right side has none. */
  treePaneRef?: React.RefObject<HTMLDivElement | null>;
  treeVisible?: boolean;
  onToggleTree?: () => void;
  onRefresh: () => void;
  /** Pinned folders the tree found deleted, so the app can forget them. */
  onMissingFavorites?: (paths: string[]) => void;
  onGoParent: () => void;
  onSort: (field: SortField) => void;
  onSelectIndex: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem | null) => void;
  onItemHover: (e: React.MouseEvent, item: FileItem | null) => void;
}

/**
 * The handlers that are the same for both sides. Each one takes the side it was
 * called for, which is what lets the view bind them without App writing the
 * same arrow twice with 'left' and 'right' in it.
 */
export interface PaneHandlers {
  navigate: (side: 'left' | 'right', path: string) => void;
  selectDrive: (side: 'left' | 'right', driveId: string) => void;
  selectTab: (side: 'left' | 'right', tabId: string) => void;
  newTab: (side: 'left' | 'right') => void;
  closeTab: (side: 'left' | 'right', tabId: string) => void;
  toggleLockTab: (side: 'left' | 'right', tabId: string) => void;
  duplicateTab: (side: 'left' | 'right', tabId: string) => void;
  goBack: (side: 'left' | 'right') => void;
  goForward: (side: 'left' | 'right') => void;
  dropItems: (draggedItems: FileItem[], targetPath: string, targetDriveId: string, operation: 'copy' | 'move') => void;
  dropNativeFiles?: (files: globalThis.FileList, targetPath: string, targetDriveId: string) => void;
  openItem: (item: FileItem) => void;
}

export interface DualPaneViewProps {
  theme: ThemeConfig;
  themeForFileList: ThemeConfig;
  lang: LanguageCode;
  settings: UserSettings;
  activePanel: 'left' | 'right';
  setActivePanel: React.Dispatch<React.SetStateAction<'left' | 'right'>>;
  quickSearchQuery: string;
  drives: Drive[];
  /** Panels stacked (top/bottom) instead of side by side. */
  stacked: boolean;
  /** Share of the split the left pane takes, along the axis they are arranged on. */
  ratio: number;
  dragging: boolean;
  onDragStart: () => void;
  left: PaneBinding;
  right: PaneBinding;
  handlers: PaneHandlers;
}

/**
 * The dual-pane viewport: one pane per side and the divider between them.
 *
 * Both halves are the same component fed from their own side's state, and the
 * divider is where a pointer drag starts. Splitting this out of App keeps the
 * two long prop lists in one place: the sides differ by which state they read,
 * not by what the view does with it.
 */
export const DualPaneView: React.FC<DualPaneViewProps> = ({
  theme,
  themeForFileList,
  lang,
  settings,
  activePanel,
  setActivePanel,
  quickSearchQuery,
  drives,
  stacked,
  ratio,
  dragging,
  onDragStart,
  left,
  right,
  handlers,
}) => {
  const t = getTranslations(lang);

  const renderPane = (side: 'left' | 'right', binding: PaneBinding, widthPercent: number) => (
    <PanelView
      side={side}
      widthPercent={widthPercent}
      stacked={stacked}
      currentTheme={theme}
      themeForFileList={themeForFileList}
      lang={lang}
      settings={settings}
      activePanel={activePanel}
      setActivePanel={setActivePanel}
      onRefresh={binding.onRefresh}
      onMissingFavorites={binding.onMissingFavorites}
      quickSearchQuery={quickSearchQuery}
      drives={drives}
      panel={binding.panel}
      setPanel={binding.setPanel}
      tab={binding.tab}
      items={binding.items}
      otherItems={binding.otherItems}
      otherTab={binding.otherTab}
      drive={binding.drive}
      isFilterOpen={binding.isFilterOpen}
      setIsFilterOpen={binding.setIsFilterOpen}
      treePaneRef={binding.treePaneRef}
      isTreeVisible={binding.treeVisible}
      onToggleTree={binding.onToggleTree}
      onDropItems={handlers.dropItems}
      onDropNativeFiles={handlers.dropNativeFiles}
      onNavigate={(path) => handlers.navigate(side, path)}
      onSelectDrive={(driveId) => handlers.selectDrive(side, driveId)}
      onSelectTab={(tabId) => handlers.selectTab(side, tabId)}
      onNewTab={() => handlers.newTab(side)}
      onCloseTab={(tabId) => handlers.closeTab(side, tabId)}
      onToggleLockTab={(tabId) => handlers.toggleLockTab(side, tabId)}
      onDuplicateTab={(tabId) => handlers.duplicateTab(side, tabId)}
      onGoParent={binding.onGoParent}
      onGoBack={() => handlers.goBack(side)}
      onGoForward={() => handlers.goForward(side)}
      onSort={binding.onSort}
      onSelectIndex={binding.onSelectIndex}
      onToggleSelect={binding.onToggleSelect}
      onOpenItem={handlers.openItem}
      onContextMenu={binding.onContextMenu}
      onItemHover={binding.onItemHover}
    />
  );

  return (
    <div
      id="dual-panel-container"
      className={`flex-1 flex ${stacked ? 'flex-col' : 'flex-col md:flex-row'} min-h-0 relative p-1 gap-1`}
    >
      {renderPane('left', left, ratio)}

      {/* Interactive Resizable Divider Bar */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          onDragStart();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          onDragStart();
        }}
        role="separator"
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        aria-valuenow={Math.round(ratio)}
        data-dragging={dragging ? 'true' : 'false'}
        className={`${
          stacked
            ? 'flex h-2.5 w-full hover:h-3.5 cursor-row-resize'
            : 'hidden md:flex w-2.5 hover:w-3.5 cursor-col-resize'
        } shrink-0 bg-black/40 hover:bg-amber-400/90 items-center justify-center transition-all group z-30 select-none rounded border border-white/10 hover:border-amber-300`}
        title={t.appResizerTitle}
      >
        <div className={`${stacked ? 'w-10 h-0.5' : 'w-0.5 h-10'} bg-amber-400/60 group-hover:bg-black rounded-full`} />
      </div>

      {renderPane('right', right, 100 - ratio)}
    </div>
  );
};
