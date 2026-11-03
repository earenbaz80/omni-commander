import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronUp, ChevronDown, Trash2, History, CornerDownLeft } from 'lucide-react';
import { CommandHistoryItem, FileItem, LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { soundManager } from '../services/soundEffects';
import { getTranslations } from '../i18n/translations';

interface CommandLineBarProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  currentPath: string;
  onExecuteCommand: (cmd: string) => void;
  commandHistory: CommandHistoryItem[];
  onClearHistory: () => void;
  isAdminMode?: boolean;
  onToggleAdminMode?: () => void;
  availableItems?: FileItem[];
  availableFileNames?: string[];
  /** Bumped by the host to open the output drawer, e.g. "Abrir en la terminal". */
  logOpenNonce?: number;
}

const BUILTIN_COMMANDS = [
  'cd',
  'dir',
  'copy',
  'xcopy',
  'robocopy',
  'move',
  'ren',
  'rename',
  'del',
  'delete',
  'mkdir',
  'md',
  'rmdir',
  'rd',
  'cls',
  'clear',
  'help',
  'type',
  'attrib',
  'tree',
  'sfc',
  'tasklist',
  'taskkill',
  'ipconfig',
  'ping',
  'tracert',
  'netstat',
  'nslookup',
  'systeminfo',
  'chkdsk',
  'diskpart',
  'winget',
  'cipher',
  'echo',
  'calc',
  'date',
  'time',
];

interface AutocompleteSuggestion {
  text: string;
  source: 'history' | 'builtin' | 'file';
  timestamp?: string;
  status?: 'ok' | 'error' | 'info';
}

