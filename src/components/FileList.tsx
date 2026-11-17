import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, Scissors } from 'lucide-react';
import { FileTypeIcon, fileIconColor } from './FileTypeIcon';
import { FileItem, SortField, SortDirection, ViewMode, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';
import { loadColumnWidths, saveColumnWidths } from '../utils/columnWidths';
import { log } from '../utils/logger';
import { formatBytes } from '../utils/formatBytes';
import { FileListStatusBar } from './FileListStatusBar';
import { FileListHeader } from './FileListHeader';
import { FileListGrid } from './FileListGrid';
import { FileListRow, type FileListHandlers } from './FileListRow';
import { getItemTextColor } from './fileListDisplay';
import { appendPath, isPathAtOrInside } from '../services/platform';

const THUMB_MIN = 48;
const THUMB_MAX = 192;
const THUMB_STEP = 16;
const THUMB_DEFAULT = 80;
const THUMB_CELL_PADDING = 24;

interface FileListProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  items: FileItem[];
  currentPath: string;
  currentDriveId: string;
  isRoot: boolean;
  focusedIndex: number;
  selectedIds: string[];
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onSelectIndex: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: FileItem) => void;
  onGoParent: () => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem | null) => void;
  onItemHover?: (e: React.MouseEvent, item: FileItem | null) => void;
  isActive: boolean;
  onActivate: () => void;
  panelSide: 'left' | 'right';
  onDropItems: (
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation: 'copy' | 'move',
  ) => void;
  onDropNativeFiles?: (files: globalThis.FileList, targetPath: string, targetDriveId: string) => void;
  blinkingCursorEnabled?: boolean;
  blinkingCursorColor?: 'amber' | 'cyan' | 'green' | 'red' | 'white';
  quickSearchQuery?: string;
  isFilterBarOpen?: boolean;
  filterText?: string;
  onFilterChange?: (text: string) => void;
  onCloseFilterBar?: () => void;
}

