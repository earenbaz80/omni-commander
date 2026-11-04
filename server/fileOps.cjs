/**
 * Everything the server does to real files: the cleanup routines, the copy and
 * move engine with its collision prompts, Send-To and the job runner on top.
 *
 * It used to be the second half of `server.cjs`. It is a factory because the
 * work shares the job table with the HTTP routes: the engine is handed the
 * bookkeeping it needs (snapshots, pause checks, the finished-job hook) instead
 * of reaching into the server, so a copy can be started from a test.
 *
 * Only the constants that describe Windows timeouts and the conflict answer
 * window are injected; everything else in this file is about the filesystem.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { once } = require('events');

const { assertSafePath } = require('./pathSafety.cjs');

function createFileOps(deps = {}) {
  const {
    noteFile,
    waitWhilePaused,
    sleep,
    finishJob,
    jobTickMs = 120,
    conflictAnswerMs = 5 * 60 * 1000,
    powershellTimeoutMs = 60000,
    wmiTimeoutMs = 300000,
  } = deps;

  const execFileAsync = promisify(execFile);
  // The moved code keeps the constant names it had in the server.
  const JOB_TICK_MS = jobTickMs;
  const CONFLICT_ANSWER_MS = conflictAnswerMs;
  const POWERSHELL_TIMEOUT_MS = powershellTimeoutMs;
  const WMI_TIMEOUT_MS = wmiTimeoutMs;

  const CLEANUP_TARGETS = {
    'user-temp': {
      resolve: () => process.env.TEMP || process.env.TMP || '',
      requiresAdmin: false,
    },
    'windows-temp': {
      resolve: () => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'),
      requiresAdmin: true,
    },
    prefetch: {
      resolve: () => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'Prefetch'),
      requiresAdmin: true,
    },
  };

  // Test hook: the suite points the user temp target at a scratch folder so it can
  // never delete the machine's real temporary files. It is an environment variable
  // and not a request field on purpose: a request must not be able to name the
  // folder that gets emptied.
  const CLEANUP_TEMP_OVERRIDE = String(process.env.OMNI_CLEANUP_USER_TEMP_ROOT || '').trim();

  // A pathologically large folder should not hold a request open forever.
  const CLEANUP_MAX_ENTRIES = 200000;

  /** Where a cleanup target points, whether or not it may be acted on. */
  function cleanupTargetPath(targetId) {
    const target = CLEANUP_TARGETS[targetId];
    if (!target) return '';
    const raw = targetId === 'user-temp' && CLEANUP_TEMP_OVERRIDE ? CLEANUP_TEMP_OVERRIDE : target.resolve();
    if (!raw) return '';
    try {
      return assertSafePath(raw);
    } catch {
      return '';
    }
  }

  /** Resolves a cleanup target to the one folder it is allowed to touch. */
  function resolveCleanupRoot(targetId) {
    if (!CLEANUP_TARGETS[targetId]) throw new Error(`Unknown cleanup target: ${String(targetId || '')}`);
    if (CLEANUP_TARGETS[targetId].requiresAdmin) {
      throw new Error(`${targetId} needs administrator rights`);
    }
    const root = cleanupTargetPath(targetId);
    if (!root) throw new Error(`No folder for cleanup target: ${String(targetId || '')}`);
    // Emptying a drive root would be the whole disk; refuse rather than trust that
    // TEMP is always somewhere sensible inside a user profile.
    if (/^[a-zA-Z]:\\$/.test(root)) throw new Error(`Refusing to clean a drive root: ${root}`);
    return root;
  }

  /** Clamps the age filter and turns it into the cutoff the walk compares against. */
  function cleanupAgeCutoff(minAgeDays) {
    return Date.now() - clampCleanupDays(minAgeDays) * 24 * 60 * 60 * 1000;
  }

  function clampCleanupDays(minAgeDays) {
    const days = Number(minAgeDays);
    if (!Number.isFinite(days) || days <= 0) return 0;
    return Math.min(Math.floor(days), 3650);
  }

  /**
   * Walks a cleanup root and returns the entries old enough to delete. A directory
   * is a removal candidate only when it is old itself and every entry under it is
   * a candidate, so a folder still holding something we must keep stays in place.
   * Reparse points (junctions, symlinks) are never followed: they can point
   * outside the root, and following one would delete files this operation has no
   * business touching.
   */
  async function scanCleanup(root, minAgeDays) {
    const cutoff = cleanupAgeCutoff(minAgeDays);
    const files = [];
    const dirs = [];
    let skipped = 0;
    let seen = 0;
    let truncated = false;

    async function walk(dir) {
      let entries = [];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        skipped += 1;
        return false;
      }
      let allCandidates = true;
      for (const entry of entries) {
        if (seen >= CLEANUP_MAX_ENTRIES) {
          truncated = true;
          allCandidates = false;
          break;
        }
        seen += 1;
        const full = path.win32.join(dir, entry.name);
        let stat = null;
        try {
          stat = await fs.promises.lstat(full);
        } catch {
          skipped += 1;
          allCandidates = false;
          continue;
        }
        if (stat.isSymbolicLink()) {
          skipped += 1;
          allCandidates = false;
          continue;
        }
        if (stat.isDirectory()) {
          const childrenAll = await walk(full);
          if (childrenAll && stat.mtimeMs < cutoff) dirs.push({ path: full, modifiedMs: stat.mtimeMs });
          if (!childrenAll) allCandidates = false;
        } else if (stat.isFile()) {
          if (stat.mtimeMs < cutoff) {
            files.push({ path: full, name: entry.name, size: stat.size, modifiedMs: stat.mtimeMs });
          } else {
            allCandidates = false;
          }
        } else {
          skipped += 1;
          allCandidates = false;
        }
      }
      return allCandidates;
    }

    await walk(root);
    return {
      files,
      dirs,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      skipped,
      truncated,
    };
  }

  /**
   * Deletes what the scan found, best effort. A file another program holds open
   * cannot be removed, so it is reported and the walk continues instead of
   * abandoning the rest of the folder.
   */
  async function runCleanup(root, minAgeDays) {
    const scan = await scanCleanup(root, minAgeDays);
    const failed = [];
    let freedBytes = 0;
    let deletedFiles = 0;
    let deletedDirs = 0;

    for (const file of scan.files) {
      try {
        const stat = await fs.promises.lstat(file.path).catch(() => null);
        // Gone or replaced by a folder since the scan: nothing to count.
        if (!stat || !stat.isFile()) continue;
        await fs.promises.unlink(file.path);
        freedBytes += stat.size;
        deletedFiles += 1;
      } catch (err) {
        failed.push({ path: file.path, message: err.code || err.message });
      }
    }

    // Deepest first: a parent can only be removed once its children are gone.
    for (const dir of [...scan.dirs].sort((a, b) => b.path.length - a.path.length)) {
      try {
        await fs.promises.rmdir(dir.path);
        deletedDirs += 1;
      } catch (err) {
        // ENOTEMPTY means a file inside survived (already reported above) and
        // ENOENT means someone else removed it first; neither is news.
        if (err.code !== 'ENOTEMPTY' && err.code !== 'ENOENT') {
          failed.push({ path: dir.path, message: err.code || err.message });
        }
      }
    }

    return {
      freedBytes,
      deletedFiles,
      deletedDirs,
      failed: failed.slice(0, 50),
      failedCount: failed.length,
      skipped: scan.skipped,
      truncated: scan.truncated,
    };
  }

  async function assertArchiveDestination(rootValue, target) {
    const root = assertSafePath(rootValue);
    const relative = path.win32.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith('..\\') || path.win32.isAbsolute(relative))
      throw new Error('Invalid destination');
    let cursor = target;
    while (true) {
      const stat = await fs.promises.lstat(cursor).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
        return null;
      });
      if (stat?.isSymbolicLink()) throw new Error('Destination contains a symbolic link');
      const parent = path.win32.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  /**
   * Sizes a tree before a transfer starts. Walks in batches instead of one entry
   * at a time: a folder like Program Files holds tens of thousands of files, and a
   * sequential walk left the job sitting at zero for minutes with nothing to show
   * for it. Reparse points are skipped so a junction cannot walk in circles.
   */
  async function measureTree(target) {
    let bytes = 0;
    let files = 0;
    const pending = [target];
    const MEASURE_BATCH = 32;

    while (pending.length > 0) {
      const batch = pending.splice(0, MEASURE_BATCH);
      const children = await Promise.all(
        batch.map(async (current) => {
          let stat;
          try {
            stat = await fs.promises.lstat(current);
          } catch {
            return [];
          }
          if (stat.isSymbolicLink()) return [];
          if (stat.isDirectory()) {
            try {
              const entries = await fs.promises.readdir(current);
              return entries.map((name) => path.win32.join(current, name));
            } catch {
              return [];
            }
          }
          bytes += stat.size;
          files += 1;
          return [];
        }),
      );

      for (const list of children) {
        for (const child of list) pending.push(child);
      }
    }

    return { bytes, files };
  }

  async function pathExists(target) {
    try {
      await fs.promises.access(target);
      return true;
    } catch {
      return false;
    }
  }

  async function uniqueName(dir, name) {
    const parsed = path.win32.parse(name);
    for (let i = 2; i < 1000; i++) {
      const candidate = `${parsed.name} (${i})${parsed.ext}`;
      if (!(await pathExists(path.win32.join(dir, candidate)))) return candidate;
    }
    return `${parsed.name} (${Date.now()})${parsed.ext}`;
  }

  // Collision policy: overwrite replaces, skip leaves the existing entry, rename
  // creates a unique sibling name (mirrors "Keep both files" in Explorer) and ask
  // parks the transfer until a human answers for this one destination.
  async function effectiveCollision(job, src, dest) {
    // An "apply to all" answer already settled the policy for the rest of the job.
    if (job.conflictOverride) return job.conflictOverride;
    if (job.collision !== 'ask') return job.collision;
    return awaitConflictAnswer(job, src, dest);
  }

  // Parks the transfer until the client answers. The snapshot exposes
  // `pendingConflict` so the UI can render the prompt, and the answer arrives
  // through POST /api/fs/job/:id/resolve. Cancel is honoured while waiting.
  // Real metadata for the two sides of a collision. The prompt shows it so the
  // user can tell a stale copy from a newer one instead of guessing by name, and
  // `identical` lets the UI point out the answer that changes nothing.
  async function conflictFact(target) {
    const stat = await fs.promises.lstat(target).catch(() => null);
    if (!stat) return { exists: false, isDirectory: false, size: 0, modifiedMs: 0 };
    return { exists: true, isDirectory: stat.isDirectory(), size: stat.size, modifiedMs: stat.mtimeMs };
  }

  async function awaitConflictAnswer(job, src, dest) {
    job.conflictDecision = null;
    const sourceFact = await conflictFact(src);
    const destinationFact = await conflictFact(dest);
    job.pendingConflict = {
      source: src,
      destination: dest,
      isDirectory: sourceFact.isDirectory || destinationFact.isDirectory,
      sourceSize: sourceFact.size,
      sourceModified: sourceFact.modifiedMs,
      destinationSize: destinationFact.size,
      destinationModified: destinationFact.modifiedMs,
      identical:
        sourceFact.exists &&
        destinationFact.exists &&
        !sourceFact.isDirectory &&
        !destinationFact.isDirectory &&
        sourceFact.size === destinationFact.size &&
        sourceFact.modifiedMs === destinationFact.modifiedMs,
    };
    const deadline = Date.now() + CONFLICT_ANSWER_MS;
    // A UI that died, crashed or simply walked away must not park this job for the
    // life of the process: the wait is bounded and expiry fails the transfer.
    while (!job.cancelled && job.pendingConflict && Date.now() < deadline) await sleep(JOB_TICK_MS);
    job.pendingConflict = null;
    if (job.cancelled) throw new Error('__cancelled__');
    if (job.conflictDecision == null) {
      throw new Error(`No answer for the conflict on ${dest} within ${Math.round(CONFLICT_ANSWER_MS / 1000)}s`);
    }
    const answer = job.conflictDecision;
    job.conflictDecision = null;
    return answer;
  }

  /**
   * Decides the final destination for one entry and returns null when it must be
   * skipped. Entries nested inside a copied tree come through here too, so a
   * policy covers the whole tree rather than only the top-level sources.
   */
  async function planDestination(src, dest, job) {
    if (!(await pathExists(dest))) return dest;
    const policy = await effectiveCollision(job, src, dest);
    if (policy === 'skip') {
      try {
        const stat = await fs.promises.lstat(src);
        if (stat.isFile()) job.bytesSkipped += stat.size;
      } catch {
        /* unreadable source is reported by the copy itself */
      }
      // Recorded here so every skip surfaces as a row, whether it happened at the
      // top level or deep inside a copied tree.
      const skipped = noteFile(job, dest, 0);
      skipped.status = 'skipped';
      return null;
    }
    if (policy === 'cancel') {
      // "Cancel the whole copy": one conflict is enough to stop the whole job.
      job.cancelled = true;
      throw new Error('Copy cancelled by the user');
    }
    if (policy === 'overwrite-if-different') {
      // Only replace when something actually changed; identical files are skipped
      // so an incremental re-copy does not rewrite everything.
      try {
        const s = await fs.promises.stat(src);
        const d = await fs.promises.stat(dest);
        if (s.size === d.size && s.mtimeMs === d.mtimeMs) {
          if (s.isFile()) job.bytesSkipped += s.size;
          const skipped = noteFile(job, dest, 0);
          skipped.status = 'skipped';
          return null;
        }
      } catch {
        /* fall through to overwrite */
      }
      return dest;
    }
    if (policy === 'rename-old') {
      // Keep the existing file under a backup name, then copy the new one in.
      const dir = path.win32.dirname(dest);
      const parsed = path.win32.parse(dest);
      let backup = path.win32.join(dir, `${parsed.name} (old)${parsed.ext}`);
      if (await pathExists(backup)) backup = path.win32.join(dir, `${parsed.name} (old) ${Date.now()}${parsed.ext}`);
      try {
        await fs.promises.rename(dest, backup);
      } catch {
        /* fall through, overwrite anyway */
      }
      return dest;
    }
    if (policy === 'rename') {
      const dir = path.win32.dirname(dest);
      return path.win32.join(dir, await uniqueName(dir, path.win32.basename(dest)));
    }
    return dest;
  }

  async function resolveDestination(src, destDir, job) {
    return planDestination(src, path.win32.join(destDir, path.win32.basename(src)), job);
  }

  // Interrupted-job recovery contract: a copy in progress writes to
  // `.<basename>.omni-part-<random>` in the SAME directory as the destination, so
  // the rename into the final name is atomic and same-volume. The original
  // destination (if any) is never touched until the temp is complete, so a
  // cancel, crash or server death leaves the previous file intact. A leftover
  // `*.omni-part-*` file therefore means an interrupted copy and is safe to
  // delete; nothing else ever reads it.
  function partNameFor(dest) {
    const dir = path.win32.dirname(dest);
    const base = path.win32.basename(dest);
    const suffix = `${process.pid.toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return path.win32.join(dir, `.${base}.omni-part-${suffix}`);
  }

  async function copyOneFile(src, dest, job) {
    const stat = await fs.promises.stat(src);
    await fs.promises.mkdir(path.win32.dirname(dest), { recursive: true });
    job.currentFile = dest;
    const entry = noteFile(job, dest, stat.size);
    const partPath = partNameFor(dest);
    const reader = fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
    const writer = fs.createWriteStream(partPath);
    const fileStart = Date.now();
    let bytesThisFile = 0;
    // A permanent 'error' listener for the whole transfer. Without it an async
    // write failure (ENOSPC, EIO) that lands outside the `once(writer, 'drain')`
    // window is an unhandled stream error that takes the whole in-process server
    // -- and every sibling job -- down with it. The promise below is the single
    // place a stream error is turned into a rejected job.
    let failTransfer;
    const transferError = new Promise((_, reject) => {
      failTransfer = reject;
    });
    writer.on('error', failTransfer);
    reader.on('error', failTransfer);
    const write = (async () => {
      for await (const chunk of reader) {
        await waitWhilePaused(job);
        bytesThisFile += chunk.length;
        if (!writer.write(chunk)) await once(writer, 'drain');
        job.copiedBytes += chunk.length;
        entry.copied = bytesThisFile;
        if (job.throttleBps > 0) {
          const expectedMs = (bytesThisFile / job.throttleBps) * 1000;
          const actualMs = Date.now() - fileStart;
          if (expectedMs > actualMs) await sleep(expectedMs - actualMs);
        }
      }
      await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())));
    })();
    try {
      // Whichever settles first wins: a completed write or a stream error.
      await Promise.race([write, transferError]);
    } catch (err) {
      reader.destroy();
      writer.destroy();
      // Remove the partial temp so an interrupted copy leaves no debris; the
      // original destination was never opened for writing, so it is intact.
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
      entry.status = 'error';
      throw err;
    } finally {
      writer.removeListener('error', failTransfer);
      reader.removeListener('error', failTransfer);
    }
    // The temp is complete: swap it into place. rename within one directory is
    // atomic, so a reader either sees the old file or the whole new one.
    try {
      await fs.promises.rename(partPath, dest);
    } catch (err) {
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
      entry.status = 'error';
      throw err;
    }
    entry.copied = stat.size;
    entry.status = 'done';
    // Timestamps and the write bit are part of the file, not decoration: an
    // incremental backup compares by date, and losing it would make every copied
    // file look newer than the original. chmod is how Windows expresses read-only.
    try {
      await fs.promises.utimes(dest, stat.atime, stat.mtime);
    } catch {}
    if (!(stat.mode & 0o200)) {
      try {
        await fs.promises.chmod(dest, 0o444);
      } catch {}
    }
  }

  // `alreadyPlanned` marks an entry whose destination the caller has already
  // cleared through resolveDestination, so it is not asked about a second time.
  // Entries below it are always planned, because a copied tree can collide at any
  // depth.
  async function copyTree(src, dest, job, alreadyPlanned = false) {
    await waitWhilePaused(job);
    const stat = await fs.promises.lstat(src);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      for (const name of await fs.promises.readdir(src)) {
        await copyTree(path.win32.join(src, name), path.win32.join(dest, name), job);
      }
      return;
    }
    const planned = alreadyPlanned ? dest : await planDestination(src, dest, job);
    if (!planned) {
      job.itemsSkipped += 1;
      return;
    }
    await copyOneFile(src, planned, job);
    job.itemsDone += 1;
  }

  // Same-volume moves are an instant rename; across volumes rename fails with
  // EXDEV and we fall back to copy-then-delete.
  async function moveTree(src, dest, job, alreadyPlanned = false) {
    await waitWhilePaused(job);
    try {
      await fs.promises.rename(src, dest);
      const measured = await measureTree(dest);
      job.copiedBytes += measured.bytes;
      job.itemsDone += Math.max(1, measured.files);
      // A same-volume move is one instant rename, so it lands as a single finished
      // row rather than a stream of per-byte updates.
      const moved = noteFile(job, dest, measured.bytes);
      moved.copied = measured.bytes;
      moved.status = 'done';
    } catch (err) {
      if (err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
      await copyTree(src, dest, job, alreadyPlanned);
      await fs.promises.rm(src, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  // Windows Recycle Bin access needs the VisualBasic FileSystem API, which is
  // only reachable through PowerShell. The helper script is generated once.
  let recycleScriptPath = null;
  let shortcutScriptPath = null;
  function ensureRecycleScript() {
    if (recycleScriptPath) return recycleScriptPath;
    const scriptPath = path.join(os.tmpdir(), `omnicommander-recycle-${process.pid}.ps1`);
    const lines = [
      'param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Targets)',
      'Add-Type -AssemblyName Microsoft.VisualBasic',
      'foreach ($t in $Targets) {',
      '  if (-not (Test-Path -LiteralPath $t)) { continue }',
      '  if ((Get-Item -LiteralPath $t -Force).PSIsContainer) {',
      "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($t, 'OnlyErrorDialogs', 'SendToRecycleBin')",
      '  } else {',
      "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($t, 'OnlyErrorDialogs', 'SendToRecycleBin')",
      '  }',
      '}',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
    recycleScriptPath = scriptPath;
    return scriptPath;
  }

  async function sendToRecycleBin(targets) {
    await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureRecycleScript(), ...targets],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: WMI_TIMEOUT_MS },
    );
  }

  async function deleteTarget(target, useTrash) {
    if (useTrash && process.platform === 'win32') {
      await sendToRecycleBin([target]);
      return;
    }
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3 });
  }

  // ---------------------------------------------------------------------------
  // "Send to" shortcuts
  //
  // The renderer names a destination from this table and the server resolves the
  // folder itself, so a request can never drop a .lnk wherever it likes. The
  // shortcut is written through WScript.Shell because a .lnk is a COM object, not
  // a format that can be typed out by hand.
  const SEND_TO_DESTINATIONS = {
    desktop: (known) => known.desktop,
    documents: (known) => known.documents,
    downloads: () => path.win32.join(process.env.USERPROFILE || '', 'Downloads'),
  };

  // Test hook, mirroring OMNI_CLEANUP_USER_TEMP_ROOT: every destination points at
  // one scratch folder, so a run never leaves shortcuts on the real desktop.
  const SEND_TO_ROOT_OVERRIDE = String(process.env.OMNI_SEND_TO_ROOT || '').trim();

  let knownUserFoldersPromise = null;

  /** Desktop and Documents, which can be redirected (OneDrive) and so are not guessable. */
  function knownUserFolders() {
    if (!knownUserFoldersPromise) {
      const command =
        "@{ desktop = [Environment]::GetFolderPath('Desktop'); documents = [Environment]::GetFolderPath('MyDocuments') } | ConvertTo-Json -Compress";
      knownUserFoldersPromise = execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: POWERSHELL_TIMEOUT_MS },
      )
        .then(({ stdout }) => JSON.parse(String(stdout || '').trim() || '{}'))
        .catch((err) => {
          // A failed lookup must not be remembered as "no folders exist".
          knownUserFoldersPromise = null;
          throw err;
        });
    }
    return knownUserFoldersPromise;
  }

  /**
   * The five folders Explorer shows as libraries: id used by the renderer, and the
   * .NET SpecialFolder name that resolves it.
   */
  const USER_LIBRARY_FOLDERS = [
    ['desktop', 'Desktop'],
    ['documents', 'MyDocuments'],
    ['pictures', 'MyPictures'],
    ['music', 'MyMusic'],
    ['videos', 'MyVideos'],
    // .NET has no SpecialFolder for Downloads: it is only ever the profile one.
    ['downloads', null],
  ];

  /** The profile's own folder names, which is all that is left when the lookup fails. */
  function guessedUserFolders() {
    const profile = process.env.USERPROFILE || '';
    if (!profile) return {};
    return {
      desktop: path.win32.join(profile, 'Desktop'),
      documents: path.win32.join(profile, 'Documents'),
      pictures: path.win32.join(profile, 'Pictures'),
      music: path.win32.join(profile, 'Music'),
      videos: path.win32.join(profile, 'Videos'),
      downloads: path.win32.join(profile, 'Downloads'),
    };
  }

  /**
   * Resolves the library folders for the signed-in profile and drops the ones this
   * machine does not have, so the tree never offers a folder that would fail to
   * open. Every candidate is checked against the disk before it is reported.
   */
  async function readUserLibraries() {
    let resolved = {};
    try {
      const body = USER_LIBRARY_FOLDERS.filter(([, special]) => special)
        .map(([key, special]) => `${key} = [Environment]::GetFolderPath('${special}')`)
        .join('; ');
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `@{ ${body} } | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: POWERSHELL_TIMEOUT_MS },
      );
      resolved = JSON.parse(String(stdout || '').trim() || '{}');
    } catch {
      // A failed lookup is not a machine without folders: fall back to the profile.
      resolved = {};
    }
    const guessed = guessedUserFolders();
    return USER_LIBRARY_FOLDERS.map(([key]) => ({
      key,
      path: String(resolved[key] || guessed[key] || ''),
    })).filter((entry) => entry.path && fs.existsSync(entry.path));
  }

  /** An absolute path that must already be a folder the shortcut can land in. */
  async function assertFolder(value) {
    const folder = assertSafePath(value);
    const stat = await fs.promises.stat(folder).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error(`Not a folder: ${folder}`);
    return folder;
  }

  async function sendToFolder(destinationId) {
    const destination = SEND_TO_DESTINATIONS[String(destinationId || '')];
    if (!destination) throw new Error(`Unknown destination: ${String(destinationId || '')}`);
    if (SEND_TO_ROOT_OVERRIDE) return assertFolder(SEND_TO_ROOT_OVERRIDE);
    const raw = destination(await knownUserFolders());
    if (!raw) throw new Error(`No folder for destination: ${String(destinationId || '')}`);
    return assertFolder(raw);
  }

  function ensureShortcutScript() {
    if (shortcutScriptPath) return shortcutScriptPath;
    const scriptPath = path.join(os.tmpdir(), `omnicommander-shortcut-${process.pid}.ps1`);
    const lines = [
      'param([Parameter(Mandatory=$true)][string]$TargetB64, [Parameter(Mandatory=$true)][string]$ShortcutB64)',
      // Paths travel base64-encoded: arguments are decoded with the console code page
      // otherwise, which mangles accented file names.
      '$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TargetB64))',
      '$shortcut = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ShortcutB64))',
      '$shell = New-Object -ComObject WScript.Shell',
      '$link = $shell.CreateShortcut($shortcut)',
      '$link.TargetPath = $target',
      '$link.WorkingDirectory = Split-Path -LiteralPath $target -Parent',
      '$link.Save()',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
    shortcutScriptPath = scriptPath;
    return scriptPath;
  }

  async function copyIntoFolder(target, folder) {
    const wanted = path.win32.basename(target);
    const direct = path.win32.join(folder, wanted);
    const destination = (await pathExists(direct)) ? path.win32.join(folder, await uniqueName(folder, wanted)) : direct;
    await fs.promises.cp(target, destination, { recursive: true, force: false, errorOnExist: true });
    return destination;
  }

  async function createShortcut(target, shortcutPath) {
    const b64 = (value) => Buffer.from(String(value), 'utf8').toString('base64');
    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ensureShortcutScript(),
        b64(target),
        b64(shortcutPath),
      ],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: POWERSHELL_TIMEOUT_MS },
    );
  }

  /**
   * Records each transfer phase in a log file. A copy that stalls on the user's
   * side leaves no other trace, so the phases are written down to make the next
   * report diagnosable instead of guessed at.
   */
  function jobLog(...parts) {
    const file = path.join(process.env.TEMP || '.', 'omnicommander-job.log');
    const line = `${new Date().toISOString()} ${parts.join(' ')}`;
    fs.promises.appendFile(file, line + '\n').catch(() => {});
  }

  function startJob(job, runner) {
    runner
      .then(() => finishJob(job))
      .catch((err) => {
        if (err && err.message === '__cancelled__') {
          job.cancelled = true;
        } else {
          jobLog('job-threw', job.id, err && err.message ? err.message : String(err));
          job.errors.push({ path: '', message: err && err.message ? err.message : String(err) });
        }
        finishJob(job);
      });
    return job;
  }

  async function runTransferJob(job, sources, targetDir) {
    jobLog('start', job.id, `op=${job.op}`, `sources=${sources.length}`, `target=${targetDir}`);
    // Measure before copying so progress has a denominator. This runs inside the
    // job, not in the start request: a big tree would otherwise hold the HTTP
    // response for as long as the walk takes.
    try {
      let bytes = 0;
      let files = 0;
      for (const src of sources) {
        const measured = await measureTree(src);
        bytes += measured.bytes;
        files += measured.files;
      }
      job.totalBytes = bytes;
      job.itemsTotal = files;
      jobLog('measured', job.id, `bytes=${bytes}`, `files=${files}`);
    } catch (err) {
      jobLog('measure-failed', job.id, err.message);
      job.errors.push({ path: sources.join(', '), message: err.message });
    }

    // Running out of room leaves a half-copied tree that looks corrupted, and the
    // real failure only shows up somewhere in the middle. Ask the filesystem
    // before the first byte instead. Moves free space as they go, so they skip it.
    if (job.op === 'copy' && job.totalBytes > 0) {
      let free = 0;
      try {
        const root = path.win32.parse(targetDir).root || targetDir;
        const space = await fs.promises.statfs(root);
        free = Number(space.bavail) * Number(space.bsize);
      } catch {
        // An exotic mount may not answer statfs; a missing check is better than a
        // refused copy.
        free = 0;
      }
      if (free > 0 && job.totalBytes > free) {
        const gb = (n) => `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
        const message = `Not enough space on the target: ${gb(job.totalBytes)} needed, ${gb(free)} free`;
        if (job.force) {
          // The user saw these same numbers and chose to proceed. The disk stays
          // the final authority: an ENOSPC still fails the job, but this guard
          // does not get to overrule an explicit decision.
          jobLog('no-space-forced', job.id, message);
        } else {
          jobLog('no-space', job.id, message);
          job.errors.push({ path: targetDir, message });
          throw new Error(message);
        }
      }
    }

    for (const src of sources) {
      await waitWhilePaused(job);
      const dest = await resolveDestination(src, targetDir, job);
      if (!dest) {
        jobLog('skipped', job.id, src);
        job.itemsSkipped += 1;
        continue;
      }
      try {
        if (job.op === 'move') await moveTree(src, dest, job, true);
        else await copyTree(src, dest, job, true);
        jobLog('entry-done', job.id, src);
      } catch (err) {
        if (err.message === '__cancelled__') throw err;
        jobLog('entry-failed', job.id, src, err.message);
        job.errors.push({ path: src, message: err.message });
      }
    }
  }

  return {
    readUserLibraries,
    measureTree,
    assertArchiveDestination,
    pathExists,
    uniqueName,
    assertFolder,
    sendToFolder,
    createShortcut,
    copyIntoFolder,
    deleteTarget,
    CLEANUP_TARGETS,
    cleanupTargetPath,
    resolveCleanupRoot,
    clampCleanupDays,
    scanCleanup,
    runCleanup,
    startJob,
    runTransferJob,
  };
}

module.exports = { createFileOps };
