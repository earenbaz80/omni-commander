import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Key, AlertTriangle } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';
import { checkPassword } from '../../services/appLock';

import { getTranslations } from '../../i18n/translations';
import ModalShell from '../ModalShell';

interface AppLockModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  expectedUser: string;
  expectedPassHash: string;
  expectedPassSalt?: string;
  onUnlockSuccess: () => void;
}

export const AppLockModal: React.FC<AppLockModalProps> = ({
  theme,
  lang,
  expectedUser,
  expectedPassHash,
  expectedPassSalt,
  onUnlockSuccess,
}) => {
  const t = getTranslations(lang);
  const [usernameInput, setUsernameInput] = useState(expectedUser || 'admin');
  const [passwordInput, setPasswordInput] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isChecking) return;
    setIsChecking(true);
    try {
      const targetUser = expectedUser || 'admin';
      const userOk = usernameInput.trim().toLowerCase() === targetUser.toLowerCase();
      // Fail closed: with no stored hash there is nothing to verify against, so
      // the modal must never accept a credential. The old `|| 'admin123'`
      // fallback turned an unset password into a public master key.
      const passOk = expectedPassHash ? await checkPassword(passwordInput, expectedPassHash, expectedPassSalt) : false;

      if (userOk && passOk) {
        soundManager.playSuccess();
        onUnlockSuccess();
        return;
      }
      soundManager.playBeep(250, 0.2);
      setHasError(true);
      setPasswordInput('');
    } catch {
      setHasError(true);
      setPasswordInput('');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <ModalShell title={t.appLockTitle} theme={theme} onClose={() => {}} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        {/* Lock Header */}
        <div
          className="px-[var(--space-4)] py-[var(--space-3)] border-b font-bold shrink-0 flex items-center justify-between text-white"
          style={{ backgroundColor: theme.modalHeaderBg, borderBottomColor: theme.modalBorder }}
        >
          <div className="flex items-center gap-[var(--space-2)]">
            <ShieldCheck className="w-5 h-5 text-amber-300" />
            <span className="text-sm font-bold tracking-wide">{t.appLockTitle}</span>
          </div>
          <span className="text-[var(--fs-8)] bg-black/30 px-[var(--space-2)] py-[var(--space-1)] rounded font-mono font-extrabold text-amber-300 uppercase">
            {t.protectedLabel}
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleUnlock} className="p-6 space-y-[var(--space-4)]">
          <div className="text-center space-y-[var(--space-2)] pb-2 border-b border-white/10">
            <div className="w-16 h-16 mx-auto rounded-full bg-sky-950 border-2 border-amber-400 flex items-center justify-center text-amber-300 shadow-inner">
              <Lock className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-white text-base">{t.appLockSignIn}</h3>
            <p className="text-[var(--fs-sm)] opacity-75">{t.lockDescription}</p>
          </div>

          {hasError && (
            <div className="p-[var(--space-2)].5 nc-danger-fill border nc-danger-edge nc-danger-ink-soft font-bold rounded text-[var(--fs-sm)] text-center flex items-center justify-center gap-[var(--space-2)]">
              <AlertTriangle className="w-4 h-4 nc-danger-ink shrink-0" />
              <span>{t.appLockBadCreds}</span>
            </div>
          )}

          <div className="space-y-[var(--space-3)]">
            <div>
              <label className="block text-[var(--fs-sm)] font-bold mb-[var(--space-1)] opacity-80 flex items-center gap-[var(--space-1)]">
                <User className="w-3.5 h-3.5 text-amber-400" /> {t.lockUserLabel}
              </label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => {
                  setUsernameInput(e.target.value);
                  setHasError(false);
                }}
                placeholder={t.appLockUserPlaceholder}
                className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black/70 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[var(--fs-sm)] font-bold mb-[var(--space-1)] opacity-80 flex items-center gap-[var(--space-1)]">
                <Key className="w-3.5 h-3.5 text-cyan-400" /> {t.lockPassLabel}
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  setHasError(false);
                }}
                placeholder={t.appLockPassPlaceholder}
                className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black/70 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
                autoFocus
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isChecking}
              className="w-full py-[var(--space-2)].5 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 disabled:cursor-wait text-black font-extrabold text-xs rounded cursor-pointer shadow-lg flex items-center justify-center gap-[var(--space-2)] uppercase tracking-wider"
            >
              <Lock className="w-4 h-4" />
              {isChecking ? t.lockChecking : t.lockUnlockBtn}
            </button>
          </div>

          <p className="text-[var(--fs-8)] opacity-50 text-center pt-2 italic">
            {t.lockDefaultUser} <code className="text-amber-300 font-bold">{expectedUser || 'admin'}</code>.
          </p>
        </form>
      </div>
    </ModalShell>
  );
};
