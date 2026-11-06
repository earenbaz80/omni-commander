import JSZip from 'jszip';
import { archiveEntryPath, bytesToBase64 } from './zipArchive';
import { buildTar, gzip } from './tarArchive';
import {
  UnsupportedArchiveError,
  formatFromExtension,
  formatLabel,
  isServerReadable,
  loadArchiveBackend,
  withFormatExtension,
  type ArchiveBackend,
  type ArchiveEntry,
  type OpenableArchiveFormat,
} from './archiveBackend';
import { API_BASE } from './apiBase';
import type { FileItem } from '../types';
import { tGlobal } from '../i18n/translations';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { ArchiveDestinationExistsError, extractServerEntry, loadServerArchiveBackend } from './serverArchive';
import { log } from '../utils/logger';

/**
 * Above this, the archive goes to the server even in a format the renderer can
 * parse: JSZip and the TAR reader want the whole file as one buffer, while the
 * server's streaming reader opens any size with a fixed amount of memory. Below
 * it the renderer keeps the job, and with it the per-entry CRC check.
 */
const RENDERER_ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The archive subsystem: mounting one into the catalogue, writing one and
 * extracting one.
 *
 * It was a block of `FileSystemEngine` that reached into eighteen of its members,
 * which is why it is a factory with declared dependencies rather than functions
 * importing the engine: the mount table is the only state, and the engine passes
 * in the path arithmetic and the catalogue writes it already owns. `this.readFileBytes`
 * stays on the engine because the viewer and the editor use it too, so the
 * dependency goes the other way as well.
 */

/** One archive mounted as a virtual root inside the catalogue. */
export interface ArchiveMount {
  source: FileItem;
  root: string;
  backend: ArchiveBackend;
  items: FileItem[];
}

/** Every member of the engine this module uses, named one by one. */
export interface ArchiveOpsDeps {
  normalizePath(path: string): string;
  getParentPath(path: string): string;
  childAbsolutePath(parentPath: string, childName: string): string;
  absoluteForDrive(driveId: string, targetPath: string): string;
  realAbsolutePath(file: FileItem): string;
  realEntryName(file: FileItem): string;
  isSystemDrive(driveId: string): boolean;
  getFiles(driveId: string, currentPath: string): FileItem[];
  readFileBytes(file: FileItem, options?: { maxBytes?: number; unlimited?: boolean }): Promise<Uint8Array>;
  createDirectory(driveId: string, parentPath: string, dirName: string): FileItem;
  callServerFs(route: string, body: unknown): Promise<unknown>;
  lastCallError(): string;
  /** Adds a catalogue entry and persists it. */
  rememberFile(item: FileItem): void;
  saveToStorage(): void;
  loadSystemDriveDirectory(driveId: string, path: string): Promise<boolean>;
}

/**
 * What the caller wants to know about an extraction, and what can stop it.
 *
 * One object instead of a row of optional positional parameters: every caller
 * that only extracts never has to name any of them.
 */
export interface ExtractHooks {
  /** Bytes that reached the disk, and how many the selection holds in all. */
  onProgress?: (bytesWritten: number, totalBytes: number) => void;
  /** The member being written right now, as its path inside the destination. */
  onEntry?: (entryPath: string) => void;
  /** The id the server knows this run by, so it can be held and released. */
  onJob?: (jobId: string) => void;
  /** Aborting stops the run and leaves nothing under the real names. */
  signal?: AbortSignal;
}

export interface ArchiveOps {
  findArchive(driveId: string, path: string): ArchiveMount | undefined;
  getArchiveSource(driveId: string, path: string): FileItem | undefined;
  /** An entry mounted from any archive, for `getFileById`. */
  findMountedItem(id: string): FileItem | undefined;
  writeBytes(driveId: string, root: string, relative: string, bytes: Uint8Array): Promise<FileItem>;
  openArchive(source: FileItem, password?: string): Promise<string>;
  createArchive(
    items: FileItem[],
    archiveName: string,
    targetDriveId: string,
    targetPath: string,
    format?: OpenableArchiveFormat,
  ): Promise<FileItem>;
  extractArchive(
    archiveFile: FileItem,
    targetDriveId: string,
    targetPath: string,
    selectedEntry?: string,
    hooks?: ExtractHooks,
  ): Promise<number>;
}

