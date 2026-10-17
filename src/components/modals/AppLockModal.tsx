import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Key, AlertTriangle } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';
import { checkPassword } from '../../services/appLock';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';

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
  onUnlockSuccess
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
      const passOk = await checkPassword(passwordInput, expectedPassHash || 'admin123', expectedPassSalt);

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

  const dialogRef = useModalDialog<HTMLDivElement>(t.lockAriaLabel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 font-mono select-none backdrop-blur-md">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg shadow-2xl border-2 text-xs overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.borderFocus,
          color: theme.itemText
        }}
      >
        {/* Lock Header */}
        <div 
          className="px-4 py-3 border-b font-bold shrink-0 flex items-center justify-between text-white"
          style={{ backgroundColor: theme.modalHeaderBg }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-300" />
            <span className="text-sm font-bold tracking-wide">{t.appLockTitle}</span>
          </div>
          <span className="text-[10px] bg-black/30 px-2 py-0.5 rounded font-mono font-extrabold text-amber-300">
            PROTECTED
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleUnlock} className="p-6 space-y-4">
          <div className="text-center space-y-2 pb-2 border-b border-white/10">
            <div className="w-16 h-16 mx-auto rounded-full bg-sky-950 border-2 border-amber-400 flex items-center justify-center text-amber-300 shadow-inner">
              <Lock className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-white text-base">{t.appLockSignIn}</h3>
            <p className="text-[11px] opacity-75">
              {t.lockDescription}
            </p>
          </div>

          {hasError && (
            <div className="p-2.5 bg-red-950 border border-red-500 text-red-200 font-bold rounded text-[11px] text-center flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{t.appLockBadCreds}</span>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold mb-1 opacity-80 flex items-center gap-1">
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
                className="w-full px-3 py-2 bg-black/70 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold mb-1 opacity-80 flex items-center gap-1">
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
                className="w-full px-3 py-2 bg-black/70 border border-white/20 rounded outline-none focus:border-amber-400 text-white font-mono text-xs"
                autoFocus
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit" disabled={isChecking}
              className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 disabled:cursor-wait text-black font-extrabold text-xs rounded cursor-pointer shadow-lg flex items-center justify-center gap-2 uppercase tracking-wider"
            >
              <Lock className="w-4 h-4" />
              {isChecking ? t.lockChecking : t.lockUnlockBtn}
            </button>
          </div>

          <p className="text-[10px] opacity-50 text-center pt-2 italic">
            {t.lockDefaultUser} <code className="text-amber-300 font-bold">{expectedUser || 'admin'}</code>.
          </p>
        </form>
      </div>
    </div>
  );
};
