import React, { useState } from 'react';
import { Trash2, RotateCcw, Folder, FileText, CheckCircle2 } from 'lucide-react';
import { RecycleBinItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';
import { fsEngine } from '../../services/fileSystem';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';

interface RecycleBinModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onRefresh: () => void;
  onClose: () => void;
}

export const RecycleBinModal: React.FC<RecycleBinModalProps> = ({
  theme,
  lang,
  onRefresh,
  onClose
}) => {
  const t = getTranslations(lang);
  const [items, setItems] = useState<RecycleBinItem[]>(() => fsEngine.getRecycleBinItems());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refreshList = () => {
    setItems(fsEngine.getRecycleBinItems());
    onRefresh();
  };

  const handleRestore = (id: string) => {
    const ok = fsEngine.restoreFromRecycleBin(id);
    if (ok) {
      soundManager.playSuccess();
      refreshList();
    }
  };

  const handleRestoreAll = () => {
    items.forEach(i => fsEngine.restoreFromRecycleBin(i.id));
    soundManager.playSuccess();
    refreshList();
  };

  const handlePermanentDelete = (id: string) => {
    fsEngine.deletePermanentlyFromRecycleBin(id);
    soundManager.playKeyTick();
    refreshList();
  };

  const handleEmptyBin = () => {
    fsEngine.emptyRecycleBin();
    soundManager.playKeyTick();
    refreshList();
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.recycleBinModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fadeIn select-none font-mono">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl rounded shadow-2xl border flex flex-col overflow-hidden text-xs max-h-[85vh]"
        style={{
          backgroundColor: theme.bgPanel,
          borderColor: theme.borderPanel,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 font-bold uppercase tracking-wider select-none border-b"
          style={{
            backgroundColor: theme.headerBg,
            color: theme.headerText,
            borderColor: theme.borderPanel
          }}
        >
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>{t.binTitle}</span>
          </div>
          <button 
            onClick={onClose}
            className="px-2 py-0.5 bg-black/30 hover:bg-black/60 rounded text-xs cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>

        {/* Action Controls */}
        <div className="p-3 bg-black/40 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-amber-300">{items.length}</span>
            <span className="opacity-75">{t.binItems}</span>
          </div>

          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <>
                <button
                  onClick={handleRestoreAll}
                  className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded flex items-center gap-1 font-bold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t.binRestoreAll}</span>
                </button>
                <button
                  onClick={handleEmptyBin}
                  className="px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 rounded flex items-center gap-1 font-bold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.binEmpty}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Item Table */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-96">
          {items.map((binItem) => {
            const isSelected = selectedId === binItem.id;
            return (
              <div
                key={binItem.id}
                onClick={() => setSelectedId(binItem.id)}
                className={`flex items-center justify-between p-2 rounded transition border ${
                  isSelected 
                    ? 'bg-amber-500/20 border-amber-400 text-white' 
                    : 'bg-black/30 border-transparent hover:bg-white/5 opacity-90'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {binItem.item.isDirectory ? (
                    <Folder className="w-4 h-4 text-amber-300 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-sky-300 shrink-0" />
                  )}
                  <div className="flex flex-col truncate">
                    <span className="font-bold text-xs truncate">{binItem.item.name}{binItem.item.ext ? `.${binItem.item.ext}` : ''}</span>
                    <span className="text-[10px] opacity-60 truncate">{t.recycleBinOriginalLocation.replace('{path}', binItem.originalPath)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 text-[11px] tabular-nums">
                  <span className="opacity-60">{formatSize(binItem.item.size)}</span>
                  <span className="opacity-50 text-[10px] hidden sm:inline">{binItem.deletedAt}</span>

                  <div className="flex items-center gap-1.5 ml-2">
                    <button
                      onClick={() => handleRestore(binItem.id)}
                      className="px-2 py-0.5 bg-emerald-700/40 hover:bg-emerald-600 text-emerald-200 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      title={t.binRestoreHint}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t.binRestore}</span>
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(binItem.id)}
                      className="p-1 text-rose-400 hover:text-rose-200 hover:bg-rose-950/40 rounded cursor-pointer"
                      title={t.binDeletePerm}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="py-12 flex flex-col items-center justify-center text-center opacity-60 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 opacity-60" />
              <span className="text-sm font-bold">{t.binEmptyMsg}</span>
              <span className="text-[11px]">{t.binEmptyHint}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 bg-black/60 border-t border-white/10 flex items-center justify-between text-[10px] opacity-75">
          <span>{t.recycleBinRestoreHint}</span>
          <span>{t.escToClose}</span>
        </div>
      </div>
    </div>
  );
};
