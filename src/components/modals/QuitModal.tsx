import React from 'react';
import { Power } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';

interface QuitModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onConfirmQuit: () => void;
  onClose: () => void;
}

export const QuitModal: React.FC<QuitModalProps> = ({
  theme,
  lang,
  onConfirmQuit,
  onClose
}) => {
  const t = getTranslations(lang);

  const dialogRef = useModalDialog<HTMLDivElement>(t.quitDialogLabel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0 bg-red-950/80 text-white"
          style={{ borderColor: theme.modalBorder }}
        >
          <div className="flex items-center gap-2">
            <Power className="w-4 h-4 text-red-400" />
            <span>{t.quitTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <div className="p-4 space-y-4 text-center">
          <p className="text-white text-sm font-bold">
            {t.quitConfirmQuestion}
          </p>
          <p className="opacity-75 text-[11px]">
            {t.quitSavedNote}
          </p>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.quitStay}
            </button>
            <button
              onClick={() => {
                soundManager.playBeep(300, 0.2);
                onConfirmQuit();
              }}
              className="px-5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-extrabold rounded cursor-pointer shadow"
            >
              {t.quitToMsDos}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
