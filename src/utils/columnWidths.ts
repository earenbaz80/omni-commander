import { readStored, writeStored, type StoredSpec } from '../services/storage';

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

const isWidths = (value: unknown): value is Partial<Record<ColumnKey, number>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, width]) => {
    // A key this build does not know is not ours to judge; the merge below only
    // reads the ones it does.
    if (!(key in DEFAULT_COLUMN_WIDTHS)) return true;
    return typeof width === 'number' && Number.isFinite(width) && width > 0;
  });
};

const COLUMN_WIDTHS_SPEC: StoredSpec<Partial<Record<ColumnKey, number>>> = {
  fallback: {},
  validate: isWidths,
  version: 1,
};

/**
 * Reads the persisted column widths, falling back to the defaults for any
 * missing, corrupt or invalid entry. Never throws: the versioned reader decides
 * what an unusable value means, and here it means "the defaults".
 */
export function loadColumnWidths(): Record<ColumnKey, number> {
  const stored = readStored(COLUMN_WIDTHS_STORAGE_KEY, COLUMN_WIDTHS_SPEC);
  const result: Record<ColumnKey, number> = { ...DEFAULT_COLUMN_WIDTHS };
  for (const key of Object.keys(DEFAULT_COLUMN_WIDTHS) as ColumnKey[]) {
    const width = stored[key];
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) result[key] = width;
  }
  return result;
}

/** Persists the column widths. A storage failure costs the widths, never the layout. */
export function saveColumnWidths(widths: Partial<Record<ColumnKey, number>>): void {
  writeStored(COLUMN_WIDTHS_STORAGE_KEY, widths, COLUMN_WIDTHS_SPEC.version ?? 1);
}

/**
 * Estimates the width (px) needed to fit the longest of the given texts,
 * using the header's monospace-ish char width. Clamped to the minimum.
 */
export function autoFitWidth(texts: string[], min: number = MIN_COLUMN_WIDTH): number {
  const longest = texts.reduce((max, text) => Math.max(max, text.length), 0);
  return Math.max(min, longest * 7.4 + 22);
}
