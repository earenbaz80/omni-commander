import React, { useState } from 'react';
import { HardDrive, ShieldAlert, Sparkles, FolderOpen, ArrowRight, ExternalLink, Info, CheckCircle2 } from 'lucide-react';
import { ThemeConfig } from '../../services/themeManager';
import { soundManager } from '../../services/soundEffects';
import { LanguageCode } from '../../types';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';

interface RealStorageOnboardingModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onMountDrive: (driveId: 'drive_c' | 'drive_d' | 'drive_host') => Promise<void>;
  onClose: () => void;
}

export const RealStorageOnboardingModal: React.FC<RealStorageOnboardingModalProps> = ({
  theme,
  lang,
  onMountDrive,
  onClose
}) => {
  const t = getTranslations(lang);
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;
  const [iframeNotice, setIframeNotice] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleMount = async (driveId: 'drive_c' | 'drive_d' | 'drive_host') => {
    soundManager.playKeyTick();
    if (isIframe) {
      setIframeNotice(t.onboardingIframeNotice.replace('{label}', t.onboardingPreviewContinue));
      return;
    }
    await onMountDrive(driveId);
  };

  const handleCopyUrl = () => {
    if (typeof window !== 'undefined') {
      try {
        navigator.clipboard.writeText(window.location.href);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 3000);
      } catch {
        // Fallback
      }
    }
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.onboardingDialogTitle);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 font-mono text-xs select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-xl border-2 shadow-2xl p-4 overflow-hidden rounded relative animate-fadeIn"
        style={{ 
          backgroundColor: theme.modalBg, 
          color: theme.itemText, 
          borderColor: theme.borderFocus,
          boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
        }}
      >
        {/* DOS Double Border Effect */}
        <div 
          className="absolute inset-1 pointer-events-none border border-dashed opacity-40"
          style={{ borderColor: theme.borderPanel }}
        />

        {/* Title Bar */}
        <div 
          className="flex items-center justify-between p-1.5 font-bold mb-3 border-b-2"
          style={{ 
            backgroundColor: theme.headerBg, 
            color: theme.headerText,
            borderColor: theme.borderPanel
          }}
        >
          <div className="flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 animate-bounce" />
            <span>{t.storageTitle}</span>
          </div>
          <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded font-black tracking-widest uppercase">
            {isIframe ? 'PREVIEW MODE' : 'STANDALONE MODE'}
          </span>
        </div>

        {/* Message */}
        <div className="space-y-2.5 mb-4 pr-1 relative z-10">
          <p className="font-bold text-amber-300 text-center text-sm">
            {t.onboardingTitleLine}
          </p>
          <p className="leading-relaxed opacity-90 text-justify">
            {t.onboardingDesc}
          </p>

          {isIframe ? (
            <div className="bg-amber-500/15 border-2 border-amber-400/60 p-3 rounded text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <Info className="w-4 h-4 shrink-0" />
                <span>{t.storageSubframe}</span>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">
                {t.onboardingSubframeDesc}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded shadow cursor-pointer transition text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{t.storageOpenTab}</span>
                </a>

                <button
                  onClick={handleCopyUrl}
                  className="px-2.5 py-1.5 bg-black/50 hover:bg-black/70 text-amber-200 border border-amber-400/40 rounded text-[11px] cursor-pointer transition flex items-center gap-1"
                >
                  {copiedUrl ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : null}
                  <span>{copiedUrl ? t.onboardingUrlCopied : t.onboardingCopyUrl}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-emerald-500/15 border border-emerald-400/40 p-2.5 rounded text-emerald-200 flex gap-2 items-start">
              <ShieldAlert className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">{t.storageStandalone}</span>
                <span className="block text-[11px] opacity-90 leading-tight">
                  {t.onboardingStandaloneDesc}
                </span>
              </div>
            </div>
          )}

          {iframeNotice && (
            <div className="bg-sky-900/60 border border-sky-400 p-2 rounded text-sky-200 text-[11px] animate-pulse">
              {iframeNotice}
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-2.5 relative z-10">
          <div className="font-bold text-amber-300 uppercase tracking-wider border-b border-white/10 pb-1 text-[10px]">
            {t.onboardingOptionsTitle}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => handleMount('drive_c')}
              className="flex items-center justify-between p-2.5 border-2 hover:border-amber-400 bg-black/40 hover:bg-white/10 cursor-pointer rounded transition group"
              style={{ borderColor: theme.borderPanel }}
            >
              <div className="flex items-center gap-3 text-left">
                <div className="bg-amber-400/20 p-1.5 rounded text-amber-400 group-hover:scale-110 transition">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white text-xs group-hover:text-amber-300">
                    {t.onboardingMountC}
                  </div>
                  <div className="text-[10px] opacity-70 mt-0.5">
                    {t.onboardingMountCDesc}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleMount('drive_d')}
              className="flex items-center justify-between p-2.5 border-2 hover:border-amber-400 bg-black/40 hover:bg-white/10 cursor-pointer rounded transition group"
              style={{ borderColor: theme.borderPanel }}
            >
              <div className="flex items-center gap-3 text-left">
                <div className="bg-sky-400/20 p-1.5 rounded text-sky-400 group-hover:scale-110 transition">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white text-xs group-hover:text-amber-300">
                    {t.onboardingMountD}
                  </div>
                  <div className="text-[10px] opacity-70 mt-0.5">
                    {t.onboardingMountDDesc}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition" />
            </button>

            <button
              onClick={() => handleMount('drive_host')}
              className="flex items-center justify-between p-2.5 border-2 hover:border-amber-400 bg-black/40 hover:bg-white/10 cursor-pointer rounded transition group"
              style={{ borderColor: theme.borderPanel }}
            >
              <div className="flex items-center gap-3 text-left">
                <div className="bg-emerald-400/20 p-1.5 rounded text-emerald-400 group-hover:scale-110 transition">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white text-xs group-hover:text-amber-300">
                    {t.onboardingMountZ}
                  </div>
                  <div className="text-[10px] opacity-70 mt-0.5">
                    {t.onboardingMountZDesc}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 relative z-10">
          <div className="flex items-center gap-1 text-[10px] opacity-60">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{isIframe ? t.onboardingRecPreview : t.onboardingRecStandalone}</span>
          </div>

          <button
            onClick={() => {
              soundManager.playSuccess();
              onClose();
            }}
            className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold border border-amber-300 rounded cursor-pointer transition text-xs flex items-center gap-1.5"
          >
            <span>{isIframe ? t.onboardingContinueNoReal : t.onboardingContinueNoLink}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
