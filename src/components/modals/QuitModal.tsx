import React from 'react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';

import { getTranslations } from '../../i18n/translations';
import ModalShell from '../ModalShell';

interface QuitModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onConfirmQuit: () => void;
  onClose: () => void;
}

export const QuitModal: React.FC<QuitModalProps> = ({ theme, lang, onConfirmQuit, onClose }) => {
  const t = getTranslations(lang);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  return (
    <ModalShell title={t.quitTitle} label={t.btnCancel} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div className="p-[var(--space-4)] space-y-[var(--space-4)] text-center">
          <p className="text-white text-sm font-bold">{t.quitConfirmQuestion}</p>
          <p className="opacity-75 text-[var(--fs-sm)]">{t.quitSavedNote}</p>

          <div className="flex items-center justify-center gap-[var(--space-3)] pt-2">
            <button
              onClick={onClose}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.quitStay}
            </button>
            <button
              onClick={() => {
                soundManager.playBeep(300, 0.2);
                onConfirmQuit();
              }}
              className="px-5 py-[var(--space-2)] nc-danger-fill hover:nc-danger-fill text-white font-extrabold rounded cursor-pointer shadow"
            >
              {t.quitToMsDos}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
