import { describe, expect, it } from 'vitest';
import { formatBytes, formatBytesCompact, formatBytesRounded, formatBytesWithTerabytes } from './formatBytes';

/**
 * Every boundary is checked on both sides: the last value of one unit and the
 * first of the next. A formatter that switches one byte early, or that quietly
 * folds terabytes back into gigabytes, reads as correct in the middle of a unit
 * and wrong at the edge.
 */
describe('formatBytes', () => {
  it('switches units at the kilobyte and the megabyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('keeps counting gigabytes past a terabyte', () => {
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1024.0 GB');
  });
});

describe('formatBytesWithTerabytes', () => {
  it('holds back the megabyte unit for small values', () => {
    expect(formatBytesWithTerabytes(800)).toBe('800 B');
    expect(formatBytesWithTerabytes(8192)).toBe('8192 B');
    expect(formatBytesWithTerabytes(1024 * 1024 - 1)).toBe('1048575 B');
    expect(formatBytesWithTerabytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('gives the terabyte its own unit', () => {
    expect(formatBytesWithTerabytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytesWithTerabytes(1024 * 1024 * 1024 * 1024 - 1)).toBe('1024.0 GB');
    expect(formatBytesWithTerabytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    expect(formatBytesWithTerabytes(1.5 * 1024 * 1024 * 1024 * 1024)).toBe('1.5 TB');
  });
});

describe('formatBytesRounded', () => {
  it('keeps a decimal below ten and rounds from ten', () => {
    expect(formatBytesRounded(0)).toBe('0.0 B');
    expect(formatBytesRounded(6)).toBe('6.0 B');
    expect(formatBytesRounded(1536)).toBe('1.5 KB');
    // The switch is on the scaled value: 10239 bytes is 9.999 KB, which still
    // takes the decimal, while 10240 is ten whole kilobytes and is rounded.
    expect(formatBytesRounded(10239)).toBe('10.0 KB');
    expect(formatBytesRounded(10240)).toBe('10 KB');
    expect(formatBytesRounded(15872)).toBe('16 KB');
  });

  it('counts terabytes and caps the unit there', () => {
    expect(formatBytesRounded(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytesRounded(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    expect(formatBytesRounded(2 * 1024 * 1024 * 1024 * 1024)).toBe('2.0 TB');
    expect(formatBytesRounded(10 * 1024 * 1024 * 1024 * 1024)).toBe('10 TB');
    // Nothing is larger than a terabyte to this formatter, so the number grows.
    expect(formatBytesRounded(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1024 TB');
  });
});

describe('formatBytesCompact', () => {
  it('leaves the byte count bare under a kilobyte', () => {
    expect(formatBytesCompact(0)).toBe('0');
    expect(formatBytesCompact(800)).toBe('800');
    expect(formatBytesCompact(1023)).toBe('1023');
    expect(formatBytesCompact(1024)).toBe('1.0 k');
  });

  it('uses one letter and no space per unit', () => {
    expect(formatBytesCompact(1024 * 1024 - 1)).toBe('1024.0 k');
    expect(formatBytesCompact(1024 * 1024)).toBe('1.0 M');
    expect(formatBytesCompact(1024 * 1024 * 1024 - 1)).toBe('1024.0 M');
    expect(formatBytesCompact(1024 * 1024 * 1024)).toBe('1.0 G');
    expect(formatBytesCompact(2 * 1024 * 1024 * 1024 * 1024)).toBe('2048.0 G');
  });
});
