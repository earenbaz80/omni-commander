import React, { useState, useEffect, useRef } from 'react';
import { Edit3, Save, Search } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface EditorModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onSave: (fileId: string, content: string) => void;
  onClose: () => void;
}

export const EditorModal: React.FC<EditorModalProps> = ({
  theme,
  lang,
  file,
  onSave,
  onClose
}) => {
  const t = getTranslations(lang);
  const [content, setContent] = useState('');
  const [isSaved, setIsSaved] = useState(true);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (file) {
      setContent(file.content || '');
      setIsSaved(true);
    }
  }, [file]);

  if (!file) return null;

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setIsSaved(false);
    updateCursor();
  };

  const updateCursor = () => {
    if (textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      const lines = content.substring(0, pos).split('\n');
      setCursorPos({
        line: lines.length,
        col: lines[lines.length - 1].length + 1
      });
    }
  };

  const handleSave = () => {
    soundManager.playSuccess();
    onSave(file.id, content);
    setIsSaved(true);
  };

  const handleReplaceAll = () => {
    if (!searchText) return;
    soundManager.playKeyTick();
    const newContent = content.replaceAll(searchText, replaceText);
    setContent(newContent);
    setIsSaved(false);
  };

  const lines = content.split('\n');
  const lineCount = lines.length;

  const dialogRef = useModalDialog<HTMLDivElement>(t.editorModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-[var(--space-4)] font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-5xl h-[90vh] flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        {/* Header bar */}
        <div 
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-[var(--space-2)] truncate">
            <Edit3 className="w-4 h-4" />
            <span className="truncate">
              Editor: {file.path}\{file.name}.{file.ext} {!isSaved && t.editorModified}
            </span>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-black/20 hover:bg-black/40 rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" /> {t.editorSearchReplace}
            </button>
            <button
              onClick={handleSave}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer font-bold"
            >
              <Save className="w-3.5 h-3.5" /> {t.btnSave} (Ctrl+S)
            </button>
            <button
              onClick={onClose}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-black/20 hover:bg-red-500/80 rounded text-xs cursor-pointer font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Find & Replace bar */}
        {showSearch && (
          <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] bg-black/40 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-[var(--space-1)] bg-black/50 border border-white/20 rounded px-[var(--space-2)] py-[var(--space-1)]">
              <span className="opacity-60">{t.findLabel}</span>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="bg-transparent border-none outline-none text-white w-32 font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-[var(--space-1)] bg-black/50 border border-white/20 rounded px-[var(--space-2)] py-[var(--space-1)]">
              <span className="opacity-60">{t.editorReplaceLabel}</span>
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                className="bg-transparent border-none outline-none text-white w-32 font-mono text-xs"
              />
            </div>
            <button
              onClick={handleReplaceAll}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-amber-400 text-black font-bold rounded cursor-pointer hover:bg-amber-300"
            >
              {t.editorReplaceAll}
            </button>
          </div>
        )}

        {/* Editor Body with Line Numbers */}
        <div className="flex-1 flex overflow-hidden bg-black/70 font-mono text-xs">
          {/* Line Numbers Column */}
          <div className="w-12 py-[var(--space-3)] px-[var(--space-1)] text-right select-none opacity-40 bg-black/50 border-r border-white/10 overflow-hidden leading-5">
            {Array.from({ length: Math.max(lineCount, 1) }).map((_, i) => (
              <div key={i} className="text-[11px] tabular-nums">{i + 1}</div>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
              }
            }}
            spellCheck={false}
            className="flex-1 p-[var(--space-3)] bg-transparent text-slate-100 font-mono text-xs resize-none outline-none leading-5 select-text overflow-auto"
          />
        </div>

        {/* Footer Status Bar */}
        <div 
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-t text-xs shrink-0 tabular-nums"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-[var(--space-3)]">
            <span>{t.editorLineInfo.replace('{current}', String(cursorPos.line)).replace('{total}', String(lineCount))}</span>
            <span>{t.editorColumnInfo.replace('{n}', String(cursorPos.col))}</span>
            <span>{t.editorTotalChars.replace('{n}', String(content.length)).replace('{size}', String(new Blob([content]).size))}</span>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <span className={isSaved ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
              {isSaved ? t.editorSaved : t.editorUnsaved}
            </span>
            <button
              onClick={onClose}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded cursor-pointer"
            >
              {t.btnClose}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
