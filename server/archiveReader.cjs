const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const zipStream = require('./zipStream.cjs');
const { renameWithRetry } = require('./fsRetry.cjs');
const { pathToFileURL } = require('node:url');

/**
 * Reading archives the renderer cannot read: RAR, 7-Zip, TAR.BZ2, TAR.LZMA.
 *
 * The browser build of libarchive.js needs a Web Worker and the packaged renderer
 * cannot start one from `file://`, so the same WASM runs here on a worker thread;
 * RAR is read by unrar because this project's libarchive was built without
 * cryptographic support. Both readers stay warm for the archive being browsed, so
 * listing and then opening one entry parses the archive once.
 *
 * It is a module rather than another route block because it owns a subsystem: two
 * WASM readers, a password probe and the entry reader. The only thing it asks the
 * server for is the path check.
 */
function registerArchiveRoutes(app, deps) {
  // `assertArchiveDestination` is optional so the module can be mounted on its
  // own in tests; production always passes it, and the write route below rejects
  // a destination outside the root it was given when it is missing.
  const { assertSafePath, assertArchiveDestination } = deps;

  /**
   * A pause switch a writer waits on. While it is shut the stream holds one
   * chunk and everything behind it backs up, so nothing is read ahead and
   * releasing it continues the very same extraction instead of starting the
   * member again from its first byte.
   */
  function createGate() {
    let paused = false;
    const waiters = [];
    const listeners = new Set();
    const set = (value) => {
      paused = value;
      for (const listener of listeners) listener(value);
      if (!value) for (const resolve of waiters.splice(0)) resolve();
    };
    return {
      pause: () => set(true),
      resume: () => set(false),
      get paused() {
        return paused;
      },
      wait() {
        return paused ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  /** Extractions in flight, by the id the renderer chose for its own run. */
  const extractionJobs = new Map();

  // -------------------------------------------------------------------------
  // Archives that only libarchive can read (RAR, 7-Zip, TAR.BZ2, TAR.LZMA)
  //
  // The renderer mounts ZIP and TAR by itself, but it has no reader for these
  // formats. The browser build of libarchive.js needs a Web Worker, and the
  // packaged app loads the renderer from file://, where Chromium refuses to
  // start one -- so the same WASM runs here instead, on a worker thread, next to
  // the file it is reading. A 2 GB RAR never travels through the renderer: this
  // side only lists names, sizes and dates, and hands back one entry at a time.
  // Nothing here writes to disk; extraction stays on the renderer's existing,
  // already-validated path, so these routes add no new write surface.
  // -------------------------------------------------------------------------

  /**
   * Comlink in libarchive.js expects the DOM worker surface (addEventListener,
   * postMessage), which a worker thread does not have. It also resolves its own
   * worker with `new URL('.', import.meta.url).pathname`, which on Windows
   * yields `/C:/...` and makes the bundled worker unloadable, so the worker is
   * created here instead and only handed over.
   */
  function adoptWorkerThread(worker) {
    return {
      postMessage: (message, transfer) => worker.postMessage(message, transfer),
      addEventListener: (_type, listener) => worker.on('message', (data) => listener({ data })),
      removeEventListener: (_type, listener) => worker.off('message', listener),
      start: () => {},
      terminate: () => worker.terminate(),
    };
  }

  let libarchivePromise = null;
  function loadLibarchive() {
    if (libarchivePromise) return libarchivePromise;
    libarchivePromise = (async () => {
      const resolved = path.dirname(require.resolve('libarchive.js/dist/libarchive-node.mjs'));
      // Inside the packaged app `node_modules` lives in app.asar, which a worker
      // thread cannot start from; build.asarUnpack puts this package on disk next
      // to it, and that copy is what actually runs.
      const unpacked = resolved.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      const dist = fs.existsSync(unpacked) ? unpacked : resolved;
      const module = await import(pathToFileURL(path.join(dist, 'libarchive-node.mjs')).href);
      const workerUrl = pathToFileURL(path.join(dist, 'worker-bundle-node.mjs'));
      module.Archive.init({ getWorker: () => adoptWorkerThread(new Worker(workerUrl, { execArgv: [] })) });
      return module.Archive;
    })().catch((error) => {
      // A failed load is not cached: the next request retries instead of being
      // stuck with a rejected promise for the life of the process.
      libarchivePromise = null;
      throw error;
    });
    return libarchivePromise;
  }

  // Opening an archive costs ~170 ms (WASM instantiation) while reading one
  // entry costs ~2 ms, so a single reader is kept warm for the archive being
  // browsed; without it, extracting a hundred files would rebuild the engine a
  // hundred times. Requests are queued because that slot is shared, and two
  // browsed archives simply take turns reopening it.
  //
  // Known cost: libarchive.js has no streaming API, so the archive being
  // browsed is held in memory here (and copied into the WASM heap) until another
  // one replaces it. That is one copy on the machine that owns the file, instead
  // of a second one in the renderer, which is the part this avoids.
  let libarchiveQueue = Promise.resolve();
  let warmArchive = null;

  async function closeWarmArchive() {
    if (!warmArchive) return;
    const { reader } = warmArchive;
    warmArchive = null;
    await reader.close().catch(() => {});
  }

  function withLibarchiveArchive(target, password, task) {
    const run = libarchiveQueue.then(async () => {
      const Archive = await loadLibarchive();
      const stat = await fs.promises.stat(target);
      const key = `${target}|${stat.size}|${stat.mtimeMs}|${password || ''}`;
      let reader = warmArchive && warmArchive.key === key ? warmArchive.reader : null;
      if (!reader) {
        await closeWarmArchive();
        const file = new File([await fs.promises.readFile(target)], path.win32.basename(target));
        reader = await Archive.open(file);
        if (password) await reader.usePassword(password);
        warmArchive = { key, reader };
      }
      return task(reader);
    });
    libarchiveQueue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // -------------------------------------------------------------------------
  // RAR, read by unrar
  //
  // The libarchive wasm this project vendors was compiled without cryptographic
  // support -- it literally carries "RAR encryption support unavailable" -- so a
  // password-protected RAR came back as its own ciphertext and an archive with
  // encrypted names listed nothing at all, with no error to show for it. RAR is
  // therefore read by unrar, the reference implementation compiled to wasm,
  // which also reads every unencrypted RAR the previous path handled. The other
  // formats stay on libarchive.
  // -------------------------------------------------------------------------

  let unrarPromise = null;
  function loadUnrar() {
    if (unrarPromise) return unrarPromise;
    unrarPromise = (async () => {
      const resolved = path.dirname(require.resolve('node-unrar-js/package.json'));
      // Same as libarchive.js: inside the packaged app the module lives in
      // app.asar, and its wasm has to be loaded from a real file next to it.
      const unpacked = resolved.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      return require(fs.existsSync(unpacked) ? unpacked : resolved);
    })().catch((error) => {
      unrarPromise = null;
      throw error;
    });
    return unrarPromise;
  }

  /** A missing or wrong passphrase is not damage: the renderer turns this into its prompt. */
  function archivePasswordRequired(reason) {
    const error = new Error(
      reason === 'invalid' ? 'Wrong password for this archive' : 'This archive is encrypted and needs its password',
    );
    error.archiveCode = 'password-required';
    error.archiveReason = reason;
    return error;
  }

  function mapUnrarError(error) {
    if (error && error.reason === 'ERAR_MISSING_PASSWORD') return archivePasswordRequired('required');
    if (error && error.reason === 'ERAR_BAD_PASSWORD') return archivePasswordRequired('invalid');
    return error;
  }

  // unrar keeps its archive in memory, so one reader is kept warm for the archive
  // being browsed, exactly like the libarchive path: extracting a hundred files
  // would otherwise re-read and re-parse the archive a hundred times. Requests
  // take turns because the slot is shared.
  let unrarQueue = Promise.resolve();
  let warmRar = null;

  function withUnrarArchive(target, password, task) {
    const run = unrarQueue.then(async () => {
      const { createExtractorFromData } = await loadUnrar();
      const stat = await fs.promises.stat(target);
      const key = `${target}|${stat.size}|${stat.mtimeMs}|${password || ''}`;
      let extractor = warmRar && warmRar.key === key ? warmRar.extractor : null;
      if (!extractor) {
        warmRar = null;
        const data = await fs.promises.readFile(target);
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        extractor = await createExtractorFromData({
          data: buffer,
          ...(password ? { password } : {}),
        });
        warmRar = { key, extractor };
      }
      return task(extractor);
    });
    unrarQueue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  const archiveEntryName = (value) =>
    String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');

  /** unrar reports files only, so the folders each path implies are synthesised here. */
  function rarListing(headers) {
    const listed = new Map();
    const stamp = (header) => {
      const parsed = Date.parse(String(header.time || ''));
      return Number.isFinite(parsed) ? parsed : Date.now();
    };
    for (const header of headers) {
      const name = archiveEntryName(header.name);
      if (!name) continue;
      const directory = Boolean(header.flags && header.flags.directory);
      listed.set(name, {
        name,
        dir: directory,
        size: directory ? 0 : Number(header.unpSize) || 0,
        date: stamp(header),
      });
      if (directory) continue;
      for (const parent of parentDirectories(name)) {
        if (!listed.has(parent)) listed.set(parent, { name: parent, dir: true, size: 0, date: Date.now() });
      }
    }
    return [...listed.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Lists a RAR with unrar. An archive whose names are encrypted cannot be listed
   * without the password, and one whose data is encrypted is refused without it
   * too: mounting a folder whose bytes cannot be read would only fail later.
   */
  /**
   * Reading this much of one entry is what proves a password: decrypting the
   * smallest encrypted file at open costs about what the first copy would. An
   * archive whose smallest encrypted file is larger is left to fail when that
   * file is actually read, rather than stalling the open on it.
   */
  const PASSWORD_PROBE_MAX_BYTES = 8 * 1024 * 1024;

  async function inspectRar(target, password) {
    return withUnrarArchive(target, password, async (extractor) => {
      let list;
      try {
        list = extractor.getFileList();
      } catch (error) {
        throw mapUnrarError(error);
      }
      const headers = [...list.fileHeaders];
      const encrypted = headers.filter((header) => header.flags && header.flags.encrypted && !header.flags.directory);
      if (encrypted.length > 0) {
        if (!password) throw archivePasswordRequired('required');
        // Encrypted names were already proven by listing them; only a readable
        // listing over encrypted data leaves the password unverified.
        if (!list.arcHeader.flags.headerEncrypted) {
          const probe = encrypted.sort((a, b) => a.unpSize - b.unpSize)[0];
          if (probe && probe.unpSize <= PASSWORD_PROBE_MAX_BYTES) {
            try {
              [...extractor.extract({ files: [archiveEntryName(probe.name)] }).files];
            } catch (error) {
              throw mapUnrarError(error);
            }
          }
        }
      }
      return rarListing(headers);
    });
  }

  async function readRarEntry(target, name, password) {
    return withUnrarArchive(target, password, async (extractor) => {
      try {
        const listed = [...extractor.getFileList().fileHeaders];
        const known = listed.some((header) => !header.flags.directory && archiveEntryName(header.name) === name);
        if (!known) throw new Error(`Entry not found: ${name}`);
        const files = [...extractor.extract({ files: [name] }).files];
        const extraction = files[0] && files[0].extraction;
        return extraction ? new Uint8Array(extraction) : new Uint8Array(0);
      } catch (error) {
        throw mapUnrarError(error);
      }
    });
  }

  /**
   * Turns an engine failure into something the renderer can translate. The
   * libarchive bridge reports a missing passphrase in prose, so that wording is
   * the only signal available there; anything unrecognised stays a plain read
   * failure rather than being guessed at.
   */
  function archiveErrorPayload(error) {
    const message = String((error && error.message) || error || '');
    if (error && error.archiveCode) return { code: error.archiveCode, reason: error.archiveReason, error: message };
    if (/passphrase|password|encrypt/i.test(message)) return { code: 'password-required', error: message };
    if (/^Entry not found:/i.test(message)) return { code: 'entry-not-found', error: message };
    return { code: 'read-failed', error: message };
  }

  /**
   * First bytes of every archive family this route can be pointed at, except
   * TAR: that one keeps its marker further in and is checked separately below.
   *
   * libarchive.js reports a file it cannot recognise as an archive with no
   * entries instead of as an error -- its warning goes to the worker's console,
   * which nobody reads -- so a text file renamed to `.rar` would mount as an
   * empty folder. This is deliberately not keyed by extension: a RAR named .zip
   * must still open, because the bytes are what decide, not the name.
   */
  const ARCHIVE_SIGNATURES = [
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], // RAR 4 and 5
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7-Zip
    [0x50, 0x4b, 0x03, 0x04], // ZIP
    [0x50, 0x4b, 0x05, 0x06], // empty ZIP
    [0x42, 0x5a, 0x68], // bzip2
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
    [0x1f, 0x8b], // gzip
  ];

  /**
   * Where a TAR keeps the only bytes that identify it. Its first 257 bytes are
   * the name and the numeric fields of the first header, so looking at the head
   * of the file as if every family started with a magic left plain `.tar`
   * rejected as "not an archive", even though the modal offers TAR.
   */
  const TAR_MAGIC_OFFSET = 257;
  const TAR_MAGIC = 'ustar';
  // One TAR block: far enough to reach the magic and still a single small read.
  const ARCHIVE_HEAD_BYTES = 512;

  async function readArchiveHead(target) {
    const handle = await fs.promises.open(target, 'r');
    try {
      const buffer = Buffer.alloc(ARCHIVE_HEAD_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  function assertArchiveSignature(head) {
    // An empty file and a bare LZMA stream carry no signature; let the engine
    // have the final word on those instead of guessing here.
    if (head.length === 0) return;
    if (ARCHIVE_SIGNATURES.some((signature) => signature.every((byte, index) => head[index] === byte))) return;
    if (head[0] === 0x5d) return; // LZMA alone: 0x5d is its properties byte
    // POSIX writes "ustar\0" and GNU writes "ustar  ", so the letters are what
    // is compared. A pre-POSIX TAR carries no magic at all and still needs the
    // engine to have the final word on it, which is what the routes do next.
    const magicEnd = TAR_MAGIC_OFFSET + TAR_MAGIC.length;
    if (head.length >= magicEnd && head.toString('latin1', TAR_MAGIC_OFFSET, magicEnd) === TAR_MAGIC) return;
    throw new Error('The file does not start like any archive format');
  }

  /**
   * RAR 4 and RAR 5 share this prefix. The engine is chosen from the bytes, not
   * the extension, so a RAR named `.zip` still takes the path that can read it.
   */
  const RAR_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];
  const isRarHead = (head) => RAR_SIGNATURE.every((byte, index) => head[index] === byte);

  /**
   * Ceiling on the archive the in-memory reader is allowed to open.
   *
   * libarchive.js has no streaming API, so opening an archive copies it several
   * times before a single entry is read: into a Node Buffer, into the Blob handed
   * to the worker, into the worker's own copy, and into the WASM heap. Measuring
   * a stored archive at 128 MB and at 256 MB put the listing peak at ~5.1x the
   * file size, with ~3.1x still resident while the warm reader stays open, and
   * another ~2-3x on top to pull out one entry of that size. The growth is linear
   * in the file size, so without a ceiling a multi-gigabyte archive asks for tens
   * of gigabytes and takes the app down instead of failing.
   *
   * 512 MB keeps that peak around 2.6 GB, which fits a machine with 8 GB of RAM.
   * OMNI_ARCHIVE_MAX_BYTES raises it for a user who knows what their RAM is;
   * moving the reader onto the file itself is what would remove the ceiling.
   */
  const DEFAULT_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
  const ARCHIVE_MAX_BYTES = (() => {
    const override = Number(process.env.OMNI_ARCHIVE_MAX_BYTES);
    return Number.isFinite(override) && override > 0 ? Math.floor(override) : DEFAULT_ARCHIVE_MAX_BYTES;
  })();

  async function resolveArchiveTarget(value) {
    const target = assertSafePath(value);
    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat) return { status: 404, payload: { code: 'not-found', error: 'Archive not found' } };
    if (!stat.isFile()) return { status: 400, payload: { code: 'not-a-file', error: 'Not a file' } };
    return { target, stat };
  }

  /**
   * Refusal for an archive the in-memory readers would have to load whole.
   *
   * This is deliberately not checked when the request arrives any more: the
   * streaming reader below opens an archive of any size with a fixed amount of
   * memory, so the ceiling only guards the fallback the WASM engines still
   * need. Checking it up front is what refused archives that could be read.
   */
  function tooLargePayload(stat) {
    if (stat.size <= ARCHIVE_MAX_BYTES) return null;
    return {
      code: 'too-large',
      sizeBytes: stat.size,
      limitBytes: ARCHIVE_MAX_BYTES,
      error: `Archive is ${stat.size} bytes, over the ${ARCHIVE_MAX_BYTES}-byte in-memory reader limit`,
    };
  }

  // -------------------------------------------------------------------------
  // Streaming reader: libarchive's command line
  //
  // Both WASM engines above need the archive as one contiguous buffer (plus a
  // copy in the worker and another in the WASM heap), which is why they carry a
  // ceiling: a 2 GB archive asked for ~10 GB and took the app down, so it was
  // refused instead. Windows ships bsdtar (libarchive 3.8) at
  // %SystemRoot%\System32\tar.exe, and its `-t`/`-xO` modes walk headers and
  // write one entry to stdout without holding the archive: any size, memory
  // proportional to one chunk. What this build cannot do is decrypt -- it
  // answers "Encryption is not supported" -- so encrypted archives fall back to
  // unrar below, ceiling included.
  // -------------------------------------------------------------------------

  let bsdtarResolved;
  function bsdtarBinary() {
    if (bsdtarResolved !== undefined) return bsdtarResolved;
    const override = process.env.OMNI_BSDTAR;
    // Empty means "pretend this machine has no bsdtar": the suite uses it to
    // keep the in-memory ceiling and its refusal honest.
    if (override === '') {
      bsdtarResolved = null;
      return null;
    }
    const candidates = override
      ? [override]
      : [...(process.env.SystemRoot ? [path.join(process.env.SystemRoot, 'System32', 'tar.exe')] : []), 'tar'];
    for (const candidate of candidates) {
      try {
        const version = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        if (/bsdtar/i.test(version)) {
          bsdtarResolved = candidate;
          return candidate;
        }
      } catch {
        // Not this candidate: try the next one.
      }
    }
    bsdtarResolved = null;
    return null;
  }

  /** Runs bsdtar to completion and hands back its stdout as text. */
  function runBsdtar(binary, args) {
    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: 120000, windowsHide: true, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              Object.assign(new Error(String(stderr || error.message).trim()), { bsdtarStderr: String(stderr || '') }),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  /**
   * Names, sizes and folders of an archive, read by bsdtar without holding the
   * archive in memory.
   *
   * Names come from `-t`, which prints them exactly (spaces and Unicode
   * included), and sizes from `-tv`, paired by position because both listings
   * walk the archive in the same order. The date column is not parsed: bsdtar
   * prints it in the machine's own locale ("Okt", "JM-dn"), which is not a
   * format to depend on, so every entry carries the archive's timestamp
   * instead of inventing one per entry.
   */
  async function bsdtarListing(binary, target, stat) {
    const [namesOut, verboseOut] = await Promise.all([
      runBsdtar(binary, ['-t', '-f', target]),
      runBsdtar(binary, ['-tv', '-f', target]),
    ]);
    const names = namesOut.split(/\r?\n/).filter((line) => line.length > 0);
    const sizes = verboseOut.split(/\r?\n/).map((line) => {
      // mode, links, owner, group, size -- the first five columns of `-tv`.
      const match = line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s/);
      return match ? Number(match[1]) : undefined;
    });
    const date = Number.isFinite(stat.mtimeMs) ? Math.round(stat.mtimeMs) : Date.now();
    const listed = new Map();
    names.forEach((raw, index) => {
      const name = raw.replace(/\\/g, '/').replace(/^\/+/, '');
      const dir = name.endsWith('/');
      const clean = dir ? name.replace(/\/+$/, '') : name;
      if (!clean) return;
      listed.set(clean, { name: clean, dir, size: dir ? 0 : (sizes[index] ?? 0), date });
      for (const parent of parentDirectories(clean)) {
        if (!listed.has(parent)) listed.set(parent, { name: parent, dir: true, size: 0, date });
      }
    });
    return [...listed.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Listing through bsdtar, or `null` when this machine cannot stream or the
   * archive needs the engines that can decrypt. The caller then falls back with
   * the ceiling applied.
   */
  async function listWithBsdtar(target, stat) {
    const binary = bsdtarBinary();
    if (!binary) return null;
    try {
      return await bsdtarListing(binary, target, stat);
    } catch {
      return null;
    }
  }

  /**
   * Bytes of one entry from the engines that can decrypt, or that only answer
   * whole entries. Both routes share this: a socket and a file want the same
   * bytes, and only what happens to them afterwards differs.
   */
  async function readEntryBytes(target, head, name, password) {
    if (isRarHead(head)) return readRarEntry(target, name, password);
    return withLibarchiveArchive(target, password, async (reader) => {
      // The library throws an opaque TypeError for a path it never listed, so
      // the entry is checked against the listing first. That listing is cached
      // by the reader after the first call, which the browse already paid for.
      const listed = await reader.getFilesArray();
      const known = listed.some(
        (item) => item.file && `${item.path || ''}${item.file.name}`.replace(/^\/+/, '') === name,
      );
      if (!known) throw new Error(`Entry not found: ${name}`);
      const file = await reader.extractSingleFile(name);
      return new Uint8Array(await file.arrayBuffer());
    });
  }

  /**
   * Writes one entry straight from bsdtar's stdout to the response.
   *
   * Resolves with what happened so the route can still answer with a status
   * code: nothing has been sent while `bytes` is 0, which is the case when the
   * archive is encrypted or the entry is not there. Once a byte has gone out the
   * status is already decided, so a later failure destroys the response instead
   * of pretending it succeeded.
   */
  function streamBsdtarEntry(binary, target, name, res) {
    return new Promise((resolve) => {
      const child = spawn(binary, ['-xO', '-f', target, '--', name], { windowsHide: true });
      let stderr = '';
      let bytes = 0;
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        res.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 8192) stderr += chunk.toString();
      });
      child.on('error', (error) => settle({ ok: false, bytes: 0, aborted: false, error: error.message }));
      child.on('close', (code) => {
        if (code === 0) {
          res.end();
          settle({ ok: true, bytes });
          return;
        }
        const message = stderr.trim() || `bsdtar exited with ${code}`;
        if (bytes === 0) {
          settle({
            ok: false,
            bytes,
            aborted: false,
            entryMissing: /not found in archive/i.test(message),
            error: message,
          });
          return;
        }
        res.destroy();
        settle({ ok: false, bytes, aborted: true, error: message });
      });
      // The renderer hanging up mid-entry must stop the extractor, not leave it
      // writing into a socket nobody reads.
      res.on('close', () => {
        if (!res.writableEnded) child.kill();
      });
      res.on('error', () => child.kill());
    });
  }

  /** The refusal a cancelled extraction ends with, so the route can stay quiet. */
  function cancelledError() {
    return Object.assign(new Error('Extraction cancelled'), { name: 'AbortError', archiveCode: 'cancelled' });
  }

  /**
   * Writes one entry from bsdtar's stdout into a file of its own, through a
   * sibling temporary path: a failed read leaves nothing under the real name.
   */
  async function extractBsdtarEntry(binary, target, name, destination, onBytes, signal, gate) {
    if (signal && signal.aborted) throw cancelledError();
    const temporary = zipStream.temporaryPathFor(destination);
    const out = fs.createWriteStream(temporary, { flags: 'wx' });
    const child = spawn(binary, ['-xO', '-f', target, '--', name], { windowsHide: true });
    let stderr = '';
    let bytes = 0;
    // Cancelling must stop the extractor, not let it keep writing a file that
    // nobody is going to look at.
    const onAbort = () => child.kill();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    // bsdtar has no pause of its own. Not draining its stdout is what makes it
    // block on the pipe, so the file stops growing where the user paused it.
    const unsubscribe = gate
      ? gate.subscribe((paused) => (paused ? child.stdout.pause() : child.stdout.resume()))
      : null;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (onBytes) onBytes(chunk.length);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8192) stderr += chunk.toString();
    });
    const exited = new Promise((resolve) => child.on('close', resolve));
    try {
      await new Promise((resolve, reject) => {
        out.on('error', reject);
        child.on('error', reject);
        out.on('finish', resolve);
        child.stdout.pipe(out);
      });
      const code = await exited;
      if (signal && signal.aborted) throw cancelledError();
      if (code !== 0) {
        const message = stderr.trim() || `bsdtar exited with ${code}`;
        throw Object.assign(new Error(message), { entryMissing: /not found in archive/i.test(message) });
      }
      // bsdtar wrote the whole entry; only its name is left, and Windows answers
      // EPERM to that while a scan holds it.
      await renameWithRetry(fs, temporary, destination);
      return bytes;
    } catch (error) {
      child.kill();
      out.destroy();
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw signal && signal.aborted ? cancelledError() : error;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (unsubscribe) unsubscribe();
    }
  }

  /** A file the extraction would overwrite is refused before a byte is written. */
  async function assertDestinationFree(destination) {
    const existing = await fs.promises.lstat(destination).catch(() => null);
    if (!existing) return;
    const error = new Error(`A file with that name already exists: ${path.win32.basename(destination)}`);
    error.archiveCode = 'exists';
    throw error;
  }

  /** Publishes bytes that had to be read whole: engines that decrypt cannot stream. */
  async function writeWholeEntry(destination, bytes, onBytes, signal, gate) {
    const temporary = zipStream.temporaryPathFor(destination);
    try {
      // Checked before and after the write: these bytes were already read whole,
      // so this is the only thing keeping a cancelled run from publishing them.
      if (signal && signal.aborted) throw cancelledError();
      if (gate) await gate.wait();
      await fs.promises.writeFile(temporary, bytes, { flag: 'wx' });
      // A pause that lands while these bytes are being written keeps the file
      // off its real name until the run is released again.
      if (gate) await gate.wait();
      if (signal && signal.aborted) throw cancelledError();
      await renameWithRetry(fs, temporary, destination);
      if (onBytes) onBytes(bytes.length);
      return bytes.length;
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Writes one member straight to its destination, choosing the reader that can
   * do it without holding the entry: ZIP by its own stream, a large archive by
   * bsdtar, and the decrypting engines by reading the entry (they cannot stream).
   */
  async function writeEntryToFile(
    target,
    head,
    stat,
    name,
    destination,
    password,
    onBytes,
    signal,
    gate,
    overwrite = false,
  ) {
    // The route already asked, unless the conflict prompt answered that this name
    // is meant to be replaced: one guard, reached by both callers.
    if (!overwrite) await assertDestinationFree(destination);
    if (isZipHead(head)) return zipStream.extractZipEntryTo(target, name, destination, onBytes, signal, gate);
    const binary = stat.size > ARCHIVE_MAX_BYTES ? bsdtarBinary() : null;
    if (binary) {
      try {
        return await extractBsdtarEntry(binary, target, name, destination, onBytes, signal, gate);
      } catch (error) {
        // A cancelled run must not fall through to a second reader.
        if (signal && signal.aborted) throw cancelledError();
        if (error.entryMissing) {
          throw Object.assign(new Error(`Entry not found: ${name}`), { archiveCode: 'entry-not-found' });
        }
        // bsdtar cannot decrypt. Below the ceiling the engines can, so they get
        // the entry; past it there is no reader left and the failure stands.
        const refused = tooLargePayload(stat);
        if (refused) throw Object.assign(new Error(error.message), { archiveCode: 'read-failed' });
      }
    }
    return writeWholeEntry(destination, await readEntryBytes(target, head, name, password), onBytes, signal, gate);
  }

  /** Folders the paths imply, so a listing is a tree whatever listed it. */
  function withParents(list) {
    const listed = new Map(list.map((entry) => [entry.name, entry]));
    for (const entry of list) {
      for (const parent of parentDirectories(entry.name)) {
        if (!listed.has(parent)) listed.set(parent, { name: parent, dir: true, size: 0, date: entry.date });
      }
    }
    return [...listed.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** ZIP has a reader of its own that needs no ceiling: see `zipStream.cjs`. */
  const isZipHead = (head) => head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

  /** `dir` entries are synthesised: libarchive.js only exposes file entries. */
  function parentDirectories(name) {
    const directories = [];
    let cursor = name.lastIndexOf('/');
    while (cursor > 0) {
      const parent = name.slice(0, cursor);
      directories.push(parent);
      cursor = parent.lastIndexOf('/');
    }
    return directories;
  }

  app.post('/api/archives/inspect', async (req, res) => {
    const body = req.body || {};
    let target;
    let stat;
    try {
      const resolved = await resolveArchiveTarget(body.path);
      if (resolved.payload) return res.status(resolved.status).json(resolved.payload);
      target = resolved.target;
      stat = resolved.stat;
    } catch (error) {
      return res.status(400).json({ code: 'not-found', error: error.message });
    }
    try {
      const head = await readArchiveHead(target);
      assertArchiveSignature(head);
      // ZIP is listed from its central directory, which is exact about names,
      // sizes and dates and needs the tail of the file only.
      if (isZipHead(head)) return res.json({ entries: withParents(await zipStream.listZip(target)) });
      // Past the ceiling the WASM engines cannot help, so the archive goes to
      // bsdtar, which walks the headers without holding the file. Below it they
      // stay: their listings keep the true entry dates and the password flow.
      const streamed = stat.size > ARCHIVE_MAX_BYTES ? await listWithBsdtar(target, stat) : null;
      if (streamed) return res.json({ entries: streamed });
      // Only the fallback is bounded, so only the fallback refuses.
      const refused = tooLargePayload(stat);
      if (refused) return res.status(413).json(refused);
      if (isRarHead(head)) return res.json({ entries: await inspectRar(target, body.password) });
      const entries = await withLibarchiveArchive(target, body.password, async (reader) => {
        const files = await reader.getFilesArray();
        const listed = new Map();
        for (const item of files) {
          if (!item.file) continue;
          const name = `${item.path || ''}${item.file.name}`.replace(/^\/+/, '');
          const modified = Number(item.file.lastModified);
          listed.set(name, {
            name,
            dir: false,
            size: Number(item.file.size) || 0,
            date: Number.isFinite(modified) ? Math.round(modified / 1e6) : Date.now(),
          });
          for (const directory of parentDirectories(name)) {
            if (!listed.has(directory))
              listed.set(directory, { name: directory, dir: true, size: 0, date: Date.now() });
          }
        }
        return [...listed.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
      res.json({ entries });
    } catch (error) {
      const payload = archiveErrorPayload(error);
      console.warn('Archive listing failed:', payload.error);
      res.status(400).json(payload);
    }
  });

  app.post('/api/archives/entry', async (req, res) => {
    const body = req.body || {};
    const name = typeof body.entry === 'string' ? body.entry : '';
    if (!name) return res.status(400).json({ code: 'not-found', error: 'entry is required' });
    let target;
    let stat;
    try {
      const resolved = await resolveArchiveTarget(body.path);
      if (resolved.payload) return res.status(resolved.status).json(resolved.payload);
      target = resolved.target;
      stat = resolved.stat;
    } catch (error) {
      return res.status(400).json({ code: 'not-found', error: error.message });
    }
    try {
      const head = await readArchiveHead(target);
      assertArchiveSignature(head);
      // The entry is streamed to the socket, so a multi-gigabyte member of a
      // multi-gigabyte archive never sits in this process's heap.
      if (isZipHead(head)) {
        await zipStream.streamZipEntry(target, name, res);
        return;
      }
      const binary = stat.size > ARCHIVE_MAX_BYTES ? bsdtarBinary() : null;
      if (binary) {
        const streamed = await streamBsdtarEntry(binary, target, name, res);
        if (streamed.ok) return;
        if (streamed.aborted) return;
        if (streamed.entryMissing)
          return res.status(400).json({ code: 'entry-not-found', error: `Entry not found: ${name}` });
      }
      const refused = tooLargePayload(stat);
      if (refused) return res.status(413).json(refused);
      res.type('application/octet-stream').send(Buffer.from(await readEntryBytes(target, head, name, body.password)));
    } catch (error) {
      const payload = archiveErrorPayload(error);
      console.warn('Archive entry read failed:', name, payload.error);
      // Once bytes are on the wire the status is already sent, so all that is
      // left is to drop the connection: the renderer then sees a failed read
      // instead of a short entry pretending to be complete.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.status(400).json(payload);
    }
  });

  /**
   * Extracts one entry straight to a path on disk.
   *
   * Reading the entry into the renderer and posting it back cost the file twice
   * in memory, once on each process, which is why a multi-gigabyte member could
   * not be extracted even after the archive itself opened. Here the server reads
   * the entry and writes it, so the only copy in flight is one chunk. The write
   * goes to a sibling temporary file and is renamed when complete, so a failure
   * never leaves a short file under the real name, and an existing file is
   * refused before anything is touched.
   */
  app.post('/api/archives/extract', async (req, res) => {
    const body = req.body || {};
    const name = typeof body.entry === 'string' ? body.entry : '';
    if (!name) return res.status(400).json({ code: 'not-found', error: 'entry is required' });
    let target;
    let stat;
    let destination;
    try {
      const resolved = await resolveArchiveTarget(body.path);
      if (resolved.payload) return res.status(resolved.status).json(resolved.payload);
      target = resolved.target;
      stat = resolved.stat;
      destination = assertSafePath(body.target);
      // Same rule as `/api/fs/write-bytes`: the destination has to be inside the
      // folder the caller declared, and no junction may stand in the way.
      if (assertArchiveDestination) await assertArchiveDestination(body.root, destination);
      await fs.promises.mkdir(path.win32.dirname(destination), { recursive: true });
    } catch (error) {
      return res.status(400).json({ code: 'not-found', error: error.message });
    }
    try {
      const head = await readArchiveHead(target);
      assertArchiveSignature(head);
      // The streaming readers are the unbounded ones; the engines below hold the
      // archive whole, so they keep the ceiling they always had.
      if (!isZipHead(head) && stat.size > ARCHIVE_MAX_BYTES && !bsdtarBinary()) {
        return res.status(413).json(tooLargePayload(stat));
      }
      // Every refusal that answers with a status happens before the first byte
      // of the body: from then on the answer is a progress stream, and a status
      // cannot be changed once one line of it has gone out. `overwrite` is the
      // conflict prompt's answer: the caller asked for this name to be replaced,
      // and the temporary + rename below still means a failed write never leaves
      // a short file under the real name.
      if (body.overwrite !== true) await assertDestinationFree(destination);
      // The renderer names its own run, so it can hold and release the write
      // while this request stays open.
      const jobId = typeof body.job === 'string' && body.job ? body.job : '';
      const gate = jobId ? createGate() : null;
      if (jobId) extractionJobs.set(jobId, gate);
      // Cancelling in the UI closes this request. Without noticing that, the
      // server would finish writing a file nobody wants and leave it on disk.
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) {
          controller.abort();
          // A paused writer is waiting on the gate, not on the socket: releasing
          // it is what lets the abort reach the stream and the cleanup run.
          if (gate) gate.resume();
        }
        if (jobId) extractionJobs.delete(jobId);
      });
      let opened = false;
      const open = () => {
        if (opened) return;
        opened = true;
        res.status(200).type('application/x-ndjson');
      };
      // One line of JSON per update, at most ten a second: the renderer moves its
      // bar from these, so a member of several gigabytes stops looking hung
      // while the server is still writing it.
      let written = 0;
      let lastReport = 0;
      const report = (chunk) => {
        written += chunk.length;
        if (controller.signal.aborted) return;
        const now = Date.now();
        if (now - lastReport < 100) return;
        lastReport = now;
        open();
        res.write(`${JSON.stringify({ type: 'progress', bytes: written })}\n`);
      };
      let bytes;
      try {
        bytes = await writeEntryToFile(
          target,
          head,
          stat,
          name,
          destination,
          body.password,
          report,
          controller.signal,
          gate,
          body.overwrite === true,
        );
      } catch (error) {
        // A cancelled extraction is not a failure: the temporary file is already
        // gone and the socket that asked for it is closed.
        if (controller.signal.aborted) {
          res.destroy();
          return;
        }
        const payload = archiveErrorPayload(error);
        console.warn('Archive entry extraction failed:', name, payload.error);
        if (opened) {
          res.end(`${JSON.stringify({ type: 'error', ...payload })}\n`);
          return;
        }
        const status = payload.code === 'entry-not-found' ? 404 : payload.code === 'exists' ? 409 : 400;
        res.status(status).json(payload);
        return;
      }
      open();
      res.end(`${JSON.stringify({ type: 'done', ok: true, path: destination, bytes })}\n`);
    } catch (error) {
      const payload = archiveErrorPayload(error);
      console.warn('Archive entry extraction failed:', name, payload.error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = payload.code === 'entry-not-found' ? 404 : payload.code === 'exists' ? 409 : 400;
      res.status(status).json(payload);
    }
  });

  /**
   * Holds or releases an extraction the renderer already started.
   *
   * The write lives in the request above, so pausing cannot arrive through it:
   * the id the caller chose is the handle for both directions, and an unknown id
   * is a run that finished, failed or belonged to another window.
   */
  function setExtractionPaused(req, res, paused) {
    const jobId = typeof (req.body || {}).job === 'string' ? req.body.job : '';
    const job = jobId ? extractionJobs.get(jobId) : undefined;
    if (!job) return res.status(404).json({ code: 'not-found', error: 'No such extraction' });
    if (paused) job.pause();
    else job.resume();
    res.json({ ok: true, paused: job.paused });
  }

  app.post('/api/archives/extract/pause', (req, res) => setExtractionPaused(req, res, true));
  app.post('/api/archives/extract/resume', (req, res) => setExtractionPaused(req, res, false));
}

module.exports = { registerArchiveRoutes };
