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

/**
 * SuperCopier-style collision prompt. The transfer is parked on disk while this
 * is open, so every exit path must answer it: the action buttons settle this one
 * conflict and Cancel aborts the whole job instead of leaving it parked forever.
 */
export const ConflictPromptModal: React.FC<ConflictPromptModalProps> = ({
  conflict,
  theme,
  lang,
  onAnswer,
  onCancel
}) => {
  const t = getTranslations(lang);
  const [applyToAll, setApplyToAll] = useState(false);

  const actions: Array<[ConflictResolution, string]> = [
    ['skip', t.collisionSkip],
    ['rename', t.collisionRename],
    ['overwrite', t.collisionOverwrite]
  ];

  const dialogRef = useModalDialog<HTMLDivElement>(t.conflictTitle);

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
          width: '30rem',
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
          <div className="flex items-center gap-2">
            <TriangleAlert className="w-4 h-4" />
            <span>{t.conflictTitle}</span>
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
          <div className="bg-black/40 p-2 rounded border border-white/10 text-[11px] break-all text-amber-300">
            {conflict.destination}
          </div>
          <label className="flex items-center gap-2 cursor-pointer opacity-90">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="cursor-pointer"
            />
            <span>{t.conflictApplyToAll}</span>
          </label>
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
              onClick={() => onAnswer(action, applyToAll)}
              className={
                action === 'overwrite'
                  ? 'px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow'
                  : 'px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer'
              }
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
