import React, { useState, useEffect } from 'react';
import { Star, Plus, Trash2, ArrowRight, Folder } from 'lucide-react';
import { BookmarkItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';

interface BookmarksHotlistModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  currentPath: string;
  currentDriveId: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
}

const STORAGE_KEY = 'nc_hotlist_bookmarks_v1';

const defaultBookmarks: BookmarkItem[] = [];

export const BookmarksHotlistModal: React.FC<BookmarksHotlistModalProps> = ({
  theme,
  lang,
  currentPath,
  currentDriveId,
  onNavigate,
  onClose
}) => {
  const t = getTranslations(lang);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return defaultBookmarks;
  });

  const [newTitle, setNewTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    } catch { /* ignore */ }
  }, [bookmarks]);

  const handleAddCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newBm: BookmarkItem = {
      id: `bm_${Date.now()}`,
      title: newTitle.trim(),
      path: currentPath,
      driveId: currentDriveId,
      isFavorite: true
    };

    setBookmarks(prev => [newBm, ...prev]);
    setNewTitle('');
    setIsAdding(false);
    soundManager.playSuccess();
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBookmarks(prev => prev.filter(b => b.id !== id));
    soundManager.playKeyTick();
  };

  const handleSelect = (item: BookmarkItem) => {
    soundManager.playDiskAccess();
    onNavigate(item.path);
    onClose();
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.hotlistModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fadeIn select-none font-mono">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded shadow-2xl border flex flex-col overflow-hidden text-xs max-h-[85vh]"
        style={{
          backgroundColor: theme.bgPanel,
          borderColor: theme.borderPanel,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-1.5 font-bold uppercase tracking-wider select-none border-b"
          style={{
            backgroundColor: theme.headerBg,
            color: theme.headerText,
            borderColor: theme.borderPanel
          }}
        >
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400 fill-amber-400/30" />
            <span>{t.hotlistTitle}</span>
          </div>
          <button 
            onClick={onClose}
            className="px-2 py-0.5 bg-black/30 hover:bg-black/60 rounded text-xs cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>

        {/* Current Path Info & Add Button */}
        <div className="p-3 bg-black/40 border-b border-white/10 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="opacity-70">{t.hotlistCurrent}</span>
            <span className="font-bold text-amber-300 truncate max-w-[280px]">{currentPath}</span>
          </div>

          {!isAdding ? (
            <button
              onClick={() => {
                setNewTitle(currentPath.split('\\').pop() || currentPath);
                setIsAdding(true);
              }}
              className="mt-1 py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-500/40 rounded flex items-center justify-center gap-1.5 font-bold transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.hotlistAdd}</span>
            </button>
          ) : (
            <form onSubmit={handleAddCurrent} className="flex items-center gap-1.5 mt-1">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder={t.hotlistNamePlaceholder}
                autoFocus
                className="flex-1 bg-black/80 border border-amber-400 px-2 py-1 text-white rounded outline-none text-xs"
              />
              <button
                type="submit"
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold cursor-pointer"
              >
                {t.btnSave}
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded cursor-pointer"
              >
                ✕
              </button>
            </form>
          )}
        </div>

        {/* Bookmark List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-80">
          {bookmarks.map((bm, index) => {
            const isSelected = selectedIndex === index;
            return (
              <div
                key={bm.id}
                onClick={() => handleSelect(bm)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex items-center justify-between p-2 rounded cursor-pointer transition border ${
                  isSelected 
                    ? 'bg-amber-500/20 border-amber-400 text-white font-bold' 
                    : 'bg-black/30 border-transparent hover:bg-white/5 opacity-90'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="flex flex-col truncate">
                    <span className="text-xs font-bold text-amber-200 truncate">{bm.title}</span>
                    <span className="text-[10px] opacity-60 font-mono truncate">{bm.path}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => handleDelete(bm.id, e)}
                    className="p-1 text-neutral-400 hover:text-rose-400 hover:bg-rose-950/30 rounded cursor-pointer"
                    title={t.hotlistDelete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ArrowRight className="w-3.5 h-3.5 opacity-50" />
                </div>
              </div>
            );
          })}

          {bookmarks.length === 0 && (
            <div className="py-8 text-center opacity-50 italic">
              {t.hotlistEmpty}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 bg-black/60 border-t border-white/10 flex items-center justify-between text-[10px] opacity-75">
          <span>{t.hotlistHint}</span>
          <span>{t.escToExit}</span>
        </div>
      </div>
    </div>
  );
};
