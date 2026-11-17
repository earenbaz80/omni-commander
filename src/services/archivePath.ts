import { isPathAtOrInside } from './platform';

/**
 * How a path inside a mounted archive is spelled.
 *
 * The archive is mounted at the absolute path of the file on disk -- `C:\copia.zip`
 * on Windows, `/mnt/vol/copia.zip` on Linux -- and its levels take the separator
 * that root already uses. One rule for both halves means `normalizePath`,
 * `appendPath` and `samePath` keep working on an archive path without knowing it
 * is one. Spelling the levels with a backslash everywhere instead forced every
 * caller to fold separators by hand, and each one folded them differently.
 *
 * The archive's own entry names are a different vocabulary: `archiveEntryPath`
 * validates and addresses an entry inside the file, and keeps the spelling the
 * format wrote.
 */

/** The separator the levels of an archive rooted at `root` are joined with. */
export function archiveSeparator(root: string): string {
  return String(root ?? '').startsWith('/') ? '/' : '\\';
}

/** Levels of an archive-relative path, however it was written. */
export function archiveLevels(relative: string): string[] {
  return String(relative ?? '')
    .split(/[\\/]+/)
    .filter(Boolean);
}

/** `root` plus an archive-relative path, re-spelled with the root's separator. */
export function joinArchivePath(root: string, relative = ''): string {
  const levels = archiveLevels(relative);
  if (!levels.length) return String(root ?? '');
  return [String(root ?? '').replace(/[\\/]+$/, ''), ...levels].join(archiveSeparator(root));
}

/** The folder that holds an archive-relative path. */
export function parentArchivePath(root: string, relative: string): string {
  return joinArchivePath(root, archiveLevels(relative).slice(0, -1).join('/'));
}

/**
 * The level `path` names inside the archive rooted at `root`, or null when it is
 * outside. The root itself yields an empty level, which is its own answer.
 */
export function archiveLevelOf(root: string, path: string): string | null {
  const base = String(root ?? '').replace(/[\\/]+$/, '');
  if (!base) return null;
  const target = String(path ?? '');
  if (!isPathAtOrInside(base, target)) return null;
  return archiveLevels(target.slice(base.length).replace(/^[\\/]+/, '')).join(archiveSeparator(root));
}
