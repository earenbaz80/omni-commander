import React from 'react';
import { User, Calendar, Cpu, Sparkles, RefreshCw } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { useAppUpdate } from '../../hooks/useAppUpdate';

import ModalShell from '../ModalShell';

interface AboutModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  authorName: string;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ theme, lang, authorName, onClose }) => {
  const t = getTranslations(lang);

  const creationDate = t.aboutCreationDate;
  // Injected by vite.config.ts from package.json, so the box cannot drift from
  // the package it was built from.
  const buildVersion = `v${__APP_VERSION__}`;
  const displayAuthor = authorName || 'Edel Arencibia Baez';

  // The header chip only shows what needs a decision; this row also reports the
  // quiet outcomes, and gives the manual check the chip deliberately lacks.
  const update = useAppUpdate();
  const updateStatusText =
    update.status === 'available'
      ? t.updateAvailable.replace('{version}', update.version || '')
      : update.status === 'downloading'
        ? t.updateDownloading.replace('{percent}', String(update.percent))
        : update.status === 'checking'
          ? t.updateChecking
          : update.status === 'up-to-date'
            ? t.updateUpToDate
            : update.status === 'error'
              ? t.updateFailed
              : '';
  const updateAction =
    update.status === 'available'
      ? { label: t.updateDownload, run: update.download }
      : update.status === 'downloaded'
        ? { label: t.updateInstall, run: update.install }
        : { label: t.updateCheck, run: update.check };

  return (
    <ModalShell title={t.aboutTitle} theme={theme} onClose={onClose}>
      <div className="font-mono select-none">
        {/* Brand Banner */}
        <div className="flex items-center gap-[var(--space-4)] p-[var(--space-3)] bg-black/40 rounded border border-white/10">
          <div className="w-14 h-14 rounded bg-sky-950/80 border-2 border-amber-400 flex items-center justify-center font-black text-2xl text-amber-300 shadow-inner">
            OC
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide">{t.appName}</h2>
            <p className="text-[var(--fs-sm)] opacity-75">{t.aboutTagline}</p>
            <span className="inline-block mt-[var(--space-1)] text-[var(--fs-8)] bg-amber-400/20 text-amber-300 px-[var(--space-2)] py-[var(--space-1)] rounded border border-amber-400/30 font-bold">
              {t.aboutEditionBadge}
            </span>
          </div>
        </div>

        {/* Details Info Card */}
        <div className="p-[var(--space-3)].5 bg-black/30 rounded border border-white/10 space-y-[var(--space-2)].5 text-[var(--fs-sm)]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[var(--space-2)] opacity-70">
              <User className="w-3.5 h-3.5 text-amber-400" /> {t.aboutAuthorLabel}
            </span>
            <span className="font-bold text-white bg-black/40 px-[var(--space-2)] py-[var(--space-1)] rounded border border-white/15">
              {displayAuthor}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[var(--space-2)] opacity-70">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t.aboutVersionLabel}
            </span>
            <span className="font-semibold text-cyan-300">{buildVersion}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[var(--space-2)] opacity-70">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" /> {t.aboutCreationDateLabel}
            </span>
            <span className="font-medium text-emerald-300">{creationDate}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-[var(--space-2)] opacity-70">
              <Cpu className="w-3.5 h-3.5 text-purple-400" /> {t.aboutArchitectureLabel}
            </span>
            <span className="text-slate-200">{t.aboutEngineValue}</span>
          </div>

          {/* Without an updater (web build, development, portable package) there
              is nothing to check, so the row is absent rather than dead. */}
          {update.enabled && (
            <div className="flex items-center justify-between gap-[var(--space-2)]">
              <span className="flex items-center gap-[var(--space-2)] opacity-70">
                <RefreshCw className="w-3.5 h-3.5 text-sky-400" /> {t.updateCheck}
              </span>
              <span className="flex items-center gap-[var(--space-2)]">
                <span className="text-slate-300">{updateStatusText}</span>
                <button
                  onClick={updateAction.run}
                  disabled={update.status === 'checking' || update.status === 'downloading'}
                  className="px-[var(--space-2)] py-[var(--space-1)] text-[10px] font-bold rounded border border-sky-400/40 bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  {updateAction.label}
                </button>
              </span>
            </div>
          )}

          {/* A failed check without a credential is the private-repository case,
              and the only thing the user can act on is where the token goes. */}
          {update.enabled && update.status === 'error' && !update.tokenConfigured && update.tokenPath && (
            <p className="text-[10px] leading-relaxed text-amber-300/90 break-all">
              {t.updateTokenHint.replace('{path}', update.tokenPath)}
            </p>
          )}
        </div>

        <p className="text-[var(--fs-sm)] opacity-75 text-center leading-relaxed">{t.aboutDescription}</p>

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
          >
            {t.btnClose} (Esc)
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