const FileListComponent: React.FC<FileListProps> = ({
  theme,
  lang,
  items,
  currentPath,
  currentDriveId,
  isRoot,
  focusedIndex,
  selectedIds,
  viewMode,
  sortField,
  sortDirection,
  onSort,
  onSelectIndex,
  onToggleSelect,
  onOpenItem,
  onGoParent,
  onContextMenu,
  onItemHover,
  isActive,
  onActivate,
  panelSide,
  onDropItems,
  onDropNativeFiles,
  blinkingCursorEnabled = true,
  blinkingCursorColor = 'cyan',
  isFilterBarOpen = false,
}) => {
  const t = getTranslations(lang);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [thumbSize, setThumbSize] = useState(THUMB_DEFAULT);
  const [containerWidth, setContainerWidth] = useState(0);

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => loadColumnWidths());

  // Persist column widths so they survive reloads.
  useEffect(() => {
    saveColumnWidths(colWidths);
  }, [colWidths]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listContainerRef.current,
    estimateSize: () => 24,
    overscan: 8,
  });

  // Generic grid virtualizer for brief/thumbnail/gallery modes
  const thumbCellSize = thumbSize + THUMB_CELL_PADDING;
  const thumbColumns = Math.max(1, Math.floor(containerWidth / thumbCellSize));
  // Brief stays at 2 columns on narrow panels and 3 otherwise (matches the old
  // `grid-cols-2 md:grid-cols-3` breakpoint at 768px) so the virtualized row
  // slicing and the rendered grid share one source of truth.
  const briefColumns = containerWidth >= 768 ? 3 : 2;
  const getGridColumns = () => {
    if (viewMode === 'brief') return briefColumns;
    if (viewMode === 'thumbnails' || viewMode === 'gallery') return thumbColumns;
    return 1;
  };
  const gridColumns = getGridColumns();
  const gridRowCount = Math.max(1, Math.ceil(items.length / gridColumns));
  const gridRowVirtualizer = useVirtualizer({
    count: gridRowCount,
    getScrollElement: () => listContainerRef.current,
    estimateSize: () => {
      if (viewMode === 'brief') return 34;
      if (viewMode === 'thumbnails') return thumbSize + 70;
      if (viewMode === 'gallery') return thumbSize + 130;
      return 34;
    },
    overscan: 4,
  });

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setThumbSize((size) => {
        const next = size + (e.deltaY < 0 ? THUMB_STEP : -THUMB_STEP);
        return Math.min(THUMB_MAX, Math.max(THUMB_MIN, next));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // HTML5 Drag & Drop visual state
  const [isDragOverPanel, setIsDragOverPanel] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOperation, setDragOperation] = useState<'copy' | 'move'>('copy');
  const [draggedIds, setDraggedIds] = useState<string[]>([]);

  useEffect(() => {
    if (isFilterBarOpen && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [isFilterBarOpen]);

  // Auto-scroll to focused row (virtualized)
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < items.length) {
      rowVirtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
    }
  }, [focusedIndex, items.length, rowVirtualizer]);

  // --- HTML5 Drag & Drop Implementation ---
  const handleDragStart = (e: React.DragEvent, item: FileItem, idx: number) => {
    const isItemSelected = selectedIdSet.has(item.id);
    const dragPayload = isItemSelected ? items.filter((i) => selectedIds.includes(i.id)) : [item];

    // Auto-focus dragged item if not selected
    if (!isItemSelected) {
      onSelectIndex(idx);
    }

    const payload = {
      items: dragPayload,
      sourceSide: panelSide,
      sourceDriveId: currentDriveId,
      sourcePath: currentPath,
    };

    setDraggedIds(dragPayload.map((i) => i.id));

    // Custom retro drag preview badge
    try {
      const dragBadge = document.createElement('div');
      dragBadge.style.position = 'fixed';
      dragBadge.style.top = '-1000px';
      dragBadge.style.left = '-1000px';
      dragBadge.style.padding = '4px 10px';
      dragBadge.style.background = '#0284c7';
      dragBadge.style.color = '#ffffff';
      dragBadge.style.border = '2px solid #38bdf8';
      dragBadge.style.borderRadius = '4px';
      dragBadge.style.fontSize = '11px';
      dragBadge.style.fontFamily = 'monospace';
      dragBadge.style.fontWeight = 'bold';
      dragBadge.style.boxShadow = '0 6px 16px rgba(0,0,0,0.6)';
      dragBadge.style.pointerEvents = 'none';
      dragBadge.style.zIndex = '99999';
      dragBadge.innerText =
        dragPayload.length === 1
          ? `📄 ${dragPayload[0].name}${dragPayload[0].ext ? '.' + dragPayload[0].ext : ''}`
          : `${dragPayload.length} ${t.elementsSuffix}`;
      document.body.appendChild(dragBadge);
      e.dataTransfer.setDragImage(dragBadge, 15, 15);
      setTimeout(() => {
        if (dragBadge.parentNode) {
          dragBadge.parentNode.removeChild(dragBadge);
        }
      }, 0);
    } catch {
      // Fallback to browser drag preview
    }

    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', dragPayload.map((i) => `${i.name}${i.ext ? '.' + i.ext : ''}`).join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';

    soundManager.playKeyTick();
  };

  const handleDragEnd = () => {
    setDraggedIds([]);
    setIsDragOverPanel(false);
    setDragOverFolderId(null);
  };

  const handleDragOverContainer = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const isMove = e.shiftKey;
    e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
    setIsDragOverPanel(true);
    setDragOperation(isMove ? 'move' : 'copy');
  };

  const handleDragLeaveContainer = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverPanel(false);
      setDragOverFolderId(null);
    }
  };

  const handleDragOverItem = (e: React.DragEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    const isMove = e.shiftKey;
    e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
    setIsDragOverPanel(true);
    setDragOperation(isMove ? 'move' : 'copy');
    if (item.isDirectory) {
      setDragOverFolderId(item.id);
    } else {
      setDragOverFolderId(null);
    }
  };

  const handleDragLeaveItem = (e: React.DragEvent, item: FileItem) => {
    e.stopPropagation();
    if (item.isDirectory && dragOverFolderId === item.id) {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDragOverFolderId(null);
      }
    }
  };

  const handleDropItem = (e: React.DragEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    handleDrop(e, item.isDirectory ? item : undefined);
  };

  const handleDrop = (e: React.DragEvent, targetFolder?: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverPanel(false);
    setDragOverFolderId(null);
    setDraggedIds([]);

    const isMove = e.shiftKey;
    const operation: 'copy' | 'move' = isMove ? 'move' : 'copy';

    // The destination hangs from the panel's own path, so it is spelled with
    // that path's separators: `/` on Linux, and the mount's inside an archive.
    const destPath =
      targetFolder && targetFolder.isDirectory ? appendPath(currentPath, targetFolder.name) : currentPath;

    // 1. Check if internal items dropped
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const payload = JSON.parse(jsonData);
        if (payload && Array.isArray(payload.items) && payload.items.length > 0) {
          // Filter out dropping a folder inside itself or child path
          const validItems = payload.items.filter((item: FileItem) => {
            if (item.isDirectory) {
              const srcFolderFull = appendPath(item.path, item.name);
              if (isPathAtOrInside(srcFolderFull, destPath)) {
                return false;
              }
            }
            return true;
          });

          if (validItems.length > 0) {
            onDropItems(validItems, destPath, currentDriveId, operation);
          }
          return;
        }
      }
    } catch (err) {
      log.warn('Drag data parse warning:', err);
    }

    // 2. Check if external files dragged from OS desktop/folder
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (onDropNativeFiles) {
        onDropNativeFiles(e.dataTransfer.files, destPath, currentDriveId);
      }
    }
  };

  // Stats calculation (memoized to avoid O(n) work on every render)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const stats = useMemo(() => {
    let totalFiles = 0;
    let totalDirs = 0;
    let selectedCount = 0;
    let selectedBytes = 0;
    let totalBytes = 0;
    for (const item of items) {
      if (item.isDirectory) {
        totalDirs++;
      } else {
        totalFiles++;
        totalBytes += item.size;
      }
      if (selectedIdSet.has(item.id)) {
        selectedCount++;
        if (!item.isDirectory) selectedBytes += item.size;
      }
    }
    return { totalFiles, totalDirs, selectedCount, selectedBytes, totalBytes };
  }, [items, selectedIdSet]);

  const handlers: FileListHandlers = {
    startDrag: handleDragStart,
    endDrag: handleDragEnd,
    dragOver: handleDragOverItem,
    dragLeave: handleDragLeaveItem,
    drop: handleDropItem,
    hover: (e, item) => onItemHover && onItemHover(e, item),
    toggleSelect: onToggleSelect,
    selectIndex: onSelectIndex,
    openItem: onOpenItem,
    contextMenu: onContextMenu,
  };

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 relative select-none font-mono text-xs overflow-hidden transition-all ${
        isDragOverPanel ? 'ring-2 ring-inset ring-amber-400 bg-amber-400/5' : ''
      }`}
      onClick={onActivate}
      onDragOver={handleDragOverContainer}
      onDragLeave={handleDragLeaveContainer}
      onDrop={(e) => handleDrop(e)}
      style={{
        backgroundColor: isActive ? theme.bgPanel : theme.bgPanelInactive,
        color: theme.itemText,
      }}
    >
      {/* Table header columns, in the classic two-panel layout */}
      <FileListHeader
        theme={theme}
        t={t}
        items={items}
        viewMode={viewMode}
        sortField={sortField}
        sortDirection={sortDirection}
        colWidths={colWidths}
        setColWidths={setColWidths}
        onSort={onSort}
      />

      <div
        ref={listContainerRef}
        data-file-list
        // Which of the two lists is the one the keyboard is on: when a window
        // closes and the control that opened it is gone, the fallback restore
        // aims here rather than at the other panel's list.
        data-file-list-active={isActive ? 'true' : undefined}
        // Focus lands here whenever a window closes over the list. A focusable
        // container with no role and no name is announced as nothing at all, so
        // the panel says which one it is and which folder it just entered: with
        // both panels mirroring the same folder, the path alone would not tell
        // them apart.
        role="group"
        aria-label={(panelSide === 'left' ? t.fileListLabelLeft : t.fileListLabelRight).replace('{path}', currentPath)}
        className="flex-1 min-h-0 min-w-full overflow-y-auto overflow-x-auto focus:outline-none p-0.5 space-y-[1px]"
        tabIndex={0}
        onContextMenu={(e) => onContextMenu(e, null)}
        onDragOver={handleDragOverContainer}
        onDragLeave={handleDragLeaveContainer}
        onDrop={(e) => handleDrop(e)}
      >
        {!isRoot && (
          <div
            onClick={() => {
              soundManager.playDiskAccess();
              onGoParent();
            }}
            onDoubleClick={() => {
              soundManager.playDiskAccess();
              onGoParent();
            }}
            className={`flex items-center justify-between px-[var(--space-2)] py-[var(--space-1)] cursor-pointer hover:bg-white/10 transition-colors group text-yellow-300 font-bold ${dragOverFolderId === 'parent_dir' ? 'ring-2 ring-amber-400 bg-amber-400/25 shadow' : ''}`}
          >
            <div className="flex items-center gap-[var(--space-2)] flex-1 min-w-0">
              <FileTypeIcon kind="folder" color={fileIconColor('folder', theme)} className="w-3.5 h-3.5 shrink-0" />
              <span className="tracking-wider">..</span>
              <span className="opacity-50 text-[10px]">&lt;UP--DIR&gt;</span>
            </div>
          </div>
        )}

        {viewMode === 'full' && (
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              const idx = virtualRow.index;
              const isSelected = selectedIdSet.has(item.id);

              return (
                <FileListRow
                  key={virtualRow.key}
                  item={item}
                  index={idx}
                  start={virtualRow.start}
                  measureElement={rowVirtualizer.measureElement}
                  isFocused={idx === focusedIndex && isActive}
                  isSelected={isSelected}
                  isHoveredTarget={dragOverFolderId === item.id}
                  isBeingDragged={draggedIds.includes(item.id)}
                  textColor={getItemTextColor(item, isSelected, theme)}
                  theme={theme}
                  t={t}
                  colWidths={colWidths}
                  thumbSize={thumbSize}
                  blinkingCursorEnabled={blinkingCursorEnabled}
                  blinkingCursorColor={blinkingCursorColor}
                  dragOperation={dragOperation}
                  handlers={handlers}
                />
              );
            })}
          </div>
        )}

        {viewMode !== 'full' && (
          <FileListGrid
            mode={viewMode}
            items={items}
            columns={gridColumns}
            thumbSize={thumbSize}
            theme={theme}
            t={t}
            focusedIndex={focusedIndex}
            isActive={isActive}
            selectedIdSet={selectedIdSet}
            dragOverFolderId={dragOverFolderId}
            draggedIds={draggedIds}
            virtualRows={gridRowVirtualizer.getVirtualItems()}
            totalSize={gridRowVirtualizer.getTotalSize()}
            measureElement={gridRowVirtualizer.measureElement}
            handlers={handlers}
          />
        )}

        {items.length === 0 && (
          <div
            onDragOver={handleDragOverContainer}
            onDragLeave={handleDragLeaveContainer}
            onDrop={(e) => handleDrop(e)}
            className="m-4 p-8 border-2 border-dashed border-white/20 hover:border-amber-400/60 rounded flex flex-col items-center justify-center text-center transition-all bg-black/20"
          >
            <FileTypeIcon kind="folder" color={fileIconColor('folder', theme)} className="w-8 h-8 opacity-40 mb-2" />
            <div className="text-xs opacity-70 font-semibold mb-1">&lt;{t.emptyFolder}&gt;</div>
            <div className="text-[11px] opacity-40">{t.emptyFolderDropHint}</div>
          </div>
        )}
      </div>

      {/* Floating Drag & Drop Operation HUD Indicator */}
      {isDragOverPanel && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-black/95 text-amber-300 border-2 border-amber-400 px-4 py-2 rounded-lg shadow-2xl flex items-center gap-3 text-xs font-bold pointer-events-none animate-bounce backdrop-blur">
          {dragOperation === 'move' ? (
            <div className="p-1 rounded bg-emerald-500/20 border border-emerald-400/40">
              <Scissors className="w-4 h-4 text-emerald-400" />
            </div>
          ) : (
            <div className="p-1 rounded bg-sky-500/20 border border-sky-400/40">
              <Copy className="w-4 h-4 text-sky-400" />
            </div>
          )}
          <div className="flex flex-col">
            <div className="flex items-center gap-[var(--space-2)]">
              <span className={dragOperation === 'move' ? 'text-emerald-400' : 'text-sky-400'}>
                {dragOperation === 'move' ? t.moveTo : t.copyTo}
              </span>
              <span className="text-white max-w-[260px] truncate">
                {dragOverFolderId === 'parent_dir'
                  ? t.parentDirectory
                  : dragOverFolderId
                    ? `${t.folder}: ${items.find((i) => i.id === dragOverFolderId)?.name || t.selectedFallback}`
                    : currentPath}
              </span>
            </div>
            <span className="text-[10px] text-amber-200/70 font-normal">
              {dragOperation === 'move' ? t.dropToMoveHint : t.dropToCopyHint}
            </span>
          </div>
        </div>
      )}

      {/* Retro Status Bar at bottom of panel */}
      <FileListStatusBar
        theme={theme}
        totalFiles={stats.totalFiles}
        totalDirs={stats.totalDirs}
        selectedCount={stats.selectedCount}
        selectedBytes={stats.selectedBytes}
        filesCountLabel={t.filesCount}
        dirsCountLabel={t.dirsCount}
        selectedCountLabel={t.selectedCount}
        totalLabel={t.statusBarTotalSize.replace('{size}', formatBytes(stats.totalBytes))}
      />
    </div>
  );
};

export const FileList = React.memo(FileListComponent);
