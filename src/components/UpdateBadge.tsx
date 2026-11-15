import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { UPDATE_TONE } from './updateTones';

/**
 * A one-line notice in the header, and nothing else.
 *
 * It only appears when there is something to do: an update was offered (one
 * click downloads it) or a download finished (one click restarts into it).
 * Checking, checking again and failing stay silent, because a file manager
 * that starts a conversation on every launch is not discreet; the About box
 * reports those states when the user asks for them.
 */
export const UpdateBadge: React.FC<{ lang: LanguageCode }> = ({ lang }) => {
  const t = getTranslations(lang);
  const update = useAppUpdate();

  // No updater here (development, the web build, the portable package), so no
  // notice either.
  if (!update.enabled) return null;

  const chip =
    'flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] text-[10px] font-bold rounded transition-colors';

  if (update.status === 'available') {
    return (
      <button
        onClick={update.download}
        title={t.updateAvailable.replace('{version}', update.version || '')}
        className={`${chip} border ${UPDATE_TONE.download} cursor-pointer`}
      >
        <Download className="w-3.5 h-3.5" />
        <span>{update.version ? `v${update.version}` : t.updateDownload}</span>
      </button>
    );
  }

  if (update.status === 'downloading') {
    return (
      <span className={`${chip} border border-sky-400/40 bg-sky-500/10 text-sky-200`}>
        <RefreshCw className="w-3 h-3 animate-spin" />
        {t.updateDownloading.replace('{percent}', String(update.percent))}
      </span>
    );
  }

  if (update.status === 'downloaded') {
    return (
      <button
        onClick={update.install}
        title={t.updateInstall}
        className={`${chip} border ${UPDATE_TONE.install} cursor-pointer`}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>{t.updateInstall}</span>
      </button>
    );
  }

  return null;
};
