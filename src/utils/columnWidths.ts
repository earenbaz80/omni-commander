export type ColumnKey = 'name' | 'ext' | 'type' | 'size' | 'date' | 'attr';

export const COLUMN_WIDTHS_STORAGE_KEY = 'nc_col_widths_v1';

/** Minimum width any column can be shrunk to. */
export const MIN_COLUMN_WIDTH = 44;

export const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  name: 160,
  ext: 40,
  type: 114,
  size: 84,
  date: 132,
  attr: 44,
};

/**
 * Reads the persisted column widths, falling back to the defaults for any
 * missing, corrupt or invalid entry. Never throws.
 */
export function loadColumnWidths(): Record<ColumnKey, number> {
  const result: Record<ColumnKey, number> = { ...DEFAULT_COLUMN_WIDTHS };
  try {
    const raw = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) return result;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return result;
    for (const key of Object.keys(DEFAULT_COLUMN_WIDTHS) as ColumnKey[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        result[key] = value;
      }
    }
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS };
  }
  return result;
}

/** Persists the column widths. Silently ignores storage failures. */
export function saveColumnWidths(widths: Partial<Record<ColumnKey, number>>): void {
  try {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* storage unavailable: widths simply won't persist */
  }
}

/**
 * Estimates the width (px) needed to fit the longest of the given texts,
 * using the header's monospace-ish char width. Clamped to the minimum.
 */
export function autoFitWidth(texts: string[], min: number = MIN_COLUMN_WIDTH): number {
  const longest = texts.reduce((max, text) => Math.max(max, text.length), 0);
  return Math.max(min, longest * 7.4 + 22);
}
