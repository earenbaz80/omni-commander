import React, { useState } from 'react';
import { Lock, Key, AlertTriangle } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface UnlockFolderModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  folderPath: string;
  expectedPassword: string;
  onSuccess: () => void;
  onClose: () => void;
}

export const UnlockFolderModal: React.FC<UnlockFolderModalProps> = ({
  theme,
  lang,
  folderPath,
  expectedPassword,
  onSuccess,
  onClose
}) => {
  const t = getTranslations(lang);
  const [passwordInput, setPasswordInput] = useState('');
  const [hasError, setHasError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === expectedPassword) {
      soundManager.playSuccess();
      onSuccess();
    } else {
      soundManager.playBeep(250, 0.2);
      setHasError(true);
      setPasswordInput('');
    }
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.unlockFolderModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded shadow-2xl border text-xs overflow-hidden animate-in zoom-in-95 duration-150"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0 bg-red-950/80 text-white"
          style={{ borderColor: theme.modalBorder }}
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <span>{t.unlockTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-950/80 border-2 border-amber-400 flex items-center justify-center text-amber-300">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-sm pt-1">{t.unlockFolder}</h3>
            <p className="text-[11px] text-amber-300 font-mono font-bold truncate max-w-full">{folderPath}</p>
          </div>

          {hasError && (
            <div className="p-2 bg-red-950 border border-red-500 text-red-200 font-bold rounded text-[11px] text-center flex items-center justify-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{t.unlockBadPass}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold mb-1 opacity-80">{t.unlockEnterPass}</label>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setHasError(false);
              }}
              placeholder={t.unlockPassPlaceholder}
              className="w-full px-3 py-2 bg-black/70 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs text-center tracking-widest"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel}
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              {t.unlockBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
