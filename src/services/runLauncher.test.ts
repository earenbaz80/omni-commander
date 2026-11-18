// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  RUN_FAVORITES_LIMIT,
  loadRunFavorites,
  moveRunFavorite,
  rememberRunTarget,
  removeRunFavorite,
  toggleRunFavorite,
} from './runLauncher';
import { setPlatformInfo, type PlatformInfo } from './platform';

/**
 * The two machines this build ships for. Only the separator and the case rule
 * reach path identity, but the answer `/api/platform` gives carries all of it.
 */
const WINDOWS: PlatformInfo = {
  platform: 'win32',
  caseSensitive: false,
  separator: '\\',
  capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
};

const LINUX: PlatformInfo = {
  platform: 'linux',
  caseSensitive: true,
  separator: '/',
  capabilities: { paths: true, volumes: true, cleanup: false, trash: true, openWith: false },
};

beforeEach(() => setPlatformInfo(WINDOWS));
afterEach(() => setPlatformInfo(WINDOWS));

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

describe('run targets on a case-sensitive root', () => {
  beforeEach(() => setPlatformInfo(LINUX));

  it('keeps two paths that differ only in case', () => {
    // Two folders on this host: recalling one must not replace the other.
    expect(rememberRunTarget('/mnt/Data', ['/mnt/data'], storage() as any)).toEqual(['/mnt/Data', '/mnt/data']);
    expect(toggleRunFavorite('/mnt/Data', ['/mnt/data'], storage() as any)).toEqual(['/mnt/Data', '/mnt/data']);
    expect(removeRunFavorite('/mnt/data', ['/mnt/Data'], storage() as any)).toEqual(['/mnt/Data']);
    expect(moveRunFavorite('/mnt/data', 1, ['/mnt/Data', '/mnt/data'], storage() as any)).toEqual([
      '/mnt/Data',
      '/mnt/data',
    ]);
  });

  it('still treats the same path written with a trailing separator as one', () => {
    expect(rememberRunTarget('/mnt/data/', ['/mnt/data'], storage() as any)).toEqual(['/mnt/data/']);
    expect(toggleRunFavorite('/mnt/data/', ['/mnt/data'], storage() as any)).toEqual([]);
  });

  it('still folds the case of a program name, which the host does not', () => {
    // `notepad` is a program, not a path: Windows resolves both spellings to the
    // same one, and the box has always unpinned it that way.
    expect(toggleRunFavorite('NOTEPAD', ['notepad'], storage() as any)).toEqual([]);
  });

  it('folds a command line, whose separator belongs to an argument', () => {
    // `cmd /c dir` carries a slash and is still not a path; reading it as one
    // would let the history hold the same command twice.
    expect(rememberRunTarget('cmd /c dir', ['CMD /C DIR'], storage() as any)).toEqual(['cmd /c dir']);
  });

  it('folds a URL down to its origin and leaves the path alone', () => {
    // A host is case-insensitive on every host; the path behind it is not.
    expect(rememberRunTarget('https://Freebuff.com/Notas', ['https://freebuff.com/Notas'], storage() as any)).toEqual([
      'https://Freebuff.com/Notas',
    ]);
    expect(rememberRunTarget('https://freebuff.com/notas', ['https://freebuff.com/Notas'], storage() as any)).toEqual([
      'https://freebuff.com/notas',
      'https://freebuff.com/Notas',
    ]);
  });
});

describe('run targets on a Windows drive', () => {
  it('folds the case of a path, because the filesystem does', () => {
    expect(rememberRunTarget('C:\\Temp', ['c:\\temp'], storage() as any)).toEqual(['C:\\Temp']);
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
