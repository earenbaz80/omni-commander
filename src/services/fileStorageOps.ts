import type { EngineState } from './fileEngineState';
import { readCatalogue, writeCatalogue } from './filesystemStorage';
import { log } from '../utils/logger';

/**
 * What the engine keeps between runs: the catalogue on disk and the subscribers
 * that follow it in memory.
 *
 * The debounce is not an optimisation: a directory listing writes on every
 * change, and the old code persisted on each one until the whole array stopped
 * fitting the localStorage quota. Reads go through the validated reader, so a
 * value this version cannot understand means "nothing saved" instead of a crash.
 */
export function createStorageOps(deps: { state: EngineState }) {
  const { state } = deps;

  function loadFromStorage() {
    // Real drives only: a first run has nothing saved, and virtual drives are
    // added elsewhere on purpose. A value that cannot be read means the same
    // thing here as no value at all, which is what the reader already decides.
    const catalogue = readCatalogue();
    state.drives = catalogue.drives;
    state.files = catalogue.files;
    state.recycleBin = catalogue.recycleBin;
  }

  /**
   * Serializes only the fields the UI actually needs. `content` (inline text or
   * base64 payloads) is the heavy, non-visible field that used to blow the
   * localStorage quota; a directory listing reloads it from the server, and
   * virtual files rehydrate lazily. Kept explicit so a future field is a
   * deliberate decision rather than an accidental quota regression.
   */
  function filesForStorage() {
    return state.files.map((f) => ({
      id: f.id,
      name: f.name,
      ext: f.ext,
      fullName: f.fullName,
      path: f.path,
      driveId: f.driveId,
      isDirectory: f.isDirectory,
      size: f.size,
      modifiedAt: f.modifiedAt,
      createdAt: f.createdAt,
      attributes: f.attributes,
      mimeType: f.mimeType,
      icon: f.icon,
      isLocked: f.isLocked,
    }));
  }

  function persistToStorageNow() {
    if (typeof window === 'undefined') return;
    const saved = writeCatalogue({
      drives: state.drives,
      files: filesForStorage(),
      recycleBin: state.recycleBin,
    });
    if (!saved) {
      // A quota-exceeded write used to fail silently, so the user lost drives,
      // files and trash with no trace. Log it and keep the app running on the
      // in-memory state instead of pretending the save succeeded.
      log.error('[fileSystem] persist to localStorage failed; continuing in memory');
    }
  }

  function flushStorage() {
    if (state.storageSaveTimer) {
      clearTimeout(state.storageSaveTimer);
      state.storageSaveTimer = null;
      persistToStorageNow();
    }
  }

  function saveToStorage() {
    // Notify React immediately; debounce the expensive localStorage writes.
    state.filesVersion++;
    notify();
    if (typeof window === 'undefined') return;
    if (state.storageSaveTimer) {
      clearTimeout(state.storageSaveTimer);
    }
    state.storageSaveTimer = setTimeout(() => {
      persistToStorageNow();
      state.storageSaveTimer = null;
    }, 250);
  }

  function subscribe(listener: () => void) {
    state.listeners.push(listener);
    return () => {
      state.listeners = state.listeners.filter((l) => l !== listener);
    };
  }

  function notify() {
    state.listeners.forEach((l) => l());
  }

  return { loadFromStorage, flushStorage, saveToStorage, subscribe };
}
