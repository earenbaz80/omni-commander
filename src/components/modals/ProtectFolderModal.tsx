import React, { useState } from 'react';
import { Lock, ShieldCheck, Key, AlertTriangle } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

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
  onClose,
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
    <ModalShell title={t.protectTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div className="p-[var(--space-4)] space-y-[var(--space-4)]">
          <div className="p-[var(--space-2)].5 bg-black/40 rounded border border-white/10 space-y-[var(--space-1)]">
            <span className="text-[var(--fs-8)] opacity-70 uppercase font-bold block">{t.protectTarget}</span>
            <span className="font-bold text-amber-300 text-xs break-all">{folderPath}</span>
          </div>

          {isAlreadyProtected ? (
            <div className="p-[var(--space-3)] bg-red-950/60 border border-red-500/50 rounded space-y-[var(--space-3)] text-center">
              <div className="flex items-center justify-center gap-[var(--space-2)] text-red-300 font-bold">
                <ShieldCheck className="w-5 h-5 text-red-400" />
                <span>{t.protectAlready}</span>
              </div>
              <p className="text-[var(--fs-sm)] opacity-80">{t.protectWarning}</p>
              <button
                onClick={handleRemoveProtection}
                className="w-full py-[var(--space-2)] bg-red-600 hover:bg-red-500 text-white font-bold rounded cursor-pointer shadow"
              >
                {t.protectRemove}
              </button>
            </div>
          ) : (
            <div className="space-y-[var(--space-3)]">
              {errorMsg && (
                <div className="p-[var(--space-2)] bg-red-950 border border-red-500 text-red-300 font-bold rounded text-[var(--fs-sm)] flex items-center gap-[var(--space-2)]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-[var(--fs-sm)] font-bold mb-[var(--space-1)] opacity-80">
                  {t.protectNewPass}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={t.protectPassPlaceholder}
                  className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black/60 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[var(--fs-sm)] font-bold mb-[var(--space-1)] opacity-80">
                  {t.protectConfirm}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder={t.protectConfirmPlaceholder}
                  className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black/60 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
                <button
                  onClick={onClose}
                  className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
                >
                  {t.btnCancel}
                </button>
                <button
                  onClick={handleSave}
                  className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-2)]"
                >
                  <Key className="w-3.5 h-3.5" />
                  {t.protectFolder}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
