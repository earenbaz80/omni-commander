import React, { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ConflictResolution, LanguageCode, PendingConflict } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { formatBytesRounded } from '../../utils/formatBytes';

import ModalShell from '../ModalShell';

interface ConflictPromptModalProps {
  conflict: PendingConflict;
  theme: ThemeConfig;
  lang: LanguageCode;
  onAnswer: (action: ConflictResolution, applyToAll: boolean) => void;
  onCancel: () => void;
}

/** Answers apply to one conflict unless the user opts into the always variant. */
type AnswerScope = 'once' | 'always';

/** A size the prompt was not given reads as a dash; the numbers are the shared formatter's. */
const formatSize = (bytes: number | undefined): string =>
  bytes === undefined || bytes < 0 ? '—' : formatBytesRounded(bytes);

function formatWhen(ms: number | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

/**
 * SuperCopier-style collision prompt. The transfer is parked on disk while this
 * is open, so every exit path must answer it: the action buttons settle this one
 * conflict and Cancel aborts the whole job instead of leaving it parked forever.
 *
 * Both sides are shown with their size and date. A same-name destination is not
 * evidence that the copy is needed, and a user picking blindly between
 * "overwrite" and "skip" is exactly how a newer file gets replaced by an older
 * one.
 */
export const ConflictPromptModal: React.FC<ConflictPromptModalProps> = ({
  conflict,
  theme,
  lang,
  onAnswer,
  onCancel,
}) => {
  const t = getTranslations(lang);
  const [scope, setScope] = useState<AnswerScope>('once');

  const actions: Array<[ConflictResolution, string]> = [
    ['skip', t.collisionSkip],
    ['rename', t.collisionRename],
    ['overwrite', t.collisionOverwrite],
    ['overwrite-if-different', t.collisionOverwriteIfDifferent],
    ['rename-old', t.collisionRenameOld],
  ];

  // The dialog semantics and the focus trap come from `ModalShell`, which asks
  // `useModalDialog` for them. Claiming them here as well put a second
  // `role="dialog"` with the very same name inside the first one, and a screen
  // reader announced the prompt twice.
  const facts: Array<[string, string, string]> = [
    [t.size, formatSize(conflict.sourceSize), formatSize(conflict.destinationSize)],
    [t.diffModified, formatWhen(conflict.sourceModified), formatWhen(conflict.destinationModified)],
  ];

  return (
    <ModalShell title={t.conflictTitle} theme={theme} onClose={onCancel} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        {/* Header with icon and full destination path */}
        <div
          className="flex items-center gap-[var(--space-2)] min-w-0 pb-2 border-b font-bold shrink-0"
          style={{ borderBottomColor: theme.modalBorder }}
        >
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span className="truncate" title={conflict.destination}>
            {t.conflictTitle}: {conflict.name}
          </span>
        </div>

        <div className="p-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
          <span className="opacity-75">{t.conflictBody}</span>

          <div className="grid gap-x-3 gap-y-1 text-[var(--fs-sm)] border border-white/10 rounded bg-black/30 p-[var(--space-2)] break-all">
            <span className="font-bold" style={{ color: theme.accentWarn }}>
              {t.transferColSource}
            </span>
            <span className="opacity-90">{conflict.source}</span>
            <span className="font-bold" style={{ color: theme.accentWarn }}>
              {t.transferColDest}
            </span>
            <span className="opacity-90">{conflict.destination}</span>
          </div>

          <table className="w-full text-[var(--fs-sm)] border border-white/10 rounded">
            <thead>
              <tr className="opacity-60">
                <th className="text-left font-bold px-[var(--space-2)] py-[var(--space-1)] w-24" />
                <th className="text-left font-bold px-[var(--space-2)] py-[var(--space-1)]">{t.transferColSource}</th>
                <th className="text-left font-bold px-[var(--space-2)] py-[var(--space-1)]">{t.transferColDest}</th>
              </tr>
            </thead>
            <tbody>
              {facts.map(([label, sourceValue, destinationValue]) => (
                <tr key={label} className="border-t border-white/10">
                  <td className="px-[var(--space-2)] py-[var(--space-1)] opacity-60">{label}</td>
                  <td className="px-[var(--space-2)] py-[var(--space-1)] tabular-nums">{sourceValue}</td>
                  <td className="px-[var(--space-2)] py-[var(--space-1)] tabular-nums">{destinationValue}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {conflict.identical && <span className="text-[var(--fs-sm)] text-emerald-300">{t.conflictIdentical}</span>}

          <fieldset className="flex items-center gap-[var(--space-4)] text-[var(--fs-sm)]">
            <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
              <input
                type="radio"
                name="conflict-scope"
                checked={scope === 'once'}
                onChange={() => setScope('once')}
                className="cursor-pointer"
              />
              <span>{t.conflictThisFile}</span>
            </label>
            <label className="flex items-center gap-[var(--space-2)] cursor-pointer" title={t.conflictAlwaysHint}>
              <input
                type="radio"
                name="conflict-scope"
                checked={scope === 'always'}
                onChange={() => setScope('always')}
                className="cursor-pointer"
              />
              <span
                className={scope === 'always' ? 'font-bold' : ''}
                style={{ color: scope === 'always' ? theme.accentWarn : 'inherit' }}
              >
                {t.conflictAlwaysMode}
              </span>
            </label>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] border-t border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="mr-auto px-[var(--space-3)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
          >
            {t.btnCancel}
          </button>
          {actions.map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => onAnswer(action, scope === 'always')}
              className={
                action === 'overwrite'
                  ? 'px-[var(--space-3)] py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow'
                  : 'px-[var(--space-3)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer'
              }
              title={scope === 'always' ? t.conflictAlwaysHint : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
};

export default ConflictPromptModal;
