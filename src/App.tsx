import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem, Drive, ActiveModal, CommandHistoryItem, ConflictResolution, FileProgressEntry, LanguageCode, PendingConflict, ThemeId, TransferOptions, TransferPlan } from './types';
import { fsEngine } from './services/fileSystem';
import { themes, ThemeConfig } from './services/themeManager';
import { soundManager } from './services/soundEffects';
import { createPasswordRecord } from './services/appLock';
import { getTranslations, setCurrentLang } from './i18n/translations';

// Components
import { HeaderMenuBar } from './components/HeaderMenuBar';
import { AppModals } from './components/AppModals';
import { ConflictPromptModal } from './components/modals/ConflictPromptModal';
import { Toolbar } from './components/Toolbar';
import { PanelView } from './components/PanelView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSettings } from './hooks/useSettings';
import { useSplitter } from './hooks/useSplitter';
import { usePanels } from './hooks/usePanels';
import { useCommandExecution } from './hooks/useCommandExecution';

const AppLockModal = React.lazy(() => import('./components/modals/AppLockModal').then(m => ({ default: m.AppLockModal })));
import { CommandLineBar } from './components/CommandLineBar';
import { FunctionKeyBar } from './components/FunctionKeyBar';
import { ContextMenu } from './components/ContextMenu';
import { HoverPreviewTooltip } from './components/HoverPreviewTooltip';
import { CollapsibleInfoDrawer } from './components/CollapsibleInfoDrawer';

// Modals
import { taskQueue } from './services/taskQueueManager';

// Real drives are polled so a USB device plugged in after startup appears
// without restarting the app. A failed poll backs off, which rides out the
// embedded server's start-up window and web mode without a running server.
const DRIVE_POLL_MS = 5000;
const DRIVE_POLL_RETRY_MS = 15000;

