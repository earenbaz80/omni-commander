import React, { useState, useEffect, useRef } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from '../services/taskQueueManager';
import { formatSpeed } from '../utils/formatSpeed';
import { soundManager } from '../services/soundEffects';
import { ThemeConfig } from '../services/themeManager';
import { RetroProgressBar } from './RetroProgressBar';
import { fsEngine } from '../services/fileSystem';
import { useElevation } from '../hooks/useElevation';
import { describeElevationFailure } from '../services/elevation';

interface TaskQueueBarProps {
  onOpenTasksModal: () => void;
  lang: LanguageCode;
  theme: ThemeConfig;
}

export const TaskQueueBar: React.FC<TaskQueueBarProps> = ({ onOpenTasksModal, lang, theme }) => {
  const t = getTranslations(lang);
  // Whether this process really holds an elevated token. Offering the only way
  // to gain one from inside a process that already has it is how the card kept
  // asking for admin while the status line said admin was granted.
  const { isElevated, requestElevation } = useElevation();
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());
  const [isMinimized, setIsMinimized] = useState(false);
  // A refused UAC leaves this window open, so the reason has to be printed
  // here instead of letting the button look like it did nothing.
  const [adminNote, setAdminNote] = useState('');

  useEffect(() => {
    return taskQueue.subscribe(() => {
      setTasks(taskQueue.getTasks());
    });
  }, []);

  // A copy must open its window on its own. Minimizing is a choice the user makes
  // for one transfer, not a permanent preference: every newly started transfer
  // restores the full card so progress can never run hidden.
  const runningTaskId = tasks.find((task) => task.status === 'running')?.id;
  const lastRunningTaskIdRef = useRef<string | undefined>(undefined);
  // A transfer that starts while another one is still running is queued behind
  // it, so the running id does not change. Watching the task count covers that
  // case: any newly added transfer reopens the window too.
  const liveTaskCount = tasks.filter((task) => task.type === 'copy' || task.type === 'move').length;
  const lastLiveTaskCountRef = useRef(liveTaskCount);
  useEffect(() => {
    const openedForNewTransfer = runningTaskId && runningTaskId !== lastRunningTaskIdRef.current;
    const openedForQueuedTransfer = liveTaskCount > lastLiveTaskCountRef.current;

    lastRunningTaskIdRef.current = runningTaskId;
    lastLiveTaskCountRef.current = liveTaskCount;

    if (openedForNewTransfer || openedForQueuedTransfer) {
      setIsMinimized(false);
    }
  }, [runningTaskId, liveTaskCount]);

  // The corner indicator exists for LIVE work and for FAILURES. Finished and
  // cancelled transfers stay in the background-tasks modal. A failed transfer is
  // the one thing that must NOT be hidden: it means the file on disk may be
  // incomplete.
  // A failure stays on screen — an incomplete file on disk is not something to
  // hide — but it must not outrank work that is still moving. Newest-first put
  // a dead copy at the top, so the card showed an old file asking for admin
  // while the real transfer wrote behind it.
  const activeTasks = tasks
    .filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'paused' || t.status === 'failed')
    .sort((a, b) => Number(a.status === 'failed') - Number(b.status === 'failed'));
  const hasLiveWork = activeTasks.length > 0;
  // The control is never fully removed once a transfer has existed: hiding the
  // transfer panel with no way back leaves the user unable to tell whether a copy
  // ran at all. When idle it collapses to a pill that reopens the task list.
  if (!hasLiveWork && tasks.length === 0) return null;

  const topTask = activeTasks[0];
  // The newest row of the bounded per-file list is the file being written now.
  const currentFileEntry =
    topTask?.files && topTask.files.length > 0 ? topTask.files[topTask.files.length - 1] : undefined;
  const currentFilePercent =
    currentFileEntry && currentFileEntry.size > 0
      ? Math.min(100, Math.round((currentFileEntry.copied / currentFileEntry.size) * 100))
      : 0;

  if (!hasLiveWork || isMinimized || !topTask) {
    return (
      <div className="fixed bottom-7 right-4 z-40 animate-fadeIn select-none font-mono text-xs">
        <button
          onClick={() => {
            soundManager.playKeyTick();
            onOpenTasksModal();
          }}
          aria-label={t.taskQueue}
          title={t.taskQueue}
          className="bg-neutral-900 border-2 border-cyan-400 rounded-md shadow-2xl px-[var(--space-3)] py-[var(--space-2)] flex items-center gap-[var(--space-2)] text-white hover:bg-cyan-950/90 transition cursor-pointer"
        >
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-bold text-cyan-300">{t.taskQueueShort}</span>
          <span className="tabular-nums opacity-80">{hasLiveWork ? `${topTask.progress}%` : `(${tasks.length})`}</span>
        </button>
      </div>
    );
  }

  // A refused write is the only signal that the token was too weak. The button
  // stays in the window while the process is not elevated, so it is already
  // there the moment it is needed, but an elevated process has nothing left to
  // ask for: the relaunch would only restart it and lose the transfer.
  const needsAdmin = !isElevated && /denied|permission|EPERM|EACCES/i.test(topTask?.error || '');

  return (
    <div className="fixed bottom-7 right-4 z-40 animate-fadeIn select-none font-mono text-sm">
      <div className="bg-neutral-900 border-2 border-cyan-400 rounded-md shadow-2xl overflow-hidden min-w-[300px] max-w-[420px] text-white">
        {/* Header */}
        <div
          onClick={onOpenTasksModal}
          className="bg-cyan-950/90 px-[var(--space-3)] py-[var(--space-2)] flex items-center justify-between cursor-pointer border-b border-cyan-500/40 hover:bg-cyan-900/90 transition"
        >
          <div className="flex items-center gap-[var(--space-2)] font-bold text-cyan-300">
            <Activity className="w-4 h-4 animate-pulse text-cyan-400" />
            <span>
              {t.taskQueueShort} ({activeTasks.length} {t.activeLabel})
            </span>
          </div>

          <div className="flex items-center gap-[var(--space-1)]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(true);
                soundManager.playKeyTick();
              }}
              aria-label={t.collapseTaskQueue}
              aria-expanded={true}
              title={t.collapseTaskQueue}
              className="flex items-center gap-[var(--space-1)] px-[var(--space-1)].5 py-[var(--space-1)] border border-cyan-500/60 rounded hover:bg-white/20 cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-[var(--space-2)].5 space-y-[var(--space-2)] bg-black/80">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-bold truncate text-neutral-200">{topTask.title}</span>
            <span className="font-bold text-cyan-400 shrink-0 ml-[var(--space-2)]">{topTask.progress}%</span>
          </div>

          <RetroProgressBar
            percent={topTask.progress}
            theme={theme}
            status={topTask.status}
            cells={20}
            className="text-[14px]"
          />

          {(topTask.status === 'running' || topTask.status === 'paused') && (
            <div className="flex items-center gap-[var(--space-2)] text-[12px]" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  soundManager.playKeyTick();
                  if (topTask.status === 'paused') taskQueue.resumeTask(topTask.id);
                  else taskQueue.pauseTask(topTask.id);
                }}
                className="px-[var(--space-1)].5 py-[var(--space-1)] border border-cyan-500/60 rounded text-cyan-300 hover:bg-cyan-950/60 cursor-pointer font-bold"
              >
                {topTask.status === 'paused' ? t.bgTasksResume : t.bgTasksPause}
              </button>

              {topTask.serverJobId && (
                <label className="flex items-center gap-[var(--space-1)] opacity-80">
                  <span>{t.speedLimit}</span>
                  <select
                    value={topTask.throttleBps ?? 0}
                    onChange={(e) => {
                      const bps = Number(e.target.value);
                      soundManager.playKeyTick();
                      // Remember the choice on the task so the control reflects it,
                      // then retune the live server job. The copy loop re-reads the
                      // limit before every chunk, so this lands mid-transfer.
                      taskQueue.updateTaskMeta(topTask.id, { throttleBps: bps });
                      void fsEngine.setJobThrottle(topTask.serverJobId as string, bps);
                    }}
                    className="bg-black text-cyan-300 border border-cyan-700 rounded px-[var(--space-1)] py-[var(--space-1)] font-mono cursor-pointer"
                  >
                    <option value={0}>{t.speedUnlimited}</option>
                    <option value={1048576}>{formatSpeed(1048576)}</option>
                    <option value={5242880}>{formatSpeed(5242880)}</option>
                    <option value={20971520}>{formatSpeed(20971520)}</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {currentFileEntry && (
            <div className="flex items-center gap-[var(--space-2)] text-[11px] opacity-70 font-mono">
              <span className="truncate flex-1" title={currentFileEntry.path}>
                {currentFileEntry.name}
              </span>
              <span className="tabular-nums shrink-0">{currentFileEntry.size > 0 ? `${currentFilePercent}%` : ''}</span>
            </div>
          )}

          {/* An extraction reports no per-file rows: it names the member it is
              writing, so the card is not left with a bare percentage. */}
          {!currentFileEntry && topTask.currentFile && (
            <div className="text-[11px] opacity-70 font-mono truncate" title={topTask.currentFile}>
              {topTask.currentFile}
            </div>
          )}

          {/* A protected destination can only be written with an elevated
              token. Explorer asks for it silently; this app has to relaunch
              itself, so keep that door in the window at all times. */}
          {!isElevated && window.electronAPI?.relaunchAsAdmin && (
            <>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  soundManager.playKeyTick();
                  setAdminNote('');
                  const result = await requestElevation();
                  if (result && !result.ok) setAdminNote(describeElevationFailure(result, t));
                }}
                className={`w-full px-[var(--space-1)].5 py-[var(--space-1)] border rounded cursor-pointer font-bold text-[12px] ${
                  needsAdmin
                    ? 'border-amber-400 text-amber-300 bg-amber-950/50 hover:bg-amber-900/70'
                    : 'border-amber-700/50 text-amber-500/80 hover:bg-amber-950/40'
                }`}
              >
                {t.runAsAdmin}
              </button>
              {adminNote && (
                <div role="alert" className="text-[11px] leading-snug text-amber-300 break-words">
                  {adminNote}
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between text-[12px] opacity-70">
            <span className={topTask.status === 'failed' ? 'nc-danger-ink font-bold break-all' : ''}>
              {topTask.status === 'failed' && topTask.error ? topTask.error : topTask.speed || t.inProgress}
              {topTask.status !== 'failed' && topTask.etaSeconds != null && topTask.etaSeconds > 0
                ? ` · ${t.etaLabel} ${topTask.etaSeconds}s`
                : ''}
            </span>
            <span onClick={onOpenTasksModal} className="underline hover:text-cyan-300 cursor-pointer font-bold">
              {t.viewAll}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
