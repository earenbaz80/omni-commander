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
import type { ConflictResolution, FileItem } from '../types';
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

/** A destination an extraction found already taken, and the facts to judge it. */
export interface ExtractConflict {
  /** The member's path inside the archive, which is what the prompt lists. */
  entry: string;
  /** Absolute path the member would land on. */
  destination: string;
  /** Name of the file already sitting there. */
  name: string;
  sourceSize?: number;
  sourceModified?: number;
  destinationSize?: number;
  destinationModified?: number;
  /** Same size and same date, so overwriting this member would change nothing. */
  identical?: boolean;
}

/** What the person answered to one of those, and whether it covers the rest. */
export interface ExtractConflictAnswer {
  action: ConflictResolution;
  /** The same answer for every later taken name in this run. */
  applyToAll: boolean;
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
  /**
   * A name the destination already has. The answer decides that member, and with
   * `applyToAll` decides the rest of the run too. Without it the write keeps
   * refusing the name, which is what every caller but the window wants.
   */
  onConflict?: (conflict: ExtractConflict) => Promise<ExtractConflictAnswer>;
  /** Aborting stops the run and leaves nothing under the real names. */
  signal?: AbortSignal;
}

export interface ArchiveOps {
  findArchive(driveId: string, path: string): ArchiveMount | undefined;
  getArchiveSource(driveId: string, path: string): FileItem | undefined;
  /** An entry mounted from any archive, for `getFileById`. */
  findMountedItem(id: string): FileItem | undefined;
  writeBytes(
    driveId: string,
    root: string,
    relative: string,
    bytes: Uint8Array,
    options?: { overwrite?: boolean },
  ): Promise<FileItem>;
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

