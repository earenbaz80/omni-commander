import React from 'react';
import { GitCompare } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface DiffCompareModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  leftFile: FileItem | null;
  rightFile: FileItem | null;
  onClose: () => void;
}

export const DiffCompareModal: React.FC<DiffCompareModalProps> = ({
  theme,
  lang,
  leftFile,
  rightFile,
  onClose
}) => {
  const t = getTranslations(lang);

  const leftLines = (leftFile?.content || '').split('\n');
  const rightLines = (rightFile?.content || '').split('\n');
  const maxLines = Math.max(leftLines.length, rightLines.length);

  const dialogRef = useModalDialog<HTMLDivElement>(t.diffModalTitle);

  return (
    <ModalShell title={t.diffTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">

        {/* File names header */}
        <div className="grid grid-cols-2 border-b border-white/20 bg-black/40 px-[var(--space-3)] py-[var(--space-2)] font-bold shrink-0">
          <div className="truncate text-amber-300">
            [{t.leftPanel}]: {leftFile ? `${leftFile.name}.${leftFile.ext}` : t.diffNoFileSelected}
          </div>
          <div className="truncate text-cyan-300 pl-4 border-l border-white/20">
            [{t.rightPanel}]: {rightFile ? `${rightFile.name}.${rightFile.ext}` : t.diffNoFileSelected}
          </div>
        </div>

        {/* Diff view lines container */}
        <div className="flex-1 overflow-y-auto bg-black/80 font-mono text-[var(--fs-sm)] select-text">
          {Array.from({ length: maxLines }).map((_, idx) => {
            const lText = leftLines[idx] !== undefined ? leftLines[idx] : '';
            const rText = rightLines[idx] !== undefined ? rightLines[idx] : '';
            const isDiff = lText !== rText;
            const isLeftOnly = leftLines[idx] !== undefined && rightLines[idx] === undefined;
            const isRightOnly = rightLines[idx] !== undefined && leftLines[idx] === undefined;

            let rowBg = 'hover:bg-white/5';
            if (isLeftOnly) rowBg = 'bg-red-950/40';
            else if (isRightOnly) rowBg = 'bg-emerald-950/40';
            else if (isDiff) rowBg = 'bg-amber-950/40';

            return (
              <div key={idx} className={`grid grid-cols-2 border-b border-white/5 leading-5 ${rowBg}`}>
                {/* Left Line */}
                <div className="flex items-start px-[var(--space-2)] py-[var(--space-1)] overflow-x-auto">
                  <span className="w-8 text-right opacity-30 select-none mr-[var(--space-2)] shrink-0 tabular-nums">
                    {leftLines[idx] !== undefined ? idx + 1 : ''}
                  </span>
                  <span className={`whitespace-pre ${isDiff && lText ? 'text-red-300 font-semibold' : 'text-slate-200'}`}>
                    {lText}
                  </span>
                </div>

                {/* Right Line */}
                <div className="flex items-start px-[var(--space-2)] py-[var(--space-1)] overflow-x-auto border-l border-white/10">
                  <span className="w-8 text-right opacity-30 select-none mr-[var(--space-2)] shrink-0 tabular-nums">
                    {rightLines[idx] !== undefined ? idx + 1 : ''}
                  </span>
                  <span className={`whitespace-pre ${isDiff && rText ? 'text-emerald-300 font-semibold' : 'text-slate-200'}`}>
                    {rText}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-[var(--space-4)]">
            <span className="flex items-center gap-[var(--space-2)]"><span className="w-3 h-3 bg-red-900 rounded"></span> {t.diffRemovedDifferent}</span>
            <span className="flex items-center gap-[var(--space-2)]"><span className="w-3 h-3 bg-emerald-900 rounded"></span> {t.diffAdded}</span>
            <span className="flex items-center gap-[var(--space-2)]"><span className="w-3 h-3 bg-amber-900 rounded"></span> {t.diffModified}</span>
          </div>

          <button
            onClick={onClose}
            className="px-[var(--space-4)] py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-bold rounded cursor-pointer"
          >
            {t.btnClose} (Esc)
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
