import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Copy, Scissors } from 'lucide-react';
import { FileTypeIcon, fileIconColor, fileIconKind } from './FileTypeIcon';
import { bestInk, readableInk } from '../utils/contrast';
import { FileItem, SortField, SortDirection, ViewMode, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { soundManager } from '../services/soundEffects';
import { loadColumnWidths, saveColumnWidths, autoFitWidth, MIN_COLUMN_WIDTH } from '../utils/columnWidths';
import { log } from '../utils/logger';
import { formatBytesCompact } from '../utils/formatBytes';
import { FileListStatusBar } from './FileListStatusBar';
import { isImageItem, mediaUrlFor } from '../services/mediaUrl';

const THUMB_MIN = 48;
const THUMB_MAX = 192;
const THUMB_STEP = 16;
const THUMB_DEFAULT = 80;
const THUMB_CELL_PADDING = 24;

/**
 * One picture cell.
 *
 * Every grid cell used to draw a generic icon even for a PNG: the listing of a
 * real drive carries no bytes, and the old branch only rendered an `<img>` when
 * the item arrived with a `data:` preload, which only archive entries do. The
 * image now comes from the local server, the browser decodes it, and a file it
 * cannot serve falls back to the icon the cell had before.
 */
const CellThumbnail: React.FC<{
  src: string | null;
  alt: string;
  fit: 'cover' | 'contain';
  fallback: React.ReactNode;
}> = ({ src, alt, fit, fallback }) => {
  const [broken, setBroken] = useState(false);
  // A recycled cell must not keep the failure of the file it showed before.
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBroken(true)}
      className={fit === 'cover' ? 'w-full h-full object-cover' : 'max-w-full max-h-full object-contain'}
    />
  );
};

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

