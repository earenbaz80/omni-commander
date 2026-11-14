import { API_BASE } from './apiBase';
import type { ConflictResolution, FileItem, FileProgressEntry, PendingConflict, TransferOptions } from '../types';
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * Server-side transfers: starting a job, following it, and answering what it
 * asks for.
 *
 * Everything here talks to the local server's job engine, which owns the bytes:
 * start a copy or a move, poll the snapshot, mirror pause/cancel onto it, and
 * raise one collision prompt per destination. `FileSystemEngine` keeps its
 * public methods as delegates, so the callers never learn about this module.
 *
 * The state this needs from the engine is only what the catalogue looks like
 * after a transfer, so it arrives as dependencies instead of `this`.
 */

/** Progress snapshot of a real filesystem job owned by the local server. */
export interface RealFsJob {
  id: string;
  op: string;
  status: 'running' | 'paused' | 'waiting' | 'done' | 'done-with-errors' | 'cancelled' | 'error';
  totalBytes: number;
  copiedBytes: number;
  itemsTotal: number;
  itemsDone: number;
  itemsSkipped: number;
  currentFile: string;
  /** Destination parked for a human answer; present only while status is 'waiting'. */
  pendingConflict: {
    source: string;
    destination: string;
    isDirectory?: boolean;
    sourceSize?: number;
    destinationSize?: number;
    sourceModified?: number;
    destinationModified?: number;
    identical?: boolean;
  } | null;
  /** Tail of the files this job touched, newest last. Bounded by the server. */
  recentFiles: FileProgressEntry[];
  speedBps: number;
  etaSeconds: number;
  errors: Array<{ path: string; message: string }>;
}

/**
 * How long an unobservable job is retried before a transfer is declared failed.
 * The defaults hold a transfer for about ten seconds, which rides out a brief
 * hiccup but refuses to call a dead server a success. Exposed so tests can
 * shrink the window instead of waiting ten real seconds.
 */
export const lostJobRetryPolicy = {
  /** Consecutive polls that may fail to observe the job before giving up. */
  maxPolls: 20,
  /** Delay between those polls, in milliseconds. */
  pollDelayMs: 500,
};

/** Every member of the engine this module uses, named one by one. */
export interface TransferOpsDeps {
  callServerFs(route: string, body: unknown): Promise<unknown>;
  lastCallError(): string;
  normalizePath(path: string): string;
  realAbsolutePath(file: FileItem): string;
  realEntryName(file: FileItem): string;
  isSystemDrive(driveId: string): boolean;
  loadSystemDriveDirectory(driveId: string, path: string): Promise<boolean>;
  /** The catalogue entry that lands in a folder after a transfer. */
  catalogueEntryAt(driveId: string, path: string, name: string): FileItem | undefined;
}

export interface TransferOps {
  awaitServerJob(
    jobId: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onJob?: (job: RealFsJob) => void,
    onConflict?: (conflict: PendingConflict) => void,
    onConflictEnd?: (jobId: string) => void,
  ): Promise<RealFsJob | null>;
  resolveConflict(jobId: string, action: ConflictResolution, applyToAll: boolean): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  setJobThrottle(jobId: string, throttleBps: number): Promise<void>;
  runRealJob(route: string, body: unknown, driveId: string, reloadPath: string): void;
  transferPaths(
    op: 'copy' | 'move',
    sources: string[],
    targetDir: string,
    overwrite: boolean,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
    onStart?: (info: { totalBytes: number; itemsTotal: number; jobId: string }) => void,
    onConflictEnd?: (jobId: string) => void,
  ): Promise<void>;
  realCopyOrMove(
    file: FileItem,
    op: 'copy' | 'move',
    targetDriveId: string,
    targetPath: string,
    overwrite: boolean,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
    onConflictEnd?: (jobId: string) => void,
  ): Promise<FileItem | undefined>;
}

