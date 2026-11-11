import React from 'react';
import { DiskUsageItem, DiskUsageScan, LanguageCode, TreeSizeFailure, TreeSizeProgress } from '../types';
import { getTranslations } from '../i18n/translations';
import { fsEngine } from '../services/fileSystem';
import { formatBytes } from '../utils/formatBytes';

/** Folders rendered per level before the rest are summarised. */
const RENDER_LIMIT = 50;

/** Commands the panel view hands to the function-key bar. */
export interface DiskUsageTreeHandle {
  stop: () => void;
  /** Opens every measured folder at once; a no-op while there is no tree yet. */
  expandAll: () => void;
  collapseAll: () => void;
}

/** What the bar needs to know to enable or grey out its tree keys. */
export interface DiskUsageTreeStatus {
  scanning: boolean;
  hasTree: boolean;
}

/** Paths of every folder below this one, for "expand all". */
function collectFolderPaths(item: DiskUsageItem | DiskUsageScan): string[] {
  const paths: string[] = [];
  for (const sub of item.subFolders ?? []) {
    paths.push(sub.path, ...collectFolderPaths(sub));
  }
  return paths;
}

interface DiskUsageTreeProps {
  lang: LanguageCode;
  driveId: string;
  /** Folder to measure. Changing it stops the running walk and starts another. */
  path: string;
  /** The finished scan, for callers that also show the largest files. */
  onScanChange?: (scan: DiskUsageScan | null) => void;
  /** Filled with the commands the function-key bar drives this tree with. */
  handleRef?: React.RefObject<DiskUsageTreeHandle | null>;
  /** Reports what the bar may enable; the modal ignores it. */
  onStatusChange?: (status: DiskUsageTreeStatus) => void;
}

/**
 * The measured folder hierarchy, with its progress and its stop button. It is
 * the body shared by the disk usage modal and the panel view, so both show the
 * same numbers and the same notices instead of two drifting implementations.
 */
