import React, { useEffect, useState } from 'react';
import { Copy, Minus, Scissors, Trash2 } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { taskQueue } from '../../services/taskQueueManager';
import { RetroProgressBar } from '../RetroProgressBar';
import { useModalDialog } from '../../hooks/useModalDialog';

interface TransferMonitorModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onNewTransfer: () => void;
  onClose: () => void;
}

const TRANSFER_TYPES: Array<BackgroundTask['type']> = ['copy', 'move', 'delete'];

function TaskIcon({ type }: { type: BackgroundTask['type'] }) {
  if (type === 'move') return <Scissors className="w-3.5 h-3.5" />;
  if (type === 'delete') return <Trash2 className="w-3.5 h-3.5" />;
  return <Copy className="w-3.5 h-3.5" />;
}

/**
 * Everything the user needs while transfers are in flight, in a single window:
 * the operation that is running right now plus the ones waiting their turn.
 * The queue is sequential, so this is a live queue and not a history log.
 */
export const TransferMonitorModal: React.FC<TransferMonitorModalProps> = ({
  theme,
  lang,
  onNewTransfer,
  onClose
}) => {
  const t = getTranslations(lang);
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());

  useEffect(() => {
    const unsubscribe = taskQueue.subscribe(() => setTasks(taskQueue.getTasks()));
    return unsubscribe;
  }, []);

  const dialogRef = useModalDialog<HTMLDivElement>(t.taskQueueShort);

  const transfers = tasks.filter(entry => TRANSFER_TYPES.includes(entry.type));
  const active =
    transfers.find(entry => entry.status === 'running') ||
    transfers.find(entry => entry.status === 'paused') ||
    transfers.find(entry => entry.status === 'queued');
  const waiting = transfers.filter(
    entry => entry.id !== active?.id && (entry.status === 'queued' || entry.status === 'running' || entry.status === 'paused')
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText,
          resize: 'both',
          width: '34rem',
          minWidth: '20rem',
          minHeight: '14rem',
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{ backgroundColor: theme.modalHeaderBg, borderColor: theme.modalBorder }}
        >
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4" />
            <span>{t.taskQueueShort}</span>
            <span className="opacity-60 font-normal">({transfers.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              aria-label={t.minimize}
              title={`${t.minimize} (Esc)`}
              className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.btnCancel}
              title={t.btnCancel}
              className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-3 overflow-y-auto">
          {!active && (
            <div className="text-[11px] opacity-70 py-6 text-center">{t.bgTasksEmpty}</div>
          )}

          {active && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 font-bold text-[13px]">
                <TaskIcon type={active.type} />
                <span className="flex-1 truncate" title={active.title}>{active.title}</span>
                <span className="uppercase text-[10px] opacity-70">{active.status}</span>
              </div>

              <RetroProgressBar percent={active.progress} theme={theme} status={active.status} />

              <div className="flex items-center justify-between text-[12px] tabular-nums">
                <span className="font-bold">{active.progress}%</span>
                <span className="opacity-80">
                  {active.speed || t.inProgress}
                  {active.etaSeconds != null && active.etaSeconds > 0 ? ` · ${t.etaLabel} ${active.etaSeconds}s` : ''}
                </span>
              </div>

              {active.currentFile && (
                <div className="text-[11px] opacity-80 font-mono truncate" title={active.currentFile}>
                  {active.currentFile}
                </div>
              )}

              {active.error && (
                <div className="text-[11px] text-rose-400 font-bold break-all">{active.error}</div>
              )}

              {(active.status === 'running' || active.status === 'paused' || active.status === 'queued') && (
                <div className="flex items-center gap-2 text-[12px]">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playKeyTick();
                      if (active.status === 'paused') taskQueue.resumeTask(active.id);
                      else taskQueue.pauseTask(active.id);
                    }}
                    className="px-2.5 py-1 border border-cyan-500/60 rounded text-cyan-300 hover:bg-cyan-950/60 cursor-pointer font-bold"
                  >
                    {active.status === 'paused' ? t.bgTasksResume : t.bgTasksPause}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playKeyTick();
                      taskQueue.cancelTask(active.id);
                    }}
                    className="px-2.5 py-1 border border-rose-500/60 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer font-bold"
                  >
                    {t.btnCancel}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Waiting transfers, in the order the queue will run them. */}
          {waiting.length > 0 && (
            <div className="border-t border-current/20 pt-2 flex flex-col gap-1.5">
              <div className="text-[10px] font-bold uppercase opacity-60">{t.taskQueueShort}</div>
              {waiting.map((entry, index) => (
                <div key={entry.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 shrink-0 opacity-60 tabular-nums">{index + 1}.</span>
                  <TaskIcon type={entry.type} />
                  <span className="w-14 shrink-0 uppercase opacity-60">{entry.status}</span>
                  <span className="flex-1 truncate font-mono" title={entry.title}>{entry.title}</span>
                  <span className="tabular-nums shrink-0 opacity-80">{entry.progress}%</span>
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playKeyTick();
                      taskQueue.cancelTask(entry.id);
                    }}
                    aria-label={t.btnCancel}
                    title={t.btnCancel}
                    className="px-1.5 py-0.5 border border-rose-500/50 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 border-t shrink-0"
          style={{ borderColor: theme.modalBorder }}
        >
          <button
            type="button"
            onClick={() => {
              soundManager.playKeyTick();
              onNewTransfer();
            }}
            className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer"
            title="F5"
          >
            {t.copyTitle}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
          >
            {t.btnCancel} (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
