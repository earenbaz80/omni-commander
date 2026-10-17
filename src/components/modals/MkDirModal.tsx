import React, { useState } from 'react';
import { FolderPlus, FilePlus } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface MkDirModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  currentPath: string;
  isNewFile?: boolean;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export const MkDirModal: React.FC<MkDirModalProps> = ({
  theme,
  lang,
  currentPath,
  isNewFile = false,
  onConfirm,
  onClose
}) => {
  const t = getTranslations(lang);
  const [name, setName] = useState(isNewFile ? 'NewDocument.txt' : 'NEW_FOLDER');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    soundManager.playDiskAccess();
    onConfirm(name.trim());
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.toolbarNewFolder);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            {isNewFile ? <FilePlus className="w-4 h-4" /> : <FolderPlus className="w-4 h-4" />}
            <span>{isNewFile ? t.newFileTitle : `${t.mkdirTitle} (F7)`}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <span className="opacity-75 block mb-1">
              {t.mkdirCreateIn} <strong className="text-white">{currentPath}</strong>
            </span>
            <label className="block font-bold text-white mb-1">
              {isNewFile ? t.mkdirFileNameLabel : t.mkdirDirNameLabel}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {t.btnOk} (Enter)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
