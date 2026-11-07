const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { renameWithRetry } = require('./fsRetry.cjs');

/**
 * Streaming reader for ZIP, so an archive of any size opens.
 *
 * JSZip needs the whole file in one buffer, which is why a 2 GB ZIP used to be
 * refused rather than loaded: the renderer would have asked for gigabytes. A ZIP
 * is made for this: the central directory at the end lists every entry with its
 * offset, so listing reads the directory only, and an entry is read from its
 * local header to its compressed bytes and inflated as it is written out.
 *
 * Faithful to what the rest of the app already does with ZIP: names honour the
 * UTF-8 flag, directories end with `/`, and an encrypted entry is reported as
 * needing its password rather than as damage. What is gone is the per-entry CRC
 * check -- verifying it needs the whole decompressed entry -- so a damaged entry
 * is discovered by whatever consumes it instead of here.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_SIGNATURE = 0x06064b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** A ZIP comment is at most 64 KB, so the end record is inside this tail. */
const TAIL_BYTES = 66 * 1024;

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** ZIP stores CP437 unless the UTF-8 flag is set; UTF-8 with a latin1 fallback covers both writers. */
function decodeName(bytes, flags) {
  if (flags & 0x800) return utf8Strict.decode(bytes);
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return Buffer.from(bytes).toString('latin1');
  }
}

function dosDate(time, date) {
  return new Date(
    1980 + (date >> 9),
    ((date >> 5) & 0xf) - 1,
    date & 0x1f,
    time >> 11,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

async function readAt(handle, offset, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return buffer.subarray(0, bytesRead);
}

/** Last end-of-central-directory record, walking back past the comment. */
function findEndRecord(tail) {
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) === EOCD_SIGNATURE) return index;
  }
  return -1;
}

/**
 * Directory location and entry count, with the ZIP64 record when the 32-bit
 * fields are saturated. ZIP64 is what makes an archive over 4 GB (or one with
 * more than 65 535 entries) readable, so it is not an optional branch here.
 */
async function readDirectoryLocation(handle, stat) {
  const tail = await readAt(handle, Math.max(0, stat.size - TAIL_BYTES), Math.min(TAIL_BYTES, stat.size));
  const at = findEndRecord(tail);
  if (at < 0) throw new Error('not a zip: no end of central directory');
  const end = tail.subarray(at);
  let entries = end.readUInt16LE(10);
  let size = end.readUInt32LE(12);
  let offset = end.readUInt32LE(16);

  const locatorAt = at - 20;
  if (offset === 0xffffffff || size === 0xffffffff || entries === 0xffff) {
    const locator = tail.subarray(locatorAt, locatorAt + 20);
    if (locator.length < 20 || locator.readUInt32LE(0) !== EOCD64_LOCATOR_SIGNATURE) return { entries, size, offset };
    const recordAt = Number(locator.readBigUInt64LE(8));
    const record = await readAt(handle, recordAt, 56);
    if (record.readUInt32LE(0) !== EOCD64_SIGNATURE) return { entries, size, offset };
    entries = Number(record.readBigUInt64LE(32));
    size = Number(record.readBigUInt64LE(40));
    offset = Number(record.readBigUInt64LE(48));
  }
  return { entries, size, offset };
}

/** ZIP64 extended information: only the fields the 32-bit header saturated. */
function readZip64Extra(extra, wanted) {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      const values = {};
      let cursor = at + 4;
      for (const field of ['size', 'compressed', 'offset']) {
        if (wanted.has(field) && cursor + 8 <= at + 4 + length) {
          values[field] = Number(extra.readBigUInt64LE(cursor));
          cursor += 8;
        }
      }
      return values;
    }
    at += 4 + length;
  }
  return {};
}

