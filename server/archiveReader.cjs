const fs = require('fs');
const path = require('path');
const { Worker } = require('node:worker_threads');
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
  const { assertSafePath } = deps;

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
   * First bytes of every archive family this route can be pointed at.
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

  async function readArchiveHead(target) {
    const handle = await fs.promises.open(target, 'r');
    try {
      const buffer = Buffer.alloc(8);
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
    // Refused before the signature check and before the engine loads: this is a
    // memory ceiling, not a judgement about the format.
    if (stat.size > ARCHIVE_MAX_BYTES)
      return {
        status: 413,
        payload: {
          code: 'too-large',
          sizeBytes: stat.size,
          limitBytes: ARCHIVE_MAX_BYTES,
          error: `Archive is ${stat.size} bytes, over the ${ARCHIVE_MAX_BYTES}-byte in-memory reader limit`,
        },
      };
    return { target };
  }

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
    try {
      const resolved = await resolveArchiveTarget(body.path);
      if (resolved.payload) return res.status(resolved.status).json(resolved.payload);
      target = resolved.target;
    } catch (error) {
      return res.status(400).json({ code: 'not-found', error: error.message });
    }
    try {
      const head = await readArchiveHead(target);
      assertArchiveSignature(head);
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
    try {
      const resolved = await resolveArchiveTarget(body.path);
      if (resolved.payload) return res.status(resolved.status).json(resolved.payload);
      target = resolved.target;
    } catch (error) {
      return res.status(400).json({ code: 'not-found', error: error.message });
    }
    try {
      const head = await readArchiveHead(target);
      assertArchiveSignature(head);
      if (isRarHead(head)) {
        const rarBytes = await readRarEntry(target, name, body.password);
        return res.type('application/octet-stream').send(Buffer.from(rarBytes));
      }
      const bytes = await withLibarchiveArchive(target, body.password, async (reader) => {
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
      res.type('application/octet-stream').send(Buffer.from(bytes));
    } catch (error) {
      const payload = archiveErrorPayload(error);
      console.warn('Archive entry read failed:', name, payload.error);
      res.status(400).json(payload);
    }
  });
}

module.exports = { registerArchiveRoutes };
