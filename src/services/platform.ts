import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * What the renderer knows about the machine it is running on.
 *
 * Path arithmetic and path comparison are platform questions, not Windows
 * constants: a drive root is `C:\` on Windows and `/mnt/data` on Linux, and two
 * spellings of the same path are equal only where the filesystem folds case.
 * The server owns that answer; this module carries it to the renderer.
 */
export type PlatformId = 'win32' | 'linux';

export interface PlatformCapabilities {
  paths: boolean;
  volumes: boolean;
  cleanup: boolean;
  trash: boolean;
  openWith: boolean;
}

export interface PlatformInfo {
  platform: PlatformId;
  /** Whether paths that differ only in case name different files. */
  caseSensitive: boolean;
  separator: '/' | '\\';
  /** Every domain is explicit, including the ones this platform does not implement. */
  capabilities: PlatformCapabilities;
}

/**
 * The capability keys `parsePlatformInfo` insists on, in the order it reads them.
 *
 * Kept private: what the app depends on is the shape the server answers with, and
 * an exported list would be one more name to keep alive for no reader.
 */
const CAPABILITY_NAMES: ReadonlyArray<keyof PlatformCapabilities> = [
  'paths',
  'volumes',
  'cleanup',
  'trash',
  'openWith',
];

/**
 * The best answer available before `/api/platform` replies.
 *
 * The user agent is only used for this first paint: the packaged Linux window
 * must not compare paths as Windows does while the request is in flight. The
 * server's answer replaces it as soon as it arrives.
 */
function fallbackPlatform(): PlatformInfo {
  const linux = typeof navigator !== 'undefined' && /linux/i.test(String(navigator.userAgent || ''));
  if (linux) {
    return {
      platform: 'linux',
      caseSensitive: true,
      separator: '/',
      capabilities: { paths: true, volumes: true, cleanup: false, trash: true, openWith: false },
    };
  }
  return {
    platform: 'win32',
    caseSensitive: false,
    separator: '\\',
    capabilities: { paths: true, volumes: true, cleanup: true, trash: true, openWith: true },
  };
}

let current = fallbackPlatform();
let pending: Promise<PlatformInfo> | null = null;

/**
 * Applies an answer from the server, or a bootstrap value, to every consumer.
 *
 * This is the only way the answer is installed: the loader below goes through it,
 * so there is one place that decides what the module currently believes.
 */
export function setPlatformInfo(info: PlatformInfo): PlatformInfo {
  current = info;
  return current;
}

function parsePlatformInfo(value: unknown): PlatformInfo | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.platform !== 'win32' && record.platform !== 'linux') return null;
  if (typeof record.caseSensitive !== 'boolean') return null;
  if (record.separator !== '/' && record.separator !== '\\') return null;
  const declared = record.capabilities;
  if (!declared || typeof declared !== 'object') return null;

  const capabilities = {} as PlatformCapabilities;
  for (const name of CAPABILITY_NAMES) {
    const enabled = (declared as Record<string, unknown>)[name];
    if (typeof enabled !== 'boolean') return null;
    capabilities[name] = enabled;
  }

  return {
    platform: record.platform,
    caseSensitive: record.caseSensitive,
    separator: record.separator,
    capabilities,
  };
}

/**
 * Reads the platform contract from the local server.
 *
 * A failure leaves the current answer in place: the app is still usable while
 * the embedded server is starting, and the next mount may ask again. The answer
 * is not cached as a failed request, so a server that binds a moment later is
 * not permanently invisible.
 */
export function loadPlatformInfo(options: { signal?: AbortSignal } = {}): Promise<PlatformInfo> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetchWithRetry(`${API_BASE}/api/platform`, {
        timeoutMs: 5000,
        retries: 1,
        signal: options.signal,
      });
      if (!response.ok) return current;
      const parsed = parsePlatformInfo(await response.json());
      return parsed ? setPlatformInfo(parsed) : current;
    } catch {
      return current;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/**
 * The path form used for equality, without a trailing separator.
 *
 * Windows has one spelling for a separator, so `C:/Temp` and `C:\Temp` name the
 * same folder and have to compare as one. POSIX does not: a backslash there is an
 * ordinary character in a file name, and folding it would merge two folders.
 */
function pathKey(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const unified = current.separator === '\\' ? text.replace(/\//g, '\\') : text;
  const trimmed = unified.replace(/[\\/]+$/, '');
  // A path made only of separators keeps one of them, so `/` and `\` stay what
  // they say instead of both collapsing to nothing.
  return trimmed || unified.slice(0, 1);
}

/** Case folding, the one comparison rule that differs between hosts. */
function fold(text: string): string {
  return current.caseSensitive ? text : text.toLowerCase();
}

/**
 * The identity of a path when spellings that name the same file must collapse.
 *
 * Trailing separators never matter, and case matters only where the host says it
 * does. Exported for callers that key a collection by path; addressing itself
 * still goes through the helpers above.
 */
export function pathIdentity(value: unknown): string {
  return fold(pathKey(value));
}

/** Path equality follows the platform: Windows folds case, POSIX does not. */
export function samePath(left: unknown, right: unknown): boolean {
  return fold(pathKey(left)) === fold(pathKey(right));
}

/** True when `candidate` is `root` itself or a path below it. */
export function isPathAtOrInside(root: unknown, candidate: unknown): boolean {
  const base = pathKey(root);
  const target = pathKey(candidate);
  if (!base || !target) return false;
  if (samePath(base, target)) return true;
  // `pathKey` leaves no trailing separator, except on a root that is only one --
  // and there it is already the prefix this wants.
  const separator = base.startsWith('/') ? '/' : '\\';
  const prefix = base.endsWith(separator) ? base : `${base}${separator}`;
  return fold(target).startsWith(fold(prefix));
}

/**
 * The drive a path lives on, choosing the most specific root that contains it.
 *
 * A mount nested in another (`/mnt` inside `/`, or a volume mounted below a folder
 * another drive already claims) must not win by list order, so the longest
 * matching root is the answer. The caller passes the drives it considers usable;
 * this only decides which one addresses the path.
 */
export function driveForPath<T extends { root: string }>(drives: ReadonlyArray<T>, value: unknown): T | undefined {
  const target = pathKey(value);
  let match: T | undefined;
  let matchLength = 0;
  for (const drive of drives) {
    const root = pathKey(drive.root);
    if (root.length <= matchLength || !isPathAtOrInside(root, target)) continue;
    match = drive;
    matchLength = root.length;
  }
  return match;
}

/**
 * Appends one child name without ever doubling a separator.
 *
 * An absolute parent carries the separator its own spelling uses and keeps it, so
 * a POSIX mount point is joined with `/` and a drive letter with `\` whatever
 * machine this is. A relative parent -- a bare name, or a path inside a virtual
 * archive -- has no such hint, and takes the separator of the machine the app runs
 * on.
 */
export function appendPath(parent: unknown, child: string): string {
  const base = String(parent ?? '');
  if (!base) return child;
  const absolute = base.startsWith('/') || /^[A-Za-z]:([\\/]|$)/.test(base);
  const separator = absolute ? (base.startsWith('/') ? '/' : '\\') : current.separator;
  return base.endsWith('/') || base.endsWith('\\') ? `${base}${child}` : `${base}${separator}${child}`;
}

/** Last segment of a path, used for labels rather than for addressing. */
export function baseName(value: unknown): string {
  const text = String(value ?? '').replace(/[\\/]+$/, '');
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}
