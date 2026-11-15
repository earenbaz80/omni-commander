import React from 'react';
import { describeElevationFailure } from '../services/elevation';
import type { ElevationResult } from '../types/electronBridge';
import { getTranslations } from '../i18n/translations';

interface ElevationFailureNoticeProps {
  failure: ElevationResult;
  t: ReturnType<typeof getTranslations>;
  onDismiss: () => void;
}

/**
 * A refused UAC leaves the window running, so the reason cannot stay inside the
 * IPC answer: the info drawer and the shell only ask, they have nowhere to print
 * it. This notice is the one place both paths reach.
 */
export const ElevationFailureNotice: React.FC<ElevationFailureNoticeProps> = ({ failure, t, onDismiss }) => (
  <div
    role="alert"
    className="fixed top-2 left-1/2 -translate-x-1/2 z-[90] max-w-[min(92vw,620px)] flex items-start gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded border border-amber-400 bg-amber-950/95 text-amber-200 shadow-xl text-xs font-mono"
  >
    <span className="flex-1">{describeElevationFailure(failure, t)}</span>
    <button
      type="button"
      onClick={onDismiss}
      aria-label={t.btnClose}
      title={t.btnClose}
      className="shrink-0 font-bold text-amber-300 hover:text-white cursor-pointer"
    >
      ×
    </button>
  </div>
);
