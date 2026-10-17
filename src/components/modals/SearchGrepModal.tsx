import React, { useState } from 'react';
import { Search, FileText, History, RotateCcw, Trash2 } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';

interface SearchGrepModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  currentDriveId: string;
  currentPath: string;
  onSelectFile: (file: FileItem) => void;
  onClose: () => void;
}

interface SearchResult {
  file: FileItem;
  matches: { line: number; text: string }[];
}

interface SearchHistoryItem {
  id: string;
  timestamp: string;
  filePattern: string;
  grepText: string;
  datePreset: 'all' | 'today' | 'last_7' | 'last_30';
  minSizeKB: string;
  maxSizeKB: string;
  filterReadOnly: boolean;
  filterHidden: boolean;
  filterSystem: boolean;
  caseSensitive: boolean;
  searchAllDrives: boolean;
}

const STORAGE_KEY = 'nc_search_history_v1';

const loadSearchHistory = (): SearchHistoryItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, 5);
    }
  } catch { /* ignore */ }
  return [];
};

const saveSearchHistory = (history: SearchHistoryItem[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 5)));
  } catch { /* ignore */ }
};

export const SearchGrepModal: React.FC<SearchGrepModalProps> = ({
  theme,
  lang,
  currentDriveId,
  onSelectFile,
  onClose
}) => {
  const t = getTranslations(lang);
  const [filePattern, setFilePattern] = useState('*.*');
  const [grepText, setGrepText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchAllDrives, setSearchAllDrives] = useState(false);

  // Advanced Filters
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'last_7' | 'last_30'>('all');
  const [minSizeKB, setMinSizeKB] = useState('');
  const [maxSizeKB, setMaxSizeKB] = useState('');
  const [filterReadOnly, setFilterReadOnly] = useState(false);
  const [filterHidden, setFilterHidden] = useState(false);
  const [filterSystem, setFilterSystem] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  // History State
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>(() => loadSearchHistory());

  const applyHistoryItem = (item: SearchHistoryItem) => {
    setFilePattern(item.filePattern);
    setGrepText(item.grepText);
    setDatePreset(item.datePreset);
    setMinSizeKB(item.minSizeKB);
    setMaxSizeKB(item.maxSizeKB);
    setFilterReadOnly(item.filterReadOnly);
    setFilterHidden(item.filterHidden);
    setFilterSystem(item.filterSystem);
    setCaseSensitive(item.caseSensitive);
    setSearchAllDrives(item.searchAllDrives);
    soundManager.playSelectSound();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    soundManager.playDiskAccess();
    setIsSearching(true);

    setTimeout(() => {
      const allFiles = fsEngine.getSearchIndex(searchAllDrives, currentDriveId);
      const patternRegex = new RegExp(
        '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i'
      );

      const found: SearchResult[] = [];
      const now = new Date();

      allFiles.forEach(file => {
        if (!searchAllDrives && file.driveId !== currentDriveId) return;

        const fullName = file.ext ? `${file.name}.${file.ext}` : file.name;
        const nameMatches = patternRegex.test(fullName) || patternRegex.test(file.name);

        if (!nameMatches) return;

        // Size Filter
        const sizeKB = file.size / 1024;
        if (minSizeKB && sizeKB < Number(minSizeKB)) return;
        if (maxSizeKB && sizeKB > Number(maxSizeKB)) return;

        // Attribute Filter
        if (filterReadOnly && !file.attributes.readOnly) return;
        if (filterHidden && !file.attributes.hidden) return;
        if (filterSystem && !file.attributes.system) return;

        // Date Filter
        if (datePreset !== 'all' && file.modifiedAt) {
          const modDate = new Date(file.modifiedAt);
          const diffDays = (now.getTime() - modDate.getTime()) / (1000 * 3600 * 24);
          if (datePreset === 'today' && diffDays > 1) return;
          if (datePreset === 'last_7' && diffDays > 7) return;
          if (datePreset === 'last_30' && diffDays > 30) return;
        }

        // If grep text specified
        if (grepText) {
          if (!file.content || file.isDirectory) return;
          const lines = file.content.split('\n');
          const fileMatches: { line: number; text: string }[] = [];

          lines.forEach((l, idx) => {
            const hasMatch = caseSensitive 
              ? l.includes(grepText) 
              : l.toLowerCase().includes(grepText.toLowerCase());
            if (hasMatch) {
              fileMatches.push({ line: idx + 1, text: l.trim() });
            }
          });

          if (fileMatches.length > 0) {
            found.push({ file, matches: fileMatches });
          }
        } else {
          found.push({ file, matches: [] });
        }
      });

      setResults(found);
      setIsSearching(false);
      soundManager.playSuccess();

      // Save to Search History (Max 5 entries)
      const newEntry: SearchHistoryItem = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        filePattern,
        grepText,
        datePreset,
        minSizeKB,
        maxSizeKB,
        filterReadOnly,
        filterHidden,
        filterSystem,
        caseSensitive,
        searchAllDrives
      };

      const filteredHistory = searchHistory.filter(item => 
        !(item.filePattern === filePattern && 
          item.grepText === grepText && 
          item.datePreset === datePreset && 
          item.minSizeKB === minSizeKB && 
          item.maxSizeKB === maxSizeKB && 
          item.filterReadOnly === filterReadOnly &&
          item.filterHidden === filterHidden &&
          item.filterSystem === filterSystem &&
          item.caseSensitive === caseSensitive &&
          item.searchAllDrives === searchAllDrives)
      );

      const updatedHistory = [newEntry, ...filteredHistory].slice(0, 5);
      setSearchHistory(updatedHistory);
      saveSearchHistory(updatedHistory);
    }, 120);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.searchDialogTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono select-none backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-3xl h-[88vh] flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0 text-white"
          style={{ backgroundColor: theme.modalHeaderBg }}
        >
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-300" />
            <span>{t.searchAdvTitle}</span>
          </div>
          <button onClick={onClose} className="px-2 py-0.5 bg-black/30 hover:bg-black/60 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        {/* Search History Bar */}
        {searchHistory.length > 0 && (
          <div className="px-3 py-1.5 bg-amber-950/30 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-1.5 text-[11px] shrink-0">
            <div className="flex items-center gap-1.5 font-bold text-amber-300">
              <History className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{t.searchHistoryCount.replace('{n}', String(searchHistory.length))}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 max-w-full overflow-x-auto no-scrollbar">
              {searchHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyHistoryItem(item)}
                  className="px-2 py-0.5 rounded border border-amber-400/30 bg-black/60 hover:bg-amber-400 hover:text-black text-amber-200 transition-colors cursor-pointer flex items-center gap-1 font-mono text-[10px]"
                  title={t.searchRecall.replace('{label}', `${item.filePattern}${item.grepText ? ` | "${item.grepText}"` : ''} (${item.datePreset})`)}
                >
                  <RotateCcw className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-bold">{item.filePattern}</span>
                  {item.grepText && <span className="opacity-80 truncate max-w-[80px]">| "{item.grepText}"</span>}
                  <span className="opacity-50 text-[9px] ml-0.5">{item.timestamp}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSearchHistory([]);
                  saveSearchHistory([]);
                  soundManager.playKeyTick();
                }}
                className="px-1.5 py-0.5 text-[10px] text-red-400/80 hover:text-red-300 hover:bg-red-950/40 rounded transition-colors cursor-pointer"
                title={t.searchClearHistory}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Search Parameters Form */}
        <form onSubmit={handleSearch} className="p-3 bg-black/40 border-b border-white/10 space-y-3 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] opacity-80 mb-0.5 font-bold">{t.searchNameWildcard}</label>
              <input
                type="text"
                value={filePattern}
                onChange={(e) => setFilePattern(e.target.value)}
                placeholder={t.searchWildcardPlaceholder}
                className="w-full bg-black/60 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs outline-none focus:ring-1 focus:ring-amber-400"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] opacity-80 mb-0.5 font-bold">{t.searchGrepLabel}</label>
              <input
                type="text"
                value={grepText}
                onChange={(e) => setGrepText(e.target.value)}
                placeholder={t.searchTextPlaceholder}
                className="w-full bg-black/60 border border-white/20 rounded px-2 py-1 text-white font-mono text-xs outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Filters Bar: Dates, Sizes, Attributes */}
          <div className="p-2 bg-black/50 rounded border border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
            {/* Date Preset */}
            <div>
              <span className="text-[10px] font-bold text-amber-300 uppercase block mb-1">{t.searchDateRange}</span>
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as any)}
                className="w-full px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
              >
                <option value="all">{t.searchDateAll}</option>
                <option value="today">{t.searchDateToday}</option>
                <option value="last_7">{t.searchLast7}</option>
                <option value="last_30">{t.searchLast30}</option>
              </select>
            </div>

            {/* Size Min/Max */}
            <div>
              <span className="text-[10px] font-bold text-sky-300 uppercase block mb-1">{t.searchSizeRange}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder={t.searchMinKb}
                  value={minSizeKB}
                  onChange={(e) => setMinSizeKB(e.target.value)}
                  className="w-1/2 px-1.5 py-1 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
                <span className="opacity-50">-</span>
                <input
                  type="number"
                  placeholder={t.searchMaxKb}
                  value={maxSizeKB}
                  onChange={(e) => setMaxSizeKB(e.target.value)}
                  className="w-1/2 px-1.5 py-1 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* Attributes Checkboxes */}
            <div>
              <span className="text-[10px] font-bold text-emerald-300 uppercase block mb-1">{t.searchAttrSection}</span>
              <div className="flex items-center gap-2 pt-0.5">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterReadOnly}
                    onChange={(e) => setFilterReadOnly(e.target.checked)}
                  />
                  <span>R/O</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterHidden}
                    onChange={(e) => setFilterHidden(e.target.checked)}
                  />
                  <span>{t.searchAttrHidden}</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterSystem}
                    onChange={(e) => setFilterSystem(e.target.checked)}
                  />
                  <span>{t.searchAttrSystem}</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />
                <span>{t.searchCaseSensitive}</span>
              </label>

              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={searchAllDrives}
                  onChange={(e) => setSearchAllDrives(e.target.checked)}
                />
                <span>{t.searchAllDrives}</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isSearching}
              className="px-6 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-1.5"
            >
              <Search className="w-4 h-4" />
              <span>{isSearching ? t.searchSearchingShort : t.searchStart}</span>
            </button>
          </div>
        </form>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 bg-black/60 space-y-1 font-mono">
          {results.length === 0 ? (
            <div className="p-8 text-center opacity-50 italic">
              {isSearching ? t.searchScanning : t.searchNoResults}
            </div>
          ) : (
            results.map(({ file, matches }) => (
              <div 
                key={file.id}
                onClick={() => {
                  soundManager.playDiskAccess();
                  onSelectFile(file);
                  onClose();
                }}
                className="p-2 rounded border border-white/10 hover:border-amber-400 hover:bg-white/10 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <FileText className="w-3.5 h-3.5" />
                    <span>{file.path}\{file.name}.{file.ext}</span>
                  </div>
                  <span className="opacity-60 text-[11px] tabular-nums">{file.size.toLocaleString()} bytes | {file.modifiedAt?.substring(0, 10)}</span>
                </div>

                {matches.length > 0 && (
                  <div className="mt-1 pl-5 space-y-0.5 text-[11px] text-emerald-300 font-mono">
                    {matches.slice(0, 3).map((m, mIdx) => (
                      <div key={mIdx} className="truncate">
                        <span className="opacity-50">{t.searchLine.replace('{n}', String(m.line))}</span> {m.text}
                      </div>
                    ))}
                    {matches.length > 3 && (
                      <div className="opacity-50 text-[10px]">{t.searchMoreMatches.replace('{n}', String(matches.length - 3))}</div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <span className="font-bold text-amber-300">{t.searchFound.replace('{n}', String(results.length))}</span>
          <button
            onClick={onClose}
            className="px-4 py-1 bg-white/10 hover:bg-white/20 rounded cursor-pointer font-bold"
          >
            {t.btnClose}
          </button>
        </div>
      </div>
    </div>
  );
};

