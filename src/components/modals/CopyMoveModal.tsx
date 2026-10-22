import React, { useEffect, useRef, useState } from 'react';
import { Copy, Minus, Scissors, ShieldAlert } from 'lucide-react';
import { BackgroundTask, CollisionPolicy, FileItem, LanguageCode, TransferOptions } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { taskQueue } from '../../services/taskQueueManager';
import { RetroProgressBar } from '../RetroProgressBar';

import { useModalDialog } from '../../hooks/useModalDialog';

interface CopyMoveModalProps {
  type: 'copy' | 'move';
  theme: ThemeConfig;
  lang: LanguageCode;
  items: FileItem[];
  sourcePath: string;
  targetPath: string;
  targetDriveId: string;
  onConfirm: (targetPath: string, options: TransferOptions) => string | undefined;
  /** Elevate and replay this transfer in the new instance. */
  onElevate?: (
    targetPath: string,
    options: TransferOptions
  ) => Promise<{ ok: boolean; reason?: string } | undefined>;
  onClose: () => void;
}

const COLLISION_OPTIONS: Array<
  [CollisionPolicy, 'collisionOverwrite' | 'collisionSkip' | 'collisionRename' | 'collisionAsk']
> = [
  ['overwrite', 'collisionOverwrite'],
  ['skip', 'collisionSkip'],
  ['rename', 'collisionRename'],
  ['ask', 'collisionAsk']
];

const SPEED_OPTIONS_MB = [1, 5, 10, 50];

