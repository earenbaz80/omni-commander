import React, { useState, useEffect } from 'react';
import { Activity, Play, Pause, XCircle, Trash2 } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { taskQueue } from '../../services/taskQueueManager';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';

interface BackgroundTasksModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

export const BackgroundTasksModal: React.FC<BackgroundTasksModalProps> = ({
  theme,
  lang,
  onClose
}) => {
  const t = getTranslations(lang);
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());

  useEffect(() => {
    return taskQueue.subscribe(() => {
      setTasks(taskQueue.getTasks());
    });
  }, []);

  const handlePause = (id: string) => {
    taskQueue.pauseTask(id);
    soundManager.playKeyTick();
  };

  const handleResume = (id: string) => {
    taskQueue.resumeTask(id);
    soundManager.playKeyTick();
  };

  const handleCancel = (id: string) => {
    taskQueue.cancelTask(id);
    soundManager.playKeyTick();
  };

  const handleClearCompleted = () => {
    taskQueue.clearCompleted();
    soundManager.playKeyTick();
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.bgTasksModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fadeIn select-none font-mono">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl rounded shadow-2xl border flex flex-col overflow-hidden text-xs max-h-[85vh]"
        style={{
          backgroundColor: theme.bgPanel,
          borderColor: theme.borderPanel,
          color: theme.itemText
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 font-bold uppercase tracking-wider select-none border-b"
          style={{
            backgroundColor: theme.headerBg,
            color: theme.headerText,
            borderColor: theme.borderPanel
          }}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span>{t.bgTasksTitle}</span>
          </div>
          <button 
            onClick={onClose}
            className="px-2 py-0.5 bg-black/30 hover:bg-black/60 rounded text-xs cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>

        {/* Action Controls */}
        <div className="p-3 bg-black/40 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-cyan-300">{tasks.filter(t => t.status === 'running').length}</span>
            <span className="opacity-75">{t.bgTasksRunning}</span>
          </div>

          <button
            onClick={handleClearCompleted}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded flex items-center gap-1 font-bold cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            <span>{t.bgTasksClearCompleted}</span>
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-96">
          {tasks.map((task) => {
            const isRunning = task.status === 'running';
            const isPaused = task.status === 'paused';
            const isCompleted = task.status === 'completed';
            const isCancelled = task.status === 'cancelled';

            return (
              <div 
                key={task.id}
                className="p-2.5 bg-black/50 border border-white/10 rounded flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <span className="px-1.5 py-0.2 text-[9px] uppercase bg-cyan-950 text-cyan-300 border border-cyan-500/30 rounded">
                      {task.type}
                    </span>
                    <span>{task.title}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px]">
                    {task.speed && isRunning && (
                      <span className="text-amber-300 font-bold">{task.speed}</span>
                    )}
                    <span className={`font-bold uppercase ${
                      isRunning ? 'text-emerald-400' : isPaused ? 'text-amber-400' : isCompleted ? 'text-cyan-400' : 'text-rose-400'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </div>

                {task.details && (
                  <div className="text-[10px] opacity-60 truncate">
                    {task.details}
                  </div>
                )}

                {/* Progress Bar */}
                <div className="w-full h-2 bg-black rounded-full overflow-hidden border border-white/10 relative">
                  <div 
                    className={`h-full transition-all duration-200 ${
                      isCompleted ? 'bg-cyan-500' : isPaused ? 'bg-amber-500' : isCancelled ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    }`}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] opacity-75 tabular-nums">
                  <span>{t.bgTasksProgress.replace('{n}', String(task.progress))}</span>
                  <div className="flex items-center gap-2">
                    {isRunning && (
                      <button
                        onClick={() => handlePause(task.id)}
                        className="px-2 py-0.5 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Pause className="w-2.5 h-2.5" />
                        <span>{t.bgTasksPause}</span>
                      </button>
                    )}
                    {isPaused && (
                      <button
                        onClick={() => handleResume(task.id)}
                        className="px-2 py-0.5 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5" />
                        <span>{t.bgTasksResume}</span>
                      </button>
                    )}
                    {(isRunning || isPaused) && (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="px-2 py-0.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-2.5 h-2.5" />
                        <span>{t.btnCancel}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {tasks.length === 0 && (
            <div className="py-10 text-center opacity-50 italic">
              {t.bgTasksEmpty}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 bg-black/60 border-t border-white/10 flex items-center justify-between text-[10px] opacity-75">
          <span>{t.bgTasksNote}</span>
          <span>{t.escToExit}</span>
        </div>
      </div>
    </div>
  );
};
