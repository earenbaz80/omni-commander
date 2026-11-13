// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatBytes as serverFormatBytes,
  formatBytesRounded as serverFormatBytesRounded,
} from './server/formatBytes.cjs';
import { formatBytes, formatBytesRoundedWithWholeBytes } from './src/utils/formatBytes';

/**
 * The server prints sizes too, and it runs as plain CommonJS that cannot require
 * the TypeScript module, so `server/formatBytes.cjs` mirrors those ladders. A
 * mirror is only worth keeping if something notices when it stops matching: these
 * cases walk every unit and both sides of each boundary, which is where a copy
 * silently starts to disagree.
 */
const SIZES = [
  1,
  5,
  9,
  10,
  512,
  1023,
  1024,
  1536,
  9.5 * 1024,
  10 * 1024,
  1024 * 1024 - 1,
  1024 * 1024,
  2.5 * 1024 * 1024,
  1024 * 1024 * 1024 - 1,
  1024 * 1024 * 1024,
  1024 * 1024 * 1024 * 1024 - 1,
  1024 * 1024 * 1024 * 1024,
  2 * 1024 * 1024 * 1024 * 1024,
  10 * 1024 * 1024 * 1024 * 1024,
  1024 * 1024 * 1024 * 1024 * 1024,
];

describe('the server size ladders', () => {
  it('match the disk views formatter', () => {
    for (const bytes of SIZES) {
      expect(serverFormatBytes(bytes), `${bytes} bytes`).toBe(formatBytes(bytes));
    }
  });

  it('match the transfer formatter above zero', () => {
    for (const bytes of SIZES) {
      expect(serverFormatBytesRounded(bytes), `${bytes} bytes`).toBe(formatBytesRoundedWithWholeBytes(bytes));
    }
  });

  it('reads a terabyte in terabytes in both shapes', () => {
    // Named here as well as compared above: the parity cases would catch a
    // mirror that drifted, but not a unit the app itself stopped printing.
    expect(serverFormatBytes(1024 * 1024 * 1024 * 1024 - 1)).toBe('1024.0 GB');
    expect(serverFormatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    expect(serverFormatBytes(2 * 1024 * 1024 * 1024 * 1024)).toBe('2.0 TB');

    expect(serverFormatBytesRounded(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    expect(serverFormatBytesRounded(2 * 1024 * 1024 * 1024 * 1024)).toBe('2.0 TB');
    expect(serverFormatBytesRounded(10 * 1024 * 1024 * 1024 * 1024)).toBe('10 TB');
    // The ladder stops at the terabyte, so a thousand of them keep counting.
    expect(serverFormatBytesRounded(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1024 TB');
  });

  it('leaves an unreadable size to the caller', () => {
    // The app prints "0 B" here; the server prints nothing and lets the caller
    // decide, which is why this case cannot be part of the comparison above.
    expect(serverFormatBytesRounded(0)).toBe('');
    expect(serverFormatBytesRounded(-1)).toBe('');
    expect(serverFormatBytesRounded(Number.NaN)).toBe('');
  });
});
