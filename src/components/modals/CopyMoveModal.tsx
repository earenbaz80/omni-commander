import React, { useEffect, useRef, useState } from 'react';
import { Copy, Scissors, ShieldAlert } from 'lucide-react';
import { BackgroundTask, CollisionPolicy, FileItem, LanguageCode, TransferOptions, TransferPlan } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { taskQueue } from '../../services/taskQueueManager';
import { addEntriesToPlan, planFileBytes } from '../../services/transferPlanEdits';
import { canPickPaths, pickPathsFromDisk, PickMode } from '../../services/nativePicker';
import { fsEngine } from '../../services/fileSystem';
import { RetroProgressBar } from '../RetroProgressBar';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

interface CopyMoveModalProps {
  type: 'copy' | 'move';
  theme: ThemeConfig;
  lang: LanguageCode;
  items?: FileItem[];
  sourcePath?: string;
  targetPath?: string;
  targetDriveId?: string;
  onConfirm: (targetPath: string, options: TransferOptions) => string | undefined | Promise<string | undefined>;
  /** Elevate and replay this transfer in the new instance. */
  onElevate?: (targetPath: string, options: TransferOptions) => Promise<{ ok: boolean; reason?: string } | undefined>;
  /** Replay a batch of plans loaded from disk. */
  onLoadCopyList?: (plans: TransferPlan[]) => void;
  onClose: () => void;
}

const COLLISION_OPTIONS: Array<
  [
    CollisionPolicy,
    (
      | 'collisionOverwrite'
      | 'collisionSkip'
      | 'collisionRename'
      | 'collisionAsk'
      | 'collisionCancel'
      | 'collisionOverwriteIfDifferent'
      | 'collisionRenameOld'
    ),
  ]
> = [
  ['overwrite', 'collisionOverwrite'],
  ['skip', 'collisionSkip'],
  ['rename', 'collisionRename'],
  ['ask', 'collisionAsk'],
  ['cancel', 'collisionCancel'],
  ['overwrite-if-different', 'collisionOverwriteIfDifferent'],
  ['rename-old', 'collisionRenameOld'],
];

const SPEED_OPTIONS_MB = [1, 5, 10, 50];

// Closing a finished transfer on its own is convenient for fire-and-forget
// copies and hostile for everything else, so it is always an explicit choice.
type AfterFinish = 'stay' | 'close' | 'ask';

const AFTER_FINISH_KEY = 'omnicommander.afterFinish';

type Tab = 'list' | 'errors' | 'options';
interface LogEntry {
  key: string;
  time: string;
  title: string;
  message: string;
}

