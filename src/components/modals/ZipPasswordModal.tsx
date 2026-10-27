import React, { useState } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface ZipPasswordModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  fileName: string;
  invalid?: boolean;
  detectFormat?: () => void; // Nueva opción para detectar formato
  onSubmit: (password: string) => void;
  onClose: () => void;
}

export const ZipPasswordModal: React.FC<ZipPasswordModalProps> = ({
  theme,
  lang,
  fileName,
  invalid,
  detectFormat,
  onSubmit,
  onClose,
}) => {
  const t = getTranslations(lang);
  const [password, setPassword] = useState('');
  const dialogRef = useModalDialog<HTMLDivElement>(t.zipTitle);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    onSubmit(password);
  };

  return (
    <ModalShell title={t.zipTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <form onSubmit={handleSubmit} className="p-[var(--space-4)] space-y-[var(--space-4)]">
          <div className="flex items-center gap-[var(--space-2)] opacity-90">
            <Lock className="w-4 h-4" />
            <span>Enter password for "{fileName}":</span>
          </div>
          {invalid && <div className="text-red-400 text-xs">Invalid password for "{fileName}"</div>}

          {/* Opción de detectar formato */}
          {detectFormat && (
            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={detectFormat}
                className="w-full px-4 py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded flex items-center justify-center gap-[var(--space-2)] transition-all text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Detect Archive Format
              </button>
            </div>
          )}

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Archive password..."
            className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
            autoFocus
          />
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
