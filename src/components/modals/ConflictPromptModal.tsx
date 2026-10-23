import React, { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ConflictResolution, LanguageCode, PendingConflict } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';

interface ConflictPromptModalProps {
  conflict: PendingConflict;
  theme: ThemeConfig;
  lang: LanguageCode;
  onAnswer: (action: ConflictResolution, applyToAll: boolean) => void;
  onCancel: () => void;
}

/** Answers apply to one conflict unless the user opts into the always variant. */
type AnswerScope = 'once' | 'always';

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

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
  onCancel
}) => {
  const t = getTranslations(lang);
  const [scope, setScope] = useState<AnswerScope>('once');

  const actions: Array<[ConflictResolution, string]> = [
    ['skip', t.collisionSkip],
    ['rename', t.collisionRename],
    ['overwrite', t.collisionOverwrite],
    ['overwrite-if-different', t.collisionOverwriteIfDifferent],
    ['rename-old', t.collisionRenameOld]
  ];

  const dialogRef = useModalDialog<HTMLDivElement>(t.conflictTitle);

  const facts: Array<[string, string, string]> = [
    [t.size, formatBytes(conflict.sourceSize), formatBytes(conflict.destinationSize)],
    [t.diffModified, formatWhen(conflict.sourceModified), formatWhen(conflict.destinationModified)]
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText,
          width: '36rem',
          maxWidth: '100%'
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <TriangleAlert className="w-4 h-4 shrink-0" />
            <span className="truncate" title={conflict.destination}>{t.conflictTitle}: {conflict.name}</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer"
            aria-label={t.btnCancel}
          >
            ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <span className="opacity-75">{t.conflictBody}</span>

          <div className="grid gap-x-3 gap-y-1 text-[11px] border border-white/10 rounded bg-black/30 p-2 break-all">
            <span className="font-bold text-amber-300">{t.transferColSource}</span>
            <span className="opacity-90">{conflict.source}</span>
            <span className="font-bold text-amber-300">{t.transferColDest}</span>
            <span className="opacity-90">{conflict.destination}</span>
          </div>

          <table className="w-full text-[11px] border border-white/10 rounded">
            <thead>
              <tr className="opacity-60">
                <th className="text-left font-bold px-2 py-1 w-24" />
                <th className="text-left font-bold px-2 py-1">{t.transferColSource}</th>
                <th className="text-left font-bold px-2 py-1">{t.transferColDest}</th>
              </tr>
            </thead>
            <tbody>
              {facts.map(([label, sourceValue, destinationValue]) => (
                <tr key={label} className="border-t border-white/10">
                  <td className="px-2 py-1 opacity-60">{label}</td>
                  <td className="px-2 py-1 tabular-nums">{sourceValue}</td>
                  <td className="px-2 py-1 tabular-nums">{destinationValue}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {conflict.identical && (
            <span className="text-[11px] text-emerald-300">{t.conflictIdentical}</span>
          )}

          <fieldset className="flex items-center gap-4 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="conflict-scope"
                checked={scope === 'once'}
                onChange={() => setScope('once')}
                className="cursor-pointer"
              />
              <span>{t.conflictThisFile}</span>
            </label>
            <label
              className="flex items-center gap-1.5 cursor-pointer"
              title={t.conflictAlwaysHint}
            >
              <input
                type="radio"
                name="conflict-scope"
                checked={scope === 'always'}
                onChange={() => setScope('always')}
                className="cursor-pointer"
              />
              <span className={scope === 'always' ? 'text-amber-300 font-bold' : ''}>{t.conflictAlwaysMode}</span>
            </label>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="mr-auto px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
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
                  ? 'px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow'
                  : 'px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer'
              }
              title={scope === 'always' ? t.conflictAlwaysHint : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConflictPromptModal;
