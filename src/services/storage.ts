/**
 * Versioned access to localStorage, in one place.
 *
 * Each screen used to read its own key with a `try/catch` and a `JSON.parse`, so
 * a value left behind by an older build either threw in a corner nobody was
 * looking at or quietly reset the setting. The two rules live here instead: a
 * value is used only when it validates, and a value from an older shape is
 * migrated or dropped, never half-trusted.
 *
 * The stored form is `{ version, value }`. A key written before that envelope
 * existed holds the bare value and is read as version 0 -- including a bare
 * string, which is not JSON at all, because that is how a plain choice used to
 * be saved. That is what makes changing a shape a bump in `version` plus a
 * `migrate` function instead of a flag day in every component.
 */

/** The one key the app's settings live under, envelope and all. */
export const SETTINGS_KEY = 'nc_settings_v1';

export interface StoredSpec<T> {
  /** Used when nothing valid is stored. */
  fallback: T;
  /** Shape check for the current version. */
  validate: (value: unknown) => value is T;
  /** The shape this code writes. Bump it when the stored form changes. */
  version?: number;
  /**
   * Turns an older value into the current shape. It receives the version the
   * value was stored with: 0 for a bare value, the envelope's number otherwise.
   * Returning null says the value cannot be rescued.
   */
  migrate?: (value: unknown, fromVersion: number) => T | null;
}

interface Envelope {
  version: number;
  value: unknown;
}

const isEnvelope = (value: unknown): value is Envelope => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { version?: unknown; value?: unknown };
  return typeof candidate.version === 'number' && 'value' in candidate;
};

/**
 * The store, or null when the browser refuses to hand it over.
 *
 * Reading `window.localStorage` itself throws when storage is disabled by
 * policy, which is why this is a function and not a module-level constant.
 */
function availableStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Removes whatever is under the key; a no-op when storage is unavailable. */
export function removeStored(key: string): void {
  const store = availableStorage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* unreadable either way */
  }
}

/**
 * Reads a key, migrating or dropping what cannot be used.
 *
 * A value that is neither valid nor migratable is removed along with its key:
 * leaving it there repeats the same failure on every mount and hides the real
 * problem, which is that the stored shape is gone.
 */
export function readStored<T>(key: string, spec: StoredSpec<T>): T {
  const store = availableStorage();
  if (!store) return spec.fallback;

  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return spec.fallback;
  }
  if (raw === null) return spec.fallback;

  let parsed: unknown = null;
  let parseable = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parseable = false;
  }

  if (!parseable) {
    // A bare string was a legitimate stored form before the envelope, so it gets
    // the same chance to migrate as any other older value.
    const migrated = spec.migrate?.(raw, 0) ?? null;
    if (migrated !== null && spec.validate(migrated)) return migrated;
    removeStored(key);
    return spec.fallback;
  }

  const version = spec.version ?? 1;
  const storedVersion = isEnvelope(parsed) ? parsed.version : 0;
  const stored = isEnvelope(parsed) ? parsed.value : parsed;

  // A value already in the current shape is used as it is, whatever version it
  // was stamped with: everything written before the envelope existed is a bare
  // value of the current shape, and migrating it away would reset every setting
  // once, which is the bug this module exists to prevent. A value stamped with a
  // version this build does not know is not trusted, only migrated.
  if (storedVersion <= version && spec.validate(stored)) return stored;

  const migrated = spec.migrate?.(stored, storedVersion) ?? null;
  if (migrated !== null && spec.validate(migrated)) return migrated;

  removeStored(key);
  return spec.fallback;
}

/**
 * Writes a value under the key, stamped with `version`.
 *
 * Returns false instead of throwing: a full or disabled storage costs the
 * setting, never the action that changed it.
 */
export function writeStored<T>(key: string, value: T, version = 1): boolean {
  const store = availableStorage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify({ version, value } satisfies Envelope));
    return true;
  } catch {
    return false;
  }
}
