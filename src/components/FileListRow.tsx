import React from 'react';
import { FileItem } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { bestInk, readableInk } from '../utils/contrast';
import { soundManager } from '../services/soundEffects';
import { FileIcon } from './FileListIcon';
import { CURSOR_BLOCK_INK, formatAttributes, formatSize, getItemType, type Translations } from './fileListDisplay';

export type CursorColor = 'amber' | 'cyan' | 'green' | 'red' | 'white';

/** What a row delegates back to the list that owns selection, drag and navigation. */
export interface FileListHandlers {
  startDrag: (e: React.DragEvent, item: FileItem, index: number) => void;
  endDrag: () => void;
  dragOver: (e: React.DragEvent, item: FileItem) => void;
  dragLeave: (e: React.DragEvent, item: FileItem) => void;
  drop: (e: React.DragEvent, item: FileItem) => void;
  hover: (e: React.MouseEvent, item: FileItem | null) => void;
  toggleSelect: (id: string) => void;
  selectIndex: (index: number) => void;
  openItem: (item: FileItem) => void;
  contextMenu: (e: React.MouseEvent, item: FileItem | null) => void;
}

interface FileListRowProps {
  item: FileItem;
  index: number;
  start: number;
  measureElement: (element: Element | null) => void;
  isFocused: boolean;
  isSelected: boolean;
  isHoveredTarget: boolean;
  isBeingDragged: boolean;
  textColor: string;
  theme: ThemeConfig;
  t: Translations;
  colWidths: Record<string, number>;
  thumbSize: number;
  blinkingCursorEnabled: boolean;
  blinkingCursorColor: CursorColor;
  dragOperation: 'copy' | 'move';
  handlers: FileListHandlers;
}

/**
 * One row of the classic full listing. It carries the item's name as `data-name`,
 * a stable hook for end-to-end tests, instead of parsing how the name and the
 * extension are split into separate columns.
 */
export const FileListRow: React.FC<FileListRowProps> = ({
  item,
  index,
  start,
  measureElement,
  isFocused,
  isSelected,
  isHoveredTarget,
  isBeingDragged,
  textColor,
  theme,
  t,
  colWidths,
  thumbSize,
  blinkingCursorEnabled,
  blinkingCursorColor,
  dragOperation,
  handlers,
}) => (
  <div
    data-index={index}
    ref={measureElement}
    data-name={item.fullName || (item.ext ? `${item.name}.${item.ext}` : item.name)}
    data-focused={isFocused}
    draggable
    onDragStart={(e) => handlers.startDrag(e, item, index)}
    onDragEnd={handlers.endDrag}
    onDragOver={(e) => handlers.dragOver(e, item)}
    onDragLeave={(e) => handlers.dragLeave(e, item)}
    onDrop={(e) => handlers.drop(e, item)}
    onMouseEnter={(e) => handlers.hover(e, item)}
    onMouseLeave={(e) => handlers.hover(e, null)}
    onClick={(e) => {
      if (e.ctrlKey || e.metaKey) {
        soundManager.playSelectSound();
        handlers.toggleSelect(item.id);
      } else {
        soundManager.playKeyTick();
        handlers.selectIndex(index);
      }
    }}
    onDoubleClick={() => {
      soundManager.playDiskAccess();
      handlers.openItem(item);
    }}
    onContextMenu={(e) => {
      e.stopPropagation();
      handlers.selectIndex(index);
      handlers.contextMenu(e, item);
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
      transform: `translateY(${start}px)`,
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
          handlers.toggleSelect(item.id);
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
          // The row behind the block carries the user's selection colour, so the
          // block keeps its hue only while that hue still reads against it.
          style={{
            color: readableInk(
              CURSOR_BLOCK_INK[blinkingCursorColor] ?? CURSOR_BLOCK_INK.cyan,
              theme.cursorBg,
              // A white row text on a bright selection colour is no more
              // readable than the block it hides, so the block falls back to
              // whichever of black or white wins against that row.
              bestInk(theme.cursorBg),
            ),
          }}
        >
          █
        </span>
      )}

      <FileIcon item={item} theme={theme} size="" style={{ width: thumbSize * 0.4, height: thumbSize * 0.4 }} />

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
      {getItemType(item, t)}
    </div>

    <div className="text-right shrink-0 tabular-nums px-1" style={{ width: `${colWidths.size}px`, minWidth: '64px' }}>
      {formatSize(item, t)}
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
