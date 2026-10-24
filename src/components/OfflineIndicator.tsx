import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';

export const OfflineIndicator: React.FC<{ lang: LanguageCode }> = ({ lang }) => {
  const t = getTranslations(lang);
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-12 left-4 z-50 flex items-center gap-[var(--space-2)] rounded bg-amber-600 border border-amber-400 px-[var(--space-3)] py-[var(--space-1)] text-xs font-bold text-white shadow-2xl font-mono animate-pulse select-none">
      <WifiOff className="w-3.5 h-3.5 text-white" />
      <span>{t.offlineMode}</span>
    </div>
  );
};