export function createArchiveOps(deps: ArchiveOpsDeps): ArchiveOps {
  const mounts = new Map<string, ArchiveMount>();

  function findArchive(driveId: string, path: string): ArchiveMount | undefined {
    const normalized = deps.normalizePath(path).toLowerCase();
    return [...mounts.values()].find(
      (m) =>
        m.source.driveId === driveId &&
        (normalized === m.root.toLowerCase() || normalized.startsWith(`${m.root.toLowerCase()}\\`)),
    );
  }

  function getArchiveSource(driveId: string, path: string): FileItem | undefined {
    return findArchive(driveId, path)?.source;
  }

  function findMountedItem(id: string): FileItem | undefined {
    return [...mounts.values()].flatMap((m) => m.items).find((f) => f.id === id);
  }

  /**
   * The backend of an archive that is already mounted, matched by the file it
   * was opened from. An encrypted archive can only be read through the backend
   * that was opened with its password, so extraction must reuse it rather than
   * open the file again without one.
   */
  function mountedArchiveBackend(archiveFile: FileItem): ArchiveBackend | undefined {
    const target = deps.realAbsolutePath(archiveFile).toLowerCase();
    return [...mounts.values()].find(
      (mounted) => mounted.source.driveId === archiveFile.driveId && mounted.root.toLowerCase() === target,
    )?.backend;
  }

  async function writeBytes(driveId: string, root: string, relative: string, bytes: Uint8Array): Promise<FileItem> {
    if (getArchiveSource(driveId, root)) throw new Error(tGlobal('zipReadOnly'));
    const safe = archiveEntryPath(relative);
    // Kept drive-relative for the catalogue entry, which indexes panels by that
    // form; only the request to the server needs the drive letter.
    const target = deps.childAbsolutePath(root, safe);
    if (deps.isSystemDrive(driveId)) {
      const response = await fetchWithRetry(
        `${API_BASE}/api/fs/write-bytes?path=${encodeURIComponent(deps.absoluteForDrive(driveId, target))}&root=${encodeURIComponent(deps.absoluteForDrive(driveId, root))}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob([new Uint8Array(bytes)]),
          retries: 0,
          timeoutMs: 120000,
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
    }
    const parent = deps.getParentPath(target);
    const fullName = safe.split('\\').pop()!;
    if (
      !deps.isSystemDrive(driveId) &&
      deps.getFiles(driveId, parent).some((f) => deps.realEntryName(f).toLowerCase() === fullName.toLowerCase())
    ) {
      throw new Error(tGlobal('zipErrExists').replace('{name}', fullName));
    }
    const dot = fullName.lastIndexOf('.');
    const now = new Date().toISOString();
    const item: FileItem = {
      id: `bytes_${Date.now()}_${Math.random()}`,
      driveId,
      path: parent,
      fullName,
      name: dot > 0 ? fullName.slice(0, dot) : fullName,
      ext: dot > 0 ? fullName.slice(dot + 1) : '',
      isDirectory: false,
      size: bytes.length,
      createdAt: now,
      modifiedAt: now,
      attributes: { readOnly: false, hidden: false, system: false, archive: true },
      content: bytesToBase64(bytes),
      contentEncoding: 'base64',
    };
    deps.rememberFile(item);
    return item;
  }

  /**
   * Picks the engine that can actually read an archive.
   *
   * ZIP and TAR are parsed in the renderer. RAR, 7-Zip and the bzip2/lzma TARs
   * are read by the local server, which runs libarchive's WASM and already owns
   * the file, so a large archive is never copied into the renderer to be parsed
   * there. An extension can lie, so a file the local engine refuses is offered
   * to the server when its magic bytes name a format the server can read.
   */
  async function openArchiveBackend(source: FileItem, password?: string): Promise<ArchiveBackend> {
    const fileName = deps.realEntryName(source);
    const declared = formatFromExtension(fileName);
    // An entry mounted from another archive is not a file on disk: the server
    // has no path to open for it.
    const onDisk = deps.isSystemDrive(source.driveId) && !source.archiveRoot;
    // A format only the server reads, or one too large for the renderer's
    // in-memory parsers: both are the server's, and it streams either of them.
    if (onDisk && (isServerReadable(declared) || source.size > RENDERER_ARCHIVE_MAX_BYTES)) {
      return loadServerArchiveBackend(deps.realAbsolutePath(source), fileName, declared, password);
    }
    try {
      return await loadArchiveBackend(await deps.readFileBytes(source, { unlimited: true }), fileName, password);
    } catch (error) {
      if (onDisk && error instanceof UnsupportedArchiveError && isServerReadable(error.format)) {
        return loadServerArchiveBackend(deps.realAbsolutePath(source), fileName, error.format, password);
      }
      if (!onDisk && isServerReadable(declared)) {
        throw new Error(tGlobal('zipServerDrive').replace('{format}', formatLabel(declared)), { cause: error });
      }
      throw error;
    }
  }

  /**
   * Mounts any archive this build can read into a virtual root inside the
   * catalogue. The format dispatch decides what is openable, so a RAR or a 7Z
   * is refused here naming its format, instead of being handed to JSZip and
   * reported as a corrupt file.
   */
  async function openArchive(source: FileItem, password?: string): Promise<string> {
    const backend = await openArchiveBackend(source, password);
    const root = deps.realAbsolutePath(source);
    const items: FileItem[] = [];
    for (const entry of backend.entries) {
      const relative = archiveEntryPath(entry.name);
      const fullPath = deps.childAbsolutePath(root, relative);
      const fullName = relative.split('\\').pop()!;
      const dot = entry.dir ? -1 : fullName.lastIndexOf('.');
      items.push({
        id: `archive_${source.driveId}_${fullPath}`,
        driveId: source.driveId,
        path: deps.getParentPath(fullPath),
        name: dot > 0 ? fullName.slice(0, dot) : fullName,
        ext: dot > 0 ? fullName.slice(dot + 1) : '',
        fullName,
        isDirectory: entry.dir,
        size: entry.dir ? 0 : entry.size,
        createdAt: entry.date.toISOString(),
        modifiedAt: entry.date.toISOString(),
        attributes: { readOnly: true, hidden: false, system: false, archive: true },
        archiveRoot: root,
        archiveEntry: entry.name,
      });
    }
    mounts.set(`${source.driveId}|${root}`, { source, root, backend, items });
    deps.saveToStorage();
    return root;
  }

  /** Serialises a collected tree into the bytes of the chosen format. */
  async function serializeArchive(
    entries: { path: string; dir: boolean; bytes?: Uint8Array; mtime?: Date }[],
    format: OpenableArchiveFormat,
  ): Promise<Uint8Array> {
    if (format === 'ZIP') {
      const zip = new JSZip();
      for (const entry of entries) {
        // Directories are registered explicitly so empty folders survive.
        if (entry.dir) zip.folder(entry.path);
        else zip.file(entry.path, entry.bytes ?? new Uint8Array(0));
      }
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    }
    const tar = buildTar(
      entries.map((entry) => ({ name: entry.path, dir: entry.dir, bytes: entry.bytes, mtime: entry.mtime })),
    );
    return format === 'TAR.GZ' ? gzip(tar) : tar;
  }

  /**
   * Creates an archive of the requested format from real bytes, including
   * recursively listed disk folders.
   *
   * The tree is collected once and each format serialises it, so ZIP and TAR
   * cannot drift apart; the stored name always carries the extension of the
   * format that was actually written, never a compound one.
   */
  async function createArchive(
    items: FileItem[],
    archiveName: string,
    targetDriveId: string,
    targetPath: string,
    format: OpenableArchiveFormat = 'ZIP',
  ): Promise<FileItem> {
    const collected: { path: string; dir: boolean; bytes?: Uint8Array; mtime?: Date }[] = [];

    const add = async (item: FileItem, prefix = ''): Promise<void> => {
      const relative = `${prefix}${deps.realEntryName(item)}`;
      archiveEntryPath(relative);
      if (item.isDirectory) {
        collected.push({ path: relative, dir: true });
        const path = deps.realAbsolutePath(item);
        if (deps.isSystemDrive(item.driveId) && !item.archiveRoot) {
          const response = await fetchWithRetry(
            `${API_BASE}/api/list?driveId=${encodeURIComponent(item.driveId)}&path=${encodeURIComponent(path)}`,
            { retries: 0, timeoutMs: 20000 },
          );
          if (!response.ok) throw new Error((await response.json()).error);
          const children = (await response.json()) as FileItem[];
          for (const child of children) await add({ ...child, driveId: item.driveId, path }, `${relative}/`);
        } else {
          for (const child of deps.getFiles(item.driveId, path)) await add(child, `${relative}/`);
        }
        return;
      }
      collected.push({
        path: relative,
        dir: false,
        // An archive is only an archive with every byte: the central directory
        // that lists its entries sits at the end of the file.
        bytes: await deps.readFileBytes(item, { unlimited: true }),
        mtime: new Date(item.modifiedAt || Date.now()),
      });
    };
    for (const item of items) await add(item);

    const bytes = await serializeArchive(collected, format);
    const result = await writeBytes(targetDriveId, targetPath, withFormatExtension(archiveName, format), bytes);
    if (deps.isSystemDrive(targetDriveId)) await deps.loadSystemDriveDirectory(targetDriveId, targetPath);
    return result;
  }

  /**
   * Extracts one large member on the server, which writes it straight to disk.
   *
   * Reading it here and posting it back would put the whole entry in this
   * process's memory and then again in the server's, which is why a member of
   * several gigabytes could not be extracted even once the archive opened. Only
   * a member above the renderer's own threshold takes this path, and only when
   * both the archive and the destination are real paths on disk. Returns the
   * bytes the server wrote, or null when it could not do it, so the caller keeps
   * its old path instead of failing an extraction that used to work.
   */
  async function streamEntryToDisk(
    archiveFile: FileItem,
    entry: ArchiveEntry,
    targetDriveId: string,
    targetPath: string,
    relative: string,
    onBytes: (bytesSoFar: number) => void,
    signal?: AbortSignal,
    job?: string,
  ): Promise<number | null> {
    const folder = deps.normalizePath(targetPath);
    try {
      return await extractServerEntry(
        {
          archivePath: deps.realAbsolutePath(archiveFile),
          fileName: deps.realEntryName(archiveFile),
          format: formatFromExtension(deps.realEntryName(archiveFile)),
          entryName: entry.name,
          destination: deps.absoluteForDrive(targetDriveId, deps.childAbsolutePath(folder, relative)),
          root: deps.absoluteForDrive(targetDriveId, folder),
          job,
        },
        onBytes,
        signal,
      );
    } catch (error) {
      // An existing destination is a refusal, and a cancelled run is not
      // something to retry in memory: both end the extraction here.
      if (error instanceof ArchiveDestinationExistsError) throw error;
      if (signal?.aborted) throw error;
      log.warn('Streamed extraction failed; falling back to a buffered read', error);
      return null;
    }
  }

  async function extractArchive(
    archiveFile: FileItem,
    targetDriveId: string,
    targetPath: string,
    selectedEntry?: string,
    hooks?: ExtractHooks,
  ): Promise<number> {
    if (getArchiveSource(targetDriveId, targetPath)) throw new Error(tGlobal('zipReadOnly'));
    const backend = mountedArchiveBackend(archiveFile) ?? (await openArchiveBackend(archiveFile));
    const wanted = selectedEntry?.replace(/\/+$/, '');
    const entries = backend.entries.filter(
      (entry) => !wanted || entry.name === wanted || entry.name.startsWith(`${wanted}/`),
    );
    const stripPrefix = selectedEntry ? selectedEntry.replace(/\/$/, '').split('/').slice(0, -1).join('/') : '';
    // The uncompressed total is the only honest denominator: the archive's own
    // size says nothing about how much has to be written.
    const totalBytes = entries.reduce((sum, entry) => sum + (entry.dir ? 0 : entry.size), 0);
    let writtenBytes = 0;
    let extractedCount = 0;
    // Named here so the server can hold and release this very run. The id is
    // what the task sends back to pause and resume, so it has to exist before
    // the first member starts.
    const job = `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    hooks?.onJob?.(job);
    try {
      for (const entry of entries) {
        // Checked between members too: a cancel must stop the rest of the
        // archive, not only the member that happened to be streaming.
        hooks?.signal?.throwIfAborted();
        const relative = archiveEntryPath(stripPrefix ? entry.name.slice(stripPrefix.length + 1) : entry.name);
        const parts = relative.split('\\');
        const directories = entry.dir ? parts : parts.slice(0, -1);
        let parent = deps.normalizePath(targetPath);
        for (const dir of directories) {
          if (deps.isSystemDrive(targetDriveId)) {
            const result = await deps.callServerFs('mkdir', {
              path: deps.childAbsolutePath(parent, dir),
              archiveRoot: targetPath,
            });
            if (!result) throw new Error(deps.lastCallError());
          } else if (!deps.getFiles(targetDriveId, parent).some((f) => f.isDirectory && f.name === dir)) {
            deps.createDirectory(targetDriveId, parent, dir);
          }
          parent = deps.childAbsolutePath(parent, dir);
        }
        if (!entry.dir) {
          // Named before the first byte, so the task can say what it is writing
          // instead of only how far it has got.
          hooks?.onEntry?.(relative);
          const streamable =
            deps.isSystemDrive(targetDriveId) &&
            deps.isSystemDrive(archiveFile.driveId) &&
            !archiveFile.archiveRoot &&
            entry.size > RENDERER_ARCHIVE_MAX_BYTES;
          // A member the server writes reports as it streams, so a single huge
          // entry moves the bar instead of sitting at zero until it finishes.
          const streamed = streamable
            ? await streamEntryToDisk(
                archiveFile,
                entry,
                targetDriveId,
                targetPath,
                relative,
                (bytesSoFar) => hooks?.onProgress?.(writtenBytes + bytesSoFar, totalBytes),
                hooks?.signal,
                job,
              )
            : null;
          if (streamed === null) {
            const bytes = await entry.read();
            await writeBytes(targetDriveId, targetPath, relative, bytes);
            writtenBytes += bytes.length;
          } else {
            writtenBytes += streamed;
          }
          hooks?.onProgress?.(writtenBytes, totalBytes);
          extractedCount++;
        }
      }
    } finally {
      if (deps.isSystemDrive(targetDriveId)) await deps.loadSystemDriveDirectory(targetDriveId, targetPath);
    }
    return extractedCount;
  }

  return {
    findArchive,
    getArchiveSource,
    findMountedItem,
    writeBytes,
    openArchive,
    createArchive,
    extractArchive,
  };
}