export const CopyMoveModal: React.FC<CopyMoveModalProps> = ({
  type,
  theme,
  lang,
  items,
  targetPath,
  onConfirm,
  onElevate,
  onClose
}) => {
  const t = getTranslations(lang);
  const [destPath, setDestPath] = useState(targetPath);
  const [collision, setCollision] = useState<CollisionPolicy>('overwrite');
  // 0 means "no cap"; anything else is a cap in MB/s, converted to bytes on submit.
  const [speedLimitMb, setSpeedLimitMb] = useState(0);
  // Once a transfer starts this window turns into its progress view instead of
  // closing: every other file manager keeps the operation on screen until the
  // user decides to send it to the background.
  const [taskId, setTaskId] = useState<string | null>(null);
  // Elevation happens in another process, so a silent failure used to look like
  // a dead button. Whatever the relaunch reports is shown right here.
  const [adminNote, setAdminNote] = useState('');
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());

  useEffect(() => {
    const unsubscribe = taskQueue.subscribe(() => setTasks(taskQueue.getTasks()));
    return unsubscribe;
  }, []);

  const task = taskId ? tasks.find(entry => entry.id === taskId) : undefined;
  const isFinished =
    !!task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled');
  const needsAdmin = /denied|permission|EPERM|EACCES/i.test(task?.error || '');
  // Elevation is only worth offering when it can actually change the outcome:
  // either the job already failed for lack of rights, or the destination is one
  // of the system locations Windows protects. Offering it for every copy made
  // it look mandatory when it was not.
  const protectedDest = /^[a-z]:\\(program files|program files \(x86\)|windows|programdata)(\\|$)/i.test(
    destPath.trim()
  );
  const showAdmin = needsAdmin || protectedDest;

  // Everything else still waiting its turn. The queue is sequential, so these
  // are real pending operations rather than a log of past ones.
  const otherTasks = tasks.filter(
    entry =>
      entry.id !== taskId &&
      (entry.type === 'copy' || entry.type === 'move' || entry.type === 'delete') &&
      (entry.status === 'queued' || entry.status === 'running' || entry.status === 'paused')
  );

  const isCopy = type === 'copy';
  const totalSize = items.reduce((acc, i) => acc + (i.isDirectory ? 0 : i.size), 0);

  const formRef = useRef<HTMLFormElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);

  // The dialog shell parks focus on its own container after mount, so the field
  // marked autoFocus lost it again and Enter kept activating the header cross.
  // Reclaiming focus one tick later is what makes Enter mean "start transfer".
  useEffect(() => {
    if (taskId) return;
    const id = window.setTimeout(() => destInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [taskId]);

  const submitOptions = (): TransferOptions => ({
    collision,
    throttleBps: speedLimitMb > 0 ? Math.round(speedLimitMb * 1024 * 1024) : 0
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destPath.trim()) return;
    soundManager.playDiskAccess();
    const started = onConfirm(destPath.trim(), submitOptions());
    if (started) setTaskId(started);
    else onClose();
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.copyMoveModalTitle);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono select-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          // Enter belongs to the form, never to the window controls. Windows
          // dialogs treat it as "press the default button"; here that is the
          // transfer confirm, which used to be replaced by the close cross.
          if (event.key !== 'Enter' || event.shiftKey || taskId) return;
          if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
          event.preventDefault();
          formRef.current?.requestSubmit();
        }}
        className="flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
        style={{
          backgroundColor: theme.modalBg,
          borderColor: theme.modalBorder,
          color: theme.itemText,
          // User-resizable: drag any edge or the bottom-right corner. The dialog
          // starts at 32rem wide, can grow up to the overlay (never past the
          // viewport) and cannot collapse below a usable minimum.
          resize: 'both',
          width: '32rem',
          minWidth: '18rem',
          minHeight: '12rem',
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            {isCopy ? <Copy className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
            <span>{isCopy ? t.copyTitle : t.moveTitle} ({isCopy ? 'F5' : 'F6'})</span>
          </div>
          <div className="flex items-center gap-1">
            {task && !isFinished && (
              <button
                type="button"
                onClick={onClose}
                aria-label={t.minimize}
                title={`${t.minimize} (Esc)`}
                className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={onClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer">✕</button>
          </div>
        </div>

        {/* Configuration form, replaced by the live progress view once started */}
        {!task ? (
        <form ref={formRef} onSubmit={handleSubmit} className="p-4 flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col min-h-0 flex-1">
            <span className="opacity-75 block mb-1">
              {isCopy
                ? t.copyItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())
                : t.moveItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())}
            </span>
            <div className="flex-1 min-h-16 overflow-y-auto bg-black/40 p-2 rounded border border-white/10 text-[11px]">
              {items.map(i => (
                <div key={i.id} className="truncate text-amber-300">
                  • {i.name}{i.ext ? `.${i.ext}` : ''} {i.isDirectory ? '<DIR>' : ''}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-white mb-1">{t.copyMoveDestLabel}</label>
            <input
              type="text"
              ref={destInputRef}
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
              autoFocus
            />
          </div>

          {/* What to do when the destination entry already exists. */}
          <div>
            <span className="block font-bold text-white mb-1">{t.collisionPolicy}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="radiogroup" aria-label={t.collisionPolicy}>
              {COLLISION_OPTIONS.map(([value, labelKey]) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer opacity-90">
                  <input
                    type="radio"
                    name="collisionPolicy"
                    value={value}
                    checked={collision === value}
                    onChange={() => setCollision(value)}
                    className="cursor-pointer"
                  />
                  <span>{t[labelKey]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional bandwidth cap, SuperCopier style. */}
          <div>
            <label className="block font-bold text-white mb-1" htmlFor="speedLimitSelect">{t.speedLimit}</label>
            <select
              id="speedLimitSelect"
              value={speedLimitMb}
              onChange={(e) => setSpeedLimitMb(Number(e.target.value))}
              className="w-full bg-black/50 border border-white/30 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none cursor-pointer"
            >
              <option value={0}>{t.speedUnlimited}</option>
              {SPEED_OPTIONS_MB.map(mb => (
                <option key={mb} value={mb}>{mb} MB/s</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
            <button
              type="submit"
              autoFocus
              className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
            >
              {isCopy ? t.copyConfirm : t.moveConfirm}
            </button>
          </div>
        </form>
        ) : (
        <div className="p-4 flex flex-col gap-3 min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[13px] truncate" title={task.title}>{task.title}</span>
            <span className="font-bold text-cyan-400 shrink-0">{task.progress}%</span>
          </div>

          <RetroProgressBar
            percent={task.progress}
            theme={theme}
            status={task.status}
            cells={34}
            className="text-[18px] leading-none"
          />

          {/* The job sizes the tree before it can report a percentage, and a big
              folder can take a while. Say what is happening instead of sitting
              on a bare 0% that reads like a hang. */}
          {task.status === 'running' && task.progress === 0 && (
            <div className="text-[11px] text-amber-300 font-bold animate-pulse">
              {t.searchScanning}
            </div>
          )}

          {task.currentFile && (
            <div className="text-[11px] opacity-80 font-mono truncate" title={task.currentFile}>
              {task.currentFile}
            </div>
          )}

          <div className="text-[11px] opacity-80 break-all">
            {task.status === 'failed' && task.error ? (
              <span className="text-rose-400 font-bold">{task.error}</span>
            ) : (
              <>
                {task.speed || t.inProgress}
                {task.etaSeconds != null && task.etaSeconds > 0 ? ` · ${t.etaLabel} ${task.etaSeconds}s` : ''}
              </>
            )}
          </div>

          {(task.status === 'running' || task.status === 'paused') && (
            <div className="flex items-center gap-2 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  soundManager.playKeyTick();
                  if (task.status === 'paused') taskQueue.resumeTask(task.id);
                  else taskQueue.pauseTask(task.id);
                }}
                className="px-2.5 py-1 border border-cyan-500/60 rounded text-cyan-300 hover:bg-cyan-950/60 cursor-pointer font-bold"
              >
                {task.status === 'paused' ? t.bgTasksResume : t.bgTasksPause}
              </button>
              <button
                type="button"
                onClick={() => {
                  soundManager.playKeyTick();
                  taskQueue.cancelTask(task.id);
                }}
                className="px-2.5 py-1 border border-rose-500/60 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer font-bold"
              >
                {t.btnCancel}
              </button>
            </div>
          )}

          {/* The queue runs one transfer at a time, so a new copy, move or delete
              waits its turn here instead of interrupting the running one. */}
          {otherTasks.length > 0 && (
            <div className="border-t border-current/20 pt-2 flex flex-col gap-1.5">
              <div className="text-[10px] font-bold uppercase opacity-60">{t.taskQueueShort}</div>
              {otherTasks.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-[11px]">
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

          {/* Elevation is offered here too: the copy window is where the user is
              watching the job, so waiting for the task card is a detour. */}
          {(showAdmin && (window as any).electronAPI?.relaunchAsAdmin) && (
            <button
              type="button"
              onClick={async () => {
                soundManager.playKeyTick();
                setAdminNote(t.inProgress);
                const result = onElevate
                  ? await onElevate(destPath.trim(), submitOptions())
                  : await (window as any).electronAPI.relaunchAsAdmin();
                if (!result?.ok) {
                  setAdminNote(`${t.runAsAdmin}: ${result?.reason || 'failed'}`);
                }
              }}
              className={`flex items-center justify-center gap-1.5 w-full px-2 py-1 rounded border font-bold text-[12px] cursor-pointer ${
                needsAdmin
                  ? 'border-amber-400 text-amber-300 bg-amber-950/50 hover:bg-amber-900/70'
                  : 'border-amber-700/50 text-amber-500/80 hover:bg-amber-950/40'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {t.runAsAdmin}
            </button>
          )}

          {adminNote && (
            <div className="text-[11px] text-amber-300 break-all">{adminNote}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10 mt-auto">
            {isFinished && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
              >
                {t.btnClose}
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
