import type { Drive, FileItem, RecycleBinItem } from '../types';
import { rootFromDriveFields } from './driveRoots';
import { readStored, writeStored, type StoredSpec } from './storage';

/**
 * The catalogue the panels show, as it is kept between runs.
 *
 * It used to be three independent `JSON.parse` calls inside the engine, which
 * meant one damaged entry made the app believe there was no catalogue at all.
 * Here the three keys share one shape check and one version, and a damaged list
 * is filtered instead of dropped.
 *
 * A file is stored without its `content`: that field holds inline text and
 * base64 payloads, it is the reason the quota used to be blown, and nothing on
 * screen needs it -- a directory listing reloads from the server, and virtual
 * files rehydrate lazily.
 */
export type StoredFile = Omit<FileItem, 'content'>;

export interface StoredCatalogue {
  drives: Drive[];
  files: StoredFile[];
  recycleBin: RecycleBinItem[];
}

const DRIVES_KEY = 'nc_drives_v1';
const FILES_KEY = 'nc_filesystem_v1';
const BIN_KEY = 'nc_recycle_bin_v1';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDrive = (value: unknown): value is Drive =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.root === 'string' &&
  value.root.length > 0 &&
  typeof value.letter === 'string' &&
  typeof value.name === 'string';

/** Rescues a drive written before the model had an explicit root. */
const migrateDrive = (value: unknown): Drive | null => {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const letter = typeof value.letter === 'string' ? value.letter : '';
  const root = rootFromDriveFields(value.root, letter);
  return root ? ({ ...value, id: value.id, name: value.name, letter, root } as Drive) : null;
};

const isStoredFile = (value: unknown): value is StoredFile =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.path === 'string' &&
  typeof value.driveId === 'string' &&
  typeof value.isDirectory === 'boolean';

/**
 * The bin's entries are replaced wholesale when it is emptied, so only the field
 * that identifies one is checked: guessing at the rest would reject entries a
 * previous build wrote for a good reason.
 */
const isBinEntry = (value: unknown): value is RecycleBinItem => isObject(value) && typeof value.id === 'string';

/** A list where every entry has to pass, and a damaged entry does not sink the rest. */
const listSpec = <T>(guard: (value: unknown) => value is T): StoredSpec<T[]> => ({
  fallback: [],
  validate: (value): value is T[] => Array.isArray(value) && value.every(guard),
  version: 1,
  migrate: (value) => (Array.isArray(value) ? value.filter(guard) : null),
});

// Version 2 stores the explicit root. Version 0/1 records are migrated by
// recovering it from their label, so an upgrade keeps the drives it could list.
const DRIVES_SPEC: StoredSpec<Drive[]> = {
  fallback: [],
  version: 2,
  validate: (value): value is Drive[] => Array.isArray(value) && value.every(isDrive),
  migrate: (value) =>
    Array.isArray(value) ? value.map(migrateDrive).filter((drive): drive is Drive => drive !== null) : null,
};
const FILES_SPEC = listSpec(isStoredFile);
const BIN_SPEC = listSpec(isBinEntry);

/** Reads the three keys; anything unreadable in one of them stays confined to it. */
export function readCatalogue(): StoredCatalogue {
  return {
    drives: readStored(DRIVES_KEY, DRIVES_SPEC),
    files: readStored(FILES_KEY, FILES_SPEC),
    recycleBin: readStored(BIN_KEY, BIN_SPEC),
  };
}

/**
 * Writes all three keys and reports whether every one landed.
 *
 * No short-circuit on purpose: a full quota usually refuses the largest list (the
 * file catalogue), and skipping the other two because of it would lose the drives
 * the user can still see.
 */
export function writeCatalogue(catalogue: StoredCatalogue): boolean {
  // Each key is stamped with the version of the shape it was written in, not with
  // the newest one around: a reader decides how to treat `files` by the number on
  // `files`, and the drives' own bump must not make an unchanged list look stale.
  const drives = writeStored(DRIVES_KEY, catalogue.drives, DRIVES_SPEC.version ?? 1);
  const files = writeStored(FILES_KEY, catalogue.files, FILES_SPEC.version ?? 1);
  const bin = writeStored(BIN_KEY, catalogue.recycleBin, BIN_SPEC.version ?? 1);
  return drives && files && bin;
}
