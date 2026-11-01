// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  RUN_FAVORITES_LIMIT,
  loadRunFavorites,
  moveRunFavorite,
  removeRunFavorite,
  toggleRunFavorite,
} from './runLauncher';

/**
 * Favourites are the only thing in the Run box that the user maintains by hand,
 * so the two rules that matter are that pinning twice is the same as pinning
 * once, and that a broken stored value never breaks the box.
 */
const storage = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
};

describe('run favourites', () => {
  it('pins a target at the front of the list', () => {
    const next = toggleRunFavorite('notepad', ['calc'], storage() as any);
    expect(next).toEqual(['notepad', 'calc']);
  });

  it('unpins a target that is already pinned, whatever its case', () => {
    const next = toggleRunFavorite('NOTEPAD', ['notepad', 'calc'], storage() as any);
    expect(next).toEqual(['calc']);
  });

  it('writes the list back so it survives a reload', () => {
    const store = storage();
    const next = toggleRunFavorite('notepad', [], store as any);
    expect(JSON.parse(store.read() || '[]')).toEqual(next);
  });

  it('keeps the list short', () => {
    const many = Array.from({ length: RUN_FAVORITES_LIMIT }, (_, index) => `target-${index}`);
    const next = toggleRunFavorite('nuevo', many, storage() as any);
    expect(next).toHaveLength(RUN_FAVORITES_LIMIT);
    expect(next[0]).toBe('nuevo');
  });

  it('ignores an empty target and a stored value that makes no sense', () => {
    expect(toggleRunFavorite('   ', ['calc'], storage() as any)).toEqual(['calc']);
    expect(loadRunFavorites(storage('{"not":"an array"}') as any)).toEqual([]);
    expect(loadRunFavorites(storage('["", 7, "calc"]') as any)).toEqual(['calc']);
    expect(loadRunFavorites(null)).toEqual([]);
  });
});

describe('run favourites edited by hand', () => {
  it('removes a favourite by name, whatever its case, and writes the list', () => {
    const store = storage();

    const next = removeRunFavorite('NOTEPAD', ['notepad', 'calc'], store as any);

    expect(next).toEqual(['calc']);
    expect(JSON.parse(store.read() || '[]')).toEqual(['calc']);
  });

  it('moves a favourite one place and leaves the rest as it was', () => {
    expect(moveRunFavorite('calc', -1, ['notepad', 'calc', 'cmd'], storage() as any)).toEqual([
      'calc',
      'notepad',
      'cmd',
    ]);
    expect(moveRunFavorite('calc', 1, ['notepad', 'calc', 'cmd'], storage() as any)).toEqual([
      'notepad',
      'cmd',
      'calc',
    ]);
  });

  it('does nothing at an edge, for an unknown target or for a blank one', () => {
    const store = storage();

    expect(moveRunFavorite('notepad', -1, ['notepad', 'calc'], store as any)).toEqual(['notepad', 'calc']);
    expect(moveRunFavorite('calc', 1, ['notepad', 'calc'], store as any)).toEqual(['notepad', 'calc']);
    expect(moveRunFavorite('ghost', 1, ['notepad', 'calc'], store as any)).toEqual(['notepad', 'calc']);
    expect(removeRunFavorite('   ', ['notepad'], store as any)).toEqual(['notepad']);
    // Nothing was worth writing, so nothing was written.
    expect(store.read()).toBeNull();
  });
});