/** Every entry the central directory declares, without touching the entry data. */
async function listZip(target) {
  const handle = await fs.promises.open(target, 'r');
  try {
    const stat = await handle.stat();
    const directory = await readDirectoryLocation(handle, stat);
    if (directory.offset + directory.size > stat.size) throw new Error('not a zip: directory outside the file');
    const bytes = await readAt(handle, directory.offset, directory.size);
    const entries = [];
    let at = 0;
    while (at + 46 <= bytes.length && bytes.readUInt32LE(at) === CENTRAL_SIGNATURE) {
      const flags = bytes.readUInt16LE(at + 8);
      const method = bytes.readUInt16LE(at + 10);
      const date = dosDate(bytes.readUInt16LE(at + 12), bytes.readUInt16LE(at + 14));
      const crc = bytes.readUInt32LE(at + 16);
      let compressed = bytes.readUInt32LE(at + 20);
      let size = bytes.readUInt32LE(at + 24);
      const nameLength = bytes.readUInt16LE(at + 28);
      const extraLength = bytes.readUInt16LE(at + 30);
      const commentLength = bytes.readUInt16LE(at + 32);
      let offset = bytes.readUInt32LE(at + 42);
      const name = decodeName(bytes.subarray(at + 46, at + 46 + nameLength), flags);
      const wanted = new Set();
      if (size === 0xffffffff) wanted.add('size');
      if (compressed === 0xffffffff) wanted.add('compressed');
      if (offset === 0xffffffff) wanted.add('offset');
      if (wanted.size > 0) {
        const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
        const values = readZip64Extra(extra, wanted);
        size = values.size ?? size;
        compressed = values.compressed ?? compressed;
        offset = values.offset ?? offset;
      }
      at += 46 + nameLength + extraLength + commentLength;
      if (!name) continue;
      const dir = name.endsWith('/');
      entries.push({
        name: dir ? name.replace(/\/+$/, '') : name,
        dir,
        size: dir ? 0 : size,
        date: date.getTime(),
        method,
        flags,
        crc,
        compressed,
        offset,
      });
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * A sibling of the destination, so the rename that publishes the file stays on
 * the same volume and cannot leave half an entry under the real name.
 */
function temporaryPathFor(destination) {
  const folder = path.win32.dirname(destination);
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.win32.join(folder, `.omni-${unique}.part`);
}

/**
 * Holds the stream while the extraction is paused. The chunk in the callback is
 * one chunk, and everything behind it backs up through the pipeline, so nothing
 * is read ahead and resuming continues the same run.
 */
function pausable(gate) {
  return new Transform({
    transform(chunk, _encoding, done) {
      gate.wait().then(
        () => done(null, chunk),
        (error) => done(error),
      );
    },
  });
}

/** Counts what flows past it, so a caller can show progress per chunk. */
function counted(onBytes) {
  return new Transform({
    transform(chunk, _encoding, done) {
      onBytes(chunk.length);
      done(null, chunk);
    },
  });
}

/** Writes one entry into a writable, inflated as it goes; nothing is buffered. */
async function pipeZipEntry(target, entryName, writable, onBytes, signal, gate) {
  const handle = await fs.promises.open(target, 'r');
  try {
    const entries = await listZip(target);
    const entry = entries.find((candidate) => !candidate.dir && candidate.name === entryName);
    if (!entry) {
      const error = new Error(`Entry not found: ${entryName}`);
      error.archiveCode = 'entry-not-found';
      throw error;
    }
    if (entry.flags & 0x1) {
      const error = new Error('This archive is encrypted and needs its password');
      error.archiveCode = 'password-required';
      error.archiveReason = 'required';
      throw error;
    }
    if (entry.method !== 0 && entry.method !== 8) {
      const error = new Error(`Unsupported ZIP compression method ${entry.method}`);
      error.archiveCode = 'read-failed';
      throw error;
    }
    const header = await readAt(handle, entry.offset, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      const error = new Error('Damaged local header');
      error.archiveCode = 'read-failed';
      throw error;
    }
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const end = start + entry.compressed;
    const source = fs.createReadStream(target, { start, end: Math.max(start, end - 1) });
    // Progress is counted on the way past, not measured afterwards: the whole
    // point of this path is that no copy of the entry is kept.
    const steps = [source];
    if (entry.method === 8) steps.push(zlib.createInflateRaw());
    // Held before the counter: while paused, progress must not creep forward.
    if (gate) steps.push(pausable(gate));
    if (onBytes) steps.push(counted(onBytes));
    steps.push(writable);
    // `pipeline` owns the cleanup: a renderer that hangs up -- a cancelled
    // preview, a closed tab -- or a disk that fills up destroys the read side
    // and settles this promise, instead of leaving an unhandled error behind.
    // An aborted signal (a cancelled extraction) tears the whole chain down and
    // settles this promise with an AbortError.
    await pipeline(steps, { signal });
  } finally {
    await handle.close();
  }
}

/** Bytes of one entry, written to the socket; the archive is never buffered. */
async function streamZipEntry(target, entryName, res) {
  await pipeZipEntry(target, entryName, res);
}

/**
 * Writes one entry to a file, so extracting a multi-gigabyte member costs this
 * process nothing but the chunk in flight. The entry appears under its final
 * name only once it is complete.
 */
async function extractZipEntryTo(target, entryName, destination, onBytes, signal, gate, io = fs) {
  const temporary = temporaryPathFor(destination);
  const out = fs.createWriteStream(temporary, { flags: 'wx' });
  try {
    await pipeZipEntry(target, entryName, out, onBytes, signal, gate);
    // The entry is complete in the temporary, so the only thing left is its
    // name; Windows can refuse that for a moment and the retry covers it.
    await renameWithRetry(io, temporary, destination);
    return (await fs.promises.stat(destination)).size;
  } catch (error) {
    out.destroy();
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { listZip, streamZipEntry, extractZipEntryTo, temporaryPathFor };
