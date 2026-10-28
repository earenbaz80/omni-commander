import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  RefreshCw,
  LayoutGrid,
  List,
  Columns,
  FolderTree,
  Image as ImageIcon,
} from 'lucide-react';
import { ViewMode, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { getTranslations } from '../i18n/translations';

interface PathBarProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  currentPath: string;
  driveLetter: string;
  onNavigate: (newPath: string) => void;
  onGoParent: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onRefresh: () => void;
  filterText: string;
  onFilterChange: (text: string) => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  isActive: boolean;
  isTreeVisible?: boolean;
  onToggleTree?: () => void;
}

export const PathBar: React.FC<PathBarProps> = ({
  theme,
  lang,
  currentPath,
  driveLetter,
  onNavigate,
  onGoParent,
  onGoBack,
  onGoForward,
  canGoBack,
  canGoForward,
  onRefresh,
  viewMode,
  onChangeViewMode,
  isActive,
  isTreeVisible,
  onToggleTree,
}) => {
  const t = getTranslations(lang);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentPath);
  const [showFilterInput] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Vertical wheel (mouse) -> horizontal scroll of the path bar
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!delta) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // Touch / stylus drag -> horizontal scroll (mirrors DriveBar behaviour)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startX = 0;
    let startLeft = 0;
    let touching = false;

    const ts = (e: TouchEvent) => {
      if (!e.touches.length) return;
      touching = true;
      startX = e.touches[0].clientX;
      startLeft = el.scrollLeft;
    };
    const tm = (e: TouchEvent) => {
      if (!touching || !e.touches.length) return;
      const delta = e.touches[0].clientX - startX;
      el.scrollLeft = startLeft - delta;
      if (Math.abs(delta) > 4) e.preventDefault();
    };
    const te = () => {
      touching = false;
    };

    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
    };
  }, []);

  useEffect(() => {
    setEditValue(currentPath);
  }, [currentPath]);
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (showFilterInput && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [showFilterInput]);

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditing(false);
    if (editValue.trim() && editValue !== currentPath) {
      soundManager.playDiskAccess();
      onNavigate(editValue.trim());
    }
  };

  const segments = currentPath ? currentPath.split('\\').filter(Boolean) : [];

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-[var(--space-1)] px-[var(--space-1)] py-[var(--space-1)] text-xs border-b shrink-0 font-mono select-none w-full min-w-0"
      style={{
        backgroundColor: isActive ? theme.bgPanel : theme.bgPanelInactive,
        borderColor: theme.borderPanel,
        color: theme.itemText,
      }}
    >
      {/* Horizontal gesture scroller: shrinks with the panel and scrolls its content */}
      <div
        ref={scrollRef}
        className="flex-1 min-w-0 overflow-x-auto no-scrollbar scrollbar-hidden overscroll-x-contain"
      >
        <div className="flex min-w-max items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)]">
          {/* Left controls: Back, Forward, Up, Refresh */}
          <div className="flex items-center gap-[var(--space-1)] shrink-0">
            <button
              onClick={() => {
                soundManager.playKeyTick();
                onGoBack();
              }}
              disabled={!canGoBack}
              title={t.navBack}
              className={`p-[var(--space-1)] rounded ${canGoBack ? 'hover:bg-black/30 cursor-pointer text-white' : 'opacity-30 cursor-not-allowed'}`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                soundManager.playKeyTick();
                onGoForward();
              }}
              disabled={!canGoForward}
              title={t.navForward}
              className={`p-[var(--space-1)] rounded ${canGoForward ? 'hover:bg-black/30 cursor-pointer text-white' : 'opacity-30 cursor-not-allowed'}`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                soundManager.playDiskAccess();
                onGoParent();
              }}
              title={t.navUp}
              className="p-[var(--space-1)] hover:bg-black/30 rounded cursor-pointer text-white"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                soundManager.playKeyTick();
                onRefresh();
              }}
              title={t.refresh}
              className="p-[var(--space-1)] hover:bg-black/30 rounded cursor-pointer text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Path Display / Breadcrumbs or Text Input */}
          <div className="flex-1 min-w-max bg-black/40 border border-white/20 rounded px-[var(--space-2)] py-[var(--space-1)] text-xs flex items-center">
            {isEditing ? (
              <form onSubmit={handleEditSubmit} className="w-full">
                <input
                  ref={inputRef}
                  type="text"
                  data-path-input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => setIsEditing(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setIsEditing(false);
                  }}
                  className="w-full bg-transparent border-none outline-none text-white font-mono text-xs"
                />
              </form>
            ) : (
              <div
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-[var(--space-1)] whitespace-nowrap cursor-text w-full py-[var(--space-1)]"
                title={t.pathEditHint}
              >
                <span className="font-bold text-amber-300 shrink-0">{driveLetter}\</span>
                {segments.map((seg, idx) => {
                  const segPath = segments.slice(0, idx + 1).join('\\');
                  const fullSegPath = `${driveLetter}\\${segPath}`;
                  return (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span className="opacity-40 shrink-0">\</span>}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          soundManager.playDiskAccess();
                          onNavigate(fullSegPath);
                        }}
                        className="hover:underline hover:text-yellow-200 whitespace-nowrap cursor-pointer font-medium shrink-0"
                      >
                        {seg}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Tools: Filter input & View modes */}
          <div className="flex items-center gap-[var(--space-1)] shrink-0">
            {/* View Mode Buttons */}
            <div className="flex items-center bg-black/30 rounded border border-white/10 p-[var(--space-1)]">
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  onChangeViewMode('full');
                }}
                title={t.viewFull}
                className={`p-[var(--space-1)] rounded cursor-pointer ${viewMode === 'full' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'}`}
              >
                <List className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  onChangeViewMode('brief');
                }}
                title={t.viewBrief}
                className={`p-[var(--space-1)] rounded cursor-pointer ${viewMode === 'brief' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'}`}
              >
                <Columns className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  onChangeViewMode('thumbnails');
                }}
                title={t.viewThumbnails}
                className={`p-[var(--space-1)] rounded cursor-pointer ${viewMode === 'thumbnails' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'}`}
              >
                <LayoutGrid className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  onChangeViewMode('gallery');
                }}
                title={t.galleryView}
                className={`p-[var(--space-1)] rounded cursor-pointer ${viewMode === 'gallery' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10 text-white/80'}`}
              >
                <ImageIcon className="w-3 h-3" />
              </button>
            </div>

            {/* Tree Sidebar Toggle Button */}
            {onToggleTree && (
              <button
                onClick={() => {
                  soundManager.playKeyTick();
                  onToggleTree();
                }}
                title={isTreeVisible ? t.hideDirectoryTree : t.showDirectoryTree}
                className={`p-[var(--space-1)] rounded cursor-pointer border flex items-center gap-[var(--space-1)] text-[11px] font-bold transition-all ${
                  isTreeVisible
                    ? 'bg-amber-400 text-black border-amber-300 shadow'
                    : 'bg-black/30 hover:bg-black/50 text-white/80 border-white/15'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span className="hidden xl:inline text-[10px]">{t.tree}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
