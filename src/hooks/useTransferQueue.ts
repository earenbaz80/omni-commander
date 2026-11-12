import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ConflictResolution,
  FileItem,
  FileProgressEntry,
  FreeSpaceVolume,
  LanguageCode,
  PendingConflict,
  PanelTab,
  TransferOptions,
  TransferPlan,
} from '../types';
import type { ElevationResult } from '../types/electronBridge';
import { fsEngine } from '../services/fileSystem';
import { taskQueue } from '../services/taskQueueManager';
import { getTranslations } from '../i18n/translations';
import { parkTransferPlan, takeParkedTransferPlan } from '../services/pendingTransfer';
import { formatSpeed } from '../utils/formatSpeed';

/** A transfer that does not fit, held until the user decides. */
export interface FreeSpacePrompt {
  volumes: FreeSpaceVolume[];
  plans: TransferPlan[];
  /** True when the plans came from a saved copy list instead of a live dialog. */
  replay: boolean;
}

export interface TransferQueueDeps {
  lang: LanguageCode;
  /** What the open transfer dialogs preview: their own snapshot, or the live selection. */
  transferItems: FileItem[];
  currentActiveTab: PanelTab;
  currentInactiveTab: PanelTab;
  setFsTick: Dispatch<SetStateAction<number>>;
}

export interface TransferQueue {
  /** The parked job waiting for an answer, if a transfer hit a name collision. */
  conflictPrompt: PendingConflict | null;
  freeSpacePrompt: FreeSpacePrompt | null;
  /** Closes the prompt without copying: the user changed their mind. */
  dismissFreeSpacePrompt: () => void;
  handleResolveConflict: (action: ConflictResolution, applyToAll: boolean) => void;
  handleAbortConflict: () => void;
  handleForceTransfer: () => void;
  handleRunCopyList: (plans: TransferPlan[]) => Promise<void>;
  handleElevateTransfer: (
    op: 'copy' | 'move',
    targetPath: string,
    options: TransferOptions,
  ) => Promise<ElevationResult | undefined>;
  handleConfirmCopy: (targetPath: string, options: TransferOptions) => Promise<string | undefined>;
  handleConfirmMove: (targetPath: string, options: TransferOptions) => Promise<string | undefined>;
  /** Pastes a clipboard snapshot into a folder of the panel the user is on. */
  handlePasteTransfer: (
    op: 'copy' | 'move',
    targetDriveId: string,
    targetPath: string,
    items: FileItem[],
  ) => Promise<string | undefined>;
}

/**
 * Every way a copy or a move can reach the disk, and the one queue they run on.
 *
 * The three entry points — a live dialog, a replayed copy list, and the batch
 * parked across an elevated restart — all end in `enqueueTransferPlan`, which is
 * why pause, cancel, collisions and per-file progress behave the same however
 * the transfer was started. The prompt states live here too: they are answers
 * this machinery is waiting for, not window state the app happens to render.
 */
