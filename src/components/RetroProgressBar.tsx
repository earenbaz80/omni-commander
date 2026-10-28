import React, { useEffect, useRef, useState } from 'react';
import { ThemeConfig } from '../services/themeManager';

/**
 * Character-mode progress bar: text cells, the way a DOS-era tool drew one.
 *
 * Rendered as a run of text cells (`████████░░░░░░░░`) so it reads like a
 * character-mode dialog instead of a modern rounded gradient. The bar can fill
 * its container edge to edge: omit `cells` and it measures its own width (and
 * keeps re-measuring on resize) so the layout stays auto-adjusting.
 */

export type RetroProgressStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

interface RetroProgressBarProps {
  /** Completion percentage, 0-100. Out of range and non-finite values are clamped. */
  percent: number;
  theme: ThemeConfig;
  status?: RetroProgressStatus;
  /** Width in character cells. Omit it to auto-fill the container width. */
  cells?: number;
  /** Override the running colour (e.g. amber for a retro bar). */
  color?: string;
  className?: string;
}

const FILLED_CELL = '█';
const EMPTY_CELL = '░';
/** Used before the first measurement lands (and where there is no layout at all, e.g. jsdom). */
const FALLBACK_CELLS = 24;

function fillColorFor(status: RetroProgressStatus, theme: ThemeConfig): string {
  switch (status) {
    case 'completed':
      return theme.exeText;
    case 'paused':
      return theme.docText;
    case 'failed':
    case 'cancelled':
      return theme.isRetro ? '#ff5555' : '#f87171';
    case 'queued':
      return theme.borderPanel;
    default:
      return theme.accent;
  }
}

export const RetroProgressBar: React.FC<RetroProgressBarProps> = ({
  percent,
  theme,
  status = 'running',
  cells,
  color,
  className = '',
}) => {
  const autoFit = typeof cells !== 'number';
  const hostRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [measuredCells, setMeasuredCells] = useState(FALLBACK_CELLS);

  // Auto-fit: work out how many mono characters fit across the container, and
  // redo it whenever the container is resized so the bar always spans 100%.
  useEffect(() => {
    if (!autoFit) return;
    const host = hostRef.current;
    const probe = probeRef.current;
    if (!host || !probe || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const cellWidth = probe.getBoundingClientRect().width;
      const hostWidth = host.clientWidth;
      if (cellWidth > 0 && hostWidth > 0) {
        const next = Math.max(8, Math.floor(hostWidth / cellWidth));
        setMeasuredCells((previous) => (previous === next ? previous : next));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [autoFit]);

  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  const total = Math.max(8, Math.floor(autoFit ? measuredCells : (cells as number)));
  const isQueued = status === 'queued';
  const reservedHead = isQueued ? 1 : 0;
  const filledCount = isQueued ? 0 : Math.round((safePercent / 100) * total);
  const emptyCount = Math.max(0, total - filledCount - reservedHead);
  const fill = color && status === 'running' ? color : fillColorFor(status, theme);
  const emptyStyle: React.CSSProperties = { color: theme.borderPanel, opacity: 0.28 };

  return (
    <div
      ref={hostRef}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safePercent}
      className={`font-mono leading-none whitespace-pre select-none relative ${className}`}
      style={{ color: fill }}
    >
      {/* Invisible one-character probe: its width tells the auto-fit how many cells fit. */}
      {autoFit && (
        <span ref={probeRef} aria-hidden="true" className="absolute left-0 top-0 invisible pointer-events-none">
          {FILLED_CELL}
        </span>
      )}
      {isQueued && (
        <span aria-hidden="true" className="animate-pulse" style={{ color: theme.accent }}>
          {FILLED_CELL}
        </span>
      )}
      <span aria-hidden="true">{FILLED_CELL.repeat(filledCount)}</span>
      <span aria-hidden="true" style={emptyStyle}>
        {EMPTY_CELL.repeat(emptyCount)}
      </span>
    </div>
  );
};

export default RetroProgressBar;
