import React, { useState, useEffect } from 'react';
import { Activity, Play, Pause, XCircle, Trash2, Save, FolderOpen } from 'lucide-react';
import { BackgroundTask, LanguageCode, TransferPlan } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { taskQueue } from '../../services/taskQueueManager';
import { fsEngine } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';

import { useModalDialog } from '../../hooks/useModalDialog';
import { getTranslations } from '../../i18n/translations';
import { RetroProgressBar } from '../RetroProgressBar';
import ModalShell from '../ModalShell';

interface BackgroundTasksModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onRunCopyList: (plans: TransferPlan[]) => void;
  onClose: () => void;
}

export const BackgroundTasksModal: React.FC<BackgroundTasksModalProps> = ({ theme, lang, onRunCopyList, onClose }) => {
  const t = getTranslations(lang);
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());
  const [listStatus, setListStatus] = useState('');

  useEffect(() => {
    return taskQueue.subscribe(() => {
      setTasks(taskQueue.getTasks());
    });
  }, []);

  // The transfer list lives on real disk, so it outlives the session and can be
  // replayed later. A list with no planned transfer (only deletes, say) has
  // nothing reproducible to write.
  const handleSaveList = async () => {
    soundManager.playKeyTick();
    const plans = taskQueue.getPlans();
    if (plans.length === 0) {
      setListStatus(t.copyListNothing);
      return;
    }
    const result = await fsEngine.saveCopyList(plans);
    setListStatus(
      result ? t.copyListSaved.replace('{n}', String(result.saved)).replace('{path}', result.path) : t.copyListFailed,
    );
  };

  const handleLoadList = async () => {
    soundManager.playKeyTick();
    const result = await fsEngine.loadCopyList();
    if (!result) {
      setListStatus(t.copyListFailed);
      return;
    }
    const plans = Array.isArray(result.list) ? result.list : [];
    if (plans.length === 0) {
      setListStatus(t.copyListNothing);
      return;
    }
    onRunCopyList(plans);
    setListStatus(t.copyListLoaded.replace('{n}', String(plans.length)).replace('{path}', result.path));
  };

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
    <ModalShell title={t.bgTasksTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        {/* Action Controls */}
        <div className="p-[var(--space-3)] bg-black/40 border-b border-white/10 flex items-center justify-between gap-[var(--space-2)]">
          <div className="flex items-center gap-[var(--space-2)] text-xs">
            <span className="font-bold text-cyan-300">{tasks.filter((t) => t.status === 'running').length}</span>
            <span className="opacity-75">{t.bgTasksRunning}</span>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <button
              onClick={() => {
                void handleSaveList();
              }}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded flex items-center gap-[var(--space-1)] font-bold cursor-pointer"
            >
              <Save className="w-3 h-3" />
              <span>{t.copyListSave}</span>
            </button>

            <button
              onClick={() => {
                void handleLoadList();
              }}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded flex items-center gap-[var(--space-1)] font-bold cursor-pointer"
            >
              <FolderOpen className="w-3 h-3" />
              <span>{t.copyListLoad}</span>
            </button>

            <button
              onClick={handleClearCompleted}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded flex items-center gap-[var(--space-1)] font-bold cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>{t.bgTasksClearCompleted}</span>
            </button>
          </div>
        </div>

        {listStatus && (
          <div className="px-[var(--space-3)] py-[var(--space-2)] bg-black/60 border-b border-white/10 text-[var(--fs-8)] text-cyan-300 break-all">
            {listStatus}
          </div>
        )}

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-[var(--space-3)] space-y-[var(--space-2)] max-h-96">
          {tasks.map((task) => {
            const isRunning = task.status === 'running';
            const isPaused = task.status === 'paused';
            const isCompleted = task.status === 'completed';

            return (
              <div
                key={task.id}
                className="p-[var(--space-3)] bg-black/50 border border-white/10 rounded flex flex-col gap-[var(--space-2)]"
              >
                <div className="flex items-center justify-between text-[var(--fs-sm)]">
                  <div className="flex items-center gap-[var(--space-2)] font-bold text-white">
                    <span className="px-[var(--space-2)] py-[var(--space-0)] text-[var(--fs-8)] uppercase bg-cyan-950 text-cyan-300 border border-cyan-500/30 rounded">
                      {task.type}
                    </span>
                    <span>{task.title}</span>
                  </div>

                  <div className="flex items-center gap-[var(--space-2)] text-[var(--fs-8)]">
                    {task.speed && isRunning && <span className="text-amber-300 font-bold">{task.speed}</span>}
                    {task.etaSeconds != null && task.etaSeconds > 0 && (
                      <span className="text-neutral-400">
                        {t.etaLabel} {task.etaSeconds}s
                      </span>
                    )}
                    <span
                      className={`font-bold uppercase ${
                        isRunning
                          ? 'text-emerald-400'
                          : isPaused
                            ? 'text-amber-400'
                            : isCompleted
                              ? 'text-cyan-400'
                              : 'text-rose-400'
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                </div>

                {task.details && <div className="text-[var(--fs-8)] opacity-60 truncate">{task.details}</div>}

                {task.currentFile && (isRunning || isPaused) && (
                  <div className="text-[var(--fs-8)] opacity-50 truncate font-mono">{task.currentFile}</div>
                )}

                {/* DOS-style per-file rows, newest first: one line per file, each
                    with its own progress readout. */}
                {task.files && task.files.length > 0 && (
                  <div className="bg-black/40 border border-white/10 rounded-sm px-[var(--space-2)] py-[var(--space-1)] max-h-32 overflow-y-auto">
                    <div className="flex items-center justify-between text-[var(--fs-8)] uppercase opacity-50">
                      <span>{t.bgTasksFiles}</span>
                      <span className="tabular-nums">{task.files.length}</span>
                    </div>
                    {task.files
                      .slice()
                      .reverse()
                      .map((file) => {
                        const pct = file.size > 0 ? Math.min(100, Math.round((file.copied / file.size) * 100)) : 0;
                        const tone =
                          file.status === 'done'
                            ? 'text-emerald-400'
                            : file.status === 'error'
                              ? 'text-rose-300'
                              : file.status === 'skipped'
                                ? 'text-neutral-500'
                                : 'text-cyan-300';
                        const mark =
                          file.status === 'done'
                            ? 'OK'
                            : file.status === 'error'
                              ? '!!'
                              : file.status === 'skipped'
                                ? '--'
                                : '>>';
                        return (
                          <div
                            key={file.path}
                            className="flex items-center gap-[var(--space-2)] text-[var(--fs-8)] font-mono py-[var(--space-1)]"
                            title={file.path}
                          >
                            <span className={`shrink-0 ${tone}`}>{mark}</span>
                            <span className="flex-1 truncate">{file.name}</span>
                            <span className="tabular-nums opacity-60 shrink-0 w-10 text-right">
                              {file.status === 'done' ? '' : file.size > 0 ? `${pct}%` : ''}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}

                {task.error && (
                  <div className="text-[var(--fs-8)] text-rose-300 bg-rose-950/40 border-l-2 border-rose-500 px-[var(--space-2)] py-[var(--space-1)] rounded-sm break-words">
                    {task.error}
                  </div>
                )}

                {/* DOS-style progress bar, spanning the full card width */}
                <RetroProgressBar
                  percent={task.progress}
                  theme={theme}
                  status={task.status}
                  className="text-xs w-full"
                />

                <div className="flex items-center justify-between text-[var(--fs-8)] opacity-75 tabular-nums">
                  <span>{t.bgTasksProgress.replace('{n}', String(task.progress))}</span>
                  <div className="flex items-center gap-[var(--space-2)]">
                    {isRunning && (
                      <button
                        onClick={() => handlePause(task.id)}
                        className="px-[var(--space-2)] py-[var(--space-1)] bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 rounded flex items-center gap-[var(--space-1)] cursor-pointer"
                      >
                        <Pause className="w-2.5 h-2.5" />
                        <span>{t.bgTasksPause}</span>
                      </button>
                    )}
                    {isPaused && (
                      <button
                        onClick={() => handleResume(task.id)}
                        className="px-[var(--space-2)] py-[var(--space-1)] bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 rounded flex items-center gap-[var(--space-1)] cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5" />
                        <span>{t.bgTasksResume}</span>
                      </button>
                    )}
                    {(isRunning || isPaused) && (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="px-[var(--space-2)] py-[var(--space-1)] bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded flex items-center gap-[var(--space-1)] cursor-pointer"
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

          {tasks.length === 0 && <div className="py-10 text-center opacity-50 italic">{t.bgTasksEmpty}</div>}
        </div>

        {/* Footer */}
        <div className="p-[var(--space-3)] bg-black/60 border-t border-white/10 flex items-center justify-between text-[var(--fs-8)] opacity-75">
          <span>{t.bgTasksNote}</span>
          <span>{t.escToExit}</span>
        </div>
      </div>
    </ModalShell>
  );
};
