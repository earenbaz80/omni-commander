import React, { useState, useMemo } from 'react';
import { FolderSync, ArrowLeftRight, RefreshCw, CheckCircle2, FileText, Folder, HardDrive } from 'lucide-react';
import { FileItem, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';

import ModalShell from '../ModalShell';

interface SyncFoldersModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  leftDriveId: string;
  leftPath: string;
  leftItems: FileItem[];
  rightDriveId: string;
  rightPath: string;
  rightItems: FileItem[];
  onSyncComplete: () => void;
  onClose: () => void;
}

export type SyncDirection = 'L_TO_R' | 'R_TO_L' | 'SKIP';

export interface SyncDiffItem {
  id: string; // unique key
  name: string;
  ext?: string;
  isDirectory: boolean;
  leftItem?: FileItem;
  rightItem?: FileItem;
  status: 'LEFT_ONLY' | 'RIGHT_ONLY' | 'LEFT_NEWER' | 'RIGHT_NEWER' | 'SIZE_MISMATCH' | 'EQUAL';
  direction: SyncDirection;
}

export const SyncFoldersModal: React.FC<SyncFoldersModalProps> = ({
  theme,
  lang,
  leftDriveId,
  leftPath,
  leftItems,
  rightDriveId,
  rightPath,
  rightItems,
  onSyncComplete,
  onClose,
}) => {
  const t = getTranslations(lang);

  // Sync criteria filters
  const [compareByDate] = useState(true);
  const [compareBySize] = useState(true);
  const [hideEqual, setHideEqual] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  // Generate initial diff map
  const [diffItems, setDiffItems] = useState<SyncDiffItem[]>(() => {
    const map = new Map<string, { left?: FileItem; right?: FileItem }>();

    leftItems.forEach((item) => {
      const key = `${item.name.toLowerCase()}_${(item.ext || '').toLowerCase()}`;
      map.set(key, { left: item });
    });

    rightItems.forEach((item) => {
      const key = `${item.name.toLowerCase()}_${(item.ext || '').toLowerCase()}`;
      const existing = map.get(key);
      if (existing) {
        existing.right = item;
      } else {
        map.set(key, { right: item });
      }
    });

    const result: SyncDiffItem[] = [];

    map.forEach((value, key) => {
      const { left, right } = value;
      const name = left ? left.name : right!.name;
      const ext = left ? left.ext : right!.ext;
      const isDirectory = left ? left.isDirectory : right!.isDirectory;

      let status: SyncDiffItem['status'] = 'EQUAL';
      let direction: SyncDirection = 'SKIP';

      if (left && !right) {
        status = 'LEFT_ONLY';
        direction = 'L_TO_R';
      } else if (!left && right) {
        status = 'RIGHT_ONLY';
        direction = 'R_TO_L';
      } else if (left && right) {
        if (compareBySize && left.size !== right.size) {
          status = 'SIZE_MISMATCH';
          direction = left.size > right.size ? 'L_TO_R' : 'R_TO_L';
        } else if (compareByDate && left.modifiedAt !== right.modifiedAt) {
          // Compare strings or date heuristic
          status = left.modifiedAt > right.modifiedAt ? 'LEFT_NEWER' : 'RIGHT_NEWER';
          direction = status === 'LEFT_NEWER' ? 'L_TO_R' : 'R_TO_L';
        } else {
          status = 'EQUAL';
          direction = 'SKIP';
        }
      }

      result.push({
        id: key,
        name,
        ext,
        isDirectory,
        leftItem: left,
        rightItem: right,
        status,
        direction,
      });
    });

    return result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  });

  // Toggle sync direction for a specific item
  const handleToggleItemDirection = (id: string) => {
    setDiffItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        let nextDir: SyncDirection;
        if (item.direction === 'L_TO_R') nextDir = 'R_TO_L';
        else if (item.direction === 'R_TO_L') nextDir = 'SKIP';
        else nextDir = 'L_TO_R';
        return { ...item, direction: nextDir };
      }),
    );
  };

  // Preset mass actions
  const setAllDirection = (dir: SyncDirection) => {
    soundManager.playKeyTick();
    setDiffItems((prev) => prev.map((item) => ({ ...item, direction: dir })));
  };

  const setSmartSync = () => {
    soundManager.playKeyTick();
    setDiffItems((prev) =>
      prev.map((item) => {
        if (item.status === 'LEFT_ONLY' || item.status === 'LEFT_NEWER') return { ...item, direction: 'L_TO_R' };
        if (item.status === 'RIGHT_ONLY' || item.status === 'RIGHT_NEWER') return { ...item, direction: 'R_TO_L' };
        return { ...item, direction: 'SKIP' };
      }),
    );
  };

  // Filtered list
  const visibleItems = useMemo(() => {
    if (!hideEqual) return diffItems;
    return diffItems.filter((i) => i.status !== 'EQUAL' || i.direction !== 'SKIP');
  }, [diffItems, hideEqual]);

  // Statistics
  const countLtoR = diffItems.filter((i) => i.direction === 'L_TO_R').length;
  const countRtoL = diffItems.filter((i) => i.direction === 'R_TO_L').length;
  const countSkip = diffItems.filter((i) => i.direction === 'SKIP').length;

  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  /**
   * Copies one entry to the other panel.
   *
   * A real drive is addressed by its path on disk, not by the catalogue id this
   * dialog captured when it opened: every copy reloads a panel, and a reload
   * hands out fresh ids, so a two-way run used to die on its second file with
   * "the file is no longer in the panel". Virtual and archive entries have no
   * disk path to replay, so they still go through the id.
   */
  const copyEntry = async (source: FileItem, targetDriveId: string, targetPath: string): Promise<void> => {
    if (fsEngine.isRealFile(source)) {
      await fsEngine.transferPaths('copy', [fsEngine.absolutePathOf(source)], targetPath, true);
      await fsEngine.loadSystemDriveDirectory(targetDriveId, targetPath);
      return;
    }

    const copied = await fsEngine.copyItem(source.id, targetDriveId, targetPath, true);
    if (!copied) throw new Error(t.syncItemMissing.replace('{name}', source.name));
  };

  // Execute sync operations
  const handleExecuteSync = async () => {
    const toProcess = diffItems.filter((i) => i.direction !== 'SKIP');
    if (toProcess.length === 0) {
      alert(t.syncNoMarked);
      return;
    }

    setIsProcessing(true);
    soundManager.playDiskAccess();

    try {
      for (let i = 0; i < toProcess.length; i++) {
        const item = toProcess[i];
        setProgressMsg(
          t.syncProgress
            .replace('{current}', String(i + 1))
            .replace('{total}', String(toProcess.length))
            .replace('{name}', item.name),
        );

        // The copy is awaited, so the counter advances when a file was actually
        // written. It used to be fired and followed by a 60 ms sleep: the bar
        // moved whether or not anything happened, and a failed copy was lost.
        if (item.direction === 'L_TO_R' && item.leftItem) {
          await copyEntry(item.leftItem, rightDriveId, rightPath);
        } else if (item.direction === 'R_TO_L' && item.rightItem) {
          await copyEntry(item.rightItem, leftDriveId, leftPath);
        } else {
          throw new Error(t.syncItemMissing.replace('{name}', item.name));
        }
      }

      soundManager.playSuccess();
      onSyncComplete();
      onClose();
    } catch (err) {
      alert(t.syncError.replace('{error}', err instanceof Error ? err.message : String(err)));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ModalShell title={t.syncModalTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        {/* Directory Comparison Banner */}
        <div className="p-[var(--space-3)] bg-black/50 border-b border-white/10 grid grid-cols-1 md:grid-cols-2 gap-[var(--space-3)] shrink-0">
          <div className="p-[var(--space-2)] bg-black/40 rounded border border-sky-400/30 flex items-center gap-[var(--space-2)] truncate">
            <HardDrive className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="truncate">
              <span className="text-[10px] text-sky-300 font-bold block uppercase">{t.syncLeft}</span>
              <span className="font-bold text-white text-xs truncate block">{leftPath}</span>
            </div>
          </div>

          <div className="p-[var(--space-2)] bg-black/40 rounded border border-emerald-400/30 flex items-center gap-[var(--space-2)] truncate">
            <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="text-[10px] text-emerald-300 font-bold block uppercase">{t.syncRight}</span>
              <span className="font-bold text-white text-xs truncate block">{rightPath}</span>
            </div>
          </div>
        </div>

        {/* Controls & Quick Actions Toolbar */}
        <div className="px-[var(--space-4)] py-[var(--space-2)] bg-black/30 border-b border-white/10 flex flex-wrap items-center justify-between gap-[var(--space-2)] shrink-0 text-[11px]">
          {/* Quick Direction Actions */}
          <div className="flex items-center gap-[var(--space-2)] flex-wrap">
            <button
              onClick={setSmartSync}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded flex items-center gap-[var(--space-1)] cursor-pointer shadow"
              title={t.syncDesc}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" /> Auto Smart Sync
            </button>
            <button
              onClick={() => setAllDirection('L_TO_R')}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-sky-900/80 hover:bg-sky-800 text-sky-200 border border-sky-400/50 font-bold rounded flex items-center gap-[var(--space-1)] cursor-pointer"
            >
              {t.syncCopyAllAB}
            </button>
            <button
              onClick={() => setAllDirection('R_TO_L')}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-400/50 font-bold rounded flex items-center gap-[var(--space-1)] cursor-pointer"
            >
              {t.syncCopyAllBA}
            </button>
            <button
              onClick={() => setAllDirection('SKIP')}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 text-slate-300 font-bold rounded flex items-center gap-[var(--space-1)] cursor-pointer"
            >
              {t.syncSkipAll}
            </button>
          </div>

          {/* Filters & Toggles */}
          <div className="flex items-center gap-[var(--space-3)]">
            <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-bold text-amber-300">
              <input type="checkbox" checked={hideEqual} onChange={(e) => setHideEqual(e.target.checked)} />
              <span>{t.syncHideEqual}</span>
            </label>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="flex-1 overflow-y-auto p-[var(--space-2)] bg-black/60 font-mono text-[11px]">
          {visibleItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-60 space-y-[var(--space-2)]">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <p className="font-bold text-white">{t.syncInSync}</p>
              <p className="text-[10px]">{t.syncNoDiff}</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/20 text-amber-300 font-bold text-[10px] uppercase sticky top-0 bg-black/90 z-10">
                  <th className="p-[var(--space-2)]">{t.syncColItem}</th>
                  <th className="p-[var(--space-2)] text-right">{t.syncColLeftSize}</th>
                  <th className="p-[var(--space-2)] text-center">{t.syncColAction}</th>
                  <th className="p-[var(--space-2)] text-left">{t.syncColRightSize}</th>
                  <th className="p-[var(--space-2)] text-center">{t.syncColStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleItems.map((item) => {
                  let statusBadge = null;
                  switch (item.status) {
                    case 'LEFT_ONLY':
                      statusBadge = (
                        <span className="bg-sky-950 text-sky-300 border border-sky-400/50 px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[9px]">
                          {t.syncOnlyLeft}
                        </span>
                      );
                      break;
                    case 'RIGHT_ONLY':
                      statusBadge = (
                        <span className="bg-emerald-950 text-emerald-300 border border-emerald-400/50 px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[9px]">
                          {t.syncOnlyRight}
                        </span>
                      );
                      break;
                    case 'LEFT_NEWER':
                      statusBadge = (
                        <span className="bg-amber-950 text-amber-300 border border-amber-400/50 px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[9px]">
                          {t.syncLeftNewer}
                        </span>
                      );
                      break;
                    case 'RIGHT_NEWER':
                      statusBadge = (
                        <span className="bg-purple-950 text-purple-300 border border-purple-400/50 px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[9px]">
                          {t.syncRightNewer}
                        </span>
                      );
                      break;
                    case 'SIZE_MISMATCH':
                      statusBadge = (
                        <span className="bg-red-950 text-red-300 border border-red-400/50 px-[var(--space-1)].5 py-[var(--space-1)] rounded text-[9px]">
                          {t.syncSizeDiff}
                        </span>
                      );
                      break;
                    case 'EQUAL':
                      statusBadge = <span className="opacity-40 text-[9px]">{t.syncIdentical}</span>;
                      break;
                  }

                  return (
                    <tr
                      key={item.id}
                      // Read by the e2e spec: the name is the one the panels use, and
                      // the direction is what the run will actually do.
                      data-sync-name={item.name}
                      data-sync-status={item.status}
                      data-sync-direction={item.direction}
                      className={`hover:bg-white/10 transition-colors ${
                        item.direction !== 'SKIP' ? 'bg-amber-500/10 font-bold' : 'opacity-80'
                      }`}
                    >
                      {/* Name & Icon */}
                      <td className="p-[var(--space-2)] flex items-center gap-[var(--space-2)] truncate">
                        {item.isDirectory ? (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        )}
                        <span className="truncate text-white">
                          {item.name}
                          {item.ext ? `.${item.ext}` : ''}
                        </span>
                      </td>

                      {/* Left Side Info */}
                      <td className="p-[var(--space-2)] text-right font-mono text-[10px] text-sky-300">
                        {item.leftItem ? formatSize(item.leftItem.size) : '-'}
                      </td>

                      {/* Action Button Toggle */}
                      <td className="p-[var(--space-2)] text-center">
                        <button
                          onClick={() => handleToggleItemDirection(item.id)}
                          className={`px-[var(--space-3)] py-[var(--space-1)] rounded font-bold border cursor-pointer transition-all ${
                            item.direction === 'L_TO_R'
                              ? 'bg-sky-500 text-black border-sky-300'
                              : item.direction === 'R_TO_L'
                                ? 'bg-emerald-500 text-black border-emerald-300'
                                : 'bg-black/40 text-slate-400 border-white/20 hover:bg-white/10'
                          }`}
                          title={t.syncClickHint}
                        >
                          {item.direction === 'L_TO_R' && (
                            <span className="flex items-center gap-[var(--space-1)]">A &rarr; B</span>
                          )}
                          {item.direction === 'R_TO_L' && (
                            <span className="flex items-center gap-[var(--space-1)]">&larr; A B</span>
                          )}
                          {item.direction === 'SKIP' && <span className="opacity-60">{t.syncSkipShort}</span>}
                        </button>
                      </td>

                      {/* Right Side Info */}
                      <td className="p-[var(--space-2)] text-left font-mono text-[10px] text-emerald-300">
                        {item.rightItem ? formatSize(item.rightItem.size) : '-'}
                      </td>

                      {/* Status Badge */}
                      <td className="p-[var(--space-2)] text-center">{statusBadge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer & Actions */}
        <div
          className="p-[var(--space-3)] border-t shrink-0 flex flex-col sm:flex-row items-center justify-between gap-[var(--space-3)] text-xs"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder,
          }}
        >
          {/* Summary */}
          <div className="flex items-center gap-[var(--space-3)] text-[11px]">
            <span className="text-sky-300 font-bold">A &rarr; B: {countLtoR}</span>
            <span className="text-emerald-300 font-bold">B &rarr; A: {countRtoL}</span>
            <span className="opacity-60">{t.syncSkipped.replace('{n}', String(countSkip))}</span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-[var(--space-2)]">
            {isProcessing && (
              <span className="text-amber-300 font-bold text-[11px] animate-pulse flex items-center gap-[var(--space-1)]">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {progressMsg}
              </span>
            )}

            <button
              onClick={onClose}
              disabled={isProcessing}
              className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel}
            </button>

            <button
              onClick={handleExecuteSync}
              disabled={isProcessing}
              className="px-6 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-2)]"
            >
              <FolderSync className="w-4 h-4" />
              {t.syncExecute}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
