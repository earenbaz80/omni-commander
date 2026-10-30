import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { log } from '../utils/logger';

/**
 * The folders Windows treats as libraries. The server resolves them for the
 * profile that is signed in, because Desktop and Documents are frequently
 * redirected into OneDrive and a path guessed here would miss them.
 */
export type UserFolderKey = 'desktop' | 'documents' | 'pictures' | 'music' | 'videos';

export interface UserFolder {
  key: UserFolderKey;
  /** Absolute path, e.g. `C:\Users\ana\OneDrive\Escritorio`. */
  path: string;
}

const USER_FOLDER_KEYS: UserFolderKey[] = ['desktop', 'documents', 'pictures', 'music', 'videos'];

function isUserFolder(value: unknown): value is UserFolder {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<UserFolder>;
  return (
    typeof entry.path === 'string' && entry.path.length > 0 && USER_FOLDER_KEYS.includes(entry.key as UserFolderKey)
  );
}

/**
 * One lookup per session: both panels can show a tree, and they ask for the
 * same five paths. A failure is not remembered, so the next tree that opens
 * asks again instead of showing an empty list for the rest of the session.
 */
let inFlight: Promise<UserFolder[]> | null = null;

export function loadUserFolders(options: { signal?: AbortSignal } = {}): Promise<UserFolder[]> {
  if (inFlight) return inFlight;
  const request = fetchWithRetry(`${API_BASE}/api/user-folders`, {
    timeoutMs: 10000,
    retries: 1,
    signal: options.signal,
  })
    .then((response) => (response.ok ? response.json() : []))
    .then((data: unknown) => (Array.isArray(data) ? data.filter(isUserFolder) : []))
    .catch((error) => {
      if (!options.signal?.aborted) log.warn('Could not load the user folders from the API', error);
      return [] as UserFolder[];
    })
    .then((folders) => {
      if (folders.length === 0) inFlight = null;
      return folders;
    });
  inFlight = request;
  return request;
}

/** Forgets the lookup, for tests that need a fresh answer. */
export function resetUserFoldersCache(): void {
  inFlight = null;
}