export default function App() {
  // Global System Settings
  const { settings, setSettings } = useSettings();

  const currentTheme: ThemeConfig = themes[settings.theme] || themes.classic_blue;
  const fileSelectorPalette: Record<string, { cursor: string; selected: string }> = {
    blue: { cursor: '#00ffff', selected: '#0000aa' },
    amber: { cursor: '#f59e0b', selected: '#b45309' },
    cyan: { cursor: '#06b6d4', selected: '#155e75' },
    green: { cursor: '#22c55e', selected: '#14532d' },
    red: { cursor: '#ef4444', selected: '#7f1d1d' },
    purple: { cursor: '#a855f7', selected: '#581c87' }
  };
  const selectedSelectorPalette = fileSelectorPalette[settings.fileSelectorColor || 'blue'] || fileSelectorPalette.blue;
  const themeForFileList = { ...currentTheme, cursorBg: selectedSelectorPalette.cursor, selectedBg: selectedSelectorPalette.selected };
  const lang: LanguageCode = settings.language;
  const t = getTranslations(lang);

  // Keep the module-level language store in sync for non-React consumers
  // (fsEngine, appLock, usePanels, ErrorBoundary, DriveBar). Set during render so
  // components rendered in this same pass already see the updated language.
  setCurrentLang(lang);

  // Keep the document language in sync for accessibility and search engines.
  // index.html ships lang="es"; without this the attribute would stay Spanish
  // no matter which language the user selects.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }

  // File system state
  const [drives, setDrives] = useState<Drive[]>(() => fsEngine.getDrives());
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');

  // Hover Tooltip state
  const [hoveredItem, setHoveredItem] = useState<FileItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  // Admin Mode state
  const [isAdminMode, setIsAdminMode] = useState(false);

  // Quick Search state (Type-to-jump)
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');
  const quickSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leftTreePaneRef = useRef<HTMLDivElement | null>(null);
  const leftTreeTabRef = useRef<HTMLButtonElement | null>(null);

  // App Lock state. The lock only activates when a password hash exists:
  // engaging it without one would either unlock with the removed public default
  // or trap the user behind a lock no credential can open.
  const [isAppLocked, setIsAppLocked] = useState<boolean>(
    () => settings.appLockEnabled && !!settings.appPasswordHash
  );

  // Password Unlock Flow state
  const [unlockTarget, setUnlockTarget] = useState<{
    side: 'left' | 'right';
    path: string;
    expectedPass: string;
  } | null>(null);

  // Single activation funnel for the lock: without a stored password there is
  // nothing to verify against, so the request is refused instead of engaging a
  // lock that can never be opened.
  const lockApp = useCallback(() => {
    setIsAppLocked(!!settings.appPasswordHash);
  }, [settings.appPasswordHash]);



  // Active Modals & Operations
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [selectedFileForModal, setSelectedFileForModal] = useState<FileItem | null>(null);

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetItem: FileItem | null;
    panelSide: 'left' | 'right';
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetItem: null,
    panelSide: 'left'
  });

  // MS-DOS Command History
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);

  // Manual Panel Width Resizing State
  const { isDraggingSplitter, setIsDraggingSplitter, ratio: dualPaneRatio } = useSplitter(setSettings, settings.dualPaneRatio || 50);

  // Load real OS drives when a local drive API is available, then keep the
  // list fresh so removable devices can be plugged in and unplugged live.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const answered = await fsEngine.loadRealDrivesFromApi();
      if (cancelled) return;
      timer = setTimeout(poll, answered ? DRIVE_POLL_MS : DRIVE_POLL_RETRY_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);


  // Sync with FileSystem changes
  const [fsTick, setFsTick] = useState(0);

  const {
    leftPanel,
    setLeftPanel,
    rightPanel,
    setRightPanel,
    isLeftFilterOpen,
    setIsLeftFilterOpen,
    isRightFilterOpen,
    setIsRightFilterOpen,
    handleSwapPanels,
    activePanelState,
    inactivePanelState,
    currentActiveTab,
    currentInactiveTab,
    currentActiveDrive,
    currentInactiveDrive,
    leftTab,
    rightTab,
    leftItems,
    rightItems,
    activeItems,
    activeFocusedItem,
    activeSelectedBytes,
    handleNavigate,
    handleSelectTab,
    handleNewTab,
    handleCloseTab,
    handleToggleLockTab,
    handleDuplicateTab,
    handleGoParent,
    handleGoBack,
    handleGoForward,
    handleSelectDrive,
    handleSelectIndex,
    handleToggleSelect,
    handleSelectAll,
    handleInvertSelection,
    handleOpenItem,
    handleLeftGoParent,
    handleRightGoParent,
    handleLeftRefresh,
    handleRightRefresh,
    handleLeftSort,
    handleRightSort,
    handleLeftSelectIndex,
    handleRightSelectIndex,
    handleLeftToggleSelect,
    handleRightToggleSelect,
    handleLeftContextMenu,
    handleRightContextMenu,
    handleLeftItemHover,
    handleRightItemHover,
  } = usePanels({
    drives,
    settings,
    activePanel,
    activeModal,
    setQuickSearchQuery,
    quickSearchTimerRef,
    setActiveModal,
    setSelectedFileForModal,
    setUnlockTarget,
    setHoveredItem,
    setHoverPos,
    setContextMenuState,
    fsTick,
    setFsTick,
  });

  const { handleExecuteCommand } = useCommandExecution({
    lang,
    activeItems,
    currentActiveTab,
    activePanel,
    isAdminMode,
    setIsAdminMode,
    handleGoParent: activePanel === 'left' ? handleLeftGoParent : handleRightGoParent,
    handleNavigate: (side, path) => handleNavigate(side, path),
    setCommandHistory,
  });

  useEffect(() => {
    return fsEngine.subscribe(() => {
      setDrives(fsEngine.getDrives());
      setFsTick(t => t + 1);
    });
  }, []);


  // One-time migration: replace any legacy plaintext password with a salted
  // PBKDF2 hash so it is never persisted in clear. The removed `admin123`
  // default is dropped outright: it was a public master key, so hashing it
  // would silently reintroduce the bypass it came from.
  const passwordMigratedRef = useRef(false);
  useEffect(() => {
    if (passwordMigratedRef.current) return;
    passwordMigratedRef.current = true;
    if (settings.appPasswordHash === 'admin123' && !settings.appPasswordSalt) {
      setSettings((s) => ({ ...s, appPasswordHash: '', appPasswordSalt: '' }));
      return;
    }
    if (settings.appPasswordHash && !settings.appPasswordSalt) {
      createPasswordRecord(settings.appPasswordHash)
        .then((record) =>
          setSettings((s) => ({ ...s, appPasswordHash: record.hash, appPasswordSalt: record.salt }))
        )
        .catch(() => {});
    }
  }, []);




  // Triggers
  const getSelectedOrFocusedItems = (): FileItem[] => {
    const selected = activeItems.filter(i => currentActiveTab.selectedIds.includes(i.id));
    if (selected.length > 0) return selected;
    if (activeFocusedItem) return [activeFocusedItem];
    return [];
  };

  // Snapshot-or-selection: one list shared by the transfer dialogs AND their
  // confirm handlers, so what the dialog previews is exactly what gets copied.
  // Falling back to the current selection guarantees a transfer can never run
  // against zero sources, even when an entry point forgets to snapshot.
  const transferItems: FileItem[] = modalData?.items?.length
    ? modalData.items
    : getSelectedOrFocusedItems();

  // Single funnel for the copy/move/delete dialogs. Child components reach it
  // through setActiveModal, so the toolbar, menu bar, user menu and F-key bar
  // all snapshot the selection before the dialog is opened.
  const openTransferModal = (modal: ActiveModal): boolean => {
    if (modal !== 'copy' && modal !== 'move' && modal !== 'delete') return false;
    // Snapshot the LIVE selection every time. Reading the previous snapshot made
    // every later transfer silently repeat the first one: the stale entries were
    // written back into modalData, so F5/F6 kept re-targeting the original folder.
    const snapshot = getSelectedOrFocusedItems();
    if (snapshot.length === 0) return true;
    soundManager.playKeyTick();
    setModalData({ items: snapshot, type: modal });
    setActiveModal(modal);
    return true;
  };

  const handleSetActiveModal: React.Dispatch<React.SetStateAction<ActiveModal>> = (action) => {
    if (typeof action === 'string' && openTransferModal(action)) return;
    setActiveModal(action);
  };

  const handleTriggerCopy = () => {
    openTransferModal('copy');
  };

  const handleTriggerMove = () => {
    openTransferModal('move');
  };

  const handleTriggerDelete = () => {
    openTransferModal('delete');
  };

  // Keyboard navigation engine
  useKeyboardShortcuts({
    activePanel,
    currentActiveTab,
    activeItems,
    activeFocusedItem,
    activeModal,
    isAppLocked,
    drives,
    leftTab,
    rightTab,
    quickSearchQuery,
    quickSearchTimerRef,
    setActivePanel,
    setActiveModal,
    setSelectedFileForModal,
    setQuickSearchQuery,
    setLeftPanel,
    setRightPanel,
    setIsLeftFilterOpen,
    setIsRightFilterOpen,
    handleTriggerCopy,
    handleTriggerMove,
    handleTriggerDelete,
    handleSelectDrive,
    handleNewTab,
    handleCloseTab,
    handleSelectAll,
    handleSwapPanels,
    handleSelectIndex,
    handleToggleSelect,
    handleOpenItem,
    handleGoParent,
  });

  // A real transfer running with the "ask" collision policy parks on disk until
  // this prompt is answered, so the prompt keeps both the job id and the
  // executor's cancel signal: every exit path has to reach the server.
  const [conflictPrompt, setConflictPrompt] = useState<PendingConflict | null>(null);
  const conflictSignalRef = useRef<{ paused: boolean; cancelled: boolean } | null>(null);

  const handleConflictPrompt = useCallback(
    (conflict: PendingConflict, signal: { paused: boolean; cancelled: boolean }) => {
      conflictSignalRef.current = signal;
      setConflictPrompt(conflict);
    },
    []
  );

  const handleResolveConflict = (action: ConflictResolution, applyToAll: boolean) => {
    const conflict = conflictPrompt;
    conflictSignalRef.current = null;
    setConflictPrompt(null);
    if (conflict) void fsEngine.resolveConflict(conflict.jobId, action, applyToAll);
  };

  // Backing out of a prompt cannot simply close it: the transfer would stay
  // parked forever, so the whole job is aborted instead.
  const handleAbortConflict = () => {
    const conflict = conflictPrompt;
    const signal = conflictSignalRef.current;
    conflictSignalRef.current = null;
    setConflictPrompt(null);
    if (signal) signal.cancelled = true;
    if (conflict) void fsEngine.cancelJob(conflict.jobId);
  };

  // A transfer plan is what a saved copy list is made of. Only real-drive
  // sources can be replayed in a later session, because a replay addresses the
  // disk directly instead of going through the in-memory catalogue.
  const buildTransferPlan = (
    op: 'copy' | 'move',
    items: FileItem[],
    targetPath: string,
    options: TransferOptions
  ): TransferPlan | undefined => {
    if (items.length === 0 || !items.every(item => fsEngine.isRealFile(item))) return undefined;
    return {
      op,
      sourceDriveId: currentActiveTab.driveId,
      targetDriveId: currentInactiveTab.driveId,
      targetDir: targetPath,
      overwrite: options.collision === 'overwrite',
      collision: options.collision,
      throttleBps: options.throttleBps,
      entries: items.map(item => ({
        path: fsEngine.absolutePathOf(item),
        name: item.name,
        isDirectory: !!item.isDirectory,
        size: item.size
      }))
    };
  };

  // Queues one planned transfer. A live copy/move walks the in-memory catalogue
  // item by item; a replay only has absolute paths, so it reaches the server
  // through `transferPaths`. Both share the same pause, cancel, collision-prompt
  // and per-file reporting behaviour; the plan's `replay` flag is the only
  // difference that survives into the executor.
  const enqueueTransferPlan = (plan: TransferPlan, replay = false): string => {
    const totalBytes = plan.entries.reduce((acc, entry) => acc + (entry.isDirectory ? 0 : entry.size), 0);
    const startedAt = Date.now();
    let taskId = '';

    const reportMeta = (done: number, currentFile: string) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = elapsed > 0 ? done / elapsed : 0;
      taskQueue.updateTaskMeta(taskId, {
        speed: rate > 0 ? `${(rate / (1024 * 1024)).toFixed(1)} MB/s` : undefined,
        etaSeconds: rate > 0 && totalBytes > done ? Math.round((totalBytes - done) / rate) : 0,
        currentFile
      });
    };

    const executor = async (
      onProgress: (transferred: number, total: number) => void,
      signal: { paused: boolean; cancelled: boolean }
    ) => {
      let transferred = 0;
      let promptedJobId = '';
      // A failure used to be recorded on the task and then swallowed, so the
      // queue marked the job completed at 100% while nothing had been written.
      // Keep the first reason and rethrow once the batch is done so the task
      // really ends up failed and the reason stays on screen.
      let firstFailure: Error | undefined;
      const askConflict = (conflict: PendingConflict) => {
        promptedJobId = conflict.jobId;
        handleConflictPrompt(conflict, signal);
      };
      try {
        for (const entry of plan.entries) {
          if (signal.cancelled) return;
          while (signal.paused && !signal.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 120));
          }
          if (signal.cancelled) return;

          // `onProgress` reports cumulative bytes for the entry in flight (a real
          // server job streams growing byte counts), so the running total is
          // everything already finished plus the current entry's progress.
          let current = 0;
          // A selection made of folders sums to zero bytes in the plan, and a
          // zero total pins the bar at 0% for the whole transfer. The server
          // measures the real size when the job starts, so the running total
          // adopts it from then on.
          let effectiveTotal = totalBytes;
          const onCopied = (copied: number, serverTotal?: number) => {
            // The job measures itself after it starts, so the total can arrive
            // after the first poll. Adopt it as soon as it is known, otherwise
            // the bar would divide by a zero total until the transfer ends.
            if (typeof serverTotal === 'number' && serverTotal > 0) {
              effectiveTotal = Math.max(effectiveTotal, transferred + serverTotal);
            }
            current = copied;
            onProgress(transferred + copied, effectiveTotal);
            reportMeta(transferred + copied, entry.name);
          };
          const onFiles = (files: FileProgressEntry[]) => taskQueue.updateTaskFiles(taskId, files);
          const failureLabel = plan.op === 'move' ? 'Move' : 'Copy';
          try {
            // Both the live and the replayed path address the disk by absolute
            // path. A plan is only built for real-drive entries, and
            // `copyItem`/`moveItem` resolve to this same server call for them,
            // so going through `transferPaths` directly keeps one entry point
            // and avoids handing a path to a method that expects a catalogue id.
            await fsEngine.transferPaths(
              plan.op,
              [entry.path],
              plan.targetDir,
              plan.overwrite,
              onCopied,
              signal,
              { collision: plan.collision, throttleBps: plan.throttleBps },
              askConflict,
              onFiles,
              (info) => {
                // A folder selection sizes to 0 from the plan alone, which left
                // the task floored at 1 MiB and reporting 100% before a byte
                // moved. Prefer the real size the server just measured.
                if (info.totalBytes > 0) {
                  // Entries handled before this one are already counted in
                  // `transferred`, so the running total is what is done plus
                  // what the server just measured for the entry in flight.
                  effectiveTotal = Math.max(effectiveTotal, transferred + info.totalBytes);
                  taskQueue.updateTaskMeta(taskId, { totalBytes: effectiveTotal });
                }
                // Keep the server job id so the progress window can retune
                // the speed limit while the transfer is still running.
                taskQueue.updateTaskMeta(taskId, { serverJobId: info.jobId });
              }
            );
          } catch (e) {
            console.error(`${replay ? 'Queued transfer' : failureLabel} failed for`, entry.name, e);
            const reason = e instanceof Error ? e.message : `${replay ? 'Transfer' : failureLabel} failed: ${entry.name}`;
            taskQueue.updateTaskMeta(taskId, { error: reason });
            if (!firstFailure) firstFailure = new Error(reason);
          }
          transferred += current || (entry.isDirectory ? 0 : entry.size);
        }
        if (firstFailure) throw firstFailure;
      } finally {
        // A cancelled or failed transfer must not leave its prompt on screen.
        setConflictPrompt(current => (current && current.jobId === promptedJobId ? null : current));
        // A replayed batch writes to disk behind the panels' back, so refresh
        // the target folder (and the source folder for moves) once it ends.
        if (replay) {
          try {
            await fsEngine.loadSystemDriveDirectory(plan.targetDriveId, plan.targetDir);
            const first = plan.entries[0];
            if (plan.op === 'move' && first) {
              await fsEngine.loadSystemDriveDirectory(plan.sourceDriveId, fsEngine.getParentPath(first.path));
            }
          } catch (error) {
            console.error('[transfer] directory reload failed', error);
          }
        }
      }
    };

    const verb = plan.op === 'move' ? t.appMoving : t.appCopying;
    taskId = taskQueue.addTask(
      plan.op,
      verb.replace('{n}', String(plan.entries.length)),
      t.appDest.replace('{path}', plan.targetDir),
      totalBytes,
      executor,
      plan
    );
    return taskId;
  };

  // Replays every transfer in a loaded copy list, one queued task per batch.
  const handleRunCopyList = (plans: TransferPlan[]) => {
    for (const plan of plans) enqueueTransferPlan(plan, true);
  };

  // Elevation restarts the process, so a pending transfer has to travel with it.
  // The plan is parked in local storage and replayed by the fresh instance, which
  // is why the copy used to disappear right after the restart.
  const ELEVATED_PLAN_KEY = 'omnicommander.pendingElevatedTransfer';

  const handleElevateTransfer = async (
    op: 'copy' | 'move',
    targetPath: string,
    options: TransferOptions
  ) => {
    if (!targetPath.trim()) return { ok: false as const, reason: 'empty destination' };
    const plan = buildTransferPlan(op, transferItems, targetPath.trim(), options);
    if (plan) {
      try {
        localStorage.setItem(ELEVATED_PLAN_KEY, JSON.stringify(plan));
      } catch {
        // A full quota must not block the elevation itself.
      }
    }
    return (window as any).electronAPI?.relaunchAsAdmin?.();
  };

  useEffect(() => {
    const parked = localStorage.getItem(ELEVATED_PLAN_KEY);
    if (!parked) return;
    localStorage.removeItem(ELEVATED_PLAN_KEY);
    try {
      const plan = JSON.parse(parked) as TransferPlan;
      if (plan?.entries?.length) enqueueTransferPlan(plan, true);
    } catch {
      // A corrupt entry is dropped instead of being replayed blindly.
    }
    // Consumed once, on the first mount after the elevated restart.
  }, []);

  // A live copy/move of real-drive items becomes a plan and hands the same
  // executor its absolute entry paths. Non-real items and rejected plans fall
  // back to the in-memory catalogue path through `copyItem`/`moveItem`.
  const runConfirmedTransfer = (
    op: 'copy' | 'move',
    targetPath: string,
    options: TransferOptions
  ): string | undefined => {
    const items: FileItem[] = transferItems;
    const plan = buildTransferPlan(op, items, targetPath, options);
    if (plan) {
      // The copy window stays open and follows the transfer it started: closing
      // it here left the user with only a small card and no way back into the job.
      return enqueueTransferPlan(plan);
    }

    // Falling back to the in-memory catalogue is correct for its own drives, but
    // it used to swallow a transfer aimed at a real drive too: the task animated
    // and finished without writing a single byte. Report the block instead of
    // pretending the copy happened.
    if (fsEngine.isSystemDrive(currentInactiveTab.driveId)) {
      const unknown = items.filter(item => !fsEngine.isRealFile(item)).map(item => item.name);
      const detail = unknown.length > 0 ? unknown.join(', ') : items.length + ' selected item(s)';
      return taskQueue.addTask(
        op,
        op === 'move' ? 'Move blocked' : 'Copy blocked',
        detail,
        0,
        async () => {
          throw new Error(
            `${detail} was not read from a physical drive, so the real transfer cannot address it.`
          );
        }
      );
    }

    const totalBytes = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
    const startedAt = Date.now();
    let taskId = '';
    // The simulated (non-real-drive) path only understands a boolean; the real
    // server path receives the full policy and lets `collision` win.
    const overwrite = options.collision === 'overwrite';

    const reportMeta = (done: number, currentFile: string) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = elapsed > 0 ? done / elapsed : 0;
      taskQueue.updateTaskMeta(taskId, {
        speed: rate > 0 ? `${(rate / (1024 * 1024)).toFixed(1)} MB/s` : undefined,
        etaSeconds: rate > 0 && totalBytes > done ? Math.round((totalBytes - done) / rate) : 0,
        currentFile
      });
    };

    const executor = async (onProgress: (transferred: number, total: number) => void, signal: { paused: boolean; cancelled: boolean }) => {
      let transferred = 0;
      let promptedJobId = '';
      const askConflict = (conflict: PendingConflict) => {
        promptedJobId = conflict.jobId;
        handleConflictPrompt(conflict, signal);
      };
      const failureLabel = op === 'move' ? 'Move' : 'Copy';
      // A recorded failure must also become the task's outcome; otherwise the
      // queue reports a completed 100% transfer that never touched the disk.
      let firstFailure: Error | undefined;
      try {
        for (const item of items) {
          if (signal.cancelled) return;
          while (signal.paused && !signal.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 120));
          }
          if (signal.cancelled) return;

          let current = 0;
          try {
            if (op === 'move') {
              await fsEngine.moveItem(item.id, currentInactiveTab.driveId, targetPath, (t) => {
                current = t;
                onProgress(transferred + t, totalBytes);
                reportMeta(transferred + t, item.name);
              }, signal, options, askConflict, files => taskQueue.updateTaskFiles(taskId, files));
            } else {
              await fsEngine.copyItem(item.id, currentInactiveTab.driveId, targetPath, overwrite, (t) => {
                current = t;
                onProgress(transferred + t, totalBytes);
                reportMeta(transferred + t, item.name);
              }, signal, options, askConflict, files => taskQueue.updateTaskFiles(taskId, files));
            }
          } catch (e) {
            console.error(`${failureLabel} failed for`, item.name, e);
            const reason = e instanceof Error ? e.message : `${failureLabel} failed: ${item.name}`;
            taskQueue.updateTaskMeta(taskId, { error: reason });
            if (!firstFailure) firstFailure = new Error(reason);
          }
          transferred += current || (item.isDirectory ? 0 : item.size);
        }
        if (firstFailure) throw firstFailure;
      } finally {
        // A cancelled or failed transfer must not leave its prompt on screen.
        setConflictPrompt(current => (current && current.jobId === promptedJobId ? null : current));
      }
    };

    const verb = op === 'move' ? t.appMoving : t.appCopying;
    taskId = taskQueue.addTask(op, verb.replace('{n}', String(items.length)), t.appDest.replace('{path}', targetPath), totalBytes, executor, plan);
    return taskId;
  };

  const handleConfirmCopy = (targetPath: string, options: TransferOptions) => {
    return runConfirmedTransfer('copy', targetPath, options);
  };

  const handleConfirmMove = (targetPath: string, options: TransferOptions) => {
    return runConfirmedTransfer('move', targetPath, options);
  };

  const handleConfirmDelete = () => {
    const items: FileItem[] = transferItems;
    const useTrash = settings.useRecycleBin !== false;
    const startedAt = Date.now();
    const totalEntries = items.length || 1;
    let taskId = '';

    // A delete moves no bytes, so progress is measured in entries and the ETA is
    // derived from the entry rate instead of a byte throughput.
    const executor = async (
      onProgress: (transferred: number, total: number) => void,
      signal: { paused: boolean; cancelled: boolean }
    ) => {
      try {
        await fsEngine.deleteItems(items, useTrash, (done, total) => {
          onProgress(done, total);
          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = elapsed > 0 ? done / elapsed : 0;
          taskQueue.updateTaskMeta(taskId, {
            etaSeconds: rate > 0 && total > done ? Math.round((total - done) / rate) : 0
          });
        }, signal, files => taskQueue.updateTaskFiles(taskId, files));
      } catch (e) {
        console.error('Delete failed', e);
        const reason = e instanceof Error ? e.message : 'Delete failed';
        taskQueue.updateTaskMeta(taskId, { error: reason });
        // A delete that threw must end failed. Resolving here marked it
        // completed at 100% with the reason stored where nothing rendered it.
        throw e instanceof Error ? e : new Error(reason);
      }
    };

    taskId = taskQueue.addTask(
      'delete',
      `${useTrash ? t.appSendingTrash : t.appDeleting} ${t.appItemsCount.replace('{n}', String(items.length))}`,
      undefined,
      totalEntries,
      executor
    );
    // A delete has no byte throughput, so clear the misleading "0 MB/s" readout.
    taskQueue.updateTaskMeta(taskId, { speed: '' });
    soundManager.playSuccess();
    setActiveModal(null);
  };

  const handleConfirmMkDir = (dirName: string) => {
    try {
      fsEngine.createDirectory(currentActiveTab.driveId, currentActiveTab.currentPath, dirName);
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleConfirmNewFile = (fileName: string) => {
    try {
      fsEngine.createFile(currentActiveTab.driveId, currentActiveTab.currentPath, fileName, '');
      soundManager.playSuccess();
      setActiveModal(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleApplyBatchRename = (renames: { id: string; newName: string }[]) => {
    renames.forEach(r => {
      fsEngine.renameItem(r.id, r.newName);
    });
    setActiveModal(null);
  };

  const handleCompressZip = async (archiveName: string) => {
    const items = getSelectedOrFocusedItems();
    if (items.length === 0) return;
    const totalBytes = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
    taskQueue.addTask('archive', t.appPacking.replace('{name}', archiveName), t.appItemsCount.replace('{n}', String(items.length)), totalBytes);
    await fsEngine.createZipArchive(items, archiveName, currentActiveTab.driveId, currentActiveTab.currentPath);
    setActiveModal(null);
  };

  const handleExtractZip = async (zipFile: FileItem) => {
    taskQueue.addTask('extract', t.appUnpacking.replace('{name}', `${zipFile.name}.${zipFile.ext}`), t.appDest.replace('{path}', currentActiveTab.currentPath), zipFile.size);
    await fsEngine.extractZipArchive(zipFile, currentActiveTab.driveId, currentActiveTab.currentPath);
    setActiveModal(null);
  };

  const handleDropItems = useCallback((
    draggedItems: FileItem[],
    targetPath: string,
    targetDriveId: string,
    operation: 'copy' | 'move' = 'copy'
  ) => {
    soundManager.playDiskAccess();
    const totalBytes = draggedItems.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);
    taskQueue.addTask(
      operation === 'move' ? 'move' : 'copy',
      (operation === 'move' ? t.appMovingDrag : t.appCopyingDrag).replace('{n}', String(draggedItems.length)),
      t.appDest.replace('{path}', targetPath),
      totalBytes
    );

    const movedIds = new Set(draggedItems.map(i => i.id));

    void (async () => {
      for (const item of draggedItems) {
        // Real-drive entries are written by the server and addressed by
        // absolute path. The catalogue id is only needed for simulated items,
        // and a listing refresh mid-drag can invalidate it.
        if (fsEngine.isRealFile(item)) {
          const isSameDir = item.driveId === targetDriveId && item.path === targetPath;
          await fsEngine.transferPaths(operation, [fsEngine.absolutePathOf(item)], targetPath, !isSameDir);
        } else if (operation === 'move') {
          await fsEngine.moveItem(item.id, targetDriveId, targetPath);
        } else {
          const isSameDir = item.driveId === targetDriveId && item.path === targetPath;
          await fsEngine.copyItem(item.id, targetDriveId, targetPath, !isSameDir);
        }
      }

      if (operation === 'move') {
        setLeftPanel(p => ({
          ...p,
          tabs: p.tabs.map(tab => ({
            ...tab,
            selectedIds: tab.selectedIds.filter(id => !movedIds.has(id))
          }))
        }));
        setRightPanel(p => ({
          ...p,
          tabs: p.tabs.map(tab => ({
            ...tab,
            selectedIds: tab.selectedIds.filter(id => !movedIds.has(id))
          }))
        }));
        // Move-success feedback belongs to a completed move only; a copy has its
        // own completion signal and must not play the move sound.
        soundManager.playSuccess();
      }
      // Both operations refresh the panes once the transfer actually finished.
      setFsTick(t => t + 1);
    })().catch(e => console.error('Drop operation failed', e));
  }, []);

  const handleDropNativeFiles = useCallback(async (
    files: globalThis.FileList,
    targetPath: string,
    targetDriveId: string
  ) => {
    soundManager.playDiskAccess();
    for (let i = 0; i < files.length; i++) {
      await fsEngine.importBrowserFile(files[i], targetDriveId, targetPath);
    }
    setFsTick(t => t + 1);
  }, []);

  // Password Folder Protection Handler
  const handleSetFolderPassword = (folderPath: string, password: string | null) => {
    setSettings(prev => {
      const updated = { ...(prev.protectedFolders || {}) };
      if (password) {
        updated[folderPath] = password;
      } else {
        delete updated[folderPath];
      }
      return { ...prev, protectedFolders: updated };
    });
  };


  useEffect(() => {
    if (!leftPanel.isTreeVisible) return;
    const onPointerDown = (e: MouseEvent) => {
      if (isDraggingSplitter) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (leftTreePaneRef.current?.contains(target)) return;
      if (leftTreeTabRef.current?.contains(target)) return;
      setLeftPanel(p => ({ ...p, isTreeVisible: false }));
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [leftPanel.isTreeVisible, isDraggingSplitter]);

  return (
    <div 
      className="flex flex-col h-screen w-screen overflow-hidden font-mono select-none relative"
      style={{
        backgroundColor: currentTheme.bgApp,
        color: currentTheme.itemText
      }}
    >
      {/* Retro CRT Monitor Scanline & Vignette Overlay */}
      {settings.crtEffectEnabled && (
        <div 
          className={`fixed inset-0 pointer-events-none z-[9999] ${
            settings.crtIntensity === 'subtle' 
              ? 'crt-overlay-subtle' 
              : settings.crtIntensity === 'intense' 
              ? 'crt-overlay-intense' 
              : 'crt-overlay-classic'
          }`}
        />
      )}
      {/* App Lock Overlay if app lock active */}
      {isAppLocked && (
        <AppLockModal
          theme={currentTheme}
          lang={lang}
          expectedUser={settings.appUsername || 'admin'}
          expectedPassHash={settings.appPasswordHash}
          expectedPassSalt={settings.appPasswordSalt}
          onUnlockSuccess={() => setIsAppLocked(false)}
        />
      )}

      {/* 1. Retro Pull-down Menu Bar */}
      <HeaderMenuBar
        theme={currentTheme}
        lang={lang}
        showClock={settings.showClock}
        clockPosition={settings.clockPosition}
        crtEffectEnabled={settings.crtEffectEnabled}
        onToggleCrt={() => setSettings(s => ({ ...s, crtEffectEnabled: !s.crtEffectEnabled }))}
        onOpenModal={(m) => {
          if (m === 'viewer' || m === 'editor' || m === 'checksum' || m === 'properties') {
            if (activeFocusedItem) setSelectedFileForModal(activeFocusedItem);
          }
          if (m === 'app_lock') {
            lockApp();
            return;
          }
          handleSetActiveModal(m);
        }}
        onRefresh={() => {
          soundManager.playKeyTick();
          setFsTick(t => t + 1);
        }}
        onSelectAll={handleSelectAll}
        onInvertSelection={handleInvertSelection}
        onToggleQuickView={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setRightPanel : setLeftPanel;
          targetSet(p => ({ ...p, isQuickView: !p.isQuickView }));
        }}
        onToggleTree={() => {
          soundManager.playKeyTick();
          const targetSet = activePanel === 'left' ? setLeftPanel : setRightPanel;
          targetSet(p => ({ ...p, isTreeVisible: !p.isTreeVisible }));
        }}
        onSwapPanels={handleSwapPanels}
        onNewTab={(side) => handleNewTab(side)}
        onChangeDrive={(side, dId) => handleSelectDrive(side, dId)}
        activePanel={activePanel}
        isQuickView={inactivePanelState.isQuickView}
        isTreeVisible={activePanelState.isTreeVisible}
        onSetTheme={(themeId: ThemeId) => setSettings(s => ({ ...s, theme: themeId }))}
        onSetLang={(newLang: LanguageCode) => setSettings(s => ({ ...s, language: newLang }))}
        onResetDefaults={() => {
          if (confirm(t.appResetConfirm)) {
            fsEngine.resetToDefaults();
          }
        }}
        onMinimizeWindow={() => {
          const api = (window as any).electronAPI;
          if (api?.minimizeWindow) api.minimizeWindow();
        }}
        onMaximizeWindow={() => {
          const api = (window as any).electronAPI;
          if (api?.maximizeWindow) api.maximizeWindow();
        }}
        onCloseWindow={() => {
          const api = (window as any).electronAPI;
          if (api?.closeWindow) api.closeWindow();
          else window.close();
        }}
      />

      <Toolbar
        currentTheme={currentTheme}
        t={t}
        showToolbar={settings.showToolbar}
        activePanel={activePanel}
        leftTab={leftTab}
        rightTab={rightTab}
        setLeftPanel={setLeftPanel}
        setRightPanel={setRightPanel}
        setFsTick={setFsTick}
        activeFocusedItem={activeFocusedItem}
        setSelectedFileForModal={setSelectedFileForModal}
        setActiveModal={handleSetActiveModal}
      />

      {/* 2. Main Dual-Panel Viewport */}
      <div id="dual-panel-container" className="flex-1 flex flex-col md:flex-row min-h-0 relative p-1 gap-1">
        <PanelView
          side="left"
          widthPercent={dualPaneRatio}
          currentTheme={currentTheme}
          themeForFileList={themeForFileList}
          lang={lang}
          settings={settings}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          onRefresh={handleLeftRefresh}
          quickSearchQuery={quickSearchQuery}
          drives={drives}
          panel={leftPanel}
          setPanel={setLeftPanel}
          tab={leftTab}
          items={leftItems}
          otherItems={rightItems}
          otherTab={rightTab}
          drive={currentActiveDrive}
          isFilterOpen={isLeftFilterOpen}
          setIsFilterOpen={setIsLeftFilterOpen}
          treePaneRef={leftTreePaneRef}
          isTreeVisible={leftPanel.isTreeVisible}
          onToggleTree={() => setLeftPanel(p => ({ ...p, isTreeVisible: !p.isTreeVisible }))}
          onDropItems={handleDropItems}
          onDropNativeFiles={handleDropNativeFiles}
          onNavigate={(p) => handleNavigate('left', p)}
          onSelectDrive={(dId) => handleSelectDrive('left', dId)}
          onSelectTab={(tId) => handleSelectTab('left', tId)}
          onNewTab={() => handleNewTab('left')}
          onCloseTab={(tId) => handleCloseTab('left', tId)}
          onToggleLockTab={(tId) => handleToggleLockTab('left', tId)}
          onDuplicateTab={(tId) => handleDuplicateTab('left', tId)}
          onGoParent={handleLeftGoParent}
          onGoBack={() => handleGoBack('left')}
          onGoForward={() => handleGoForward('left')}
          onSort={handleLeftSort}
          onSelectIndex={handleLeftSelectIndex}
          onToggleSelect={handleLeftToggleSelect}
          onOpenItem={handleOpenItem}
          onContextMenu={handleLeftContextMenu}
          onItemHover={handleLeftItemHover}
        />

        {/* Interactive Resizable Divider Bar */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDraggingSplitter(true);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setIsDraggingSplitter(true);
          }}
          className="hidden md:flex w-2.5 hover:w-3.5 bg-black/40 hover:bg-amber-400/90 cursor-col-resize items-center justify-center transition-all group z-30 select-none rounded border border-white/10 hover:border-amber-300"
          title={t.appResizerTitle}
        >
          <div className="w-0.5 h-10 bg-amber-400/60 group-hover:bg-black rounded-full" />
        </div>

        <PanelView
          side="right"
          widthPercent={100 - dualPaneRatio}
          currentTheme={currentTheme}
          themeForFileList={themeForFileList}
          lang={lang}
          settings={settings}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          onRefresh={handleRightRefresh}
          quickSearchQuery={quickSearchQuery}
          drives={drives}
          panel={rightPanel}
          setPanel={setRightPanel}
          tab={rightTab}
          items={rightItems}
          otherItems={leftItems}
          otherTab={leftTab}
          drive={currentInactiveDrive}
          isFilterOpen={isRightFilterOpen}
          setIsFilterOpen={setIsRightFilterOpen}
          onDropItems={handleDropItems}
          onDropNativeFiles={handleDropNativeFiles}
          onNavigate={(p) => handleNavigate('right', p)}
          onSelectDrive={(dId) => handleSelectDrive('right', dId)}
          onSelectTab={(tId) => handleSelectTab('right', tId)}
          onNewTab={() => handleNewTab('right')}
          onCloseTab={(tId) => handleCloseTab('right', tId)}
          onToggleLockTab={(tId) => handleToggleLockTab('right', tId)}
          onDuplicateTab={(tId) => handleDuplicateTab('right', tId)}
          onGoParent={handleRightGoParent}
          onGoBack={() => handleGoBack('right')}
          onGoForward={() => handleGoForward('right')}
          onSort={handleRightSort}
          onSelectIndex={handleRightSelectIndex}
          onToggleSelect={handleRightToggleSelect}
          onOpenItem={handleOpenItem}
          onContextMenu={handleRightContextMenu}
          onItemHover={handleRightItemHover}
        />
      </div>

      {/* 3. Collapsible Info & System Performance Drawer */}
      {settings.showCollapsibleInfoDrawer && (
        <CollapsibleInfoDrawer
          lang={lang}
          theme={currentTheme}
          activeDrive={currentActiveDrive}
          activePath={currentActiveTab.currentPath}
          focusedItem={activeFocusedItem}
          selectedCount={currentActiveTab.selectedIds.length}
          totalItemsCount={activeItems.length}
          totalSelectedBytes={activeSelectedBytes}
          isAdminMode={isAdminMode}
          onToggleAdminMode={() => setIsAdminMode(!isAdminMode)}
          onLockApp={lockApp}
          isFolderProtected={!!(settings.protectedFolders && currentActiveTab?.currentPath && settings.protectedFolders[currentActiveTab.currentPath])}
          onProtectFolder={() => setActiveModal('protect_folder')}
          showClock={settings.showClock}
          clockPosition={settings.clockPosition}
        />
      )}

      {/* 4. MS-DOS & Admin Command Line Prompt Bar */}
      {settings.showCommandLine && (
        <CommandLineBar
          lang={lang}
          theme={currentTheme}
          currentPath={currentActiveTab.currentPath}
          onExecuteCommand={handleExecuteCommand}
          commandHistory={commandHistory}
          onClearHistory={() => setCommandHistory([])}
          isAdminMode={isAdminMode}
          onToggleAdminMode={() => setIsAdminMode(!isAdminMode)}
          availableItems={activeItems}
        />
      )}

      {/* 5. Bottom F1..F10 Function Key Bar */}
      {settings.showFunctionBar && (
        <FunctionKeyBar
          theme={currentTheme}
          lang={lang}
          onOpenModal={(m) => {
            if (m === 'viewer' || m === 'editor' || m === 'checksum' || m === 'properties') {
              if (activeFocusedItem) setSelectedFileForModal(activeFocusedItem);
            }
            handleSetActiveModal(m);
          }}
          onCopy={handleTriggerCopy}
          onMove={handleTriggerMove}
          onDelete={handleTriggerDelete}
          onMkDir={() => setActiveModal('mkdir')}
          onView={() => {
            if (activeFocusedItem) {
              setSelectedFileForModal(activeFocusedItem);
              setActiveModal('viewer');
            }
          }}
          onEdit={() => {
            if (activeFocusedItem && !activeFocusedItem.isDirectory) {
              setSelectedFileForModal(activeFocusedItem);
              setActiveModal('editor');
            }
          }}
        />
      )}

      {/* 6. Hover Preview Tooltip & Image Thumbnail */}
      {settings.showHoverTooltips && hoveredItem && (
        <HoverPreviewTooltip
          lang={lang}
          theme={currentTheme}
          item={hoveredItem}
          x={hoverPos.x}
          y={hoverPos.y}
          showThumbnail={settings.showImageHoverThumbnails}
        />
      )}

      {/* 7. Context Menu */}
      {contextMenuState.visible && (
        <ContextMenu
          theme={currentTheme}
          lang={lang}
          x={contextMenuState.x}
          y={contextMenuState.y}
          targetItem={contextMenuState.targetItem}
          onClose={() => setContextMenuState(s => ({ ...s, visible: false }))}
          onView={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('viewer');
            }
          }}
          onEdit={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('editor');
            }
          }}
          onCopy={handleTriggerCopy}
          onMove={handleTriggerMove}
          onDelete={handleTriggerDelete}
          onMkDir={() => setActiveModal('mkdir')}
          onNewFile={() => {
            setModalData({ isNewFile: true });
            setActiveModal('new_file');
          }}
          onZip={() => setActiveModal('zipArchive')}
          onChecksum={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('checksum');
            }
          }}
          onProperties={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('properties');
            }
          }}
          onDownload={() => {
            const item = contextMenuState.targetItem;
            if (item) {
              const blob = new Blob([item.content || ''], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${item.name}.${item.ext || 'txt'}`;
              a.click();
              URL.revokeObjectURL(url);
            }
          }}
          onUpload={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                await fsEngine.importBrowserFile(file, currentActiveTab.driveId, currentActiveTab.currentPath);
                soundManager.playSuccess();
              }
            };
            input.click();
          }}
          onRefresh={() => setFsTick(t => t + 1)}
          onProtectFolder={() => {
            const target = contextMenuState.targetItem;
            if (target && target.isDirectory) {
              setModalData({ targetFolderPath: `${target.path}\\${target.name}` });
            } else {
              setModalData({ targetFolderPath: currentActiveTab.currentPath });
            }
            setActiveModal('protect_folder');
          }}
          onSplitFile={() => {
            if (contextMenuState.targetItem) {
              setSelectedFileForModal(contextMenuState.targetItem);
              setActiveModal('file_splitter');
            }
          }}
        />
      )}

      <AppModals
        currentTheme={currentTheme}
        lang={lang}
        selectedFileForModal={selectedFileForModal}
        setActiveModal={handleSetActiveModal}
        activeModal={activeModal}
        modalData={modalData?.items?.length ? modalData : { ...modalData, items: transferItems }}
        setModalData={setModalData}
        onRunCopyList={handleRunCopyList}
        currentActiveTab={currentActiveTab}
        currentInactiveTab={currentInactiveTab}
        activePanel={activePanel}
        activeItems={activeItems}
        activeFocusedItem={activeFocusedItem}
        leftTab={leftTab}
        rightTab={rightTab}
        leftItems={leftItems}
        rightItems={rightItems}
        drives={drives}
        settings={settings}
        setSettings={setSettings}
        unlockTarget={unlockTarget}
        setUnlockTarget={setUnlockTarget}
        setLeftPanel={setLeftPanel}
        setRightPanel={setRightPanel}
        setFsTick={setFsTick}
        handleConfirmCopy={handleConfirmCopy}
        handleConfirmMove={handleConfirmMove}
        handleElevateTransfer={handleElevateTransfer}
        handleConfirmDelete={handleConfirmDelete}
        handleConfirmMkDir={handleConfirmMkDir}
        handleConfirmNewFile={handleConfirmNewFile}
        handleApplyBatchRename={handleApplyBatchRename}
        getSelectedOrFocusedItems={getSelectedOrFocusedItems}
        handleNavigate={handleNavigate}
        handleSelectIndex={handleSelectIndex}
        handleCompressZip={handleCompressZip}
        handleExtractZip={handleExtractZip}
        handleSetFolderPassword={handleSetFolderPassword}
        handleSelectDrive={handleSelectDrive}
        handleExecuteCommand={handleExecuteCommand}
      />

      {conflictPrompt && (
        <ConflictPromptModal
          conflict={conflictPrompt}
          theme={currentTheme}
          lang={lang}
          onAnswer={handleResolveConflict}
          onCancel={handleAbortConflict}
        />
      )}

      <button
        ref={leftTreeTabRef}
        onClick={() => setLeftPanel(p => ({ ...p, isTreeVisible: !p.isTreeVisible }))}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-[10000] w-6 h-14 rounded-r-md border border-l-0 text-[11px] font-bold flex items-center justify-center cursor-pointer shadow-lg"
        style={{ backgroundColor: currentTheme.headerBg, color: currentTheme.headerText, borderColor: currentTheme.borderPanel }}
        title={t.toggleTreeTooltip}
      >
        {leftPanel.isTreeVisible ? '◁' : '▷'}
      </button>
    </div>
  );
}
