import React from 'react';
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { fsEngine, CleanupRun, CleanupScan, CleanupTargetId } from '../../services/fileSystem';
import { soundManager } from '../../services/soundEffects';
import { cleanupTargetLabel } from '../../utils/cleanupTargets';

import { useModalDialog } from '../../hooks/useModalDialog';
import ModalShell from '../ModalShell';

/** Age filters offered for the cleanup, in days (0 = everything). */
const AGE_CHOICES: Array<{ days: number; key: string }> = [
  { days: 0, key: 'cleanupAgeAll' },
  { days: 1, key: 'cleanupAge1' },
  { days: 7, key: 'cleanupAge7' },
  { days: 30, key: 'cleanupAge30' },
];

type Phase = 'scanning' | 'ready' | 'confirming' | 'running' | 'done' | 'error';

interface CleanupModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  /** Folder picked in the toolbar menu; the server resolves its real path. */
  target: CleanupTargetId;
  onClose: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

/**
 * Empties one disposable folder. It always measures before it deletes, shows
 * what that measurement found, and asks once more before touching anything: the
 * removal is not recoverable through the Recycle Bin. Entries another program
 * holds on to are reported instead of failing the run.
 */
export const CleanupModal: React.FC<CleanupModalProps> = ({ theme, lang, target, onClose }) => {
  const t = getTranslations(lang);
  const [phase, setPhase] = React.useState<Phase>('scanning');
  const [minAgeDays, setMinAgeDays] = React.useState(0);
  const [scan, setScan] = React.useState<CleanupScan | null>(null);
  const [run, setRun] = React.useState<CleanupRun | null>(null);
  const [errorText, setErrorText] = React.useState('');
  const [scanTick, setScanTick] = React.useState(0);

  const dialogRef = useModalDialog<HTMLDivElement>(t.cleanupTitle);

  // Measuring is the only thing that happens on its own; `scanTick` re-runs it on
  // demand after a cleanup or when the user asks for a fresh count.
  React.useEffect(() => {
    let cancelled = false;
    setPhase('scanning');
    fsEngine
      .scanCleanup(target, minAgeDays)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setErrorText(fsEngine.lastServerError);
          setPhase('error');
          return;
        }
        setScan(result);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorText(error instanceof Error ? error.message : '');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [target, minAgeDays, scanTick]);

  const runCleanup = async () => {
    setPhase('running');
    soundManager.playKeyTick();
    try {
      const result = await fsEngine.runCleanup(target, minAgeDays);
      if (!result) {
        setErrorText(fsEngine.lastServerError);
        setPhase('error');
        return;
      }
      setRun(result);
      setPhase('done');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '');
      setPhase('error');
    }
  };

  const pending = scan ? scan.files + scan.dirs : 0;
  const pendingSize = scan ? formatBytes(scan.bytes) : '';

  const primaryButton =
    'px-[var(--space-3)] py-[var(--space-1)].5 rounded border text-xs font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <ModalShell title={t.cleanupTitle} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
      <div ref={dialogRef} tabIndex={-1} className="font-mono select-none">
        <div className="space-y-[var(--space-3)]">
          <div className="flex items-center justify-between gap-[var(--space-2)]">
            <span className="font-bold text-amber-300 text-sm">{cleanupTargetLabel(target, t)}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-60">{t.cleanupFilterLabel}</span>
          </div>

          {phase === 'scanning' && (
            <div className="flex items-center gap-[var(--space-2)] text-white/70 py-[var(--space-4)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.cleanupScanning}
            </div>
          )}

          {phase === 'error' && (
            <div className="border border-red-500/40 bg-red-900/20 rounded p-[var(--space-3)] space-y-1">
              <div className="flex items-center gap-[var(--space-2)] text-red-300 font-bold">
                <AlertTriangle className="w-4 h-4" />
                {t.cleanupScanFailed}
              </div>
              {errorText && <div className="text-xs opacity-80 break-all">{errorText}</div>}
            </div>
          )}

          {(phase === 'ready' || phase === 'confirming' || phase === 'running') && scan && (
            <>
              <div className="text-[10px] opacity-60 break-all" title={scan.path}>
                {scan.path}
              </div>

              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                {AGE_CHOICES.map((choice) => (
                  <button
                    key={choice.key}
                    onClick={() => setMinAgeDays(choice.days)}
                    disabled={phase === 'running'}
                    className={`px-[var(--space-2)] py-[var(--space-1)] rounded border text-[10px] cursor-pointer ${
                      minAgeDays === choice.days
                        ? 'bg-amber-500/30 border-amber-400/70 text-white'
                        : 'border-white/20 opacity-70'
                    }`}
                  >
                    {t[choice.key]}
                  </button>
                ))}
              </div>

              <div className="border border-white/10 rounded bg-black/40 p-[var(--space-3)] space-y-1">
                <div className="text-white font-bold">
                  {pending === 0
                    ? t.cleanupNothing
                    : t.cleanupSummary
                        .replace('{files}', String(scan.files))
                        .replace('{dirs}', String(scan.dirs))
                        .replace('{size}', pendingSize)}
                </div>
                {scan.skipped > 0 && (
                  <div className="text-[10px] opacity-60">{t.cleanupSkipped.replace('{n}', String(scan.skipped))}</div>
                )}
                {scan.truncated && <div className="text-[10px] text-amber-300">{t.cleanupTruncated}</div>}
              </div>

              {scan.largest.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-amber-300">{t.cleanupLargest}</div>
                  <div className="border border-white/10 rounded bg-black/40 divide-y divide-white/5">
                    {scan.largest.map((item) => (
                      <div
                        key={item.name}
                        className="flex justify-between gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] text-xs"
                      >
                        <span className="truncate opacity-80">{item.name}</span>
                        <span className="tabular-nums text-amber-300 shrink-0">{formatBytes(item.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {phase === 'confirming' && (
                <div className="border border-red-500/50 bg-red-900/20 rounded p-[var(--space-3)] text-xs text-red-200">
                  {t.cleanupConfirm
                    .replace('{files}', String(scan.files))
                    .replace('{dirs}', String(scan.dirs))
                    .replace('{size}', pendingSize)}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-[var(--space-2)] pt-[var(--space-1)]">
                {phase === 'confirming' ? (
                  <>
                    <button
                      onClick={runCleanup}
                      className={`${primaryButton} bg-red-600/40 border-red-400/70 text-white`}
                    >
                      {t.cleanupConfirmYes}
                    </button>
                    <button onClick={() => setPhase('ready')} className={`${primaryButton} border-white/20 opacity-80`}>
                      {t.btnCancel}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setPhase('confirming')}
                      disabled={pending === 0 || phase === 'running'}
                      className={`${primaryButton} flex items-center gap-[var(--space-2)] ${
                        pending === 0 ? 'border-white/20' : 'bg-red-600/30 border-red-400/60 text-white'
                      }`}
                    >
                      {phase === 'running' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      {phase === 'running' ? t.cleanupRunning : t.cleanupRun}
                    </button>
                    <button
                      onClick={() => setScanTick((x) => x + 1)}
                      disabled={phase === 'running'}
                      className={`${primaryButton} flex items-center gap-[var(--space-2)] border-white/20 opacity-80`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {t.cleanupRescan}
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {phase === 'done' && run && (
            <>
              <div className="border border-emerald-500/40 bg-emerald-900/20 rounded p-[var(--space-3)] space-y-1">
                <div className="text-emerald-300 font-bold">{t.cleanupDone}</div>
                <div className="text-white">{t.cleanupFreed.replace('{size}', formatBytes(run.freedBytes))}</div>
                <div className="text-xs opacity-80">
                  {t.cleanupDeleted
                    .replace('{files}', String(run.deletedFiles))
                    .replace('{dirs}', String(run.deletedDirs))}
                </div>
                {run.skipped > 0 && (
                  <div className="text-[10px] opacity-60">{t.cleanupSkipped.replace('{n}', String(run.skipped))}</div>
                )}
                {run.truncated && <div className="text-[10px] text-amber-300">{t.cleanupTruncated}</div>}
              </div>

              {run.failedCount > 0 && (
                <div className="border border-amber-500/40 bg-amber-900/20 rounded p-[var(--space-3)] space-y-1">
                  <div className="text-amber-300 font-bold text-xs">
                    {t.cleanupFailed.replace('{n}', String(run.failedCount))}
                  </div>
                  <div className="space-y-0.5">
                    {run.failed.slice(0, 5).map((entry) => (
                      <div key={entry.path} className="text-[10px] opacity-70 break-all">
                        {entry.path} — {entry.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <button
                  onClick={() => {
                    setRun(null);
                    setScanTick((x) => x + 1);
                  }}
                  className={`${primaryButton} flex items-center gap-[var(--space-2)] border-white/20 opacity-80`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t.cleanupRescan}
                </button>
                <button onClick={onClose} className={`${primaryButton} border-white/20`}>
                  {t.btnClose}
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <div className="flex justify-end">
              <button onClick={onClose} className={`${primaryButton} border-white/20`}>
                {t.btnClose}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
