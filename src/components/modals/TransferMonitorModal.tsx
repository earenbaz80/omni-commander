import React, { useEffect, useRef, useState } from 'react';
import { Copy, Scissors, Trash2 } from 'lucide-react';
import { BackgroundTask, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { taskQueue } from '../../services/taskQueueManager';
import { fsEngine } from '../../services/fileSystem';
import { readAfterFinishChoice, writeAfterFinishChoice, type AfterFinish } from '../../services/afterFinish';
import { RetroProgressBar } from '../RetroProgressBar';
import ModalShell from '../ModalShell';

interface TransferMonitorModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onNewTransfer: () => void;
  onClose: () => void;
}

const TRANSFER_TYPES: Array<BackgroundTask['type']> = ['copy', 'move', 'delete'];

const SPEED_OPTIONS_MB = [0, 1, 5, 10, 50];

type Tab = 'list' | 'errors' | 'options';

interface LogEntry {
  key: string;
  time: string;
  title: string;
  message: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function TaskIcon({ type }: { type: BackgroundTask['type'] }) {
  if (type === 'move') return <Scissors className="w-3.5 h-3.5" />;
  if (type === 'delete') return <Trash2 className="w-3.5 h-3.5" />;
  return <Copy className="w-3.5 h-3.5" />;
}

/**
 * Everything about transfers in a single window, shaped like the one SuperCopier
 * shows: the running operation on top with its progress, and three pages below
 * for the list, the error log and the options. Folding it down to a bar keeps it
 * out of the way without losing the transfer, which is what minimizing means
 * everywhere else in this app.
 */
export const TransferMonitorModal: React.FC<TransferMonitorModalProps> = ({ theme, lang, onNewTransfer, onClose }) => {
  const t = getTranslations(lang);
  const [tasks, setTasks] = useState<BackgroundTask[]>(() => taskQueue.getTasks());
  const [tab, setTab] = useState<Tab>('list');
  const [folded] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [afterFinish, setAfterFinish] = useState<AfterFinish>(readAfterFinishChoice);
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = taskQueue.subscribe(() => setTasks(taskQueue.getTasks()));
    return unsubscribe;
  }, []);

  // A task only keeps its latest error, so the log accumulates failures as they
  // happen. The dismissed set keeps a cleared entry from coming straight back.
  useEffect(() => {
    setLog((prev) => {
      const next = [...prev];
      let changed = false;
      for (const task of tasks) {
        if (!task.error) continue;
        const key = `${task.id}:${task.error}`;
        if (dismissed.current.has(key)) continue;
        if (next.some((entry) => entry.key === key)) continue;
        next.push({
          key,
          time: new Date().toLocaleTimeString(),
          title: task.title,
          message: task.error,
        });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const transfers = tasks.filter((entry) => TRANSFER_TYPES.includes(entry.type));
  const active =
    transfers.find((entry) => entry.status === 'running') ||
    transfers.find((entry) => entry.status === 'paused') ||
    transfers.find((entry) => entry.status === 'queued');
  const currentSpeedMb = active?.throttleBps ? Math.round(active.throttleBps / (1024 * 1024)) : 0;

  const applySpeed = (mb: number) => {
    if (!active) return;
    const bps = mb * (1024 * 1024);
    taskQueue.updateTaskMeta(active.id, { throttleBps: bps });
    if (active.serverJobId) void fsEngine.setJobThrottle(active.serverJobId, bps);
  };

  const chooseAfterFinish = (next: AfterFinish) => {
    setAfterFinish(next);
    writeAfterFinishChoice(next);
  };

  const clearLog = () => {
    for (const entry of log) dismissed.current.add(entry.key);
    setLog([]);
  };

  const canControl = active?.status === 'running' || active?.status === 'paused';

  return (
    <ModalShell title={t.taskQueueShort} theme={theme} onClose={onClose} closeButtonLabel={t.btnCancel}>
      <div className="font-mono select-none">
        {/* Progress of whatever is running right now, always visible. */}
        {active && (
          <div className="px-[var(--space-3)] pt-2 flex flex-col gap-[var(--space-1)] shrink-0">
            <RetroProgressBar percent={active.progress} theme={theme} status={active.status} />
            <div className="flex items-center justify-between gap-[var(--space-2)] text-[11px] tabular-nums">
              <span className="truncate" title={active.currentFile || active.title}>
                {active.currentFile || active.title}
              </span>
              <span className="shrink-0 font-bold">{active.progress}%</span>
            </div>
          </div>
        )}

        {folded ? (
          <div className="px-[var(--space-3)] py-[var(--space-2)] text-[11px] opacity-70">
            {active ? `${active.speed || t.inProgress}` : t.bgTasksEmpty}
          </div>
        ) : (
          <>
            {/* Pages */}
            <div className="flex items-end gap-[var(--space-1)] px-[var(--space-2)] pt-2 shrink-0">
              {(
                [
                  ['list', t.transferTabList],
                  ['errors', `${t.transferTabErrors}${log.length > 0 ? ` (${log.length})` : ''}`],
                  ['options', t.transferTabOptions],
                ] as Array<[Tab, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    soundManager.playKeyTick();
                    setTab(value);
                  }}
                  className="px-[var(--space-3)] py-[var(--space-1)] border-t border-x rounded-t cursor-pointer text-[11px] font-bold"
                  style={{
                    backgroundColor: tab === value ? theme.modalBg : theme.modalHeaderBg,
                    borderColor: theme.modalBorder,
                    opacity: tab === value ? 1 : 0.65,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-[var(--space-3)] py-[var(--space-2)] border-t flex flex-col gap-[var(--space-1)]"
              style={{ borderColor: theme.modalBorder }}
            >
              {!active && tab === 'list' && transfers.length === 0 && (
                <div className="text-[11px] opacity-70 py-6 text-center">{t.bgTasksEmpty}</div>
              )}

              {tab === 'list' && transfers.length > 0 && (
                <>
                  <div className="grid grid-cols-[1fr_4.5rem_5rem_3rem_1.25rem] gap-[var(--space-2)] text-[10px] uppercase opacity-60 font-bold">
                    <span>{t.transferColTask}</span>
                    <span className="text-right">{t.transferColSize}</span>
                    <span className="text-right">{t.transferColStatus}</span>
                    <span className="text-right">%</span>
                    <span />
                  </div>
                  {transfers.map((entry, index) => (
                    <div
                      key={entry.id}
                      className="grid grid-cols-[1fr_4.5rem_5rem_3rem_1.25rem] gap-[var(--space-2)] items-center text-[11px]"
                    >
                      <span className="flex items-center gap-[var(--space-2)] min-w-0">
                        <span className="opacity-50 tabular-nums shrink-0">{index + 1}.</span>
                        <TaskIcon type={entry.type} />
                        <span className="truncate font-mono" title={entry.title}>
                          {entry.title}
                        </span>
                      </span>
                      <span className="text-right tabular-nums opacity-80">
                        {entry.totalBytes ? formatBytes(entry.totalBytes) : '—'}
                      </span>
                      <span className="text-right uppercase opacity-70 text-[10px]">{entry.status}</span>
                      <span className="text-right tabular-nums font-bold">{entry.progress}%</span>
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playKeyTick();
                          taskQueue.cancelTask(entry.id);
                        }}
                        aria-label={t.btnCancel}
                        title={t.btnCancel}
                        className="px-[var(--space-1)] border border-rose-500/50 rounded text-rose-300 hover:bg-rose-950/60 cursor-pointer text-[10px] leading-4"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}

              {tab === 'errors' && (
                <>
                  <div className="flex items-center justify-between mb-[var(--space-1)]">
                    <span className="text-[10px] uppercase opacity-60 font-bold">{t.transferColTime}</span>
                    <button
                      type="button"
                      onClick={clearLog}
                      disabled={log.length === 0}
                      className="px-[var(--space-2)] py-[var(--space-1)] border border-current/30 rounded cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    >
                      {t.transferLogClear}
                    </button>
                  </div>
                  {log.length === 0 && (
                    <div className="text-[11px] opacity-70 py-6 text-center">{t.transferLogEmpty}</div>
                  )}
                  {log.map((entry) => (
                    <div
                      key={entry.key}
                      className="flex items-start gap-[var(--space-2)] text-[11px]"
                      title={entry.title}
                    >
                      <span className="opacity-60 shrink-0 tabular-nums">{entry.time}</span>
                      <span className="flex-1 break-all text-rose-300">{entry.message}</span>
                    </div>
                  ))}
                </>
              )}

              {tab === 'options' && (
                <>
                  <div>
                    <label className="block font-bold mb-[var(--space-1)]" htmlFor="monitorSpeed">
                      {t.speedLimit}
                    </label>
                    <select
                      id="monitorSpeed"
                      value={currentSpeedMb}
                      disabled={!canControl}
                      onChange={(e) => applySpeed(Number(e.target.value))}
                      className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] font-mono text-xs cursor-pointer disabled:opacity-50 disabled:cursor-default outline-none"
                    >
                      {SPEED_OPTIONS_MB.map((mb) => (
                        <option key={mb} value={mb}>
                          {mb === 0 ? t.speedUnlimited : `${mb} MB/s`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold mb-[var(--space-1)]" htmlFor="monitorAfter">
                      {t.afterFinishLabel}
                    </label>
                    <select
                      id="monitorAfter"
                      value={afterFinish}
                      onChange={(e) => chooseAfterFinish(e.target.value as AfterFinish)}
                      className="w-full bg-black/50 border border-white/30 rounded px-[var(--space-3)] py-[var(--space-2)] font-mono text-xs cursor-pointer outline-none"
                    >
                      <option value="stay">{t.afterFinishStay}</option>
                      <option value="close">{t.afterFinishClose}</option>
                      <option value="ask">{t.afterFinishAsk}</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] border-t shrink-0"
          style={{ borderColor: theme.modalBorder }}
        >
          <button
            type="button"
            onClick={() => {
              soundManager.playKeyTick();
              onNewTransfer();
            }}
            className="px-[var(--space-3)] py-[var(--space-1)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer"
            title="F5"
          >
            {t.copyTitle}
          </button>
          <div className="flex items-center gap-[var(--space-2)]">
            {canControl && active && (
              <>
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
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-[var(--space-3)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
            >
              {t.btnCancel} (Esc)
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
