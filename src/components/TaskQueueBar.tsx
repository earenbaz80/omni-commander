import React, { useState, useEffect } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from '../services/taskQueueManager';
import { soundManager } from '../services/soundEffects';
import { ThemeConfig } from '../services/themeManager';
import { RetroProgressBar } from './RetroProgressBar';

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