export function useTransferQueue({
  lang,
  transferItems,
  currentActiveTab,
  currentInactiveTab,
  setFsTick,
}: TransferQueueDeps): TransferQueue {
  const t = getTranslations(lang);

  // A real transfer running with the "ask" collision policy parks on disk until
  // this prompt is answered, so the prompt keeps both the job id and the
  // executor's cancel signal: every exit path has to reach the server.
  const [conflictPrompt, setConflictPrompt] = useState<PendingConflict | null>(null);
  const conflictSignalRef = useRef<{ paused: boolean; cancelled: boolean } | null>(null);

  // A transfer that does not fit is held here until the user decides: the plans
  // are already built, so forcing the copy only has to enqueue them.
  const [freeSpacePrompt, setFreeSpacePrompt] = useState<FreeSpacePrompt | null>(null);

  const handleConflictPrompt = useCallback(
    (conflict: PendingConflict, signal: { paused: boolean; cancelled: boolean }) => {
      conflictSignalRef.current = signal;
      setConflictPrompt(conflict);
    },
    [],
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
    items: FileItem[] | null,
    targetPath: string,
    options: TransferOptions,
    targetDriveId: string = currentInactiveTab.driveId,
    sourceDriveId: string = currentActiveTab.driveId,
  ): TransferPlan | undefined => {
    // Guardrail: Handle null/undefined items gracefully
    const normalizedItems = items ?? [];

    if (normalizedItems.length === 0 || !normalizedItems.every((item) => fsEngine.isRealFile(item))) return undefined;
    return {
      op,
      sourceDriveId,
      targetDriveId,
      targetDir: targetPath,
      overwrite: options.collision === 'overwrite',
      collision: options.collision,
      throttleBps: options.throttleBps,
      entries: normalizedItems.map((item) => ({
        path: fsEngine.absolutePathOf(item),
        name: item.name,
        isDirectory: !!item.isDirectory,
        size: item.size,
      })),
    };
  };

  // Queues one planned transfer. A live copy/move walks the in-memory catalogue
  // item by item; a replay only has absolute paths, so it reaches the server
  // through `transferPaths`. Both share the same pause, cancel, collision-prompt
  // and per-file reporting behaviour; the plan's `replay` flag is the only
  // difference that survives into the executor.
  const enqueueTransferPlan = (plan: TransferPlan, replay = false, force = false): string => {
    let totalBytes = plan.entries.reduce((acc, entry) => acc + (entry.isDirectory ? 0 : entry.size), 0);
    const startedAt = Date.now();
    let taskId = '';

    // The transfer window can append entries while this runs (native picker).
    // Reading the task's plan on every step is what makes those additions real
    // instead of decorative, and the byte total grows with them.
    const livePlan = () => taskQueue.getPlan(taskId) ?? plan;
    const plannedBytes = () => livePlan().entries.reduce((acc, entry) => acc + (entry.isDirectory ? 0 : entry.size), 0);

    const reportMeta = (done: number, currentFile: string) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = elapsed > 0 ? done / elapsed : 0;
      taskQueue.updateTaskMeta(taskId, {
        speed: rate > 0 ? formatSpeed(rate) : undefined,
        etaSeconds: rate > 0 && totalBytes > done ? Math.round((totalBytes - done) / rate) : 0,
        currentFile,
      });
    };

    const executor = async (
      onProgress: (transferred: number, total: number) => void,
      signal: { paused: boolean; cancelled: boolean },
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
        for (let index = 0; index < livePlan().entries.length; index++) {
          const entry = livePlan().entries[index];
          if (signal.cancelled) return;
          // An entry appended after the start re-scales the bar instead of
          // leaving it at 100% while bytes are still queued.
          totalBytes = Math.max(totalBytes, plannedBytes());
          while (signal.paused && !signal.cancelled) {
            await new Promise((resolve) => setTimeout(resolve, 120));
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
            taskQueue.updateTaskMeta(taskId, {
              currentFileBytes: copied,
              currentFileTotal: typeof serverTotal === 'number' && serverTotal > 0 ? serverTotal : entry.size || 0,
            });
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
              { collision: plan.collision, throttleBps: plan.throttleBps, force },
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
              },
            );
          } catch (e) {
            console.error(`${replay ? 'Queued transfer' : failureLabel} failed for`, entry.name, e);
            const reason =
              e instanceof Error ? e.message : `${replay ? 'Transfer' : failureLabel} failed: ${entry.name}`;
            taskQueue.updateTaskMeta(taskId, { error: reason });
            if (!firstFailure) firstFailure = new Error(reason);
          }
          transferred += current || (entry.isDirectory ? 0 : entry.size);
        }
        if (firstFailure) throw firstFailure;
      } finally {
        // A cancelled or failed transfer must not leave its prompt on screen.
        setConflictPrompt((current) => (current && current.jobId === promptedJobId ? null : current));
        // Every transfer writes to disk behind the panels' back. Refreshing only
        // replayed batches meant a normal copy stayed invisible until the user
        // hit refresh, so the destination looked empty right after it finished.
        try {
          await fsEngine.loadSystemDriveDirectory(plan.targetDriveId, plan.targetDir);
          const first = livePlan().entries[0];
          if (plan.op === 'move' && first) {
            await fsEngine.loadSystemDriveDirectory(plan.sourceDriveId, fsEngine.getParentPath(first.path));
          }
        } catch (error) {
          console.error('[transfer] directory reload failed', error);
        }
        setFsTick((t) => t + 1);
      }
    };

    const verb = plan.op === 'move' ? t.appMoving : t.appCopying;
    taskId = taskQueue.addTask(
      plan.op,
      verb.replace('{n}', String(plan.entries.length)),
      t.appDest.replace('{path}', plan.targetDir),
      totalBytes,
      executor,
      plan,
    );
    return taskId;
  };

  // Pre-flight for a transfer that is about to start. The server walks the
  // source trees and reads each target volume, so a folder that would overflow
  // the disk is caught before a half-written file is left behind. The check is
  // advisory: a server that cannot answer must never block the copy.
  const spaceLacking = async (plans: TransferPlan[]): Promise<FreeSpaceVolume[] | null> => {
    const report = await fsEngine.checkFreeSpace(plans);
    if (!report) return null;
    const lacking = report.volumes.filter((volume) => volume.lacking > 0);
    return lacking.length > 0 ? lacking : null;
  };

  // Forcing does not skip the warning for the next batch: the plans go straight
  // to the queue because the user already saw the numbers and accepted them.
  // `force` also travels into each job, otherwise the server's own guard would
  // refuse the very copy the user just approved.
  const handleForceTransfer = () => {
    const prompt = freeSpacePrompt;
    setFreeSpacePrompt(null);
    if (prompt) for (const plan of prompt.plans) enqueueTransferPlan(plan, prompt.replay, true);
  };

  // Replays every transfer in a loaded copy list, one queued task per batch.
  const handleRunCopyList = async (plans: TransferPlan[]) => {
    const lacking = await spaceLacking(plans);
    if (lacking) {
      setFreeSpacePrompt({ volumes: lacking, plans, replay: true });
      return;
    }
    for (const plan of plans) enqueueTransferPlan(plan, true);
  };

  // Elevation restarts the process, so a pending transfer has to travel with it.
  // The plan is parked in local storage and replayed by the fresh instance, which
  // is why the copy used to disappear right after the restart.
  const handleElevateTransfer = async (op: 'copy' | 'move', targetPath: string, options: TransferOptions) => {
    if (!targetPath.trim()) return { ok: false as const, reason: 'empty destination' };
    const relaunch = window.electronAPI?.relaunchAsAdmin;
    // Without a bridge there is no restart, so there is nothing to replay.
    if (typeof relaunch !== 'function') return { ok: false as const, reason: 'unsupported' };
    const plan = buildTransferPlan(op, transferItems, targetPath.trim(), options);
    // A full quota must not block the elevation itself; parking reports it and
    // the elevation goes ahead.
    if (plan) parkTransferPlan(plan);
    try {
      const result = await relaunch();
      // Only a confirmed restart has a successor that will replay the plan. A
      // cancelled UAC leaves this process running, so keeping the plan here
      // would let a later launch run the copy unelevated and unasked.
      if (plan && result?.ok !== true) takeParkedTransferPlan();
      return result;
    } catch (error) {
      if (plan) takeParkedTransferPlan();
      return { ok: false as const, reason: error instanceof Error ? error.message : 'relaunch failed' };
    }
  };

  useEffect(() => {
    const plan = takeParkedTransferPlan();
    if (plan?.entries?.length) enqueueTransferPlan(plan, true);
    // Consumed once, on the first mount after the elevated restart.
  }, []);

  // A live copy/move of real-drive items becomes a plan and hands the same
  // executor its absolute entry paths. Non-real items and rejected plans fall
  // back to the in-memory catalogue path through `copyItem`/`moveItem`.
  const runConfirmedTransfer = async (
    op: 'copy' | 'move',
    targetPath: string,
    options: TransferOptions,
    // A clipboard paste names both halves itself: the items were copied in one
    // panel and the destination is the folder of the panel the user is on now.
    // The dialog flow instead always aims at the other panel, which is why the
    // drive and the list have to be passed in rather than read from the tabs.
    fromClipboard?: { items: FileItem[]; targetDriveId: string },
  ): Promise<string | undefined> => {
    const items: FileItem[] = fromClipboard?.items ?? transferItems;
    const targetDriveId = fromClipboard?.targetDriveId ?? currentInactiveTab.driveId;
    const sourceDriveId = items[0]?.driveId ?? currentActiveTab.driveId;
    if (items.some((item) => item.archiveRoot) || fsEngine.getArchiveSource(targetDriveId, targetPath)) {
      return taskQueue.addTask('extract', t.unzipExtract, t.appDest.replace('{path}', targetPath), 0, async () => {
        if (op !== 'copy' || fsEngine.getArchiveSource(targetDriveId, targetPath)) throw new Error(t.zipReadOnly);
        for (const item of items) {
          const source = fsEngine.getArchiveSource(item.driveId, item.path);
          if (!source) throw new Error(t.zipErrEmpty);
          await fsEngine.extractArchive(source, targetDriveId, targetPath, item.archiveEntry);
        }
      });
    }
    const plan = buildTransferPlan(op, items, targetPath, options, targetDriveId, sourceDriveId);
    if (plan) {
      // The copy window stays open and follows the transfer it started: closing
      // it here left the user with only a small card and no way back into the job.
      // A transfer that does not fit returns no task id on purpose, which closes
      // the window and hands the decision to the free-space prompt.
      const lacking = await spaceLacking([plan]);
      if (lacking) {
        setFreeSpacePrompt({ volumes: lacking, plans: [plan], replay: false });
        return undefined;
      }
      return enqueueTransferPlan(plan);
    }

    // Falling back to the in-memory catalogue is correct for its own drives, but
    // it used to swallow a transfer aimed at a real drive too: the task animated
    // and finished without writing a single byte. Report the block instead of
    // pretending the copy happened.
    if (fsEngine.isSystemDrive(targetDriveId)) {
      const unknown = items.filter((item) => !fsEngine.isRealFile(item)).map((item) => item.name);
      const detail = unknown.length > 0 ? unknown.join(', ') : items.length + ' selected item(s)';
      return taskQueue.addTask(op, op === 'move' ? 'Move blocked' : 'Copy blocked', detail, 0, async () => {
        throw new Error(`${detail} was not read from a physical drive, so the real transfer cannot address it.`);
      });
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
        speed: rate > 0 ? formatSpeed(rate) : undefined,
        etaSeconds: rate > 0 && totalBytes > done ? Math.round((totalBytes - done) / rate) : 0,
        currentFile,
      });
    };

    const executor = async (
      onProgress: (transferred: number, total: number) => void,
      signal: { paused: boolean; cancelled: boolean },
    ) => {
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
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          if (signal.cancelled) return;

          let current = 0;
          try {
            if (op === 'move') {
              await fsEngine.moveItem(
                item.id,
                targetDriveId,
                targetPath,
                (t) => {
                  current = t;
                  onProgress(transferred + t, totalBytes);
                  reportMeta(transferred + t, item.name);
                },
                signal,
                options,
                askConflict,
                (files) => taskQueue.updateTaskFiles(taskId, files),
              );
            } else {
              await fsEngine.copyItem(
                item.id,
                targetDriveId,
                targetPath,
                overwrite,
                (t) => {
                  current = t;
                  onProgress(transferred + t, totalBytes);
                  reportMeta(transferred + t, item.name);
                },
                signal,
                options,
                askConflict,
                (files) => taskQueue.updateTaskFiles(taskId, files),
              );
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
        setConflictPrompt((current) => (current && current.jobId === promptedJobId ? null : current));
      }
    };

    const verb = op === 'move' ? t.appMoving : t.appCopying;
    taskId = taskQueue.addTask(
      op,
      verb.replace('{n}', String(items.length)),
      t.appDest.replace('{path}', targetPath),
      totalBytes,
      executor,
      plan,
    );
    return taskId;
  };

  const handleConfirmCopy = (targetPath: string, options: TransferOptions) => {
    return runConfirmedTransfer('copy', targetPath, options);
  };

  const handleConfirmMove = (targetPath: string, options: TransferOptions) => {
    return runConfirmedTransfer('move', targetPath, options);
  };

  // Ctrl+V reaches this directly instead of opening the copy window: the folder
  // is the one already in front of the user, and a collision is asked about by
  // the same prompt the dialogs use.
  const handlePasteTransfer = (
    op: 'copy' | 'move',
    targetDriveId: string,
    targetPath: string,
    items: FileItem[],
  ): Promise<string | undefined> => {
    if (items.length === 0) return Promise.resolve(undefined);
    return runConfirmedTransfer(op, targetPath, { collision: 'ask', throttleBps: 0 }, { items, targetDriveId });
  };

  const dismissFreeSpacePrompt = () => setFreeSpacePrompt(null);

  return {
    conflictPrompt,
    freeSpacePrompt,
    dismissFreeSpacePrompt,
    handleResolveConflict,
    handleAbortConflict,
    handleForceTransfer,
    handleRunCopyList,
    handleElevateTransfer,
    handleConfirmCopy,
    handleConfirmMove,
    handlePasteTransfer,
  };
}
