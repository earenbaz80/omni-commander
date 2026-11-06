/**
 * Reads the archives only libarchive can handle (RAR, 7-Zip, TAR.BZ2, TAR.LZMA)
 * through the local server, which runs that engine on a worker thread right next
 * to the file.
 *
 * Why the server and not the renderer: libarchive.js's browser build needs a Web
 * Worker, and the packaged app loads the renderer from file://, where Chromium
 * refuses to start one. The server also already owns the file, so a huge archive
 * is listed and extracted where it lives instead of being copied into the
 * renderer to be parsed there.
 *
 * This bridge only ever reads: names, sizes, dates and one entry's bytes at a
 * time. Extracting to disk stays on the caller's existing path, which already
 * validates every entry name before writing, so these calls add no new way to
 * write to the filesystem.
 */
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { tGlobal } from '../i18n/translations';
import { log } from '../utils/logger';
import { API_BASE } from './apiBase';
import {
  ArchivePasswordError,
  formatLabel,
  type ArchiveBackend,
  type ArchiveEntry,
  type ArchiveFormatName,
} from './archiveBackend';

/** One entry as the server describes it; `date` is epoch milliseconds. */
interface RemoteEntry {
  name: string;
  dir: boolean;
  size: number;
  date: number;
}

interface FailurePayload {
  code?: string;
  error?: string;
  /** On `password-required`: `required` when none was given, `invalid` when it did not work. */
  reason?: string;
  /** Present on `too-large`: the ceiling the server refused the archive against. */
  limitBytes?: number;
}

/**
 * Raised when the entry cannot be written because something is already there.
 * It is not a read failure, so the caller must not retry it as one.
 */
export class ArchiveDestinationExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveDestinationExistsError';
  }
}

/** Raised when the local server is not answering, so these formats cannot be read. */
export class ArchiveServerUnavailableError extends Error {
  constructor(format: ArchiveFormatName) {
    super(tGlobal('zipServerRequired').replace('{format}', formatLabel(format)));
    this.name = 'ArchiveServerUnavailableError';
  }
}

async function callServer(route: string, body: unknown): Promise<Response> {
  return fetchWithRetry(`${API_BASE}/api/archives/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // No retries: a second attempt on a damaged archive only doubles the wait,
    // and a refused connection is reported as such rather than as damage.
    retries: 0,
    timeoutMs: 120000,
  });
}

/** Whole-megabyte ceiling as the message shows it, e.g. `512 MB`. */
function describeLimit(limitBytes: number): string {
  const megabytes = limitBytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

/**
 * Maps a refusal onto the error the rest of the app already knows how to show:
 * a missing passphrase becomes the password prompt, an archive over the reader's
 * memory ceiling says so, and everything else the same "cannot read this
 * archive" message the ZIP path uses. A too-large archive is not damaged, so
 * reporting it as corrupt would send the user looking for a problem in the file.
 */
function failureFromPayload(payload: FailurePayload | null, fileName: string): Error {
  if (payload?.code === 'password-required') {
    return new ArchivePasswordError(
      fileName,
      tGlobal('zipErrPasswordNeeded').replace('{name}', fileName),
      payload.reason === 'invalid' ? 'invalid' : 'required',
    );
  }
  if (payload?.code === 'too-large' && typeof payload.limitBytes === 'number') {
    return new Error(
      tGlobal('zipErrTooLarge').replace('{name}', fileName).replace('{size}', describeLimit(payload.limitBytes)),
    );
  }
  if (payload?.error) log.warn('Archive server refused the request', payload.code, payload.error);
  return new Error(tGlobal('zipErrCorrupt').replace('{name}', fileName));
}

async function remoteFailure(response: Response, fileName: string): Promise<Error> {
  return failureFromPayload((await response.json().catch(() => null)) as FailurePayload | null, fileName);
}

/**
 * Lists a server-readable archive and returns a backend whose `read()` fetches
 * one entry at a time. `targetPath` is the archive's absolute path on disk.
 */
export async function loadServerArchiveBackend(
  targetPath: string,
  fileName: string,
  format: ArchiveFormatName,
  password?: string,
): Promise<ArchiveBackend> {
  let response: Response;
  try {
    response = await callServer('inspect', { path: targetPath, password });
  } catch (error) {
    log.warn('Archive server unreachable', error);
    throw new ArchiveServerUnavailableError(format);
  }
  if (!response.ok) throw await remoteFailure(response, fileName);

  const payload = (await response.json()) as { entries?: RemoteEntry[] };
  const read = async (entryName: string): Promise<Uint8Array> => {
    let entryResponse: Response;
    try {
      entryResponse = await callServer('entry', { path: targetPath, entry: entryName, password });
    } catch (error) {
      log.warn('Archive server unreachable while extracting', error);
      throw new ArchiveServerUnavailableError(format);
    }
    if (!entryResponse.ok) throw await remoteFailure(entryResponse, fileName);
    return new Uint8Array(await entryResponse.arrayBuffer());
  };

  const entries: ArchiveEntry[] = (payload.entries ?? []).map((entry) => ({
    name: entry.name,
    dir: entry.dir,
    size: entry.dir ? 0 : entry.size,
    date: new Date(entry.date),
    read: () => (entry.dir ? Promise.resolve(new Uint8Array(0)) : read(entry.name)),
  }));

  return {
    format,
    entries,
    readEntry: read,
  };
}

/** Everything the extraction route needs: which archive, which entry, where. */
export interface ServerEntryTarget {
  /** Absolute path of the archive on disk. */
  archivePath: string;
  /** The archive's name, for the messages the user reads. */
  fileName: string;
  format: ArchiveFormatName;
  /** Name of the entry inside the archive, slash separated. */
  entryName: string;
  /** Absolute path of the file to write. */
  destination: string;
  /** The folder being extracted into; the server refuses anything outside it. */
  root: string;
  password?: string;
}

/**
 * Extracts one entry straight to disk, on the server.
 *
 * Fetching the bytes here and posting them back would need the whole entry in
 * this process's memory and then again in the server's, so a member of several
 * gigabytes could not be extracted at all. The server reads the archive it
already has and writes the file, and this returns how many bytes landed.
 */
export async function extractServerEntry(target: ServerEntryTarget): Promise<number> {
  let response: Response;
  try {
    response = await callServer('extract', {
      path: target.archivePath,
      entry: target.entryName,
      target: target.destination,
      root: target.root,
      password: target.password,
    });
  } catch (error) {
    log.warn('Archive server unreachable while extracting', error);
    throw new ArchiveServerUnavailableError(target.format);
  }
  const payload = (await response.json().catch(() => null)) as (FailurePayload & { bytes?: number }) | null;
  if (payload?.code === 'exists') {
    const leaf = target.destination.split(/[\\/]/).pop() || target.entryName;
    throw new ArchiveDestinationExistsError(tGlobal('zipErrExists').replace('{name}', leaf));
  }
  if (!response.ok) throw failureFromPayload(payload, target.fileName);
  return typeof payload?.bytes === 'number' ? payload.bytes : 0;
}
