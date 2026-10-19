import React from 'react';
import { ThemeConfig } from '../services/themeManager';
import { Drive, FileItem, LanguageCode, PanelState, PanelTab, SortField, UserSettings } from '../types';
import { soundManager } from '../services/soundEffects';
import { TreeNavigationPane } from './TreeNavigationPane';
import { DriveBar } from './DriveBar';
import { PanelTabs } from './PanelTabs';
import { PathBar } from './PathBar';
import { QuickViewPane } from './QuickViewPane';
import { FileList } from './FileList';

interface PanelViewProps {
  side: 'left' | 'right';
  widthPercent: number;
  currentTheme: ThemeConfig;
  themeForFileList: ThemeConfig;
  lang: LanguageCode;
  settings: UserSettings;
  activePanel: 'left' | 'right';
  setActivePanel: React.Dispatch<React.SetStateAction<'left' | 'right'>>;
  onRefresh: () => void;
  quickSearchQuery: string;
  drives: Drive[];
  panel: PanelState;
  setPanel: React.Dispatch<React.SetStateAction<PanelState>>;
  tab: PanelTab;
  items: FileItem[];
  otherItems: FileItem[];
  otherTab: PanelTab;
  drive: Drive;
  isFilterOpen: boolean;
  setIsFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  treePaneRef?: React.RefObject<HTMLDivElement | null>;
  isTreeVisible?: boolean;
  onToggleTree?: () => void;
  onDropItems: (
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation: 'copy' | 'move'
  ) => void;
  onDropNativeFiles?: (files: globalThis.FileList, targetPath: string, targetDriveId: string) => void;
  onMountLocalPC: () => Promise<void>;
  onNavigate: (path: string) => void;
  onSelectDrive: (driveId: string) => void;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onToggleLockTab: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onGoParent: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSort: (field: SortField) => void;
  onSelectIndex: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem | null) => void;
  onItemHover: (e: React.MouseEvent, item: FileItem | null) => void;
}

/**
 * A single pane (left or right) of the dual-pane view: optional directory tree,
 * drive bar, tabs, path bar and either the quick view or the file list.
 * Extracted from App and shared by both sides.
 */
export const PanelView: React.FC<PanelViewProps> = ({
  side,
  widthPercent,
  currentTheme,
  themeForFileList,
  lang,
  settings,
  activePanel,
  setActivePanel,
  onRefresh,
  quickSearchQuery,
  drives,
  panel,
  setPanel,
  tab,
  items,
  otherItems,
  otherTab,
  drive,
  isFilterOpen,
  setIsFilterOpen,
  treePaneRef,
  isTreeVisible,
  onToggleTree,
  onDropItems,
  onDropNativeFiles,
  onMountLocalPC,
  onNavigate,
  onSelectDrive,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onToggleLockTab,
  onDuplicateTab,
  onGoParent,
  onGoBack,
  onGoForward,
  onSort,
  onSelectIndex,
  onToggleSelect,
  onOpenItem,
  onContextMenu,
  onItemHover,
}) => {
  const isActive = activePanel === side;

  return (
    <div
      className={`flex flex-row min-h-0 border rounded shadow-md overflow-hidden transition-all ${
        isActive ? 'ring-2' : 'opacity-90'
      }`}
      style={{
        width: typeof window !== 'undefined' && window.innerWidth >= 768 ? `${widthPercent}%` : '100%',
        borderColor: isActive ? currentTheme.borderFocus : currentTheme.borderPanel,
        outlineColor: currentTheme.borderFocus,
      }}
      onClick={() => {
        if (activePanel !== side) {
          soundManager.playKeyTick();
          setActivePanel(side);
        }
      }}
    >
      {/* Optional Directory Tree View */}
      {panel.isTreeVisible && (
        <div ref={treePaneRef}>
          <TreeNavigationPane
            lang={lang}
            theme={currentTheme}
            drives={drives}
            currentPath={tab.currentPath}
            currentDriveId={tab.driveId}
            onNavigate={onNavigate}
            onSelectDrive={onSelectDrive}
            onClose={() => setPanel((p) => ({ ...p, isTreeVisible: false }))}
            onDropItems={onDropItems}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <DriveBar
          theme={currentTheme}
          drives={drives}
          currentDriveId={tab.driveId}
          onSelectDrive={onSelectDrive}
          onMountLocal={onMountLocalPC}
          panelSide={side}
          isActive={isActive}
        />

        <PanelTabs
          theme={currentTheme}
          tabs={panel.tabs}
          activeTabId={panel.activeTabId}
          onSelectTab={onSelectTab}
          onNewTab={onNewTab}
          onCloseTab={onCloseTab}
          onToggleLockTab={onToggleLockTab}
          onDuplicateTab={onDuplicateTab}
          isActive={isActive}
        />

        <PathBar
          lang={lang}
          theme={currentTheme}
          currentPath={tab.currentPath}
          driveLetter={drive.letter}
          onNavigate={onNavigate}
          onGoParent={onGoParent}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          canGoBack={tab.historyIndex > 0}
          canGoForward={tab.historyIndex < tab.history.length - 1}
          onRefresh={onRefresh}
          filterText={tab.filterText}
          onFilterChange={(txt) =>
            setPanel((p) => ({
              ...p,
              tabs: p.tabs.map((t) => (t.id === p.activeTabId ? { ...t, filterText: txt } : t)),
            }))
          }
          viewMode={tab.viewMode}
          onChangeViewMode={(mode) =>
            setPanel((p) => ({
              ...p,
              tabs: p.tabs.map((t) => (t.id === p.activeTabId ? { ...t, viewMode: mode } : t)),
            }))
          }
          isActive={isActive}
          isTreeVisible={isTreeVisible}
          onToggleTree={onToggleTree}
        />

        {panel.isQuickView ? (
          <QuickViewPane
            lang={lang}
            theme={currentTheme}
            targetItem={otherItems[otherTab.focusedIndex] || null}
            onClose={() => setPanel((p) => ({ ...p, isQuickView: false }))}
          />
        ) : (
          <FileList
            theme={themeForFileList}
            lang={lang}
            items={items}
            currentPath={tab.currentPath}
            currentDriveId={tab.driveId}
            isRoot={!tab.currentPath.includes('\\')}
            focusedIndex={tab.focusedIndex}
            selectedIds={tab.selectedIds}
            viewMode={tab.viewMode}
            sortField={tab.sortField}
            sortDirection={tab.sortDirection}
            onSort={onSort}
            onSelectIndex={onSelectIndex}
            onToggleSelect={onToggleSelect}
            onOpenItem={onOpenItem}
            onGoParent={onGoParent}
            onContextMenu={onContextMenu}
            onItemHover={onItemHover}
            isActive={isActive}
            onActivate={() => setActivePanel(side)}
            panelSide={side}
            onDropItems={onDropItems}
            onDropNativeFiles={onDropNativeFiles}
            blinkingCursorEnabled={settings.blinkingCursorEnabled}
            blinkingCursorColor={settings.cursorBlinkColor}
            quickSearchQuery={isActive ? quickSearchQuery : ''}
            isFilterBarOpen={isActive && isFilterOpen}
            filterText={tab.filterText}
            onFilterChange={(txt) =>
              setPanel((p) => ({
                ...p,
                tabs: p.tabs.map((t) => (t.id === p.activeTabId ? { ...t, filterText: txt } : t)),
              }))
            }
            onCloseFilterBar={() => setIsFilterOpen(false)}
          />
        )}
      </div>
    </div>
  );
};
