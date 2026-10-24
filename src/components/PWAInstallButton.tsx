import React, { useState } from 'react';
import { Download, Monitor } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';

export const PWAInstallButton: React.FC<{ compact?: boolean; lang: LanguageCode }> = ({ compact = false, lang }) => {
  const t = getTranslations(lang);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className={`flex items-center gap-[var(--space-2)] rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow cursor-pointer ${
          compact ? 'px-[var(--space-2)] py-[var(--space-1)] text-[10px]' : 'px-[var(--space-3)] py-[var(--space-1)] text-xs'
        }`}
        title={t.installApp}
      >
        <Download className="w-3.5 h-3.5" />
        <span>{t.pwaInstallApp}</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={`flex items-center gap-[var(--space-2)] rounded border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 font-bold transition cursor-pointer ${
            compact ? 'px-[var(--space-2)] py-[var(--space-1)] text-[10px]' : 'px-[var(--space-3)] py-[var(--space-1)] text-xs'
          }`}
        >
          <Monitor className="w-3 h-3" />
          <span>{t.pwaInstallIos}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-[var(--space-4)] font-mono text-xs select-none">
            <div className="w-full max-w-sm rounded border border-amber-400 bg-neutral-900 p-5 shadow-2xl text-white">
              <h3 className="text-sm font-bold text-amber-300 flex items-center gap-[var(--space-2)]">
                <Monitor className="w-4 h-4" /> {t.pwaIosHeading}
              </h3>
              <p className="mt-[var(--space-3)] text-neutral-300 leading-relaxed text-[11px]">
                {t.pwaIosStep1}<br />
                {t.pwaIosStep2.replace('{addToHome}', t.addToHome)}
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-[var(--space-4)] w-full rounded bg-amber-400 py-[var(--space-2)] text-xs font-extrabold text-black hover:bg-amber-300 cursor-pointer"
              >
                {t.btnClose}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