/** The cursor block's hues, matching the names the settings offer. */
const CURSOR_BLOCK_INK: Record<'amber' | 'cyan' | 'green' | 'red' | 'white', string> = {
  amber: '#fcd34d',
  cyan: '#67e8f9',
  green: '#6ee7b7',
  red: '#fca5a5',
  white: '#ffffff',
};

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
  const resizingColumnRef = useRef<string | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingColumnRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const next = Math.max(MIN_COLUMN_WIDTH, resizeStartWidthRef.current + delta);
      setColWidths((prev) => ({ ...prev, [resizingColumnRef.current as string]: next }));
    };
    const onUp = () => {
      resizingColumnRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Persist column widths so they survive reloads.
  useEffect(() => {
    saveColumnWidths(colWidths);
  }, [colWidths]);

  const startResizeColumn = (key: string, e: React.MouseEvent) => {
    resizingColumnRef.current = key;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = colWidths[key];
    e.preventDefault();
    e.stopPropagation();
  };
  const autoSizeColumn = (key: string) => {
    const samples: Record<string, string[]> = {
      name: [...items.map((i) => i.name), t.name],
      ext: [...items.map((i) => i.ext), t.ext],
      type: [...items.map((i) => getItemType(i)), t.colType],
      size: [...items.map((i) => formatSize(i)), t.size],
      date: ['0000-00-00 00:00', t.date],
      attr: ['RWA', t.attr],
    };
    setColWidths((p) => ({ ...p, [key]: autoFitWidth(samples[key] ?? ['']) }));
  };

  // Small visible divider between column labels: drag to resize, double-click to auto-fit.
  const renderResizer = (colKey: string, label: string) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.fileListResizeColumn.replace('{label}', String(label))}
      title={t.fileListResizeHint}
      onMouseDown={(e) => startResizeColumn(colKey, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        autoSizeColumn(colKey);
      }}
      className="nc-col-resizer"
    />
  );

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

  const formatSize = (item: FileItem): string => {
    if (item.isDirectory) {
      return item.size && item.size > 0 ? formatBytesCompact(item.size) : t.directory;
    }
    return formatBytesCompact(item.size);
  };

  /**
   * The listing draws its own glyphs so they carry the theme's colours; see
   * FileTypeIcon for why the icon library was dropped from this column.
   */
  const getFileIcon = (item: FileItem, size = 'w-3.5 h-3.5', style?: React.CSSProperties) => {
    const kind = fileIconKind(item);
    return <FileTypeIcon kind={kind} color={fileIconColor(kind, theme)} className={`${size} shrink-0`} style={style} />;
  };

  const getItemTextColor = (item: FileItem, isSelected: boolean): string => {
    if (isSelected) return theme.selectedText;
    if (item.isDirectory) return theme.dirText;
    const ext = item.ext.toUpperCase();
    if (['EXE', 'COM', 'BAT', 'CMD'].includes(ext)) return theme.exeText;
    if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'ISO'].includes(ext)) return theme.zipText;
    if (['TXT', 'DOC', 'DOCX', 'PDF', 'MD'].includes(ext)) return theme.docText;
    if (['JPG', 'PNG', 'GIF', 'MP3', 'MP4', 'WAV'].includes(ext)) return theme.mediaText;
    return theme.itemText;
  };

  const getItemType = (item: FileItem): string => {
    if (item.isDirectory) return t.folder;
    const ext = item.ext.toUpperCase();
    if (['EXE', 'COM', 'BAT', 'CMD', 'PS1', 'SH'].includes(ext)) return t.typeExecutable;
    if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'ISO'].includes(ext)) return t.typeArchive;
    if (['JPG', 'JPEG', 'PNG', 'GIF', 'BMP', 'SVG', 'WEBP', 'ICO'].includes(ext)) return t.typeImage;
    if (['MP3', 'WAV', 'OGG', 'FLAC', 'AAC', 'MID'].includes(ext)) return t.typeAudio;
    if (['MP4', 'AVI', 'MKV', 'MOV', 'WMV', 'WEBM'].includes(ext)) return t.typeVideo;
    if (['TXT', 'MD', 'RTF', 'LOG', 'INI'].includes(ext)) return t.typeText;
    if (['DOC', 'DOCX', 'PDF', 'XLS', 'XLSX', 'PPT', 'PPTX'].includes(ext)) return t.typeDocument;
    if (['JS', 'TS', 'TSX', 'JSX', 'HTML', 'CSS', 'JSON', 'PY', 'C', 'CPP', 'RS', 'GO', 'SQL', 'JAVA'].includes(ext))
      return t.typeCode;
    return t.file;
  };

  const formatAttributes = (item: FileItem): string => {
    const a = item.attributes;
    return `${a.readOnly ? 'R' : '.'}${a.hidden ? 'H' : '.'}${a.system ? 'S' : '.'}${a.archive ? 'A' : '.'}`;
  };

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

    // Target folder path
    const destPath = targetFolder && targetFolder.isDirectory ? `${currentPath}\\${targetFolder.name}` : currentPath;

    // 1. Check if internal items dropped
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const payload = JSON.parse(jsonData);
        if (payload && Array.isArray(payload.items) && payload.items.length > 0) {
          // Filter out dropping a folder inside itself or child path
          const validItems = payload.items.filter((item: FileItem) => {
            if (item.isDirectory) {
              const srcFolderFull = `${item.path}\\${item.name}`;
              if (destPath === srcFolderFull || destPath.startsWith(`${srcFolderFull}\\`)) {
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
      <div
        className="flex items-center min-w-full px-[var(--space-2)] py-[var(--space-1)] border-b select-none font-bold text-[11px] shrink-0 uppercase tracking-wider gap-0 whitespace-nowrap flex-nowrap"
        style={{
          backgroundColor: theme.headerBg,
          color: theme.headerText,
          borderColor: theme.borderPanel,
        }}
      >
        <div
          onClick={() => onSort('name')}
          onDoubleClick={() => autoSizeColumn('name')}
          className="flex items-center cursor-pointer hover:opacity-80 transition-opacity shrink-0 relative pr-1"
          style={{ width: `${colWidths.name}px`, minWidth: '44px' }}
        >
          <span className="truncate">{t.name}</span>
          {sortField === 'name' && <span className="ml-1 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
          {viewMode === 'full' && renderResizer('name', t.name)}
        </div>

        {viewMode === 'full' && (
          <>
            <div
              onClick={() => onSort('ext')}
              onDoubleClick={() => autoSizeColumn('ext')}
              className="text-center cursor-pointer hover:opacity-80 transition-opacity shrink-0 relative"
              style={{ width: `${colWidths.ext}px`, minWidth: '44px' }}
            >
              <span>{t.ext}</span>
              {sortField === 'ext' && <span className="ml-0.5 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
              {renderResizer('ext', t.ext)}
            </div>
            <div
              onDoubleClick={() => autoSizeColumn('type')}
              className="text-left shrink-0 px-1 opacity-90 font-semibold relative"
              style={{ width: `${colWidths.type}px`, minWidth: '72px' }}
            >
              {t.colType}
              {renderResizer('type', t.colType)}
            </div>

            <div
              onClick={() => onSort('size')}
              onDoubleClick={() => autoSizeColumn('size')}
              className="text-right cursor-pointer hover:opacity-80 transition-opacity shrink-0 px-1 relative"
              style={{ width: `${colWidths.size}px`, minWidth: '64px' }}
            >
              <span>{t.size}</span>
              {sortField === 'size' && (
                <span className="ml-0.5 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>
              )}
              {renderResizer('size', t.size)}
            </div>

            <div
              onClick={() => onSort('modifiedAt')}
              onDoubleClick={() => autoSizeColumn('date')}
              className="text-center cursor-pointer hover:opacity-80 transition-opacity shrink-0 relative"
              style={{ width: `${colWidths.date}px`, minWidth: '96px' }}
            >
              <span>{t.date}</span>
              {sortField === 'modifiedAt' && (
                <span className="ml-0.5 text-[10px]">{sortDirection === 'asc' ? '▲' : '▼'}</span>
              )}
              {renderResizer('date', t.date)}
            </div>

            <div
              onDoubleClick={() => autoSizeColumn('attr')}
              className="text-center shrink-0 hidden sm:block relative"
              style={{ width: `${colWidths.attr}px`, minWidth: '44px' }}
            >
              <span>{t.attr}</span>
              {renderResizer('attr', t.attr)}
            </div>
          </>
        )}

        <div className="flex-1" />
      </div>

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
              // The row below carries `data-name`, the entry's own name: a stable
              // hook for end-to-end tests, instead of parsing how the name and the
              // extension are split into separate columns.
              const item = items[virtualRow.index];
              const idx = virtualRow.index;
              const isFocused = idx === focusedIndex && isActive;
              const isSelected = selectedIdSet.has(item.id);
              const isHoveredTarget = dragOverFolderId === item.id;
              const isBeingDragged = draggedIds.includes(item.id);
              const textColor = getItemTextColor(item, isSelected);

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  data-name={item.fullName || (item.ext ? `${item.name}.${item.ext}` : item.name)}
                  data-focused={isFocused}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item, idx)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOverItem(e, item)}
                  onDragLeave={(e) => handleDragLeaveItem(e, item)}
                  onDrop={(e) => handleDropItem(e, item)}
                  onMouseEnter={(e) => onItemHover && onItemHover(e, item)}
                  onMouseLeave={(e) => onItemHover && onItemHover(e, null)}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      soundManager.playSelectSound();
                      onToggleSelect(item.id);
                    } else {
                      soundManager.playKeyTick();
                      onSelectIndex(idx);
                    }
                  }}
                  onDoubleClick={() => {
                    soundManager.playDiskAccess();
                    onOpenItem(item);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    onSelectIndex(idx);
                    onContextMenu(e, item);
                  }}
                  className={`flex items-center px-[var(--space-2)] py-[var(--space-1)] cursor-pointer transition-all ${
                    isBeingDragged
                      ? 'opacity-40 ring-1 ring-dashed ring-amber-400'
                      : isHoveredTarget
                        ? 'ring-2 ring-amber-400 bg-amber-400/30 font-bold text-amber-200 shadow-md'
                        : isFocused
                          ? 'font-bold'
                          : isSelected
                            ? 'bg-amber-900/30'
                            : 'hover:bg-white/5'
                  }`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    backgroundColor: isHoveredTarget
                      ? undefined
                      : isFocused
                        ? theme.cursorBg
                        : isSelected
                          ? theme.selectedBg
                          : undefined,
                    color: isHoveredTarget ? '#ffff55' : isFocused ? theme.cursorText : textColor,
                  }}
                >
                  <div
                    className="flex items-center gap-[var(--space-2)] shrink-0 min-w-0 pr-2"
                    style={{ width: `${colWidths.name}px`, minWidth: '44px' }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        soundManager.playSelectSound();
                        onToggleSelect(item.id);
                      }}
                      aria-label={`${isSelected ? t.deselectItem : t.selectItem} ${item.name}`}
                      aria-pressed={isSelected}
                      className={`w-3 h-3 flex items-center justify-center rounded-[2px] border text-[9px] shrink-0 cursor-pointer ${
                        isSelected
                          ? 'bg-amber-400 text-black border-amber-300 font-extrabold'
                          : 'border-white/30 opacity-40 hover:opacity-100'
                      }`}
                    >
                      {isSelected ? '✓' : ''}
                    </button>

                    {isFocused && blinkingCursorEnabled && (
                      <span
                        className="nc-blink font-bold shrink-0 font-mono text-[11px] select-none"
                        // The row behind the block carries the user's selection
                        // colour, so the block keeps its hue only while that hue
                        // still reads against it.
                        style={{
                          color: readableInk(
                            CURSOR_BLOCK_INK[blinkingCursorColor] ?? CURSOR_BLOCK_INK.cyan,
                            theme.cursorBg,
                            // A white row text on a bright selection colour is
                            // no more readable than the block it hides, so the
                            // block falls back to whichever of black or white
                            // wins against that row.
                            bestInk(theme.cursorBg),
                          ),
                        }}
                      >
                        █
                      </span>
                    )}

                    {getFileIcon(item, '', { width: thumbSize * 0.4, height: thumbSize * 0.4 })}

                    <span className={`truncate ${item.isDirectory ? 'font-bold' : ''}`} title={item.name}>
                      {item.name}
                    </span>

                    {isHoveredTarget && item.isDirectory && (
                      <span className="ml-auto text-[9px] bg-amber-400 text-black px-[var(--space-2)] py-[var(--space-1)] rounded font-extrabold uppercase shrink-0 shadow animate-pulse">
                        ↵ {dragOperation === 'move' ? t.moveToFolderBadge : t.copyToFolderBadge}
                      </span>
                    )}
                  </div>

                  <div
                    className="text-center shrink-0 uppercase opacity-90 truncate font-semibold"
                    style={{ width: `${colWidths.ext}px`, minWidth: '44px' }}
                  >
                    {item.isDirectory ? '' : item.ext}
                  </div>
                  <div
                    className="text-left shrink-0 truncate opacity-90 text-[11px] px-1"
                    style={{ width: `${colWidths.type}px`, minWidth: '72px' }}
                  >
                    {getItemType(item)}
                  </div>

                  <div
                    className="text-right shrink-0 tabular-nums px-1"
                    style={{ width: `${colWidths.size}px`, minWidth: '64px' }}
                  >
                    {formatSize(item)}
                  </div>

                  <div
                    className="text-center shrink-0 opacity-80 text-[11px] tabular-nums"
                    style={{ width: `${colWidths.date}px`, minWidth: '96px' }}
                  >
                    {item.modifiedAt.substring(0, 16)}
                  </div>

                  <div
                    className="text-center shrink-0 opacity-70 text-[10px] hidden sm:block tracking-widest"
                    style={{ width: `${colWidths.attr}px`, minWidth: '44px' }}
                  >
                    {formatAttributes(item)}
                  </div>
                  <div className="flex-1" />
                </div>
              );
            })}
          </div>
        )}

        {/* Brief Multi-Column Mode (virtualized) */}
        {viewMode === 'brief' && (
          <div style={{ height: `${gridRowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
            {gridRowVirtualizer.getVirtualItems().map((virtualRow) => {
              const base = virtualRow.index * gridColumns;
              const rowItems = items.slice(base, base + gridColumns);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={gridRowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                    gap: '2px',
                    padding: '4px',
                  }}
                  className="cv-auto"
                >
                  {rowItems.map((item, offset) => {
                    const idx = base + offset;
                    const isFocused = idx === focusedIndex && isActive;
                    const isSelected = selectedIdSet.has(item.id);
                    const isHoveredTarget = dragOverFolderId === item.id;
                    const textColor = getItemTextColor(item, isSelected);
                    const isBeingDragged = draggedIds.includes(item.id);

                    return (
                      <div
                        key={item.id}
                        data-focused={isFocused}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOverItem(e, item)}
                        onDragLeave={(e) => handleDragLeaveItem(e, item)}
                        onDrop={(e) => handleDropItem(e, item)}
                        onClick={() => {
                          soundManager.playKeyTick();
                          onSelectIndex(idx);
                        }}
                        onDoubleClick={() => {
                          soundManager.playDiskAccess();
                          onOpenItem(item);
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          onSelectIndex(idx);
                          onContextMenu(e, item);
                        }}
                        className={`flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] rounded cursor-pointer truncate transition-all cv-auto ${
                          isBeingDragged
                            ? 'opacity-40 ring-1 ring-dashed ring-amber-400'
                            : isHoveredTarget
                              ? 'ring-2 ring-amber-400 bg-amber-400/30 font-bold text-amber-200'
                              : isFocused
                                ? 'font-bold shadow ring-1 ring-amber-300'
                                : isSelected
                                  ? 'bg-amber-900/40'
                                  : 'hover:bg-white/10'
                        }`}
                        style={{
                          backgroundColor: isHoveredTarget ? undefined : isFocused ? theme.cursorBg : undefined,
                          color: isHoveredTarget ? '#ffff55' : isFocused ? theme.cursorText : textColor,
                        }}
                      >
                        {getFileIcon(item, '', { width: thumbSize * 0.4, height: thumbSize * 0.4 })}
                        <span
                          className="truncate font-medium flex-1"
                          title={item.name + (item.ext ? '.' + item.ext : '')}
                        >
                          {item.name}
                          {item.ext ? `.${item.ext}` : ''}
                        </span>
                        {isHoveredTarget && item.isDirectory && (
                          <span className="text-[8px] bg-amber-400 text-black px-1 rounded font-bold shrink-0">↵</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {/* Thumbnails Mode */}
        {viewMode === 'thumbnails' && (
          <div style={{ height: `${gridRowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
            {gridRowVirtualizer.getVirtualItems().map((virtualRow) => {
              const base = virtualRow.index * thumbColumns;
              const rowItems = items.slice(base, base + thumbColumns);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={gridRowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${thumbColumns}, minmax(0, 1fr))`,
                    gap: '8px',
                    padding: '8px',
                  }}
                  className="cv-auto"
                >
                  {rowItems.map((item, offset) => {
                    const idx = base + offset;
                    const isFocused = idx === focusedIndex && isActive;
                    const isSelected = selectedIdSet.has(item.id);
                    const isHoveredTarget = dragOverFolderId === item.id;
                    const isBeingDragged = draggedIds.includes(item.id);
                    const textColor = getItemTextColor(item, isSelected);

                    return (
                      <div
                        key={item.id}
                        data-focused={isFocused}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOverItem(e, item)}
                        onDragLeave={(e) => handleDragLeaveItem(e, item)}
                        onDrop={(e) => handleDropItem(e, item)}
                        onClick={() => {
                          soundManager.playKeyTick();
                          onSelectIndex(idx);
                        }}
                        onDoubleClick={() => {
                          soundManager.playDiskAccess();
                          onOpenItem(item);
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          onSelectIndex(idx);
                          onContextMenu(e, item);
                        }}
                        className={`flex flex-col items-center justify-center p-[var(--space-2)] rounded border cursor-pointer text-center transition-all cv-auto ${
                          isBeingDragged
                            ? 'opacity-40 ring-1 ring-dashed ring-amber-400'
                            : isHoveredTarget
                              ? 'ring-2 ring-amber-400 bg-amber-400/30 border-amber-300'
                              : isFocused
                                ? 'ring-2 ring-amber-400 bg-white/20'
                                : isSelected
                                  ? 'bg-amber-900/30 border-amber-400'
                                  : 'border-white/10 hover:bg-white/5'
                        }`}
                      >
                        <div
                          className="flex items-center justify-center mb-1 overflow-hidden rounded bg-black/40"
                          style={{ width: thumbSize, height: thumbSize }}
                        >
                          <CellThumbnail
                            src={isImageItem(item) ? mediaUrlFor(item) : null}
                            alt={item.name}
                            fit="contain"
                            fallback={getFileIcon(item, '', { width: thumbSize, height: thumbSize })}
                          />
                        </div>
                        <span className="truncate w-full text-[11px] font-medium" style={{ color: textColor }}>
                          {item.name}
                          {item.ext ? `.${item.ext}` : ''}
                        </span>
                        <span className="text-[10px] opacity-60 tabular-nums">{formatSize(item)}</span>
                        {isHoveredTarget && item.isDirectory && (
                          <span className="text-[9px] bg-amber-400 text-black px-1 rounded font-bold mt-1">
                            {t.dropHere}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Gallery / Mosaic Grid Mode */}
        {viewMode === 'gallery' && (
          <div style={{ height: `${gridRowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
            {gridRowVirtualizer.getVirtualItems().map((virtualRow) => {
              const base = virtualRow.index * thumbColumns;
              const rowItems = items.slice(base, base + thumbColumns);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={gridRowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${thumbColumns}, minmax(0, 1fr))`,
                    gap: '10px',
                    padding: '8px',
                  }}
                  className="cv-auto"
                >
                  {rowItems.map((item, offset) => {
                    const idx = base + offset;
                    const isFocused = idx === focusedIndex && isActive;
                    const isSelected = selectedIdSet.has(item.id);
                    const isHoveredTarget = dragOverFolderId === item.id;
                    const isBeingDragged = draggedIds.includes(item.id);
                    const textColor = getItemTextColor(item, isSelected);
                    const ext = item.ext.toLowerCase();
                    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
                    const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext);
                    const isVideo = ['mp4', 'webm', 'mkv', 'avi'].includes(ext);

                    return (
                      <div
                        key={item.id}
                        data-focused={isFocused}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOverItem(e, item)}
                        onDragLeave={(e) => handleDragLeaveItem(e, item)}
                        onDrop={(e) => handleDropItem(e, item)}
                        onClick={() => {
                          soundManager.playKeyTick();
                          onSelectIndex(idx);
                        }}
                        onDoubleClick={() => {
                          soundManager.playDiskAccess();
                          onOpenItem(item);
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          onSelectIndex(idx);
                          onContextMenu(e, item);
                        }}
                        className={`group relative flex flex-col rounded-md border p-2 cursor-pointer transition-all overflow-hidden cv-auto ${
                          isBeingDragged
                            ? 'opacity-40 ring-1 ring-dashed ring-amber-400'
                            : isHoveredTarget
                              ? 'ring-2 ring-amber-400 bg-amber-400/20 border-amber-300 shadow-xl'
                              : isFocused
                                ? 'ring-2 ring-amber-400 bg-amber-400/10 border-amber-400 shadow-lg'
                                : isSelected
                                  ? 'bg-amber-900/40 border-amber-400'
                                  : 'border-white/15 bg-black/40 hover:bg-white/10 hover:border-white/30'
                        }`}
                      >
                        {/* Card Thumbnail Box */}
                        <div className="w-full h-24 rounded bg-black/60 border border-white/10 flex items-center justify-center overflow-hidden relative mb-1.5">
                          {isImage ? (
                            <CellThumbnail
                              src={mediaUrlFor(item)}
                              alt={item.name}
                              fit="cover"
                              fallback={
                                <div
                                  className="w-full h-full flex flex-col items-center justify-center"
                                  style={{ background: theme.bgPanel, color: theme.mediaText }}
                                >
                                  <FileTypeIcon kind="image" color={theme.mediaText} className="w-8 h-8" />
                                  <span className="text-[9px] font-bold mt-1 uppercase">{ext} IMAGE</span>
                                </div>
                              }
                            />
                          ) : isAudio ? (
                            <div
                              className="w-full h-full flex flex-col items-center justify-center"
                              style={{ background: theme.bgPanel, color: theme.mediaText }}
                            >
                              <FileTypeIcon kind="audio" color={theme.mediaText} className="w-8 h-8 animate-pulse" />
                              <span className="text-[9px] font-bold mt-1 uppercase">AUDIO TRACK</span>
                            </div>
                          ) : isVideo ? (
                            <div
                              className="w-full h-full flex flex-col items-center justify-center"
                              style={{ background: theme.bgPanel, color: theme.mediaText }}
                            >
                              <FileTypeIcon kind="video" color={theme.mediaText} className="w-8 h-8" />
                              <span className="text-[9px] font-bold mt-1 uppercase">VIDEO CLIP</span>
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                              {getFileIcon(item, '', { width: thumbSize, height: thumbSize })}
                            </div>
                          )}

                          {/* Selection Indicator Badge */}
                          {isSelected && (
                            <div className="absolute top-1 right-1 bg-amber-400 text-black p-0.5 rounded-full shadow">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </div>
                          )}

                          {isHoveredTarget && item.isDirectory && (
                            <div className="absolute inset-0 bg-amber-400/80 text-black font-extrabold flex items-center justify-center text-xs uppercase shadow">
                              {t.dropHere}
                            </div>
                          )}
                        </div>

                        {/* Card Footer Meta */}
                        <div className="flex items-center justify-between text-[11px] font-semibold truncate">
                          <span
                            className="truncate"
                            title={item.name + (item.ext ? '.' + item.ext : '')}
                            style={{ color: textColor }}
                          >
                            {item.name}
                            {item.ext ? `.${item.ext}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] opacity-60 mt-[var(--space-1)] tabular-nums">
                          <span>{formatSize(item)}</span>
                          <span>{item.modifiedAt?.substring(0, 10)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
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
        totalLabel={t.statusBarTotalSize.replace('{size}', String(Math.round(stats.totalBytes / 1024)))}
      />
    </div>
  );
};

export const FileList = React.memo(FileListComponent);
