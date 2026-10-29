import React, { useState } from 'react';
import { Search, FileText, History, RotateCcw, Trash2 } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';
import { panelFilterPattern } from '../../utils/panelFilter';
import { decodeFileBytes } from '../../utils/fileContent';

/** Reading contents is bounded: one search must not try to grep a whole drive. */
const GREP_MAX_FILES = 100;
const GREP_MAX_BYTES = 1024 * 1024;

import ModalShell from '../ModalShell';

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
  } catch {
    /* ignore */
  }
  return [];
};

const saveSearchHistory = (history: SearchHistoryItem[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 5)));
  } catch {
    /* ignore */
  }
};

export const SearchGrepModal: React.FC<SearchGrepModalProps> = ({
  theme,
  lang,
  currentDriveId,
  onSelectFile,
  onClose,
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
  // Files the content search could not read, so "no matches" never hides them.
  const [skippedFiles, setSkippedFiles] = useState(0);

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

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    soundManager.playDiskAccess();
    setIsSearching(true);
    setSkippedFiles(0);

    {
      const allFiles = fsEngine.getSearchIndex(searchAllDrives, currentDriveId);
      // The same wildcard rules as the panel filter: `*` and `?`, nothing else.
      const pattern = panelFilterPattern(filePattern.trim() || '*');
      const needle = caseSensitive ? grepText : grepText.toLowerCase();

      const found: SearchResult[] = [];
      let skipped = 0;
      let scanned = 0;
      const now = new Date();

      for (const file of allFiles) {
        if (!searchAllDrives && file.driveId !== currentDriveId) continue;

        const fullName = file.ext ? `${file.name}.${file.ext}` : file.name;
        if (!pattern.test(fullName) && !pattern.test(file.name)) continue;

        // Size Filter
        const sizeKB = file.size / 1024;
        if (minSizeKB && sizeKB < Number(minSizeKB)) continue;
        if (maxSizeKB && sizeKB > Number(maxSizeKB)) continue;

        // Attribute Filter
        if (filterReadOnly && !file.attributes.readOnly) continue;
        if (filterHidden && !file.attributes.hidden) continue;
        if (filterSystem && !file.attributes.system) continue;

        // Date Filter
        if (datePreset !== 'all' && file.modifiedAt) {
          const modDate = new Date(file.modifiedAt);
          const diffDays = (now.getTime() - modDate.getTime()) / (1000 * 3600 * 24);
          if (datePreset === 'today' && diffDays > 1) continue;
          if (datePreset === 'last_7' && diffDays > 7) continue;
          if (datePreset === 'last_30' && diffDays > 30) continue;
        }

        if (!needle) {
          found.push({ file, matches: [] });
          continue;
        }

        // The name matched, so the text has to come from the file itself: the
        // listing carries no bytes, and the old check on `file.content` skipped
        // every real file, which looked exactly like "no matches".
        if (file.isDirectory || file.size > GREP_MAX_BYTES || scanned >= GREP_MAX_FILES) {
          skipped += 1;
          continue;
        }
        scanned += 1;

        try {
          const bytes = await fsEngine.readFileBytes(file, { maxBytes: GREP_MAX_BYTES });
          const decoded = decodeFileBytes(bytes, GREP_MAX_BYTES);
          if (decoded.binary) {
            skipped += 1;
            continue;
          }
          const fileMatches: { line: number; text: string }[] = [];
          decoded.text.split('\n').forEach((line, index) => {
            const haystack = caseSensitive ? line : line.toLowerCase();
            if (haystack.includes(needle)) fileMatches.push({ line: index + 1, text: line.trim() });
          });
          if (fileMatches.length > 0) found.push({ file, matches: fileMatches });
        } catch {
          skipped += 1;
        }
      }

      setResults(found);
      setSkippedFiles(skipped);
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
        searchAllDrives,
      };

      const filteredHistory = searchHistory.filter(
        (item) =>
          !(
            item.filePattern === filePattern &&
            item.grepText === grepText &&
            item.datePreset === datePreset &&
            item.minSizeKB === minSizeKB &&
            item.maxSizeKB === maxSizeKB &&
            item.filterReadOnly === filterReadOnly &&
            item.filterHidden === filterHidden &&
            item.filterSystem === filterSystem &&
            item.caseSensitive === caseSensitive &&
            item.searchAllDrives === searchAllDrives
          ),
      );

      const updatedHistory = [newEntry, ...filteredHistory].slice(0, 5);
      setSearchHistory(updatedHistory);
      saveSearchHistory(updatedHistory);
    }
  };

  return (
    <ModalShell title={t.searchAdvTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        {/* Search History Bar */}
        {searchHistory.length > 0 && (
          <div className="px-[var(--space-3)] py-[var(--space-2)] bg-amber-950/30 border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-[var(--space-2)] text-[11px] shrink-0">
            <div className="flex items-center gap-[var(--space-2)] font-bold text-amber-300">
              <History className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{t.searchHistoryCount.replace('{n}', String(searchHistory.length))}</span>
            </div>
            <div className="flex flex-wrap items-center gap-[var(--space-2)] max-w-full overflow-x-auto no-scrollbar">
              {searchHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyHistoryItem(item)}
                  className="px-[var(--space-2)] py-[var(--space-1)] rounded border border-amber-400/30 bg-black/60 hover:bg-amber-400 hover:text-black text-amber-200 transition-colors cursor-pointer flex items-center gap-[var(--space-1)] font-mono text-[10px]"
                  title={t.searchRecall.replace(
                    '{label}',
                    `${item.filePattern}${item.grepText ? ` | "${item.grepText}"` : ''} (${item.datePreset})`,
                  )}
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
                className="px-[var(--space-1)].5 py-[var(--space-1)] text-[10px] text-red-400/80 hover:text-red-300 hover:bg-red-950/40 rounded transition-colors cursor-pointer"
                title={t.searchClearHistory}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Search Parameters Form */}
        <form
          onSubmit={handleSearch}
          className="p-[var(--space-3)] bg-black/40 border-b border-white/10 space-y-[var(--space-3)] shrink-0"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-2)]">
            <div>
              <label className="block text-[11px] opacity-80 mb-0.5 font-bold">{t.searchNameWildcard}</label>
              <input
                type="text"
                value={filePattern}
                onChange={(e) => setFilePattern(e.target.value)}
                placeholder={t.searchWildcardPlaceholder}
                className="w-full bg-black/60 border border-white/20 rounded px-[var(--space-2)] py-[var(--space-1)] text-white font-mono text-xs outline-none focus:ring-1 focus:ring-amber-400"
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
                className="w-full bg-black/60 border border-white/20 rounded px-[var(--space-2)] py-[var(--space-1)] text-white font-mono text-xs outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Filters Bar: Dates, Sizes, Attributes */}
          <div className="p-[var(--space-2)] bg-black/50 rounded border border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-[var(--space-3)] text-[11px]">
            {/* Date Preset */}
            <div>
              <span className="text-[10px] font-bold text-amber-300 uppercase block mb-[var(--space-1)]">
                {t.searchDateRange}
              </span>
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as any)}
                className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
              >
                <option value="all">{t.searchDateAll}</option>
                <option value="today">{t.searchDateToday}</option>
                <option value="last_7">{t.searchLast7}</option>
                <option value="last_30">{t.searchLast30}</option>
              </select>
            </div>

            {/* Size Min/Max */}
            <div>
              <span className="text-[10px] font-bold text-sky-300 uppercase block mb-[var(--space-1)]">
                {t.searchSizeRange}
              </span>
              <div className="flex items-center gap-[var(--space-1)]">
                <input
                  type="number"
                  placeholder={t.searchMinKb}
                  value={minSizeKB}
                  onChange={(e) => setMinSizeKB(e.target.value)}
                  className="w-1/2 px-[var(--space-1)].5 py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
                <span className="opacity-50">-</span>
                <input
                  type="number"
                  placeholder={t.searchMaxKb}
                  value={maxSizeKB}
                  onChange={(e) => setMaxSizeKB(e.target.value)}
                  className="w-1/2 px-[var(--space-1)].5 py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* Attributes Checkboxes */}
            <div>
              <span className="text-[10px] font-bold text-emerald-300 uppercase block mb-[var(--space-1)]">
                {t.searchAttrSection}
              </span>
              <div className="flex items-center gap-[var(--space-2)] pt-0.5">
                <label className="flex items-center gap-[var(--space-1)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterReadOnly}
                    onChange={(e) => setFilterReadOnly(e.target.checked)}
                  />
                  <span>R/O</span>
                </label>
                <label className="flex items-center gap-[var(--space-1)] cursor-pointer">
                  <input type="checkbox" checked={filterHidden} onChange={(e) => setFilterHidden(e.target.checked)} />
                  <span>{t.searchAttrHidden}</span>
                </label>
                <label className="flex items-center gap-[var(--space-1)] cursor-pointer">
                  <input type="checkbox" checked={filterSystem} onChange={(e) => setFilterSystem(e.target.checked)} />
                  <span>{t.searchAttrSystem}</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-[var(--space-4)]">
              <label className="flex items-center gap-[var(--space-1)] cursor-pointer">
                <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
                <span>{t.searchCaseSensitive}</span>
              </label>

              <label className="flex items-center gap-[var(--space-1)] cursor-pointer">
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
              className="px-6 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-2)]"
            >
              <Search className="w-4 h-4" />
              <span>{isSearching ? t.searchSearchingShort : t.searchStart}</span>
            </button>
          </div>
        </form>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-[var(--space-2)] bg-black/60 space-y-[var(--space-1)] font-mono">
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
                className="p-[var(--space-2)] rounded border border-white/10 hover:border-amber-400 hover:bg-white/10 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-[var(--space-2)] font-bold text-amber-300">
                    <FileText className="w-3.5 h-3.5" />
                    <span>
                      {file.path}\{file.name}.{file.ext}
                    </span>
                  </div>
                  <span className="opacity-60 text-[11px] tabular-nums">
                    {file.size.toLocaleString()} bytes | {file.modifiedAt?.substring(0, 10)}
                  </span>
                </div>

                {matches.length > 0 && (
                  <div className="mt-[var(--space-1)] pl-5 space-y-0.5 text-[11px] text-emerald-300 font-mono">
                    {matches.slice(0, 3).map((m, mIdx) => (
                      <div key={mIdx} className="truncate">
                        <span className="opacity-50">{t.searchLine.replace('{n}', String(m.line))}</span> {m.text}
                      </div>
                    ))}
                    {matches.length > 3 && (
                      <div className="opacity-50 text-[10px]">
                        {t.searchMoreMatches.replace('{n}', String(matches.length - 3))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder,
          }}
        >
          <span className="font-bold text-amber-300">
            {t.searchFound.replace('{n}', String(results.length))}
            {skippedFiles > 0 && (
              <span className="ml-[var(--space-2)] font-normal text-amber-200/80">
                {t.searchSkipped.replace('{n}', String(skippedFiles))}
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            className="px-[var(--space-4)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded cursor-pointer font-bold"
          >
            {t.btnClose}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