  async function writeBytes(
    driveId: string,
    root: string,
    relative: string,
    bytes: Uint8Array,
    options: { overwrite?: boolean } = {},
  ): Promise<FileItem> {
    if (getArchiveSource(driveId, root)) throw new Error(tGlobal('zipReadOnly'));
    const safe = archiveEntryPath(relative);
    // Kept drive-relative for the catalogue entry, which indexes panels by that
    // form; only the request to the server needs the drive letter.
    const target = deps.childAbsolutePath(root, safe);
    if (deps.isSystemDrive(driveId)) {
      const replace = options.overwrite ? '&overwrite=1' : '';
      const response = await fetchWithRetry(
        `${API_BASE}/api/fs/write-bytes?path=${encodeURIComponent(deps.absoluteForDrive(driveId, target))}&root=${encodeURIComponent(deps.absoluteForDrive(driveId, root))}${replace}`,
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
    const listed = deps.isSystemDrive(driveId)
      ? undefined
      : deps.getFiles(driveId, parent).find((f) => deps.realEntryName(f).toLowerCase() === fullName.toLowerCase());
    if (listed) {
      if (!options.overwrite) throw new Error(tGlobal('zipErrExists').replace('{name}', fullName));
      // The catalogue lists these very objects, so replacing a file is an update
      // of the entry that is there, not a second entry carrying the same name.
      listed.size = bytes.length;
      listed.content = bytesToBase64(bytes);
      listed.contentEncoding = 'base64';
      listed.modifiedAt = new Date().toISOString();
      deps.saveToStorage();
      return listed;
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

  /** What already sits on a destination name, or null when it is free. */
  async function existingFileAt(
    driveId: string,
    parentPath: string,
    name: string,
  ): Promise<{ size?: number; modified?: number; listed?: FileItem } | null> {
    if (deps.isSystemDrive(driveId)) {
      const answer = (await deps.callServerFs('stat', {
        paths: [deps.absoluteForDrive(driveId, deps.childAbsolutePath(parentPath, name))],
      })) as { entries?: { size: number; isDirectory: boolean; modified?: number }[] } | null;
      const found = answer?.entries?.[0];
      if (!found) return null;
      return {
        size: found.isDirectory ? undefined : found.size,
        // The server reports the last-write time in milliseconds already, so the
        // prompt can compare it with the member's own date instead of showing a
        // dash the user has to guess about.
        modified: typeof found.modified === 'number' ? found.modified : undefined,
      };
    }
    const listed = deps
      .getFiles(driveId, parentPath)
      .find((file) => deps.realEntryName(file).toLowerCase() === name.toLowerCase());
    if (!listed) return null;
    const modified = Date.parse(listed.modifiedAt);
    return {
      size: listed.isDirectory ? undefined : listed.size,
      modified: Number.isFinite(modified) ? modified : undefined,
      listed,
    };
  }

  /**
   * The next name in Explorer's numbered series (`nota (2).txt`), checked against
   * the folder the extraction is writing into rather than assumed to be free.
   */
  async function freeSiblingName(driveId: string, parentPath: string, name: string): Promise<string> {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    for (let index = 2; index < 1000; index++) {
      const candidate = `${base} (${index})${extension}`;
      if (!(await existingFileAt(driveId, parentPath, candidate))) return candidate;
    }
    throw new Error(tGlobal('zipErrExists').replace('{name}', name));
  }

  /** Moves the file that is in the way aside, under the next free name. */
  async function moveExistingAside(
    driveId: string,
    parentPath: string,
    name: string,
    existing: { listed?: FileItem },
  ): Promise<void> {
    const renamed = await freeSiblingName(driveId, parentPath, name);
    if (deps.isSystemDrive(driveId)) {
      const result = await deps.callServerFs('rename', {
        path: deps.absoluteForDrive(driveId, deps.childAbsolutePath(parentPath, name)),
        newName: renamed,
      });
      if (!result) throw new Error(deps.lastCallError() || tGlobal('zipErrExists').replace('{name}', name));
      return;
    }
    const listed = existing.listed;
    if (!listed) return;
    const dot = renamed.lastIndexOf('.');
    listed.fullName = renamed;
    listed.name = dot > 0 ? renamed.slice(0, dot) : renamed;
    listed.ext = dot > 0 ? renamed.slice(dot + 1) : '';
    deps.saveToStorage();
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
    overwrite = false,
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
          overwrite,
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
    // An answer given with "always" covers every later taken name in this run,
    // and only this run: the next extraction asks again.
    let rememberedAnswer: ConflictResolution | undefined;
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
          // A name the destination already holds is a question when the caller
          // can answer it. Everything below decides where this member lands, or
          // whether it lands at all.
          let destinationRelative = relative;
          let overwrite = false;
          let skip = false;
          const leaf = relative.split('\\').pop()!;
          // Only a caller that can answer is worth the round trip: without a
          // prompt the write below already refuses the name, and probing every
          // member would cost one request per file on a large archive.
          const taken = hooks?.onConflict ? await existingFileAt(targetDriveId, parent, leaf) : null;
          if (taken) {
            // A ZIP keeps its dates to the even second, so a file written from
            // this very member can sit up to that far from the date the archive
            // states. Closer than that is the same file: the prompt can say so
            // instead of asking a question whose every answer writes the same
            // bytes, and "overwrite if different" has to decide with the same
            // definition or it would skip a file that only shares its size.
            const identical =
              taken.size !== undefined &&
              taken.size === entry.size &&
              taken.modified !== undefined &&
              Math.abs(taken.modified - entry.date.getTime()) < 2000;
            let action: ConflictResolution | undefined = rememberedAnswer;
            if (!action && hooks?.onConflict) {
              const answer = await hooks.onConflict({
                entry: relative,
                destination: deps.absoluteForDrive(targetDriveId, deps.childAbsolutePath(parent, leaf)),
                name: leaf,
                sourceSize: entry.size,
                sourceModified: entry.date.getTime(),
                destinationSize: taken.size,
                destinationModified: taken.modified,
                identical,
              });
              action = answer.action;
              if (answer.applyToAll) rememberedAnswer = answer.action;
            }
            if (action === 'skip') skip = true;
            else if (action === 'overwrite') overwrite = true;
            else if (action === 'overwrite-if-different') {
              // Same bytes and same date: rewriting would only move the date.
              // Same size with another date is a different file, and skipping it
              // is what this answer exists to prevent.
              skip = identical;
              overwrite = !skip;
            } else if (action === 'rename') {
              const kept = await freeSiblingName(targetDriveId, parent, leaf);
              destinationRelative = `${relative.slice(0, relative.length - leaf.length)}${kept}`;
            } else if (action === 'rename-old') {
              await moveExistingAside(targetDriveId, parent, leaf, taken);
            } else if (action === 'cancel') {
              // Backing out of the prompt ends the run where a cancel does, so
              // nothing else is written under a name nobody answered.
              hooks?.signal?.throwIfAborted();
              throw new Error(tGlobal('zipErrExists').replace('{name}', leaf));
            }
          }
          if (skip) {
            // A skipped member still counts as accounted for, or the bar would
            // stop short of the end with nothing left to write.
            writtenBytes += entry.size;
            hooks?.onProgress?.(writtenBytes, totalBytes);
            continue;
          }
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
                destinationRelative,
                (bytesSoFar) => hooks?.onProgress?.(writtenBytes + bytesSoFar, totalBytes),
                hooks?.signal,
                job,
                overwrite,
              )
            : null;
          if (streamed === null) {
            const bytes = await entry.read();
            await writeBytes(targetDriveId, targetPath, destinationRelative, bytes, { overwrite });
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
