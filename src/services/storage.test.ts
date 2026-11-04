import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readStored, writeStored, removeStored, type StoredSpec } from './storage';

interface Point {
  x: number;
  y: number;
}

const isPoint = (value: unknown): value is Point =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Point).x === 'number' &&
  typeof (value as Point).y === 'number';

/** Version 1 stored `{ a, b }`; version 2 stores `{ x, y }`. */
const pointSpec: StoredSpec<Point> = {
  fallback: { x: 0, y: 0 },
  validate: isPoint,
  version: 2,
  migrate: (value, fromVersion) => {
    if (fromVersion !== 1 || typeof value !== 'object' || value === null) return null;
    const old = value as { a?: unknown; b?: unknown };
    if (typeof old.a !== 'number' || typeof old.b !== 'number') return null;
    return { x: old.a, y: old.b };
  },
};

const stored = (key: string) => JSON.parse(localStorage.getItem(key) as string);

describe('storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('falls back when the key was never written', () => {
    expect(readStored('point', pointSpec)).toEqual({ x: 0, y: 0 });
  });

  it('round-trips a value under the versioned envelope', () => {
    expect(writeStored('point', { x: 3, y: 4 }, 2)).toBe(true);
    expect(stored('point')).toEqual({ version: 2, value: { x: 3, y: 4 } });
    expect(readStored('point', pointSpec)).toEqual({ x: 3, y: 4 });
  });

  it('reads a bare value left by a build without the envelope', () => {
    localStorage.setItem('point', JSON.stringify({ x: 7, y: 8 }));
    expect(readStored('point', pointSpec)).toEqual({ x: 7, y: 8 });
  });

  it('migrates a value stored under an older version', () => {
    localStorage.setItem('point', JSON.stringify({ version: 1, value: { a: 5, b: 6 } }));
    expect(readStored('point', pointSpec)).toEqual({ x: 5, y: 6 });
  });

  it('drops a corrupt value and the key that held it', () => {
    localStorage.setItem('point', '{not json');
    expect(readStored('point', pointSpec)).toEqual({ x: 0, y: 0 });
    expect(localStorage.getItem('point')).toBeNull();
  });

  it('drops an older value that cannot be migrated', () => {
    localStorage.setItem('point', JSON.stringify({ version: 1, value: { a: 'nope' } }));
    expect(readStored('point', pointSpec)).toEqual({ x: 0, y: 0 });
    expect(localStorage.getItem('point')).toBeNull();
  });

  // A plain choice was saved as a bare string, which is not JSON: the migration
  // is the only thing that can rescue it, so it has to receive the raw text.
  it('hands a bare string to the migration', () => {
    const choiceSpec: StoredSpec<'stay' | 'close'> = {
      fallback: 'stay',
      validate: (value): value is 'stay' | 'close' => value === 'stay' || value === 'close',
      migrate: (value) => (value === 'stay' || value === 'close' ? value : null),
    };
    localStorage.setItem('choice', 'close');
    expect(readStored('choice', choiceSpec)).toBe('close');
  });

  it('reports a failed write instead of throwing when the store is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(writeStored('point', { x: 1, y: 2 }, 2)).toBe(false);
  });

  it('removes a key', () => {
    writeStored('point', { x: 1, y: 1 }, 2);
    removeStored('point');
    expect(localStorage.getItem('point')).toBeNull();
  });
});