export const DiskUsageTree: React.FC<DiskUsageTreeProps> = ({
  lang,
  driveId,
  path,
  onScanChange,
  handleRef,
  onStatusChange,
}) => {
  const t = getTranslations(lang);
  // A real drive is measured on disk; a virtual one only exists in the engine's
  // own index, which is already complete and needs no scan.
  const scansDisk = fsEngine.isSystemDrive(driveId);

  const [scan, setScan] = React.useState<DiskUsageScan | null>(null);
  const [progress, setProgress] = React.useState<TreeSizeProgress | null>(null);
  const [failure, setFailure] = React.useState<TreeSizeFailure | null>(null);
  const [stopped, setStopped] = React.useState(false);
  const [scanning, setScanning] = React.useState(scansDisk);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  // Lets the Stop button cancel the walk the effect started.
  const abortRef = React.useRef<AbortController | null>(null);
  // Kept in a ref so an inline callback from the caller cannot restart the walk
  // on every render.
  const scanChangeRef = React.useRef(onScanChange);
  React.useEffect(() => {
    scanChangeRef.current = onScanChange;
  }, [onScanChange]);

  React.useEffect(() => {
    if (!scansDisk) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;
    setScanning(true);
    setFailure(null);
    setStopped(false);
    setScan(null);
    setProgress(null);
    scanChangeRef.current?.(null);
    fsEngine
      .getTreeSize(driveId, path, {
        signal: controller.signal,
        // A whole drive takes minutes, so the counters and the folders already
        // measured are shown while the walk is still running.
        onProgress: (update) => {
          if (!cancelled) setProgress(update);
        },
      })
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'ok') {
          setScan(result.tree);
          scanChangeRef.current?.(result.tree);
        } else {
          setFailure(result.reason);
        }
        setScanning(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Only an abort gets here: pressing Stop is not a failed scan.
        setStopped(true);
        setScanning(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [driveId, path, scansDisk]);

  const stopScan = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // The bar can only offer "stop" while a walk is running and expand/collapse
  // once there is a measured tree, so the panel is told what is available.
  React.useEffect(() => {
    onStatusChange?.({ scanning, hasTree: scan !== null });
  }, [onStatusChange, scanning, scan]);

  // Commands for the function-key bar. They read the tree through this render's
  // `scan`, so the handle is refreshed whenever a new one arrives.
  React.useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      stop: stopScan,
      expandAll: () => setExpanded(new Set(scan ? collectFolderPaths(scan) : [])),
      collapseAll: () => setExpanded(new Set()),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, scan, stopScan]);

  const partialFolders = progress?.folders ?? [];

  const tree: DiskUsageItem | DiskUsageScan | null = scansDisk
    ? scan
    : driveId
      ? fsEngine.getFolderSizes(path || 'C:', driveId)
      : null;

  const toggle = (folderPath: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });

  const renderNode = (item: DiskUsageItem | DiskUsageScan, depth = 0, isRoot = false): React.ReactNode => {
    const subFolders = item.subFolders ?? [];
    // The cap applies at every level, root included: a folder with thousands of
    // children would otherwise put the whole tree in the DOM at once.
    const shown = subFolders.slice(0, RENDER_LIMIT);
    const hidden = subFolders.length - shown.length;
    const open = isRoot || expanded.has(item.path);

    return (
      <div key={item.path}>
        <div
          className="flex items-center justify-between gap-[var(--space-2)] text-white hover:bg-white/10 rounded px-[var(--space-1)]"
          style={{ paddingLeft: depth * 12 }}
        >
          <button
            type="button"
            onClick={() => subFolders.length > 0 && toggle(item.path)}
            disabled={subFolders.length === 0}
            aria-expanded={subFolders.length > 0 ? open : undefined}
            className={`flex items-center gap-[var(--space-1)] truncate text-left ${
              subFolders.length > 0 ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <span className="w-3 shrink-0 opacity-70">{subFolders.length > 0 ? (open ? '▾' : '▸') : ' '}</span>
            <span className="truncate">📁 {item.name}</span>
          </button>
          <span className="tabular-nums text-amber-300 shrink-0">
            {formatBytes(item.sizeBytes)} · {item.fileCount} {t.filesCount}
          </span>
        </div>
        {open && shown.map((sub) => renderNode(sub, depth + 1))}
        {open && hidden > 0 && (
          <div className="opacity-50 px-[var(--space-1)]" style={{ paddingLeft: (depth + 1) * 12 + 12 }}>
            {t.diskMoreItems.replace('{n}', String(hidden))}
          </div>
        )}
      </div>
    );
  };

  // Each way a scan can come back empty gets its own sentence: a dead server, a
  // folder that needs administrator rights and a folder that is gone are not
  // the same problem, and the last two used to be reported as the first.
  const failureMessage = (reason: TreeSizeFailure): string => {
    switch (reason) {
      case 'forbidden':
        return t.diskScanForbidden;
      case 'notFound':
        return t.diskScanNotFound;
      case 'refused':
        return t.diskScanRefused;
      default:
        return t.diskScanFailed;
    }
  };

  const treeBody = () => {
    if (failure) return <div className="nc-danger-ink">{failureMessage(failure)}</div>;
    if (!tree) return <div className="opacity-50">{t.diskUsageNoData}</div>;
    return renderNode(tree, 0, true);
  };

  const folderRows = (folders: DiskUsageItem[]) => (
    <ul className="space-y-[2px]">
      {folders.map((folder) => (
        <li key={folder.path} className="flex items-center justify-between gap-[var(--space-2)]">
          <span className="truncate">📁 {folder.name}</span>
          <span className="tabular-nums text-amber-300 shrink-0">
            {formatBytes(folder.sizeBytes)} · {folder.fileCount} {t.filesCount}
          </span>
        </li>
      ))}
    </ul>
  );

  // Shown while the walk is running: how much has been measured, where it is
  // now, and the root folders that are already finished.
  const progressBody = () => (
    <div className="space-y-[var(--space-2)]">
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <span className="text-amber-300 truncate">
          {progress
            ? t.diskScanProgress
                .replace('{n}', progress.entries.toLocaleString())
                .replace('{size}', formatBytes(progress.bytes))
            : t.diskScanning}
        </span>
        <button
          type="button"
          onClick={stopScan}
          className="shrink-0 px-[var(--space-2)] py-[var(--space-1)] rounded border border-amber-400/60 text-amber-300 hover:bg-amber-400/10 cursor-pointer"
        >
          {t.diskScanStop}
        </button>
      </div>
      <div className="h-1.5 rounded bg-black/60 border border-white/15 overflow-hidden">
        <div className="h-full w-1/3 bg-amber-400 animate-pulse" />
      </div>
      {progress?.currentPath && (
        <div className="text-[var(--fs-8)] opacity-60 truncate" title={progress.currentPath}>
          {progress.currentPath}
        </div>
      )}
      {partialFolders.length > 0 && folderRows(partialFolders)}
    </div>
  );

  return (
    <>
      {scan?.truncated && <div className="text-[var(--fs-8)] text-amber-300 mb-1">{t.diskScanTruncated}</div>}
      {stopped && <div className="text-[var(--fs-8)] text-amber-300 mb-1">{t.diskScanStopped}</div>}
      <div className="border border-white/10 rounded overflow-hidden bg-black/40 p-2 text-xs">
        {scanning ? (
          progressBody()
        ) : stopped ? (
          partialFolders.length > 0 ? (
            folderRows(partialFolders)
          ) : (
            <div className="opacity-50">{t.diskUsageNoData}</div>
          )
        ) : (
          treeBody()
        )}
      </div>
    </>
  );
};