export function createTransferOps(deps: TransferOpsDeps): TransferOps {
  /**
   * Typed view of the bridge. The engine's `callServerFs` answers `unknown`
   * because only the route knows what it returns, so each call here names the
   * snapshot it expects — the same contract these call sites had before the move.
   */
  const callServer = <T>(route: string, body: unknown): Promise<T | null> =>
    deps.callServerFs(route, body) as Promise<T | null>;

  /**
   * Reads a job snapshot. A 404 means the server no longer knows about the job,
   * which the caller decides how to treat. Transport failures deliberately
   * PROPAGATE: swallowing them here is what let a dead server look like a
   * finished transfer, turning a half-written file into a green 100% in the UI.
   */
  async function getServerJob(jobId: string): Promise<RealFsJob | null> {
    const response = await fetchWithRetry(`${API_BASE}/api/fs/job/${encodeURIComponent(jobId)}`, {
      timeoutMs: 10000,
      retries: 1,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Job status request failed with HTTP ${response.status}`);
    return (await response.json()) as RealFsJob;
  }

  /**
   * Follows a server-side job to completion. The caller's pause/cancel intent
   * is mirrored onto the running job, so pausing in the UI actually stops the
   * transfer on disk instead of only freezing the progress bar.
   */
  async function awaitServerJob(
    jobId: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    onJob?: (job: RealFsJob) => void,
    onConflict?: (conflict: PendingConflict) => void,
    onConflictEnd?: (jobId: string) => void,
  ): Promise<RealFsJob | null> {
    let lastPaused = false;
    let lastCancelled = false;
    // Tracks the conflict already handed to the UI so one prompt is raised per
    // destination instead of once per poll. Cleared once the prompt is gone.
    let promptedConflict = '';
    // A job that cannot be observed is NOT a finished job. With the server gone
    // we keep asking for a bounded window before giving up, so a brief hiccup
    // does not fail an otherwise healthy transfer, but a real outage is reported
    // instead of silently completing with a truncated destination file.
    let lostPolls = 0;
    for (;;) {
      let job: RealFsJob | null = null;
      let unobservable = false;
      try {
        job = await getServerJob(jobId);
      } catch {
        unobservable = true;
      }

      if (unobservable || !job) {
        lostPolls += 1;
        if (lostPolls > lostJobRetryPolicy.maxPolls) {
          throw new Error(
            'Transfer lost: the local file server stopped responding, so the destination may be incomplete.',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, lostJobRetryPolicy.pollDelayMs));
        continue;
      }
      lostPolls = 0;

      onProgress?.(job.copiedBytes, job.totalBytes);
      // Callers that need entry counts (delete has no byte total) read the raw
      // snapshot here instead of the byte-oriented `onProgress` hook.
      onJob?.(job);

      // Raise a collision prompt at most once. Fire and forget on purpose: the
      // poller must never block on a human, and the UI answers through
      // resolveConflict(), which is what releases the parked server job.
      if (job.pendingConflict) {
        const signature = `${job.id}|${job.pendingConflict.source}|${job.pendingConflict.destination}`;
        if (signature !== promptedConflict) {
          promptedConflict = signature;
          onConflict?.({
            jobId: job.id,
            source: job.pendingConflict.source,
            destination: job.pendingConflict.destination,
            name:
              job.pendingConflict.destination.split(/[\\/]/).filter(Boolean).pop() || job.pendingConflict.destination,
            isDirectory: job.pendingConflict.isDirectory,
            sourceSize: job.pendingConflict.sourceSize,
            destinationSize: job.pendingConflict.destinationSize,
            sourceModified: job.pendingConflict.sourceModified,
            destinationModified: job.pendingConflict.destinationModified,
            identical: job.pendingConflict.identical,
          });
        }
      } else if (promptedConflict) {
        // The prompt is gone: the job was answered -- from the window, the tray or
        // the dashboard -- or it ended. Either way it is no longer parked, and the
        // surface that showed it waiting has to hear that without waiting for the
        // transfer to end.
        promptedConflict = '';
        onConflictEnd?.(job.id);
      }

      if (signal) {
        if (signal.cancelled && !lastCancelled) {
          lastCancelled = true;
          await callServer(`job/${encodeURIComponent(jobId)}/cancel`, {});
        } else if (!signal.cancelled && signal.paused !== lastPaused) {
          lastPaused = signal.paused;
          await callServer(`job/${encodeURIComponent(jobId)}/${signal.paused ? 'pause' : 'resume'}`, {});
        }
      }

      if (job.status !== 'running' && job.status !== 'paused' && job.status !== 'waiting') return job;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Answers a collision prompt raised by a running job. `applyToAll` promotes the
   * single answer into the policy for the rest of that transfer, so a large copy
   * does not ask once per colliding file.
   */
  async function resolveConflict(jobId: string, action: ConflictResolution, applyToAll: boolean): Promise<void> {
    await callServer(`job/${encodeURIComponent(jobId)}/resolve`, {
      decision: action,
      applyToAll: !!applyToAll,
    });
  }

  /** Aborts a job outright, used when the user backs out of a collision prompt. */
  async function cancelJob(jobId: string): Promise<void> {
    await callServer(`job/${encodeURIComponent(jobId)}/cancel`, {});
  }

  /**
   * Changes the speed limit of a job already in flight. The server applies it
   * from the next chunk, so a large transfer can be slowed down while it runs.
   * A value of 0 means unlimited.
   */
  async function setJobThrottle(jobId: string, throttleBps: number): Promise<void> {
    await callServer(`job/${encodeURIComponent(jobId)}/throttle`, { throttleBps });
  }

  // Fire-and-forget mutation helper: start the server job, wait for it and then
  // re-read the directory from disk. Reloading unconditionally is deliberate —
  // it repairs the optimistic in-memory state after a cancel or a failure.
  function runRealJob(route: string, body: unknown, driveId: string, reloadPath: string): void {
    void (async () => {
      try {
        const started = await callServer<{ jobId?: string }>(route, body);
        if (started?.jobId) await awaitServerJob(started.jobId);
      } catch (error) {
        // A fire-and-forget job has no task to report on, but a lost transfer
        // must not become an unhandled rejection either.
        console.error('[fileSystem] background job failed', error);
      }
      try {
        await deps.loadSystemDriveDirectory(driveId, reloadPath);
      } catch (error) {
        console.error('[fileSystem] directory reload failed', error);
      }
    })();
  }

  /**
   * Runs one server-side transfer of absolute source paths and waits for it.
   * This is the shared core of both a live selection transfer and a transfer
   * replayed from a saved copy list, which only has paths to work with.
   */
  async function transferPaths(
    op: 'copy' | 'move',
    sources: string[],
    targetDir: string,
    overwrite: boolean,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
    onStart?: (info: { totalBytes: number; itemsTotal: number; jobId: string }) => void,
    onConflictEnd?: (jobId: string) => void,
  ): Promise<void> {
    const started = await callServer<{ jobId?: string; totalBytes?: number; itemsTotal?: number }>(op, {
      sources,
      // Panels address a drive root as a bare letter ("C:\"), which the server's
      // path guard used to reject. Normalizing here keeps the request well formed
      // whatever the caller passed.
      targetDir: deps.normalizePath(targetDir),
      overwrite,
      // SuperCopier-style knobs. Omitted when the caller has no preference, so
      // the server keeps its `overwrite`-derived default.
      ...(options
        ? {
            collision: options.collision,
            throttleBps: options.throttleBps,
            ...(options.force ? { force: true } : {}),
            ...(options.resume ? { resume: true } : {}),
          }
        : {}),
    });
    if (!started?.jobId) {
      // `callServerFs` keeps the server's own reason out of band; surface it so
      // the user sees "Unsafe path: ..." instead of an opaque "could not start".
      const reason = deps.lastCallError() || 'the local file service did not answer';
      throw new Error(`${op === 'move' ? 'Move' : 'Copy'} could not start: ${reason}`);
    }

    // The server already walked the tree to size the job. Report it so a
    // folder selection does not fall back to the 1 MiB floor, which made an
    // untouched copy look finished at 100%.
    onStart?.({
      totalBytes: Number(started.totalBytes) || 0,
      itemsTotal: Number(started.itemsTotal) || 0,
      jobId: String(started.jobId),
    });

    // The per-file rows come from the same snapshot the progress callback reads,
    // so both surfaces stay in lockstep without a second poll.
    const job = await awaitServerJob(
      started.jobId,
      onProgress,
      signal,
      onFiles ? (snapshot) => onFiles(snapshot.recentFiles || []) : undefined,
      onConflict,
      onConflictEnd,
    );
    if (job && job.status === 'done-with-errors') {
      throw new Error(job.errors[0]?.message || 'Operation failed');
    }
  }

  async function realCopyOrMove(
    file: FileItem,
    op: 'copy' | 'move',
    targetDriveId: string,
    targetPath: string,
    overwrite: boolean,
    onProgress?: (transferred: number, total: number) => void,
    signal?: { paused: boolean; cancelled: boolean },
    options?: TransferOptions,
    onConflict?: (conflict: PendingConflict) => void,
    onFiles?: (files: FileProgressEntry[]) => void,
    onConflictEnd?: (jobId: string) => void,
  ): Promise<FileItem | undefined> {
    await transferPaths(
      op,
      [deps.realAbsolutePath(file)],
      targetPath,
      overwrite,
      onProgress,
      signal,
      options,
      onConflict,
      onFiles,
      undefined,
      onConflictEnd,
    );

    const sourceDriveId = file.driveId;
    await deps.loadSystemDriveDirectory(targetDriveId, targetPath);
    if (op === 'move' && sourceDriveId !== targetDriveId) {
      await deps.loadSystemDriveDirectory(sourceDriveId, file.path);
    }

    return deps.catalogueEntryAt(targetDriveId, targetPath, deps.realEntryName(file));
  }

  return {
    awaitServerJob,
    resolveConflict,
    cancelJob,
    setJobThrottle,
    runRealJob,
    transferPaths,
    realCopyOrMove,
  };
}
