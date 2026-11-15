import React, { useEffect, useState } from 'react';
import type { VirtualItem } from '@tanstack/react-virtual';
import { Check } from 'lucide-react';
import { FileTypeIcon } from './FileTypeIcon';
import { FileItem, ViewMode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { isImageItem, mediaUrlFor } from '../services/mediaUrl';
import { FileIcon } from './FileListIcon';
import { formatSize, getItemTextColor, type Translations } from './fileListDisplay';
import type { FileListHandlers } from './FileListRow';

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

interface FileListGridProps {
  mode: Exclude<ViewMode, 'full'>;
  items: FileItem[];
  columns: number;
  thumbSize: number;
  theme: ThemeConfig;
  t: Translations;
  focusedIndex: number;
  isActive: boolean;
  selectedIdSet: Set<string>;
  dragOverFolderId: string | null;
  draggedIds: string[];
  virtualRows: VirtualItem[];
  totalSize: number;
  measureElement: (element: Element | null) => void;
  handlers: FileListHandlers;
}

/**
 * The three non-column views share one virtualized row window; only the cell
 * itself changes shape between a compact line, a thumbnail and a card.
 */
export const FileListGrid: React.FC<FileListGridProps> = ({
  mode,
  items,
  columns,
  thumbSize,
  theme,
  t,
  focusedIndex,
  isActive,
  selectedIdSet,
  dragOverFolderId,
  draggedIds,
  virtualRows,
  totalSize,
  measureElement,
  handlers,
}) => (
  <div style={{ height: `${totalSize}px`, position: 'relative', width: '100%' }}>
    {virtualRows.map((virtualRow) => {
      const base = virtualRow.index * columns;
      const rowItems = items.slice(base, base + columns);
      return (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={measureElement}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: mode === 'brief' ? '2px' : mode === 'thumbnails' ? '8px' : '10px',
            padding: mode === 'brief' ? '4px' : '8px',
          }}
          className="cv-auto"
        >
          {rowItems.map((item, offset) => {
            const idx = base + offset;
            const isFocused = idx === focusedIndex && isActive;
            const isSelected = selectedIdSet.has(item.id);
            const isHoveredTarget = dragOverFolderId === item.id;
            const isBeingDragged = draggedIds.includes(item.id);
            const textColor = getItemTextColor(item, isSelected, theme);

            if (mode === 'brief') {
              return (
                <div
                  key={item.id}
                  data-focused={isFocused}
                  draggable
                  onDragStart={(e) => handlers.startDrag(e, item, idx)}
                  onDragEnd={handlers.endDrag}
                  onDragOver={(e) => handlers.dragOver(e, item)}
                  onDragLeave={(e) => handlers.dragLeave(e, item)}
                  onDrop={(e) => handlers.drop(e, item)}
                  onClick={() => {
                    soundManager.playKeyTick();
                    handlers.selectIndex(idx);
                  }}
                  onDoubleClick={() => {
                    soundManager.playDiskAccess();
                    handlers.openItem(item);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    handlers.selectIndex(idx);
                    handlers.contextMenu(e, item);
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
                  <FileIcon
                    item={item}
                    theme={theme}
                    size=""
                    style={{ width: thumbSize * 0.4, height: thumbSize * 0.4 }}
                  />
                  <span className="truncate font-medium flex-1" title={item.name + (item.ext ? '.' + item.ext : '')}>
                    {item.name}
                    {item.ext ? `.${item.ext}` : ''}
                  </span>
                  {isHoveredTarget && item.isDirectory && (
                    <span className="text-[8px] bg-amber-400 text-black px-1 rounded font-bold shrink-0">↵</span>
                  )}
                </div>
              );
            }

            if (mode === 'thumbnails') {
              return (
                <div
                  key={item.id}
                  data-focused={isFocused}
                  draggable
                  onDragStart={(e) => handlers.startDrag(e, item, idx)}
                  onDragEnd={handlers.endDrag}
                  onDragOver={(e) => handlers.dragOver(e, item)}
                  onDragLeave={(e) => handlers.dragLeave(e, item)}
                  onDrop={(e) => handlers.drop(e, item)}
                  onClick={() => {
                    soundManager.playKeyTick();
                    handlers.selectIndex(idx);
                  }}
                  onDoubleClick={() => {
                    soundManager.playDiskAccess();
                    handlers.openItem(item);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    handlers.selectIndex(idx);
                    handlers.contextMenu(e, item);
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
                      fallback={
                        <FileIcon item={item} theme={theme} size="" style={{ width: thumbSize, height: thumbSize }} />
                      }
                    />
                  </div>
                  <span className="truncate w-full text-[11px] font-medium" style={{ color: textColor }}>
                    {item.name}
                    {item.ext ? `.${item.ext}` : ''}
                  </span>
                  <span className="text-[10px] opacity-60 tabular-nums">{formatSize(item, t)}</span>
                  {isHoveredTarget && item.isDirectory && (
                    <span className="text-[9px] bg-amber-400 text-black px-1 rounded font-bold mt-1">{t.dropHere}</span>
                  )}
                </div>
              );
            }

            const ext = item.ext.toLowerCase();
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
            const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext);
            const isVideo = ['mp4', 'webm', 'mkv', 'avi'].includes(ext);

            return (
              <div
                key={item.id}
                data-focused={isFocused}
                draggable
                onDragStart={(e) => handlers.startDrag(e, item, idx)}
                onDragEnd={handlers.endDrag}
                onDragOver={(e) => handlers.dragOver(e, item)}
                onDragLeave={(e) => handlers.dragLeave(e, item)}
                onDrop={(e) => handlers.drop(e, item)}
                onClick={() => {
                  soundManager.playKeyTick();
                  handlers.selectIndex(idx);
                }}
                onDoubleClick={() => {
                  soundManager.playDiskAccess();
                  handlers.openItem(item);
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handlers.selectIndex(idx);
                  handlers.contextMenu(e, item);
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
                      <FileIcon item={item} theme={theme} size="" style={{ width: thumbSize, height: thumbSize }} />
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
                  <span>{formatSize(item, t)}</span>
                  <span>{item.modifiedAt?.substring(0, 10)}</span>
                </div>
              </div>
            );
          })}
        </div>
      );
    })}
  </div>
);
