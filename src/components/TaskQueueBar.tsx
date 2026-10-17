import React, { useState, useEffect } from 'react';
import { Activity, ChevronUp, ChevronDown } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../types';
import { getTranslations } from '../i18n/translations';
import { taskQueue } from '../services/taskQueueManager';
import { soundManager } from '../services/soundEffects';

interface TaskQueueBarProps {
  onOpenTasksModal: () => void;
  lang: LanguageCode;
}

export const TaskQueueBar: React.FC<TaskQueueBarProps> = ({ onOpenTasksModal, lang }) => {
  const t = getTranslations(lang);
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    return taskQueue.subscribe(() => {
      setTasks(taskQueue.getTasks());
    });
  }, []);

  const runningTasks = tasks.filter(t => t.status === 'running');
  if (tasks.length === 0) return null;

  const topTask = runningTasks[0] || tasks[0];

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
            <span>{t.taskQueueShort} ({runningTasks.length} {t.activeLabel})</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(!isMinimized);
                soundManager.playKeyTick();
              }}
              aria-label={isMinimized ? t.expandTaskQueue : t.collapseTaskQueue}
              aria-expanded={!isMinimized}
              className="p-0.5 hover:bg-white/20 rounded cursor-pointer"
            >
              {isMinimized ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Body */}
        {!isMinimized && topTask && (
          <div className="p-2.5 space-y-1.5 bg-black/80">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold truncate text-neutral-200">{topTask.title}</span>
              <span className="font-bold text-cyan-400 shrink-0 ml-2">{topTask.progress}%</span>
            </div>

            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden border border-white/10">
              <div 
                className={`h-full transition-all duration-200 ${
                  topTask.status === 'completed' ? 'bg-cyan-400' : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                }`}
                style={{ width: `${topTask.progress}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] opacity-70">
              <span>{topTask.speed || t.inProgress}</span>
              <span 
                onClick={onOpenTasksModal}
                className="underline hover:text-cyan-300 cursor-pointer font-bold"
              >
                {t.viewAll}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
