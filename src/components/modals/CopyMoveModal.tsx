import React, { useState } from 'react';
import { Copy, Scissors } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface CopyMoveModalProps {
  type: 'copy' | 'move';
  theme: ThemeConfig;
  lang: LanguageCode;
  items: FileItem[];
  sourcePath: string;
  targetPath: string;
  targetDriveId: string;
  onConfirm: (targetPath: string, overwrite: boolean) => void;
  onClose: () => void;
}

export const CopyMoveModal: React.FC<CopyMoveModalProps> = ({
  type,
  theme,
  lang,
  items,
  targetPath,
  onConfirm,
  onClose
}) => {
  const t = getTranslations(lang);
  const [destPath, setDestPath] = useState(targetPath);
  const [overwrite, setOverwrite] = useState(true);

  const isCopy = type === 'copy';
  const totalSize = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destPath.trim()) return;
    soundManager.playDiskAccess();
    onConfirm(destPath.trim(), overwrite);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.copyMoveModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            {isCopy ? <Copy className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
            <span>{isCopy ? t.copyTitle : t.moveTitle} ({isCopy ? 'F5' : 'F6'})</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer">✕</button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <span className="opacity-75 block mb-1">
              {isCopy
                ? t.copyItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())
                : t.moveItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())}
            </span>
            <div className="max-h-24 overflow-y-auto bg-black/40 p-2 rounded border border-white/10 text-[11px] mb-2">
              {items.map(i => (
                <div key={i.id} className="truncate text-amber-300">
                  • {i.name}{i.ext ? `.${i.ext}` : ''} {i.isDirectory ? '<DIR>' : ''}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-white mb-1">{t.copyMoveDestLabel}</label>
            <input
              type="text"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="overwriteCheck"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="overwriteCheck" className="cursor-pointer opacity-90">
              {t.copyMoveOverwrite}
            </label>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
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
              {isCopy ? t.copyConfirm : t.moveConfirm}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
