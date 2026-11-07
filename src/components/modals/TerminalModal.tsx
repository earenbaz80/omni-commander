import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { CommandHistoryItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';

import ModalShell from '../ModalShell';

interface TerminalModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  currentPath: string;
  commandHistory: CommandHistoryItem[];
  onExecuteCommand: (cmd: string) => void;
  onClearHistory: () => void;
  isAdminMode: boolean;
  onRequestElevation?: () => void;
  onClose: () => void;
}

/**
 * The same shell as the command bar, as a window of its own.
 *
 * It is deliberately not a second interpreter: `onExecuteCommand` and the log
 * it appends to come from App, so a command typed here appears in the bar's
 * drawer and one typed there appears here. What this window adds is the screen
 * — the output gets the whole panel instead of a 176 px drawer — and the
 * phosphor: scanlines, glow and a coloured prompt, driven by the theme.
 */
export const TerminalModal: React.FC<TerminalModalProps> = ({
  theme,
  lang,
  currentPath,
  commandHistory,
  onExecuteCommand,
  onClearHistory,
  isAdminMode,
  onRequestElevation,
  onClose,
}) => {
  const t = getTranslations(lang);
  const [inputVal, setInputVal] = useState('');
  /** How many commands back the prompt currently is; -1 means the fresh line. */
  const [recallIndex, setRecallIndex] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Every new line walks the screen down to the last answer: a terminal that
  // leaves the user hunting for its output is worse than one that prints none.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [commandHistory.length]);

  // Typing keeps the caret in view: the prompt scrolls with the scrollback
  // instead of being pinned to the bottom, so the screen has to follow it.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [inputVal]);

  /** Walks the history from the newest command, the way the command bar does. */
  const recall = (step: number) => {
    if (commandHistory.length === 0) return;
    const next = Math.min(Math.max(recallIndex + step, -1), commandHistory.length - 1);
    setRecallIndex(next);
    setInputVal(next === -1 ? '' : commandHistory[commandHistory.length - 1 - next].command);
  };

  const run = (raw: string) => {
    const command = raw.trim();
    if (!command) return;
    soundManager.playKeyTick();
    setInputVal('');
    setRecallIndex(-1);
    // `cls` is the engine's own case and it empties this very log, so there is
    // nothing to clear here on the side.
    onExecuteCommand(command);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter is the only way to send a line, as on any terminal: there is no
    // button to fall back on, and an empty line is not worth a round trip.
    if (event.key === 'Enter') {
      event.preventDefault();
      run(inputVal);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      recall(1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      recall(-1);
    }
  };

  return (
    <ModalShell
      title={t.terminalTitle}
      theme={theme}
      onClose={onClose}
      closeButtonLabel={t.btnClose}
      windowControls
      resizable
      movable
    >
      <div className="flex flex-col font-mono select-none bg-black">
        {/* Monitor toolbar: what the shell is, the elevation it has, and the wipe. */}
        <div
          className="flex items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] border-b text-[11px] shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder,
          }}
        >
          <div className="flex items-center gap-[var(--space-2)] min-w-0">
            <span className="font-black tracking-widest truncate">{t.cmdShellTitle}</span>
            {isAdminMode && (
              <span className="bg-red-600 text-white font-black px-[var(--space-1)] py-0.5 rounded text-[9px] uppercase tracking-wider animate-pulse shrink-0">
                {t.cmdAdminElevated}
              </span>
            )}
          </div>
          <div className="flex items-center gap-[var(--space-2)] shrink-0">
            {onRequestElevation && (
              <button
                type="button"
                onClick={onRequestElevation}
                className={`text-[10px] font-bold px-[var(--space-2)] py-[var(--space-1)] rounded border cursor-pointer ${
                  isAdminMode
                    ? 'bg-amber-400 text-black border-amber-300'
                    : 'bg-black/40 text-slate-300 border-white/20 hover:bg-white/10'
                }`}
              >
                {isAdminMode ? t.cmdElevatedShell : t.cmdUserShell}
              </button>
            )}
            <button
              type="button"
              onClick={onClearHistory}
              className="flex items-center gap-[var(--space-1)] hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" /> {t.clearLabel}
            </button>
          </div>
        </div>

        {/* Screen. The prompt is the last line of the scrollback, not a field
            below the glass: what is typed appears inline with the output, which
            is the one thing that makes this feel like a terminal instead of a
            form. The scanlines sit on top and take no clicks. */}
        <div className="relative flex-1 min-h-72">
          <div
            ref={logRef}
            data-terminal-log
            onClick={() => inputRef.current?.focus()}
            className="absolute inset-0 overflow-y-auto p-[var(--space-3)] text-[12px] leading-5 select-text cursor-text"
            style={{ color: theme.promptText, textShadow: '0 0 6px currentColor' }}
          >
            <div role="log" aria-live="polite" aria-label={t.terminalTitle}>
              {commandHistory.length === 0 ? (
                <div className="opacity-50 italic">{t.terminalHint}</div>
              ) : (
                commandHistory.map((entry) => (
                  <div key={entry.id} className="mb-[var(--space-1)]">
                    <div className="font-bold">
                      <span className="opacity-80">{currentPath}&gt;</span> {entry.command}
                    </div>
                    {entry.output && (
                      <pre
                        className={`whitespace-pre-wrap pl-2 ${entry.status === 'error' ? 'text-red-400' : 'text-emerald-300'}`}
                      >
                        {entry.output}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* The caret is the browser's own, coloured like the phosphor. */}
            <div className="flex items-baseline gap-[var(--space-2)]">
              <span className="font-bold shrink-0" style={{ color: isAdminMode ? '#f87171' : theme.promptText }}>
                {isAdminMode ? `[ADMIN] ${currentPath}>` : `${currentPath}>`}
              </span>
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={(event) => {
                  setInputVal(event.target.value);
                  setRecallIndex(-1);
                }}
                onKeyDown={handleKeyDown}
                aria-label={t.cmdPlaceholder}
                spellCheck={false}
                autoComplete="off"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none p-0"
                style={{ color: theme.promptText, caretColor: theme.promptText }}
              />
            </div>
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(0,0,0,0.26) 0px, rgba(0,0,0,0.26) 1px, transparent 1px, transparent 3px)',
              boxShadow: 'inset 0 0 90px rgba(0,0,0,0.85)',
            }}
          />
        </div>
      </div>
    </ModalShell>
  );
};