function readAfterFinish(): AfterFinish {
  try {
    const stored = localStorage.getItem(AFTER_FINISH_KEY);
    if (stored === 'close' || stored === 'ask' || stored === 'stay') return stored;
  } catch {
    // Storage can be unavailable; the default is still the safe one.
  }
  return 'stay';
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '�';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export const CopyMoveModal: React.FC<CopyMoveModalProps> = ({
  type,
  theme,
  lang,
  items = [],
  targetPath = '',
  onConfirm,
  onElevate,
  onLoadCopyList,
  onClose,
}) => {
  const t = getTranslations(lang);
  const [destPath, setDestPath] = useState(targetPath);
  const [collision, setCollision] = useState<CollisionPolicy>('overwrite');
  // 0 means "no cap"; anything else is a cap in MB/s, converted to bytes on submit.
  const [speedLimitMb, setSpeedLimitMb] = useState(0);
  // Remembered across sessions: nobody wants to re-pick this on every copy.
  const [afterFinish, setAfterFinish] = useState<AfterFinish>(readAfterFinish);
  const [finishedPrompt, setFinishedPrompt] = useState(false);
  const [listNote, setListNote] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Once a transfer starts this window turns into its progress view instead of
  // closing: every other file manager keeps the operation on screen until the
  // user decides to send it to the background.
  const [taskId, setTaskId] = useState<string | null>(null);
  // Elevation happens in another process, so a silent failure used to look like
  // a dead button. Whatever the relaunch reports is shown right here.
  const [adminNote, setAdminNote] = useState('');
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());

  // Tabbed monitor state (SuperCopier shape): list / errors / options, plus fold.
  const [tab, setTab] = useState<Tab>('list');
  const [folded] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = taskQueue.subscribe(() => setTasks(taskQueue.getTasks()));
    return unsubscribe;
  }, []);

  // Accumulate an error log entry whenever a task reports a failure.
  useEffect(() => {
    setLog((prev) => {
      let changed = false;
      const next = [...prev];
      for (const task of tasks) {
        if (!task.error) continue;
        const key = `${task.id}:${task.error}`;
        if (dismissed.current.has(key)) continue;
        if (next.some((e) => e.key === key)) continue;
        next.push({ key, time: new Date().toLocaleTimeString(), title: task.title, message: task.error });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const task = taskId ? tasks.find((entry) => entry.id === taskId) : undefined;
  const isFinished = !!task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled');
  const needsAdmin = /denied|permission|EPERM|EACCES/i.test(task?.error || '');
  const protectedDest = /^[a-z]:\\(program files|program files \(x86\)|windows|programdata)(\\|$)/i.test(
    destPath.trim(),
  );
  const showAdmin = needsAdmin || protectedDest;

  // Everything else still waiting its turn. The queue is sequential, so these
  // are real pending operations rather than a log of past ones.
  const otherTasks = tasks.filter(
    (entry) =>
      entry.id !== taskId &&
      (entry.type === 'copy' || entry.type === 'move' || entry.type === 'delete') &&
      (entry.status === 'queued' || entry.status === 'running' || entry.status === 'paused'),
  );

  // Monitor derived state.
  const transfers = tasks.filter((entry) => entry.type === 'copy' || entry.type === 'move' || entry.type === 'delete');
  const active =
    transfers.find((t) => t.status === 'running') ??
    transfers.find((t) => t.status === 'paused') ??
    transfers.find((t) => t.status === 'queued');
  const currentSpeedMb = active ? Math.round(active.throttleBps / 1048576) : 0;
  const canControl = !!active && (active.status === 'running' || active.status === 'paused');

  const applySpeed = (mb: number) => {
    if (!active) return;
    const bps = mb === 0 ? 0 : mb * 1024 * 1024;
    taskQueue.updateTaskMeta(active.id, { throttleBps: bps });
    if (active.serverJobId) void fsEngine.setJobThrottle(active.serverJobId, bps);
  };

  const chooseAfterFinish = (next: AfterFinish) => {
    setAfterFinish(next);
    try {
      localStorage.setItem(AFTER_FINISH_KEY, next);
    } catch {
      // A full quota costs the reminder, never the transfer.
    }
  };

  const clearLog = () => {
    for (const e of log) dismissed.current.add(e.key);
    setLog([]);
  };

  const handleSaveLog = () => {
    if (log.length === 0) return;
    const text = log.map((e) => `[${e.time}] ${e.title}\n${e.message}`).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'errorlog.txt';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const moveEntry = (index: number, delta: number) => {
    if (!active?.plan?.entries) return;
    const next = [...active.plan.entries];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    taskQueue.updateTaskMeta(active.id, { plan: { ...active.plan, entries: next } });
  };

  const moveEntryTop = (index: number) => {
    if (!active?.plan?.entries || index <= 0) return;
    const next = [...active.plan.entries];
    const [item] = next.splice(index, 1);
    next.unshift(item);
    taskQueue.updateTaskMeta(active.id, { plan: { ...active.plan, entries: next } });
  };

  const moveEntryBottom = (index: number) => {
    if (!active?.plan?.entries) return;
    const next = [...active.plan.entries];
    const [item] = next.splice(index, 1);
    next.push(item);
    taskQueue.updateTaskMeta(active.id, { plan: { ...active.plan, entries: next } });
  };

  const sortEntries = (key: 'path' | 'name' | 'size') => {
    if (!active?.plan?.entries) return;
    const next = [...active.plan.entries].sort((a, b) => {
      if (key === 'size') return a.size - b.size;
      if (key === 'name') return a.name.localeCompare(b.name);
      return a.path.localeCompare(b.path);
    });
    taskQueue.updateTaskMeta(active.id, { plan: { ...active.plan, entries: next } });
  };

  const removeEntry = (index: number) => {
    if (!active?.plan?.entries) return;
    const next = active.plan.entries.filter((_, i) => i !== index);
    taskQueue.updateTaskMeta(active.id, {
      plan: { ...active.plan, entries: next },
      totalBytes: next.reduce((acc, e) => acc + (e.isDirectory ? 0 : e.size), 0),
    });
  };

  // Adds what the native picker returned to the transfer on screen. The plan is
  // re-read after the dialog closes: the transfer kept running while the user
  // browsed, and the list on screen may no longer be the list it started with.
  const handleAddPicked = async (mode: PickMode) => {
    const target = active;
    if (!target?.plan) return;

    const picked = await pickPathsFromDisk(mode, lang);
    if (picked.length === 0) return;

    const inspected = await fsEngine.inspectPaths(picked);
    if (!inspected) {
      setListNote(t.transferAddFailed);
      return;
    }

    const current = taskQueue.getPlan(target.id) ?? target.plan;
    const merged = addEntriesToPlan(current, inspected.entries);
    if (merged.added.length === 0) {
      setListNote(t.transferAddNoNew);
      return;
    }

    // The total never shrinks: a folder already measured by the server holds
    // bytes the plan's own sizes cannot reproduce.
    taskQueue.updateTaskMeta(target.id, {
      plan: merged.plan,
      totalBytes: Math.max(target.totalBytes || 0, planFileBytes(merged.plan)),
    });
    setListNote(`${t.transferAddFiles}: +${merged.added.length}`);
  };

  const handleSaveList = async () => {
    if (!active?.plan) return;
    setListNote(t.transferSaveList + '�');
    try {
      const result = await fsEngine.saveCopyList([active.plan]);
      setListNote(result ? `${t.transferSaveList}: ${result.path}` : t.transferSaveList);
    } catch {
      setListNote(t.transferSaveList);
    }
  };

  const handleLoadList = async () => {
    try {
      const result = await fsEngine.loadCopyList();
      if (result?.found && result.list?.length) {
        onLoadCopyList?.(result.list);
        setListNote(`${t.transferLoadList}: ${result.list.length}`);
      } else {
        setListNote(t.transferLoadList);
      }
    } catch {
      setListNote(t.transferLoadList);
    }
  };

  // Honour the "when finished" choice as soon as the transfer reaches a terminal
  // state. Staying open is the default because a window that vanishes on its own
  // reads as a crash, not as success.
  useEffect(() => {
    if (!task || !isFinished) {
      setFinishedPrompt(false);
      return;
    }
    if (afterFinish === 'close') {
      const id = window.setTimeout(() => onClose(), 1200);
      return () => window.clearTimeout(id);
    }
    if (afterFinish === 'ask' && task.status === 'completed') setFinishedPrompt(true);
    return;
  }, [task?.status, afterFinish, isFinished]);

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
    throttleBps: speedLimitMb > 0 ? Math.round(speedLimitMb * 1024 * 1024) : 0,
  });

  // Confirming can be asynchronous: the app measures the destination volume
  // before it starts, and a transfer that does not fit opens its own window
  // instead of starting. The dialog waits for that answer and only closes when
  // no task was started.
  const submittingRef = useRef(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destPath.trim() || submittingRef.current) return;
    submittingRef.current = true;
    soundManager.playDiskAccess();
    try {
      const started = await onConfirm(destPath.trim(), submitOptions());
      if (started) setTaskId(started);
      else onClose();
    } finally {
      submittingRef.current = false;
    }
  };

  const dialogRef = useModalDialog<HTMLDivElement>(t.copyMoveModalTitle);

  // Idle = opened from the pill, no items in hand. Show the monitor instead of
  // the form, so this single window is both the transfer list and the form.
  const idle = !task && items.length === 0;

  // Shared tabbed monitor block (list / errors / options).
  const renderTabs = () => (
    <>
      <div
        className="flex items-end gap-0 px-[var(--space-3)] pt-2 shrink-0 border-b"
        style={{ borderColor: theme.modalBorder }}
      >
        {(['list', 'errors', 'options'] as Tab[]).map((tabKey) => {
          const label =
            tabKey === 'list' ? t.transferTabList : tabKey === 'errors' ? t.transferTabErrors : t.transferTabOptions;
          const activeTab = tab === tabKey;
          return (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className="px-[var(--space-3)] py-[var(--space-1)] text-[11px] font-bold rounded-t cursor-pointer border-t border-x"
              style={{
                backgroundColor: activeTab ? theme.modalBg : theme.modalHeaderBg,
                borderColor: theme.modalBorder,
                color: theme.itemText,
                opacity: activeTab ? 1 : 0.65,
                marginBottom: activeTab ? '-1px' : '0',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-[var(--space-3)] text-[11px]">
        {tab === 'list' && (
          <div className="flex flex-col gap-[var(--space-3)]">
            {active?.plan?.entries?.length ? (
              <div className="flex flex-col gap-[var(--space-1)]">
                <div className="flex items-center gap-[var(--space-2)] text-[10px]">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set((active?.plan?.entries || []).map((_, i) => i)))}
                    disabled={!active?.plan?.entries?.length}
                    className="px-[var(--space-2)] py-[var(--space-1)] border border-white/20 rounded cursor-pointer disabled:opacity-40"
                  >
                    {t.transferSelectAll}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        new Set((active?.plan?.entries || []).map((_, i) => i).filter((i) => !selected.has(i))),
                      )
                    }
                    disabled={!active?.plan?.entries?.length}
                    className="px-[var(--space-2)] py-[var(--space-1)] border border-white/20 rounded cursor-pointer disabled:opacity-40"
                  >
                    {t.transferSelectInvert}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!active?.plan?.entries) return;
                      const next = active.plan.entries.filter((_, i) => !selected.has(i));
                      taskQueue.updateTaskMeta(active.id, {
                        plan: { ...active.plan, entries: next },
                        totalBytes: next.reduce((a, e) => a + (e.isDirectory ? 0 : e.size), 0),
                      });
                      setSelected(new Set());
                    }}
                    disabled={selected.size === 0}
                    className="px-[var(--space-2)] py-[var(--space-1)] border border-rose-500/50 rounded text-rose-300 cursor-pointer disabled:opacity-40"
                  >
                    {t.transferRemoveSelected}
                  </button>
                  {canPickPaths() && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleAddPicked('files')}
                        className="px-[var(--space-2)] py-[var(--space-1)] border border-emerald-500/50 rounded text-emerald-200 cursor-pointer"
                      >
                        {t.transferAddFiles}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAddPicked('folders')}
                        className="px-[var(--space-2)] py-[var(--space-1)] border border-emerald-500/50 rounded text-emerald-200 cursor-pointer"
                      >
                        {t.transferAddFolder}
                      </button>
                    </>
                  )}
                  <span className="opacity-60 ml-auto">{selected.size > 0 ? `${selected.size} selected` : ''}</span>
                </div>
                <div className="flex items-center gap-[var(--space-2)] text-[10px]">
                  <span className="opacity-60">{t.sortBy}</span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) sortEntries(e.target.value as 'path' | 'name' | 'size');
                      e.target.value = '';
                    }}
                    disabled={active.status !== 'queued'}
                    className="bg-black/50 border border-white/30 rounded px-[var(--space-1)].5 py-[var(--space-1)] text-white font-mono text-[10px] cursor-pointer disabled:opacity-40"
                  >
                    <option value="">{t.sortBy}</option>
                    <option value="path">{t.transferColSource}</option>
                    <option value="name">{t.transferColTask}</option>
                    <option value="size">{t.transferColSize}</option>
                  </select>
                </div>
                <div
                  className="grid gap-[var(--space-1)] text-[10px] font-bold opacity-60"
                  style={{ gridTemplateColumns: '1.5rem 1.25rem 1fr 4.5rem 1fr 1.25rem' }}
                >
                  <div />
                  <div />
                  <div>{t.transferColSource}</div>
                  <div>{t.transferColSize}</div>
                  <div>{t.transferColDest}</div>
                  <div />
                </div>
                {active.plan.entries.map((entry, index) => (
                  <div
                    key={`${entry.path}-${index}`}
                    className="grid gap-[var(--space-1)] items-center text-[11px]"
                    style={{ gridTemplateColumns: '1.5rem 1.25rem 1fr 4.5rem 1fr 1.25rem' }}
                  >
                    <span className="opacity-50">{index + 1}.</span>
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(index);
                        else next.delete(index);
                        setSelected(next);
                      }}
                      className="cursor-pointer"
                    />
                    <span className="truncate font-mono" title={entry.path}>
                      {entry.path}
                    </span>
                    <span className="opacity-80">{formatBytes(entry.size)}</span>
                    <span className="truncate font-mono opacity-80" title={active.plan!.targetDir}>
                      {active.plan!.targetDir}
                    </span>
                    <span className="flex items-center gap-[var(--space-1)]">
                      {active.status === 'queued' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => moveEntryTop(index)}
                            disabled={index === 0}
                            className="cursor-pointer disabled:opacity-30"
                            aria-label={t.moveTop}
                          >
                            T
                          </button>
                          <button
                            type="button"
                            onClick={() => moveEntry(index, -1)}
                            disabled={index === 0}
                            className="cursor-pointer disabled:opacity-30"
                            aria-label={t.moveUp}
                          >
                            U
                          </button>
                          <button
                            type="button"
                            onClick={() => moveEntry(index, 1)}
                            disabled={index === active.plan!.entries.length - 1}
                            className="cursor-pointer disabled:opacity-30"
                            aria-label={t.moveDown}
                          >
                            D
                          </button>
                          <button
                            type="button"
                            onClick={() => moveEntryBottom(index)}
                            disabled={index === active.plan!.entries.length - 1}
                            className="cursor-pointer disabled:opacity-30"
                            aria-label={t.moveBottom}
                          >
                            B
                          </button>
                          <button
                            type="button"
                            onClick={() => removeEntry(index)}
                            className="text-rose-300 hover:text-rose-100 cursor-pointer"
                            aria-label={t.btnCancel}
                          >
                            X
                          </button>
                        </>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="opacity-60">{t.bgTasksEmpty}</div>
            )}

            {transfers.length > 1 && (
              <div className="border-t border-white/10 pt-2 flex flex-col gap-[var(--space-1)]">
                <div className="text-[10px] font-bold uppercase opacity-60">{t.taskQueueShort}</div>
                {transfers.map((entry, index) => (
                  <div key={entry.id} className="flex items-center gap-[var(--space-2)] text-[11px]">
                    <span className="w-4 shrink-0 opacity-50">{index + 1}.</span>
                    {entry.type === 'move' ? (
                      <Scissors className="w-3 h-3 shrink-0" />
                    ) : entry.type === 'delete' ? (
                      <span className="shrink-0">?</span>
                    ) : (
                      <Copy className="w-3 h-3 shrink-0" />
                    )}
                    <span className="flex-1 truncate" title={entry.title}>
                      {entry.title}
                    </span>
                    <span className="uppercase opacity-70">{entry.status}</span>
                    <span className="tabular-nums shrink-0">{entry.progress}%</span>
                    <button
                      type="button"
                      onClick={() => taskQueue.cancelTask(entry.id)}
                      className="text-rose-300 hover:text-rose-100 cursor-pointer shrink-0"
                      aria-label={t.btnCancel}
                    >
                      ?
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-[var(--space-2)] pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleSaveList}
                disabled={!active?.plan}
                className="px-[var(--space-3)] py-[var(--space-1)] border border-white/20 rounded cursor-pointer disabled:opacity-40"
              >
                {t.transferSaveList}
              </button>
              <button
                type="button"
                onClick={handleLoadList}
                className="px-[var(--space-3)] py-[var(--space-1)] border border-white/20 rounded cursor-pointer"
              >
                {t.transferLoadList}
              </button>
              {listNote && (
                <span className="text-[10px] opacity-70 truncate" title={listNote}>
                  {listNote}
                </span>
              )}
            </div>
          </div>
        )}

        {tab === 'errors' && (
          <div className="flex flex-col gap-[var(--space-2)]">
            <div className="flex items-center justify-between">
              <span className="font-bold opacity-60">{t.transferTabErrors}</span>
              <div className="flex items-center gap-[var(--space-2)]">
                <button
                  type="button"
                  onClick={handleSaveLog}
                  disabled={log.length === 0}
                  className="px-[var(--space-2)] py-[var(--space-1)] border border-white/20 rounded cursor-pointer disabled:opacity-40"
                >
                  {t.transferLogSave}
                </button>
                <button
                  type="button"
                  onClick={clearLog}
                  disabled={log.length === 0}
                  className="px-[var(--space-2)] py-[var(--space-1)] border border-white/20 rounded cursor-pointer disabled:opacity-40"
                >
                  {t.transferLogClear}
                </button>
              </div>
            </div>
            {log.length === 0 ? (
              <div className="opacity-60">{t.transferLogEmpty}</div>
            ) : (
              <div className="flex flex-col gap-[var(--space-2)]">
                {log.map((entry) => (
                  <div
                    key={entry.key}
                    className="border border-rose-500/30 rounded p-[var(--space-2)]"
                    title={entry.title}
                  >
                    <div className="flex items-center gap-[var(--space-2)] text-[10px] opacity-70">
                      <span>{entry.time}</span>
                      <span className="truncate">{entry.title}</span>
                    </div>
                    <div className="text-rose-300 break-all">{entry.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'options' && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <div>
              <label className="block font-bold text-white mb-[var(--space-1)]" htmlFor="monitorSpeedSelect">
                {t.speedLimit}
              </label>
              <div className="flex items-center gap-[var(--space-3)]">
                <input
                  id="monitorSpeedSelect"
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={currentSpeedMb}
                  disabled={!canControl}
                  onChange={(e) => applySpeed(Number(e.target.value))}
                  className="flex-1 cursor-pointer disabled:opacity-40"
                />
                <span className="shrink-0 tabular-nums text-[11px] opacity-80 w-16 text-right">
                  {currentSpeedMb === 0 ? t.speedUnlimited : `${currentSpeedMb} MB/s`}
                </span>
              </div>
            </div>
            <div>
              <label className="block font-bold text-white mb-[var(--space-1)]" htmlFor="monitorAfterFinishSelect">
                {t.afterFinishLabel}
              </label>
              <select
                id="monitorAfterFinishSelect"
                value={afterFinish}
                onChange={(e) => chooseAfterFinish(e.target.value as AfterFinish)}
                className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none cursor-pointer"
              >
                <option value="stay">{t.afterFinishStay}</option>
                <option value="close">{t.afterFinishClose}</option>
                <option value="ask">{t.afterFinishAsk}</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );

  // Render directly without intermediate content variable
  return (
    <ModalShell
      title={idle ? t.taskQueueShort : isCopy ? t.copyTitle : t.moveTitle}
      theme={theme}
      onClose={onClose}
      closeButtonLabel={t.btnCancel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="font-mono select-none"
        onKeyDownCapture={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || taskId) return;
          if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
          event.preventDefault();
          formRef.current?.requestSubmit();
        }}
      >
        {/* Folded strip */}
        {folded && (
          <div
            className="px-[var(--space-3)] py-[var(--space-2)] text-[11px] opacity-80 border-b shrink-0"
            style={{ borderColor: theme.modalBorder }}
          >
            {active ? active.speed || t.inProgress : t.bgTasksEmpty}
          </div>
        )}

        {/* Idle monitor view: no items in hand. */}
        {idle && !folded && (
          <>
            {active && (
              <div
                className="p-[var(--space-3)] flex flex-col gap-[var(--space-2)] border-b shrink-0"
                style={{ borderColor: theme.modalBorder }}
              >
                <div className="flex items-center justify-between gap-[var(--space-2)]">
                  <span className="font-bold text-[12px] truncate" title={active.title}>
                    {active.title}
                  </span>
                  <span className="font-bold text-cyan-400 shrink-0">{active.progress}%</span>
                </div>
                <RetroProgressBar
                  percent={active.progress}
                  theme={theme}
                  status={active.status}
                  color="#fbbf24"
                  className="text-[16px] leading-none"
                />
                {active.currentFile && (
                  <div className="flex flex-col gap-[var(--space-1)]">
                    <div className="flex items-center justify-between gap-[var(--space-2)] text-[10px] opacity-70">
                      <span className="truncate font-mono" title={active.currentFile}>
                        {active.currentFile}
                      </span>
                      {active.currentFileTotal ? (
                        <span className="shrink-0 tabular-nums">
                          {Math.round(((active.currentFileBytes || 0) / active.currentFileTotal) * 100)}%
                        </span>
                      ) : null}
                    </div>
                    <RetroProgressBar
                      percent={
                        active.currentFileTotal
                          ? Math.round(((active.currentFileBytes || 0) / active.currentFileTotal) * 100)
                          : active.progress
                      }
                      theme={theme}
                      status={active.status}
                      color="#fbbf24"
                      className="text-[11px] leading-none"
                    />
                  </div>
                )}
                <div className="text-[11px] opacity-80 break-all">
                  {active.status === 'failed' && active.error ? (
                    <span className="text-rose-400 font-bold">{active.error}</span>
                  ) : (
                    <>
                      {active.speed || t.inProgress}
                      {active.etaSeconds != null && active.etaSeconds > 0
                        ? ` � ${t.etaLabel} ${active.etaSeconds}s`
                        : ''}
                    </>
                  )}
                </div>
                {(active.status === 'running' || active.status === 'paused') && (
                  <div className="flex items-center gap-[var(--space-2)] text-[12px]">
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playKeyTick();
                        if (active.status === 'paused') taskQueue.resumeTask(active.id);
                        else taskQueue.pauseTask(active.id);
                      }}
                      className="px-[var(--space-3)] py-[var(--space-1)] border border-cyan-500/60 rounded text-cyan-300 hover:bg-cyan-950/60 cursor-pointer font-bold"
                    >
                      {active.status === 'paused' ? t.bgTasksResume : t.bgTasksPause}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playKeyTick();
                        taskQueue.cancelTask(active.id);
                      }}
                      className="px-[var(--space-3)] py-[var(--space-1)] border border-rose-500/60 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer font-bold"
                    >
                      {t.btnCancel}
                    </button>
                  </div>
                )}
              </div>
            )}
            {renderTabs()}
            <div
              className="flex items-center justify-between gap-[var(--space-2)] p-[var(--space-3)] border-t shrink-0"
              style={{ borderColor: theme.modalBorder }}
            >
              <button
                type="button"
                onClick={() => {
                  soundManager.playKeyTick();
                  onClose();
                }}
                className="px-[var(--space-3)] py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
              >
                {t.copyTitle}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-[var(--space-3)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
              >
                {t.btnCancel} (Esc)
              </button>
            </div>
          </>
        )}

        {/* Configuration form, replaced by the live progress view once started */}
        {!idle && !task && (
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="p-[var(--space-4)] flex flex-col gap-[var(--space-4)] min-h-0 flex-1 overflow-y-auto"
          >
            <div className="flex flex-col min-h-0 flex-1">
              <span className="opacity-75 block mb-[var(--space-1)]">
                {isCopy
                  ? t.copyItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())
                  : t.moveItemsLead.replace('{n}', String(items.length)).replace('{size}', totalSize.toLocaleString())}
              </span>
              <div className="flex-1 min-h-16 overflow-y-auto bg-black/40 p-[var(--space-2)] rounded border border-white/10 text-[11px]">
                {items.map((i) => (
                  <div key={i.id} className="truncate text-amber-300">
                    � {i.name}
                    {i.ext ? `.${i.ext}` : ''} {i.isDirectory ? '<DIR>' : ''}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-bold text-white mb-[var(--space-1)]">{t.copyMoveDestLabel}</label>
              <input
                type="text"
                ref={destInputRef}
                value={destPath}
                onChange={(e) => setDestPath(e.target.value)}
                className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none"
                autoFocus
              />
            </div>

            {/* What to do when the destination entry already exists. */}
            <div>
              <span className="block font-bold text-white mb-[var(--space-1)]">{t.collisionPolicy}</span>
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1"
                role="radiogroup"
                aria-label={t.collisionPolicy}
              >
                {COLLISION_OPTIONS.map(([value, labelKey]) => (
                  <label key={value} className="flex items-center gap-[var(--space-2)] cursor-pointer opacity-90">
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
              <label className="block font-bold text-white mb-[var(--space-1)]" htmlFor="speedLimitSelect">
                {t.speedLimit}
              </label>
              <select
                id="speedLimitSelect"
                value={speedLimitMb}
                onChange={(e) => setSpeedLimitMb(Number(e.target.value))}
                className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none cursor-pointer"
              >
                <option value={0}>{t.speedUnlimited}</option>
                {SPEED_OPTIONS_MB.map((mb) => (
                  <option key={mb} value={mb}>
                    {mb} MB/s
                  </option>
                ))}
              </select>
            </div>

            {/* What happens once the transfer is over. Remembered, because nobody
              wants to re-pick this before every copy. */}
            <div>
              <label className="block font-bold text-white mb-[var(--space-1)]" htmlFor="afterFinishSelect">
                {t.afterFinishLabel}
              </label>
              <select
                id="afterFinishSelect"
                value={afterFinish}
                onChange={(e) => {
                  const next = e.target.value as AfterFinish;
                  setAfterFinish(next);
                  try {
                    localStorage.setItem(AFTER_FINISH_KEY, next);
                  } catch {
                    // A full quota costs the reminder, never the transfer.
                  }
                }}
                className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] text-white font-mono text-xs focus:ring-1 focus:ring-amber-400 outline-none cursor-pointer"
              >
                <option value="stay">{t.afterFinishStay}</option>
                <option value="close">{t.afterFinishClose}</option>
                <option value="ask">{t.afterFinishAsk}</option>
              </select>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-[var(--space-2)] pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={onClose}
                className="px-[var(--space-4)] py-[var(--space-2)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
              >
                {t.btnCancel} (Esc)
              </button>
              <button
                type="submit"
                autoFocus
                className="px-5 py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
              >
                {isCopy ? t.copyConfirm : t.moveConfirm}
              </button>
            </div>
          </form>
        )}

        {/* Live progress view */}
        {!idle && task && (
          <div className="p-[var(--space-4)] flex flex-col gap-[var(--space-3)] min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between gap-[var(--space-2)]">
              <span className="font-bold text-[13px] truncate" title={task.title}>
                {task.title}
              </span>
              <span className="font-bold text-cyan-400 shrink-0">{task.progress}%</span>
            </div>

            <RetroProgressBar
              percent={task.progress}
              theme={theme}
              status={task.status}
              color="#fbbf24"
              className="text-[18px] leading-none"
            />

            {task.currentFile && (
              <div className="flex flex-col gap-[var(--space-1)]">
                <div className="flex items-center justify-between gap-[var(--space-2)] text-[11px] opacity-80">
                  <span className="truncate font-mono" title={task.currentFile}>
                    {task.currentFile}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {task.currentFileBytes != null && task.currentFileTotal
                      ? `${Math.round((task.currentFileBytes / task.currentFileTotal) * 100)}%`
                      : ''}
                  </span>
                </div>
                <RetroProgressBar
                  percent={
                    task.currentFileTotal
                      ? Math.round(((task.currentFileBytes || 0) / task.currentFileTotal) * 100)
                      : task.progress
                  }
                  theme={theme}
                  status={task.status}
                  color="#fbbf24"
                  className="text-[12px] leading-none"
                />
              </div>
            )}

            {task.status === 'running' && task.progress === 0 && (
              <div className="text-[11px] text-amber-300 font-bold animate-pulse">{t.searchScanning}</div>
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
                  {task.etaSeconds != null && task.etaSeconds > 0 ? ` � ${t.etaLabel} ${task.etaSeconds}s` : ''}
                </>
              )}
            </div>

            {(task.status === 'running' || task.status === 'paused') && (
              <div className="flex items-center gap-[var(--space-2)] text-[12px]">
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playKeyTick();
                    if (task.status === 'paused') taskQueue.resumeTask(task.id);
                    else taskQueue.pauseTask(task.id);
                  }}
                  className="px-[var(--space-3)] py-[var(--space-1)] border border-cyan-500/60 rounded text-cyan-300 hover:bg-cyan-950/60 cursor-pointer font-bold"
                >
                  {task.status === 'paused' ? t.bgTasksResume : t.bgTasksPause}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playKeyTick();
                    taskQueue.cancelTask(task.id);
                  }}
                  className="px-[var(--space-3)] py-[var(--space-1)] border border-rose-500/60 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer font-bold"
                >
                  {t.btnCancel}
                </button>
              </div>
            )}

            {otherTasks.length > 0 && (
              <div className="border-t border-current/20 pt-2 flex flex-col gap-[var(--space-2)]">
                <div className="text-[10px] font-bold uppercase opacity-60">{t.taskQueueShort}</div>
                {otherTasks.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-[var(--space-2)] text-[11px]">
                    <span className="w-14 shrink-0 uppercase opacity-60">{entry.status}</span>
                    <span className="flex-1 truncate font-mono" title={entry.title}>
                      {entry.title}
                    </span>
                    <span className="tabular-nums shrink-0 opacity-80">{entry.progress}%</span>
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playKeyTick();
                        taskQueue.cancelTask(entry.id);
                      }}
                      aria-label={t.btnCancel}
                      title={t.btnCancel}
                      className="px-[var(--space-1)].5 py-[var(--space-1)] border border-rose-500/50 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer shrink-0"
                    >
                      ?
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAdmin && (window as any).electronAPI?.relaunchAsAdmin && (
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
                className={`flex items-center justify-center gap-[var(--space-2)] w-full px-[var(--space-2)] py-[var(--space-1)] rounded border font-bold text-[12px] cursor-pointer ${
                  needsAdmin
                    ? 'border-amber-400 text-amber-300 bg-amber-950/50 hover:bg-amber-900/70'
                    : 'border-amber-700/50 text-amber-500/80 hover:bg-amber-950/40'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {t.runAsAdmin}
              </button>
            )}

            {adminNote && <div className="text-[11px] text-amber-300 break-all">{adminNote}</div>}

            {finishedPrompt && (
              <div className="border border-amber-400/60 bg-amber-950/40 rounded p-[var(--space-2)] flex flex-col gap-[var(--space-2)]">
                <span className="text-[11px] font-bold text-amber-300">
                  {isCopy ? t.msgCopiedSuccess : t.msgMovedSuccess}
                </span>
                <div className="flex items-center gap-[var(--space-2)]">
                  <button
                    type="button"
                    onClick={() => {
                      setFinishedPrompt(false);
                      onClose();
                    }}
                    className="px-[var(--space-3)] py-[var(--space-1)] bg-amber-400 hover:bg-amber-300 text-black font-bold rounded cursor-pointer"
                  >
                    {t.btnClose}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFinishedPrompt(false)}
                    className="px-[var(--space-3)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
                  >
                    {t.afterFinishStay}
                  </button>
                </div>
              </div>
            )}

            {!folded && renderTabs()}

            <div className="flex items-center justify-end gap-[var(--space-2)] pt-2 border-t border-white/10 mt-auto">
              {isFinished && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-[var(--space-4)] py-[var(--space-2)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
                >
                  {t.btnClose}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
