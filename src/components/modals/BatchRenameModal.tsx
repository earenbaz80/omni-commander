import React, { useState } from 'react';
import { Type } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface BatchRenameModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  items: FileItem[];
  onApplyRename: (renames: { id: string; newName: string }[]) => void;
  onClose: () => void;
}

export const BatchRenameModal: React.FC<BatchRenameModalProps> = ({
  theme,
  lang,
  items,
  onApplyRename,
  onClose
}) => {
  const t = getTranslations(lang);
  const [patternType, setPatternType] = useState<'replace' | 'prefix' | 'counter' | 'case'>('replace');
  const [findStr, setFindStr] = useState('');
  const [replaceStr, setReplaceStr] = useState('');
  const [prefixStr, setPrefixStr] = useState('');
  const [suffixStr, setSuffixStr] = useState('');
  const [startNum, setStartNum] = useState(1);
  const [numDigits, setNumDigits] = useState(3);
  const [caseMode, setCaseMode] = useState<'upper' | 'lower' | 'title'>('lower');

  const computeNewNames = (): { id: string; oldName: string; newName: string }[] => {
    return items.map((item, idx) => {
      let base = item.name;
      let ext = item.ext;

      if (patternType === 'replace') {
        if (findStr) {
          base = base.replaceAll(findStr, replaceStr);
        }
      } else if (patternType === 'prefix') {
        base = `${prefixStr}${base}${suffixStr}`;
      } else if (patternType === 'counter') {
        const num = (startNum + idx).toString().padStart(numDigits, '0');
        base = `${prefixStr || 'File_'}${num}`;
      } else if (patternType === 'case') {
        if (caseMode === 'upper') {
          base = base.toUpperCase();
          ext = ext.toUpperCase();
        } else if (caseMode === 'lower') {
          base = base.toLowerCase();
          ext = ext.toLowerCase();
        } else if (caseMode === 'title') {
          base = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
        }
      }

      const newFullName = ext ? `${base}.${ext}` : base;
      const oldFullName = item.ext ? `${item.name}.${item.ext}` : item.name;
      return { id: item.id, oldName: oldFullName, newName: newFullName };
    });
  };

  const previewList = computeNewNames();

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    soundManager.playSuccess();
    onApplyRename(previewList.map(p => ({ id: p.id, newName: p.newName })));
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.batchRenameModalTitle);

  return (
    <ModalShell title={`${t.batchRenameTitle} (${items.length} ${t.files})`} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <form onSubmit={handleApply} className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden">
          {/* Mode Selector Tabs */}
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => setPatternType('replace')}
              className={`px-3 py-1 rounded cursor-pointer ${patternType === 'replace' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10'}`}
            >
              {t.batchRenameReplaceTab}
            </button>
            <button
              type="button"
              onClick={() => setPatternType('prefix')}
              className={`px-3 py-1 rounded cursor-pointer ${patternType === 'prefix' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10'}`}
            >
              {t.batchRenamePrefixTab}
            </button>
            <button
              type="button"
              onClick={() => setPatternType('counter')}
              className={`px-3 py-1 rounded cursor-pointer ${patternType === 'counter' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10'}`}
            >
              {t.batchRenameCounterTab}
            </button>
            <button
              type="button"
              onClick={() => setPatternType('case')}
              className={`px-3 py-1 rounded cursor-pointer ${patternType === 'case' ? 'bg-amber-400 text-black font-bold' : 'hover:bg-white/10'}`}
            >
              {t.batchRenameCaseTab}
            </button>
          </div>

          {/* Mode inputs */}
          <div className="p-3 bg-black/30 rounded border border-white/10 space-y-2 shrink-0">
            {patternType === 'replace' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renameFindText}</label>
                  <input
                    type="text"
                    value={findStr}
                    onChange={(e) => setFindStr(e.target.value)}
                    placeholder={t.renameFindPlaceholder}
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renameReplaceWith}</label>
                  <input
                    type="text"
                    value={replaceStr}
                    onChange={(e) => setReplaceStr(e.target.value)}
                    placeholder={t.renameReplacePlaceholder}
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {patternType === 'prefix' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renamePrefixLabel}</label>
                  <input
                    type="text"
                    value={prefixStr}
                    onChange={(e) => setPrefixStr(e.target.value)}
                    placeholder={t.renamePrefixPlaceholder}
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renameSuffix}</label>
                  <input
                    type="text"
                    value={suffixStr}
                    onChange={(e) => setSuffixStr(e.target.value)}
                    placeholder={t.renameSuffixPlaceholder}
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {patternType === 'counter' && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renameBaseName}</label>
                  <input
                    type="text"
                    value={prefixStr}
                    onChange={(e) => setPrefixStr(e.target.value)}
                    placeholder="Foto_"
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renameStartNumber}</label>
                  <input
                    type="number"
                    value={startNum}
                    onChange={(e) => setStartNum(parseInt(e.target.value) || 1)}
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[var(--fs-sm)] opacity-75 mb-0.5">{t.renameDigits}</label>
                  <input
                    type="number"
                    min="1"
                    max="6"
                    value={numDigits}
                    onChange={(e) => setNumDigits(parseInt(e.target.value) || 3)}
                    className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {patternType === 'case' && (
              <div className="flex items-center gap-4 py-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="case"
                    checked={caseMode === 'lower'}
                    onChange={() => setCaseMode('lower')}
                  />
                  <span>{t.renameLower}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="case"
                    checked={caseMode === 'upper'}
                    onChange={() => setCaseMode('upper')}
                  />
                  <span>{t.renameUpper}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="case"
                    checked={caseMode === 'title'}
                    onChange={() => setCaseMode('title')}
                  />
                  <span>{t.renameTitleCase}</span>
                </label>
              </div>
            )}
          </div>

          {/* Live Preview Table */}
          <div className="flex-1 overflow-y-auto border border-white/10 rounded bg-black/40">
            <table className="w-full text-left text-[var(--fs-sm)] border-collapse">
              <thead className="bg-black/60 sticky top-0 border-b border-white/20 text-amber-300">
                <tr>
                  <th className="p-2 w-1/2">{t.renameOriginal}</th>
                  <th className="p-2 w-1/2">{t.renamePreview}</th>
                </tr>
              </thead>
              <tbody>
                {previewList.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="p-2 truncate opacity-70">{p.oldName}</td>
                    <td className="p-2 truncate font-bold text-emerald-400">{p.newName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded cursor-pointer"
            >
              {t.btnCancel}
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {t.btnApply} ({previewList.length} {t.files})
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
};
