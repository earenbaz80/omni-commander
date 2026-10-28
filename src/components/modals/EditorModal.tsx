import React, { useState, useRef } from 'react';
import { AlertTriangle, Edit3, Save, Search } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { useFileContent } from '../../hooks/useFileContent';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface EditorModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  file: FileItem | null;
  onSave: (fileId: string, content: string) => void;
  onClose: () => void;
}

export const EditorModal: React.FC<EditorModalProps> = ({ theme, lang, file, onSave, onClose }) => {
  const t = getTranslations(lang);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The text on screen starts as the bytes on disk. It used to start as
  // `file.content`, which the listing of a real drive never fills, so a real file
  // opened blank and saving wrote that blank buffer over it.
  const { state, reload } = useFileContent(file);
  const ready = state.status === 'ready' ? state : null;

  /**
   * The buffer is derived from what was loaded until the user changes it, never
   * copied into state by an effect: with a copy there is a frame where the file
   * has loaded, saving is allowed and the buffer is still empty — and writing
   * that empty buffer is exactly how this editor used to truncate files.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const content = draft ?? ready?.text ?? '';
  const isDirty = draft !== null && ready !== null && draft !== ready.text;

  const dialogRef = useModalDialog<HTMLDivElement>(t.editorModalTitle);

  if (!file) return null;

  /**
   * Why saving is refused right now, empty when it is allowed. A file that is
   * still loading has no buffer to write, a binary file cannot survive a round
   * trip through a text buffer, and a file larger than the read cap would be
   * truncated by the write.
   */
  const blockedReason =
    state.status === 'loading'
      ? t.contentLoading
      : state.status === 'error'
        ? t.contentLoadFailed
        : ready?.binary
          ? t.editorBinaryBlocked
          : ready?.truncated
            ? t.editorTruncatedBlocked
            : '';
  const canSave = blockedReason === '' && ready !== null;

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    updateCursor();
  };

  const updateCursor = () => {
    if (textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      const lines = content.substring(0, pos).split('\n');
      setCursorPos({
        line: lines.length,
        col: lines[lines.length - 1].length + 1,
      });
    }
  };

  const handleSave = () => {
    // Guarded here as well as on the button: Ctrl+S reaches this too, and an
    // unloaded buffer must never be written.
    if (!canSave) return;
    soundManager.playSuccess();
    onSave(file.id, content);
    // Back to the file's own text: what was saved is the file now.
    setDraft(null);
  };

  const handleReplaceAll = () => {
    if (!searchText || !canSave) return;
    soundManager.playKeyTick();
    setDraft(content.replaceAll(searchText, replaceText));
  };

  const lines = content.split('\n');
  const lineCount = lines.length;

  return (
    <ModalShell title={t.editorModalTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        {/* Search bar in header area */}
        <div
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b font-bold shrink-0"
          style={{ backgroundColor: theme.modalHeaderBg, color: theme.modalHeaderText, borderColor: theme.modalBorder }}
        >
          <div className="flex items-center gap-[var(--space-2)] truncate">
            <Edit3 className="w-4 h-4" />
            <span className="truncate">
              Editor: {file.path}\{file.name}.{file.ext} {isDirty && t.editorModified}
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
              disabled={!canSave}
              title={blockedReason || undefined}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed text-white rounded text-xs flex items-center gap-[var(--space-1)] cursor-pointer font-bold"
            >
              <Save className="w-3.5 h-3.5" /> {t.btnSave} (Ctrl+S)
            </button>
          </div>
        </div>

        {/* Why saving is unavailable, when it is */}
        {blockedReason && (
          <div
            data-testid="editor-save-blocked"
            className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1)] bg-amber-950/70 border-b border-amber-500/40 text-amber-200 text-[11px] shrink-0"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{blockedReason}</span>
            {state.status === 'error' && (
              <button onClick={reload} className="underline cursor-pointer font-bold">
                {t.contentLoadRetry}
              </button>
            )}
          </div>
        )}

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
              disabled={!canSave}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-amber-400 text-black font-bold rounded cursor-pointer hover:bg-amber-300 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed"
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
              <div key={i} className="text-[11px] tabular-nums">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            disabled={!canSave}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
              }
            }}
            spellCheck={false}
            className="flex-1 p-[var(--space-3)] bg-transparent text-slate-100 font-mono text-xs resize-none outline-none leading-5 select-text overflow-auto disabled:opacity-50"
          />
        </div>

        {/* Footer Status Bar */}
        <div
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-t text-xs shrink-0 tabular-nums"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder,
          }}
        >
          <div className="flex items-center gap-[var(--space-3)]">
            <span>
              {t.editorLineInfo.replace('{current}', String(cursorPos.line)).replace('{total}', String(lineCount))}
            </span>
            <span>{t.editorColumnInfo.replace('{n}', String(cursorPos.col))}</span>
            <span>
              {t.editorTotalChars
                .replace('{n}', String(content.length))
                .replace('{size}', String(new Blob([content]).size))}
            </span>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <span className={isDirty ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
              {isDirty ? t.editorUnsaved : t.editorSaved}
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
    </ModalShell>
  );
};
