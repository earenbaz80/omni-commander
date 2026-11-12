import { describe, expect, it } from 'vitest';
import { formatSpeed } from './formatSpeed';

describe('formatSpeed', () => {
  it('reads nothing transferred as zero', () => {
    expect(formatSpeed(0)).toBe('0 MB/s');
    expect(formatSpeed(-1)).toBe('0 MB/s');
    expect(formatSpeed(Number.NaN)).toBe('0 MB/s');
  });

  it('gives one decimal to a rate that has one', () => {
    expect(formatSpeed(1024 * 1024 * 0.5)).toBe('0.5 MB/s');
    expect(formatSpeed(1024 * 1024 * 1.5)).toBe('1.5 MB/s');
    expect(formatSpeed(1024 * 1024 * 5.25)).toBe('5.3 MB/s');
    expect(formatSpeed(1024 * 1024 * 9.96)).toBe('10 MB/s');
  });

  it('drops the zero of a whole rate, so a cap reads as it was chosen', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1 MB/s');
    expect(formatSpeed(1024 * 1024 * 5)).toBe('5 MB/s');
    expect(formatSpeed(1024 * 1024 * 100)).toBe('100 MB/s');
  });

  it('keeps counting in megabytes past a gigabyte per second', () => {
    expect(formatSpeed(1024 * 1024 * 1024)).toBe('1024 MB/s');
  });
});
