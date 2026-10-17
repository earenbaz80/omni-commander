import React, { useState } from 'react';
import { Lock, ShieldCheck, Key, AlertTriangle } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface ProtectFolderModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  folderPath: string;
  isAlreadyProtected: boolean;
  onSetFolderPassword: (folderPath: string, password: string | null) => void;
  onClose: () => void;
}

export const ProtectFolderModal: React.FC<ProtectFolderModalProps> = ({
  theme,
  lang,
  folderPath,
  isAlreadyProtected,
  onSetFolderPassword,
  onClose
}) => {
  const t = getTranslations(lang);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSave = () => {
    if (!password.trim()) {
      setErrorMsg(t.protectInvalidPass);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg(t.protectMismatch);
      return;
    }
    soundManager.playSuccess();
    onSetFolderPassword(folderPath, password.trim());
    onClose();
  };

  const handleRemoveProtection = () => {
    soundManager.playBeep(400, 0.1);
    onSetFolderPassword(folderPath, null);
    onClose();
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.protectDialogTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
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
            <Lock className="w-4 h-4" />
            <span>{t.protectTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="p-2.5 bg-black/40 rounded border border-white/10 space-y-1">
            <span className="text-[10px] opacity-70 uppercase font-bold block">{t.protectTarget}</span>
            <span className="font-bold text-amber-300 text-xs break-all">{folderPath}</span>
          </div>

          {isAlreadyProtected ? (
            <div className="p-3 bg-red-950/60 border border-red-500/50 rounded space-y-3 text-center">
              <div className="flex items-center justify-center gap-2 text-red-300 font-bold">
                <ShieldCheck className="w-5 h-5 text-red-400" />
                <span>{t.protectAlready}</span>
              </div>
              <p className="text-[11px] opacity-80">
                {t.protectWarning}
              </p>
              <button
                onClick={handleRemoveProtection}
                className="w-full py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded cursor-pointer shadow"
              >
                {t.protectRemove}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {errorMsg && (
                <div className="p-2 bg-red-950 border border-red-500 text-red-300 font-bold rounded text-[11px] flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold mb-1 opacity-80">{t.protectNewPass}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={t.protectPassPlaceholder}
                  className="w-full px-3 py-1.5 bg-black/60 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1 opacity-80">{t.protectConfirm}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={t.protectConfirmPlaceholder}
                  className="w-full px-3 py-1.5 bg-black/60 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
                >
                  {t.btnCancel}
                </button>
                <button
                  onClick={handleSave}
                  className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" />
                  {t.protectFolder}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
