import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_COLUMN_WIDTHS,
  loadColumnWidths,
  saveColumnWidths,
  autoFitWidth,
  COLUMN_WIDTHS_STORAGE_KEY,
} from './columnWidths';

describe('columnWidths', () => {
  beforeEach(() => localStorage.clear());

  it('returns the defaults when nothing is stored', () => {
    expect(loadColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS);
  });

  it('round-trips saved widths', () => {
    saveColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, name: 250 });
    expect(loadColumnWidths().name).toBe(250);
  });

  it('merges partial stored data with the defaults', () => {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({ name: 300 }));
    const widths = loadColumnWidths();
    expect(widths.name).toBe(300);
    expect(widths.ext).toBe(DEFAULT_COLUMN_WIDTHS.ext);
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({ name: 'nope', ext: -5 }));
    const widths = loadColumnWidths();
    expect(widths.name).toBe(DEFAULT_COLUMN_WIDTHS.name);
    expect(widths.ext).toBe(DEFAULT_COLUMN_WIDTHS.ext);
  });

  it('survives corrupt stored data', () => {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, '{not json');
    expect(loadColumnWidths()).toEqual(DEFAULT_COLUMN_WIDTHS);
  });
});

describe('autoFitWidth', () => {
  it('never goes below the minimum', () => {
    expect(autoFitWidth(['a'])).toBe(44);
  });

  it('grows with the longest text', () => {
    const short = autoFitWidth(['abc']);
    const long = autoFitWidth(['a'.repeat(20)]);
    expect(long).toBeGreaterThan(short);
  });

  it('uses the longest of the provided texts', () => {
    expect(autoFitWidth(['a', 'a'.repeat(20), 'ab'])).toBe(autoFitWidth(['a'.repeat(20)]));
  });
});
