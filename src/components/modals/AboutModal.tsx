import React from 'react';
import { Info, User, Calendar, Cpu, Sparkles } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';

interface AboutModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  authorName: string;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  theme,
  lang,
  authorName,
  onClose
}) => {
  const t = getTranslations(lang);

  const creationDate = t.aboutCreationDate;
  const buildVersion = 'v5.50.2026 Pro (Build 2026.09.24-x64)';
  const displayAuthor = authorName || 'Edel Arencibia Baez';

  const dialogRef = useModalDialog<HTMLDivElement>(t.aboutTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none">
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
            <Info className="w-4 h-4" />
            <span>{t.aboutTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 font-mono">
          {/* Brand Banner */}
          <div className="flex items-center gap-4 p-3 bg-black/40 rounded border border-white/10">
            <div className="w-14 h-14 rounded bg-sky-950/80 border-2 border-amber-400 flex items-center justify-center font-black text-2xl text-amber-300 shadow-inner">
              OC
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">OmniCommander Pro</h2>
              <p className="text-[11px] opacity-75">Advanced Dual-Pane File Manager for Windows</p>
              <span className="inline-block mt-1 text-[10px] bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded border border-amber-400/30 font-bold">
                Edition 2026 • Professional
              </span>
            </div>
          </div>

          {/* Details Info Card */}
          <div className="p-3.5 bg-black/30 rounded border border-white/10 space-y-2.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 opacity-70">
                <User className="w-3.5 h-3.5 text-amber-400" /> {t.aboutAuthorLabel}
              </span>
              <span className="font-bold text-white bg-black/40 px-2 py-0.5 rounded border border-white/15">
                {displayAuthor}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 opacity-70">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t.aboutVersionLabel}
              </span>
              <span className="font-semibold text-cyan-300">
                {buildVersion}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 opacity-70">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" /> {t.aboutCreationDateLabel}
              </span>
              <span className="font-medium text-emerald-300">
                {creationDate}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 opacity-70">
                <Cpu className="w-3.5 h-3.5 text-purple-400" /> {t.aboutArchitectureLabel}
              </span>
              <span className="text-slate-200">
                Dual-Pane Orthodox Engine + HTML5 Host FS Access
              </span>
            </div>
          </div>

          <p className="text-[11px] opacity-75 text-center leading-relaxed">
            {t.aboutDescription}
          </p>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <button
              onClick={onClose}
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {t.btnClose} (Esc)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
