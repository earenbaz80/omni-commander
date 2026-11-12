import React, { useState } from 'react';
import { Trash2, RotateCcw, Folder, FileText, CheckCircle2 } from 'lucide-react';
import { RecycleBinItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';
import { fsEngine } from '../../services/fileSystem';

import { getTranslations } from '../../i18n/translations';
import { formatBytes } from '../../utils/formatBytes';
import ModalShell from '../ModalShell';

interface RecycleBinModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onRefresh: () => void;
  onClose: () => void;
}

export const RecycleBinModal: React.FC<RecycleBinModalProps> = ({ theme, lang, onRefresh, onClose }) => {
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
    items.forEach((i) => fsEngine.restoreFromRecycleBin(i.id));
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

  return (
    <ModalShell title={t.binTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        {/* Action Controls */}
        <div className="p-[var(--space-3)] bg-black/40 border-b border-white/10 flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <div className="flex items-center gap-[var(--space-2)] text-xs">
            <span className="font-bold text-amber-300">{items.length}</span>
            <span className="opacity-75">{t.binItems}</span>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            {items.length > 0 && (
              <>
                <button
                  onClick={handleRestoreAll}
                  className="px-[var(--space-3)] py-[var(--space-1)] bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded flex items-center gap-[var(--space-1)] font-bold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t.binRestoreAll}</span>
                </button>
                <button
                  onClick={handleEmptyBin}
                  className="px-[var(--space-3)] py-[var(--space-1)] nc-danger-surface-strong hover:nc-danger-surface-strong nc-danger-ink border nc-danger-edge rounded flex items-center gap-[var(--space-1)] font-bold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.binEmpty}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Item Table */}
        <div className="flex-1 overflow-y-auto p-[var(--space-2)] space-y-[var(--space-1)] max-h-96">
          {items.map((binItem) => {
            const isSelected = selectedId === binItem.id;
            return (
              <div
                key={binItem.id}
                onClick={() => setSelectedId(binItem.id)}
                className={`flex items-center justify-between p-[var(--space-2)] rounded transition border ${
                  isSelected
                    ? 'bg-amber-500/20 border-amber-400 text-white'
                    : 'bg-black/30 border-transparent hover:bg-white/5 opacity-90'
                }`}
              >
                <div className="flex items-center gap-[var(--space-2)].5 min-w-0 flex-1">
                  {binItem.item.isDirectory ? (
                    <Folder className="w-4 h-4 text-amber-300 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-sky-300 shrink-0" />
                  )}
                  <div className="flex flex-col truncate">
                    <span className="font-bold text-xs truncate">
                      {binItem.item.name}
                      {binItem.item.ext ? `.${binItem.item.ext}` : ''}
                    </span>
                    <span className="text-[var(--fs-8)] opacity-60 truncate">
                      {t.recycleBinOriginalLocation.replace('{path}', binItem.originalPath)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-[var(--space-4)] shrink-0 text-[var(--fs-sm)] tabular-nums">
                  <span className="opacity-60">{formatBytes(binItem.item.size)}</span>
                  <span className="opacity-50 text-[var(--fs-8)] hidden sm:inline">{binItem.deletedAt}</span>

                  <div className="flex items-center gap-[var(--space-2)] ml-[var(--space-2)]">
                    <button
                      onClick={() => handleRestore(binItem.id)}
                      className="px-[var(--space-2)] py-[var(--space-1)] bg-emerald-700/40 hover:bg-emerald-600 text-emerald-200 rounded text-[var(--fs-8)] font-bold flex items-center gap-[var(--space-1)] cursor-pointer"
                      title={t.binRestoreHint}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t.binRestore}</span>
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(binItem.id)}
                      className="p-[var(--space-1)] nc-danger-ink hover:nc-danger-ink-soft hover:nc-danger-surface-strong rounded cursor-pointer"
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
            <div className="py-12 flex flex-col items-center justify-center text-center opacity-60 space-y-[var(--space-2)]">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 opacity-60" />
              <span className="text-sm font-bold">{t.binEmptyMsg}</span>
              <span className="text-[var(--fs-sm)]">{t.binEmptyHint}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-[var(--space-2)].5 bg-black/60 border-t border-white/10 flex items-center justify-between text-[var(--fs-8)] opacity-75">
          <span>{t.recycleBinRestoreHint}</span>
          <span>{t.escToClose}</span>
        </div>
      </div>
    </ModalShell>
  );
};
