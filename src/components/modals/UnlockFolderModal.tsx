import React, { useState } from 'react';
import { Lock, Key, AlertTriangle } from 'lucide-react';
import { FolderPasswordRecord, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { checkPassword } from '../../services/appLock';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import ModalShell from '../ModalShell';

interface UnlockFolderModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  folderPath: string;
  /** The stored PBKDF2 record; the password itself is never held in settings. */
  record: FolderPasswordRecord;
  /**
   * Called with the typed password when the record predates hashing, so the
   * caller can store a derived one and the plaintext stops being kept.
   */
  onUpgrade: (password: string) => void;
  onSuccess: () => void;
  onClose: () => void;
}

export const UnlockFolderModal: React.FC<UnlockFolderModalProps> = ({
  theme,
  lang,
  folderPath,
  record,
  onUpgrade,
  onSuccess,
  onClose,
}) => {
  const t = getTranslations(lang);
  const [passwordInput, setPasswordInput] = useState('');
  const [hasError, setHasError] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    try {
      // Opening the folder now costs a derivation, because what is stored is a
      // salt and a hash. A record without a salt is one saved by an older build,
      // which `checkPassword` still verifies as the plaintext it is.
      const typed = passwordInput.trim();
      const ok = await checkPassword(typed, record.hash, record.salt || undefined);
      if (ok) {
        // A saltless record is the plaintext an older build left behind. It just
        // proved itself, which is the one moment the password is available to
        // hash, so it is the moment to stop storing it.
        if (!record.salt) onUpgrade(typed);
        soundManager.playSuccess();
        onSuccess();
        return;
      }
      soundManager.playBeep(250, 0.2);
      setHasError(true);
      setPasswordInput('');
    } catch {
      // No WebCrypto is not a reason to open the folder: fail closed, with the
      // same answer a wrong password gets.
      setHasError(true);
      setPasswordInput('');
    } finally {
      setChecking(false);
    }
  };

  return (
    <ModalShell title={t.unlockTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        <form onSubmit={handleSubmit} className="p-[var(--space-4)] space-y-[var(--space-4)]">
          <div className="text-center space-y-[var(--space-1)]">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-950/80 border-2 border-amber-400 flex items-center justify-center text-amber-300">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-sm pt-1">{t.unlockFolder}</h3>
            <p className="text-[var(--fs-sm)] text-amber-300 font-mono font-bold truncate max-w-full">{folderPath}</p>
          </div>

          {hasError && (
            <div className="p-[var(--space-2)] bg-red-950 border border-red-500 text-red-200 font-bold rounded text-[var(--fs-sm)] text-center flex items-center justify-center gap-[var(--space-2)]">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{t.unlockBadPass}</span>
            </div>
          )}

          <div>
            <label className="block text-[var(--fs-sm)] font-bold mb-[var(--space-1)] opacity-80">
              {t.unlockEnterPass}
            </label>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setHasError(false);
              }}
              placeholder={t.unlockPassPlaceholder}
              className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black/70 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs text-center tracking-widest"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel}
            </button>
            <button
              type="submit"
              disabled={checking}
              className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-2)]"
            >
              <Key className="w-3.5 h-3.5" />
              {t.unlockBtn}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
};
