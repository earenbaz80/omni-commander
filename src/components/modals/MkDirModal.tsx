import React, { useState } from 'react';
import { FolderPlus, FilePlus } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

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
  onClose,
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
    <ModalShell
      title={isNewFile ? t.newFileTitle : `${t.mkdirTitle} (F7)`}
      theme={theme}
      onClose={onClose}
      closeButtonLabel={t.btnCancel}
    >
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <form onSubmit={handleSubmit} className="p-[var(--space-4)] space-y-[var(--space-4)]">
          <div>
            <span className="opacity-75 block mb-[var(--space-1)]">
              {t.mkdirCreateIn} <strong className="text-white">{currentPath}</strong>
            </span>
            <label className="block font-bold text-white mb-[var(--space-1)]">
              {isNewFile ? t.mkdirFileNameLabel : t.mkdirDirNameLabel}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
            <button
              type="submit"
              className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {t.btnOk} (Enter)
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
};
