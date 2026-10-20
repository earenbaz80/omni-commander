import React, { useState, useEffect, useRef } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from '../services/taskQueueManager';
import { soundManager } from '../services/soundEffects';
import { ThemeConfig } from '../services/themeManager';
import { RetroProgressBar } from './RetroProgressBar';
import { fsEngine } from '../services/fileSystem';

interface TaskQueueBarProps {
  onOpenTasksModal: () => void;
  lang: LanguageCode;
  theme: ThemeConfig;
}

export const TaskQueueBar: React.FC<TaskQueueBarProps> = ({ onOpenTasksModal, lang, theme }) => {
  const t = getTranslations(lang);
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    return taskQueue.subscribe(() => {
      setTasks(taskQueue.getTasks());
    });
  }, []);

  // A copy must open its window on its own. Minimizing is a choice the user makes
  // for one transfer, not a permanent preference: every newly started transfer
  // restores the full card so progress can never run hidden.
  const runningTaskId = tasks.find(task => task.status === 'running')?.id;
  const lastRunningTaskIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (runningTaskId && runningTaskId !== lastRunningTaskIdRef.current) {
      lastRunningTaskIdRef.current = runningTaskId;
      setIsMinimized(false);
    }
  }, [runningTaskId]);

  // The corner indicator exists for LIVE work and for FAILURES. Finished and
  // cancelled transfers stay in the background-tasks modal. A failed transfer is
  // the one thing that must NOT be hidden: it means the file on disk may be
  // incomplete.
  const activeTasks = tasks.filter(
    t =>
      t.status === 'running' ||
      t.status === 'queued' ||
      t.status === 'paused' ||
      t.status === 'failed'
  );
  const hasLiveWork = activeTasks.length > 0;
  // The control is never fully removed once a transfer has existed: hiding the
  // transfer panel with no way back leaves the user unable to tell whether a copy
  // ran at all. When idle it collapses to a pill that reopens the task list.
  if (!hasLiveWork && tasks.length === 0) return null;

  const topTask = activeTasks[0];
  // The newest row of the bounded per-file list is the file being written now.
  const currentFileEntry = topTask?.files && topTask.files.length > 0
    ? topTask.files[topTask.files.length - 1]
    : undefined;
  const currentFilePercent = currentFileEntry && currentFileEntry.size > 0
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
          className="bg-neutral-900 border-2 border-cyan-400 rounded-md shadow-2xl px-3 py-1.5 flex items-center gap-2 text-white hover:bg-cyan-950/90 transition cursor-pointer"
        >
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-bold text-cyan-300">{t.taskQueueShort}</span>
          <span className="tabular-nums opacity-80">
            {hasLiveWork ? `${topTask.progress}%` : `(${tasks.length})`}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-7 right-4 z-40 animate-fadeIn select-none font-mono text-xs">
      <div className="bg-neutral-900 border-2 border-cyan-400 rounded-md shadow-2xl overflow-hidden min-w-[260px] max-w-[340px] text-white">
        {/* Header */}
        <div 
          onClick={onOpenTasksModal}
          className="bg-cyan-950/90 px-3 py-1.5 flex items-center justify-between cursor-pointer border-b border-cyan-500/40 hover:bg-cyan-900/90 transition"
        >
          <div className="flex items-center gap-2 font-bold text-cyan-300">
            <Activity className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
            <span>{t.taskQueueShort} ({activeTasks.length} {t.activeLabel})</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(true);
                soundManager.playKeyTick();
              }}
              aria-label={t.collapseTaskQueue}
              aria-expanded={true}
              title={t.collapseTaskQueue}
              className="p-0.5 hover:bg-white/20 rounded cursor-pointer"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-2.5 space-y-1.5 bg-black/80">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold truncate text-neutral-200">{topTask.title}</span>
            <span className="font-bold text-cyan-400 shrink-0 ml-2">{topTask.progress}%</span>
          </div>

          <RetroProgressBar
            percent={topTask.progress}
            theme={theme}
            status={topTask.status}
            cells={22}
            className="text-[11px]"
          />

          {(topTask.status === 'running' || topTask.status === 'paused') && (
            <div className="flex items-center gap-1.5 text-[10px]" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  soundManager.playKeyTick();
                  if (topTask.status === 'paused') taskQueue.resumeTask(topTask.id);
                  else taskQueue.pauseTask(topTask.id);
                }}
                className="px-1.5 py-0.5 border border-cyan-500/60 rounded text-cyan-300 hover:bg-cyan-950/60 cursor-pointer font-bold"
              >
                {topTask.status === 'paused' ? t.bgTasksResume : t.bgTasksPause}
              </button>

              {topTask.serverJobId && (
                <label className="flex items-center gap-1 opacity-80">
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
                    className="bg-black text-cyan-300 border border-cyan-700 rounded px-1 py-0.5 font-mono cursor-pointer"
                  >
                    <option value={0}>{t.speedUnlimited}</option>
                    <option value={1048576}>1 MB/s</option>
                    <option value={5242880}>5 MB/s</option>
                    <option value={20971520}>20 MB/s</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {currentFileEntry && (
            <div className="flex items-center gap-1.5 text-[9px] opacity-70 font-mono">
              <span className="truncate flex-1" title={currentFileEntry.path}>
                {currentFileEntry.name}
              </span>
              <span className="tabular-nums shrink-0">
                {currentFileEntry.size > 0 ? `${currentFilePercent}%` : ''}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] opacity-70">
            <span className={topTask.status === 'failed' ? 'text-rose-400 font-bold truncate' : ''}>
              {topTask.status === 'failed' && topTask.error
                ? topTask.error
                : topTask.speed || t.inProgress}
              {topTask.status !== 'failed' && topTask.etaSeconds != null && topTask.etaSeconds > 0
                ? ` · ${t.etaLabel} ${topTask.etaSeconds}s`
                : ''}
            </span>
            <span
              onClick={onOpenTasksModal}
              className="underline hover:text-cyan-300 cursor-pointer font-bold"
            >
              {t.viewAll}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
