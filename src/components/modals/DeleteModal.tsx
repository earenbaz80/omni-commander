import React from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface DeleteModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  items: FileItem[];
  onConfirm: () => void;
  onClose: () => void;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({ theme, lang, items, onConfirm, onClose }) => {
  const t = getTranslations(lang);
  const totalSize = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);

  const handleConfirm = () => {
    soundManager.playBeep(440, 0.1);
    onConfirm();
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.deleteDialogLabel);

  return (
    <ModalShell title={t.deleteDialogLabel} theme={theme} onClose={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b font-bold shrink-0 bg-red-900/60 text-white"
          style={{ borderColor: theme.modalBorder }}
        >
          <div className="flex items-center gap-[var(--space-2)]">
            <Trash2 className="w-4 h-4 text-red-300" />
            <span>{t.deleteTitle} (F8 / Supr)</span>
          </div>
          <button
            onClick={onClose}
            className="px-[var(--space-2)] py-[var(--space-1)] bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-[var(--space-4)] space-y-[var(--space-4)]">
          <div className="flex items-start gap-[var(--space-3)]">
            <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-white mb-[var(--space-1)]">{t.msgConfirmDelete}</p>
              <p className="opacity-75 text-[var(--fs-sm)]">
                {t.deleteSummary.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())}
              </p>
            </div>
          </div>

          <div className="max-h-32 overflow-y-auto bg-black/40 p-[var(--space-2)] rounded border border-white/10 text-[var(--fs-sm)] space-y-0.5">
            {items.map((i) => (
              <div key={i.id} className="truncate text-red-300">
                • {i.name}
                {i.ext ? `.${i.ext}` : ''} {i.isDirectory ? t.markerFolder : ''}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
            <button
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-[var(--space-2)] bg-red-600 hover:bg-red-500 text-white font-extrabold rounded cursor-pointer shadow"
            >
              {t.delete} (Enter)
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