export const CommandLineBar: React.FC<CommandLineBarProps> = ({
  theme,
  lang,
  currentPath,
  onExecuteCommand,
  commandHistory,
  onClearHistory,
  isAdminMode = false,
  onToggleAdminMode,
  availableItems,
  availableFileNames,
  logOpenNonce = 0,
}) => {
  const t = getTranslations(lang);
  const [inputVal, setInputVal] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(true);

  // The drawer is closed by default, so a command sent from the context menu
  // would run out of sight; the host asks for it explicitly.
  useEffect(() => {
    if (logOpenNonce > 0) setIsLogOpen(true);
  }, [logOpenNonce]);

  // Tab completion state
  const [tabState, setTabState] = useState<{
    prefix: string;
    token: string;
    matches: string[];
    currentIndex: number;
    expectedInputValue: string;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);

  // Extract real-time autocomplete suggestions as user types
  const suggestions = useMemo<AutocompleteSuggestion[]>(() => {
    const trimmed = inputVal.trim();
    if (!trimmed) return [];

    const lowerQuery = trimmed.toLowerCase();
    const result: AutocompleteSuggestion[] = [];
    const seenTexts = new Set<string>();

    // 1. First priority: Matching entries from user's Command History (ordered from most recent)
    for (let i = commandHistory.length - 1; i >= 0; i--) {
      const item = commandHistory[i];
      const cmdText = item.command.trim();
      const lowerCmd = cmdText.toLowerCase();

      if (lowerCmd.includes(lowerQuery) && !seenTexts.has(lowerCmd)) {
        seenTexts.add(lowerCmd);
        result.push({
          text: cmdText,
          source: 'history',
          timestamp: item.timestamp,
          status: item.status,
        });
      }
    }

    // 2. Second priority: Matching built-in system DOS commands
    for (const cmd of BUILTIN_COMMANDS) {
      const lowerCmd = cmd.toLowerCase();
      if (lowerCmd.startsWith(lowerQuery) && !seenTexts.has(lowerCmd)) {
        seenTexts.add(lowerCmd);
        result.push({
          text: cmd,
          source: 'builtin',
        });
      }
    }

    // 3. Third priority: Files and directories in active folder
    const fileNames: string[] = [];
    if (availableItems && availableItems.length > 0) {
      availableItems.forEach((item) => {
        if (item.name) fileNames.push(item.name);
        if (item.ext && !item.isDirectory && !item.name.toLowerCase().endsWith(`.${item.ext.toLowerCase()}`)) {
          fileNames.push(`${item.name}.${item.ext}`);
        }
      });
    } else if (availableFileNames && availableFileNames.length > 0) {
      fileNames.push(...availableFileNames);
    }

    for (const f of fileNames) {
      const lowerF = f.toLowerCase();
      if (lowerF.startsWith(lowerQuery) && !seenTexts.has(lowerF)) {
        seenTexts.add(lowerF);
        result.push({
          text: f,
          source: 'file',
        });
      }
    }

    // Sort: Prefix matches first, then shorter commands first
    return result
      .sort((a, b) => {
        const aStarts = a.text.toLowerCase().startsWith(lowerQuery);
        const bStarts = b.text.toLowerCase().startsWith(lowerQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        if (a.source === 'history' && b.source !== 'history') return -1;
        if (a.source !== 'history' && b.source === 'history') return 1;
        return a.text.length - b.text.length;
      })
      .slice(0, 7); // Max 7 suggestions
  }, [inputVal, commandHistory, availableItems, availableFileNames]);

  // Compute ghost suggestion text (inline gray completion preview)
  const ghostSuffix = useMemo(() => {
    if (!inputVal || suggestions.length === 0) return '';
    const topMatch = suggestions[0].text;
    if (topMatch.toLowerCase().startsWith(inputVal.toLowerCase())) {
      return topMatch.slice(inputVal.length);
    }
    return '';
  }, [inputVal, suggestions]);

  useEffect(() => {
    if (isLogOpen && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [commandHistory, isLogOpen]);

  // Auto-scroll selected suggestion into view
  useEffect(() => {
    if (suggestionsContainerRef.current && selectedSuggestionIndex >= 0) {
      const el = suggestionsContainerRef.current.children[selectedSuggestionIndex] as HTMLElement;
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedSuggestionIndex]);

  const formatMatch = (match: string) => {
    if (match.includes(' ')) {
      return `"${match}"`;
    }
    return match;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setInputVal(newVal);
    setSelectedSuggestionIndex(-1);
    setIsSuggestionsOpen(true);
    if (tabState && newVal !== tabState.expectedInputValue) {
      setTabState(null);
    }
  };

  const applySuggestion = (suggestionText: string, executeImmediately: boolean = false) => {
    soundManager.playSelectSound();
    setInputVal(suggestionText);
    setSelectedSuggestionIndex(-1);
    setIsSuggestionsOpen(false);

    if (executeImmediately) {
      onExecuteCommand(suggestionText);
      setInputVal('');
      setHistoryIndex(-1);
      setTabState(null);
      setIsLogOpen(true);
    } else {
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let commandToRun = inputVal.trim();

    // If an item in the suggestions dropdown is highlighted, execute that
    if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
      commandToRun = suggestions[selectedSuggestionIndex].text;
    }

    if (!commandToRun) return;

    soundManager.playKeyTick();
    onExecuteCommand(commandToRun);
    setInputVal('');
    setHistoryIndex(-1);
    setTabState(null);
    setSelectedSuggestionIndex(-1);
    setIsSuggestionsOpen(false);
    setIsLogOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 1. Right arrow at the end of input to accept ghost text or top suggestion
    if (e.key === 'ArrowRight' && ghostSuffix && inputRef.current) {
      const cursorAtEnd = inputRef.current.selectionStart === inputVal.length;
      if (cursorAtEnd && suggestions.length > 0) {
        e.preventDefault();
        applySuggestion(suggestions[0].text, false);
        return;
      }
    }

    // 2. Tab key handling: autocomplete from suggestions or standard cycle
    if (e.key === 'Tab') {
      e.preventDefault();

      // If suggestions list is visible and has items, apply the selected or top suggestion
      if (suggestions.length > 0 && isSuggestionsOpen) {
        const targetIdx = selectedSuggestionIndex >= 0 ? selectedSuggestionIndex : 0;
        applySuggestion(suggestions[targetIdx].text, false);
        return;
      }

      // Fallback to standard token-based Tab completion
      const fileNames: string[] = [];
      if (availableItems && availableItems.length > 0) {
        availableItems.forEach((item) => {
          if (item.name) fileNames.push(item.name);
          if (item.ext && !item.isDirectory && !item.name.toLowerCase().endsWith(`.${item.ext.toLowerCase()}`)) {
            fileNames.push(`${item.name}.${item.ext}`);
          }
        });
      } else if (availableFileNames && availableFileNames.length > 0) {
        fileNames.push(...availableFileNames);
      }

      if (tabState && tabState.matches.length > 0 && inputVal === tabState.expectedInputValue) {
        const step = e.shiftKey ? -1 : 1;
        const nextIndex = (tabState.currentIndex + step + tabState.matches.length) % tabState.matches.length;
        const selectedMatch = tabState.matches[nextIndex];
        const formatted = formatMatch(selectedMatch);
        const nextInputVal = tabState.prefix + formatted;

        setInputVal(nextInputVal);
        setTabState({
          ...tabState,
          currentIndex: nextIndex,
          expectedInputValue: nextInputVal,
        });
        soundManager.playKeyTick();
        return;
      }

      let prefix = '';
      let token = inputVal;
      let isCommandPos = true;

      const lastSpaceIdx = inputVal.lastIndexOf(' ');
      if (lastSpaceIdx !== -1) {
        prefix = inputVal.substring(0, lastSpaceIdx + 1);
        token = inputVal.substring(lastSpaceIdx + 1);
        isCommandPos = false;
      }

      const cleanToken = token.replace(/^["']|["']$/g, '');
      const candidates: string[] = isCommandPos ? Array.from(new Set([...BUILTIN_COMMANDS, ...fileNames])) : fileNames;

      let matches = candidates.filter((c) => c.toLowerCase().startsWith(cleanToken.toLowerCase()));
      if (matches.length === 0 && cleanToken.length > 0) {
        matches = candidates.filter((c) => c.toLowerCase().includes(cleanToken.toLowerCase()));
      }

      if (matches.length > 0) {
        const firstMatch = matches[0];
        const formatted = formatMatch(firstMatch);
        const nextInputVal = prefix + formatted;

        setInputVal(nextInputVal);
        setTabState({
          prefix,
          token: cleanToken,
          matches,
          currentIndex: 0,
          expectedInputValue: nextInputVal,
        });
        soundManager.playKeyTick();
      }
      return;
    }

    // 3. Escape key: Close suggestions popover or tab completion
    if (e.key === 'Escape') {
      if (isSuggestionsOpen && suggestions.length > 0) {
        setIsSuggestionsOpen(false);
        setSelectedSuggestionIndex(-1);
        return;
      }
      if (tabState) {
        setTabState(null);
        return;
      }
    }

    // 4. Arrow Navigation: Suggestions Popover Navigation or History Traversal
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTabState(null);

      // If suggestions are open and user is typing
      if (isSuggestionsOpen && suggestions.length > 0) {
        soundManager.playKeyTick();
        setSelectedSuggestionIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }

      // Classical Command History UP traversal
      if (commandHistory.length > 0) {
        const nextIdx = historyIndex + 1 < commandHistory.length ? historyIndex + 1 : historyIndex;
        setHistoryIndex(nextIdx);
        setInputVal(commandHistory[commandHistory.length - 1 - nextIdx]?.command || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTabState(null);

      // If suggestions are open and user is typing
      if (isSuggestionsOpen && suggestions.length > 0) {
        soundManager.playKeyTick();
        setSelectedSuggestionIndex((prev) => (prev + 1 >= suggestions.length ? 0 : prev + 1));
        return;
      }

      // Classical Command History DOWN traversal
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputVal(commandHistory[commandHistory.length - 1 - nextIdx]?.command || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputVal('');
      }
    }
  };

  // Helper to render matched query with highlighted span
  const renderHighlightedText = (fullText: string, query: string) => {
    if (!query) return <span>{fullText}</span>;
    const idx = fullText.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return <span>{fullText}</span>;

    const before = fullText.substring(0, idx);
    const match = fullText.substring(idx, idx + query.length);
    const after = fullText.substring(idx + query.length);

    return (
      <span className="truncate">
        <span className="opacity-90">{before}</span>
        <span className="text-amber-300 font-extrabold underline">{match}</span>
        <span className="opacity-90">{after}</span>
      </span>
    );
  };

  return (
    <div
      className="flex flex-col border-t shrink-0 select-none font-mono text-xs z-20 relative"
      style={{
        backgroundColor: theme.promptBg,
        borderColor: theme.borderPanel,
        color: theme.promptText,
      }}
    >
      {/* Terminal Log Output Drawer */}
      {/* The drawer is the only place command output is rendered; `data-command-log`
          is the stable hook the E2E spec reads it through, instead of a style class. */}
      {isLogOpen && (
        <div
          ref={logContainerRef}
          data-command-log
          className="max-h-44 overflow-y-auto p-[var(--space-2)] bg-black/90 border-b border-white/20 select-text font-mono text-[11px] space-y-[var(--space-2)]"
        >
          <div className="flex items-center justify-between pb-1 border-b border-white/10 opacity-70">
            <div className="flex items-center gap-[var(--space-2)]">
              <span className="font-bold text-amber-400">{t.cmdShellTitle}</span>
              {isAdminMode && (
                <span className="bg-red-600 text-white font-black px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[9px] uppercase tracking-wider animate-pulse">
                  {t.cmdAdminElevated}
                </span>
              )}
            </div>
            <div className="flex items-center gap-[var(--space-2)]">
              {onToggleAdminMode && (
                <button
                  type="button"
                  onClick={onToggleAdminMode}
                  className={`text-[10px] font-bold px-[var(--space-1)].5 py-[var(--space-1)] rounded border cursor-pointer ${
                    isAdminMode
                      ? 'bg-amber-400 text-black border-amber-300'
                      : 'bg-black/40 text-slate-300 border-white/20 hover:bg-white/10'
                  }`}
                >
                  {isAdminMode ? t.cmdElevatedShell : t.cmdUserShell}
                </button>
              )}
              <button
                onClick={onClearHistory}
                className="hover:text-red-400 cursor-pointer flex items-center gap-[var(--space-1)] text-[10px]"
              >
                <Trash2 className="w-3 h-3" /> {t.clearLabel}
              </button>
              <button onClick={() => setIsLogOpen(false)} className="hover:text-white cursor-pointer text-[10px]">
                ✕ {t.hideLabel}
              </button>
            </div>
          </div>

          {commandHistory.length === 0 ? (
            <div className="opacity-40 italic">{t.cmdHelpHint}</div>
          ) : (
            commandHistory.map((item) => (
              <div key={item.id} className="space-y-0.5">
                <div className="flex items-center gap-[var(--space-1)] font-bold text-amber-300">
                  <span>{currentPath}&gt;</span>
                  <span className="text-white">{item.command}</span>
                </div>
                {item.output && (
                  <pre
                    className={`whitespace-pre-wrap pl-2 ${item.status === 'error' ? 'text-red-400' : 'text-emerald-400'}`}
                  >
                    {item.output}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Real-Time Command History Autocomplete Popup */}
      {isSuggestionsOpen && suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-0.5 px-[var(--space-2)] pointer-events-auto">
          <div
            className="w-full max-w-2xl bg-neutral-950/95 border-2 border-amber-400/80 rounded shadow-2xl overflow-hidden backdrop-blur font-mono text-[11px] animate-fadeIn"
            style={{ color: theme.itemText }}
          >
            {/* Suggestions Header */}
            <div className="px-[var(--space-3)] py-[var(--space-1)] bg-amber-950/80 border-b border-amber-400/40 flex items-center justify-between text-[10px] font-bold text-amber-300">
              <div className="flex items-center gap-[var(--space-2)]">
                <History className="w-3 h-3 text-amber-400 animate-pulse" />
                <span>{t.cmdAutocomplete.replace('{n}', String(suggestions.length))}</span>
              </div>
              <div className="flex items-center gap-[var(--space-2)] opacity-80 font-normal">
                <span>{t.keyNavigate}</span>
                <span>{t.keyComplete}</span>
                <span>{t.keyRun}</span>
                <span>{t.escClose}</span>
              </div>
            </div>

            {/* Suggestions List */}
            <div
              ref={suggestionsContainerRef}
              className="max-h-48 overflow-y-auto divide-y divide-white/5 p-[var(--space-1)] space-y-0.5"
            >
              {suggestions.map((sug, idx) => {
                const isSelected = selectedSuggestionIndex === idx;
                const isHistory = sug.source === 'history';
                const isBuiltin = sug.source === 'builtin';

                return (
                  <div
                    key={idx}
                    onClick={() => applySuggestion(sug.text, false)}
                    onDoubleClick={() => applySuggestion(sug.text, true)}
                    onMouseEnter={() => setSelectedSuggestionIndex(idx)}
                    className={`flex items-center justify-between px-[var(--space-2)] py-[var(--space-1)] rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-amber-400 text-black font-bold shadow' : 'hover:bg-white/10 text-white/90'
                    }`}
                  >
                    <div className="flex items-center gap-[var(--space-2)] min-w-0 flex-1">
                      <div className="shrink-0 flex items-center">
                        {isHistory ? (
                          <span
                            className={`px-[var(--space-1)] py-0.2 rounded text-[9px] font-bold uppercase flex items-center gap-[var(--space-1)] ${
                              isSelected
                                ? 'bg-black text-amber-300'
                                : 'bg-amber-950/90 text-amber-400 border border-amber-500/40'
                            }`}
                          >
                            <History className="w-2.5 h-2.5" /> {t.historyShort}
                          </span>
                        ) : isBuiltin ? (
                          <span
                            className={`px-[var(--space-1)] py-0.2 rounded text-[9px] font-bold uppercase ${
                              isSelected
                                ? 'bg-black text-cyan-300'
                                : 'bg-cyan-950/90 text-cyan-400 border border-cyan-500/40'
                            }`}
                          >
                            DOS
                          </span>
                        ) : (
                          <span
                            className={`px-[var(--space-1)] py-0.2 rounded text-[9px] font-bold uppercase ${
                              isSelected
                                ? 'bg-black text-emerald-300'
                                : 'bg-emerald-950/90 text-emerald-400 border border-emerald-500/40'
                            }`}
                          >
                            {t.file}
                          </span>
                        )}
                      </div>

                      <div className="truncate flex-1 font-mono">
                        {renderHighlightedText(sug.text, inputVal.trim())}
                      </div>
                    </div>

                    <div className="flex items-center gap-[var(--space-2)] text-[10px] shrink-0 opacity-80 pl-2">
                      {sug.timestamp && <span className="text-[9px] opacity-60 hidden sm:inline">{sug.timestamp}</span>}
                      {isSelected ? (
                        <span className="flex items-center gap-[var(--space-1)] font-bold text-black text-[9px] bg-amber-300 px-[var(--space-1)] rounded">
                          <CornerDownLeft className="w-2.5 h-2.5" /> Enter
                        </span>
                      ) : (
                        <span className="text-[9px] opacity-50">Tab ➔</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab Completion Bar (Fallback / Explicit Tab) */}
      {tabState && tabState.matches.length > 0 && !isSuggestionsOpen && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] bg-black/80 border-b border-amber-400/30 font-mono text-[11px] select-none text-amber-300">
          <span className="text-white/70 font-bold flex items-center gap-[var(--space-1)] text-[10px]">
            <kbd className="px-[var(--space-1)] py-0.2 bg-amber-400/20 border border-amber-400/40 rounded text-amber-300 font-extrabold text-[9px]">
              TAB
            </kbd>
            <span>{t.cmdMatches.replace('{n}', String(tabState.matches.length))}</span>
          </span>
          <div className="flex items-center gap-[var(--space-1)] overflow-x-auto max-w-full no-scrollbar py-[var(--space-1)]">
            {tabState.matches.map((match, idx) => {
              const isSelected = idx === tabState.currentIndex;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    const formatted = formatMatch(match);
                    const nextVal = tabState.prefix + formatted;
                    setInputVal(nextVal);
                    setTabState({
                      ...tabState,
                      currentIndex: idx,
                      expectedInputValue: nextVal,
                    });
                    inputRef.current?.focus();
                  }}
                  className={`px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[10px] font-mono cursor-pointer transition-colors whitespace-nowrap border ${
                    isSelected
                      ? 'bg-amber-400 text-black border-amber-300 font-extrabold shadow-sm'
                      : 'bg-black/60 text-amber-200/80 border-white/10 hover:border-amber-400/50 hover:bg-white/10'
                  }`}
                >
                  {match}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Command Input Row */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center px-[var(--space-2)] py-[var(--space-1)] gap-[var(--space-1)] relative"
      >
        <button
          type="button"
          onClick={() => setIsLogOpen(!isLogOpen)}
          title={t.toggleConsole}
          className="p-[var(--space-1)] hover:bg-white/10 rounded cursor-pointer text-amber-400 shrink-0"
        >
          {isLogOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        <span
          className={`font-bold shrink-0 select-none ${isAdminMode ? 'text-red-400 font-extrabold' : 'text-amber-400'}`}
        >
          {isAdminMode ? `[ADMIN] ${currentPath}>` : `${currentPath}>`}
        </span>

        {/* Input with Inline Ghost Text Completion */}
        <div className="relative flex-1 flex items-center min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsSuggestionsOpen(true)}
            placeholder={t.cmdPlaceholder}
            className="w-full bg-transparent border-none outline-none text-white font-mono text-xs placeholder:text-white/30 z-10"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Ghost text overlay behind real input */}
          {ghostSuffix && (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center pointer-events-none font-mono text-xs select-none overflow-hidden"
            >
              <span className="opacity-0">{inputVal}</span>
              <span className="text-amber-400/50 italic font-semibold">{ghostSuffix}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-[var(--space-2)] shrink-0">
          {commandHistory.length > 0 && (
            <button
              type="button"
              onClick={() => {
                soundManager.playKeyTick();
                setIsSuggestionsOpen((prev) => !prev);
              }}
              title={t.commandHistory}
              className={`p-[var(--space-1)] rounded text-[11px] font-bold flex items-center gap-[var(--space-1)] cursor-pointer transition ${
                isSuggestionsOpen && suggestions.length > 0
                  ? 'bg-amber-400/30 text-amber-300 border border-amber-400/50'
                  : 'bg-black/30 hover:bg-white/10 text-white/60'
              }`}
            >
              <History className="w-3 h-3" />
              <span className="hidden sm:inline text-[10px]">{commandHistory.length}</span>
            </button>
          )}

          <button
            type="submit"
            className="px-[var(--space-3)] py-[var(--space-1)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded text-[11px] cursor-pointer shadow flex items-center gap-[var(--space-1)]"
          >
            <span>{t.runCommand}</span>
            <CornerDownLeft className="w-3 h-3" />
          </button>
        </div>
      </form>
    </div>
  );
};
