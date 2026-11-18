import React from 'react';
import type { AppUpdateSnapshot } from '../hooks/useAppUpdate';

/**
 * The reason a check failed, printed next to the state that survived it.
 *
 * A finished download outlives a failed check, so the card and the About box
 * keep offering the restart; this is what keeps the failure itself from being
 * hidden. The failure state already names the failure, so nothing is added
 * there, and with no error there is nothing to say.
 */
export const UpdateFailureNote: React.FC<{ update: AppUpdateSnapshot; label: string }> = ({ update, label }) => {
  if (!update.error || update.status === 'error') return null;

  return (
    <span className="text-[var(--fs-8)] nc-danger-ink" title={update.error}>
      {label}: {update.error}
    </span>
  );
};
