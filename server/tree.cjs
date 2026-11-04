/**
 * The shallow tree the renderer browses and TreeSize: the real recursive size
 * of a folder, measured with progress.
 *
 * Both only read the disk. The tree reuses the shared directory listing, which
 * arrives as an argument, and both accept paths the renderer was never granted,
 * so the path guard arrives with it.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function registerTreeRoutes(app, deps) {
  const { assertSafePath, logDebug, listDirectory } = deps;

  // ---------------------------------------------------------------------------
  // TreeSize: real recursive folder sizes
  // ---------------------------------------------------------------------------
  // The renderer used to build this tree from its own listing index, which only
  // holds the folders the user had already opened, so every other folder reported
  // 0 bytes and the report was meaningless. A real total has to stat the whole
  // subtree, and only this process can: it runs where the disks are.

  // A whole-drive scan is unbounded by nature, so it is not cut short by an entry
  // or time budget: it runs to completion and reports as it goes. The answer is a
  // newline-delimited stream of JSON messages, because a full system drive takes
  // minutes and the previous all-or-nothing reply arrived only as a tree that had
  // silently stopped measuring. Only a pathological depth or an unreadable folder
  // can still leave a number partial, and both are flagged.
  // `tree` walks the real folders, bounded: four levels and 300 folders per
  // answer, because the point of the command is to show the shape of a folder,
  // not to enumerate a whole drive inside one request.
  const TREE_MAX_DEPTH = 4;
  const TREE_MAX_ENTRIES = 300;

  app.get('/api/tree', async (req, res) => {
    const driveId = String(req.query.driveId || '');
    const depthLimit = Math.min(TREE_MAX_DEPTH, Math.max(1, Number(req.query.depth) || 2));
    const entries = [];
    const unreadable = [];
    let truncated = false;

    async function walk(dirPath, level) {
      if (level > depthLimit || truncated) return;
      const listing = await listDirectory(driveId, dirPath);
      if (listing.error) {
        if (level === 1) unreadable.push(dirPath);
        return;
      }
      const folders = listing.items.filter((item) => item.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
      for (const folder of folders) {
        if (entries.length >= TREE_MAX_ENTRIES) {
          truncated = true;
          return;
        }
        entries.push({ name: folder.name, depth: level });
        await walk(path.win32.join(listing.path, folder.name), level + 1);
      }
    }

    try {
      const start = await listDirectory(driveId, String(req.query.path || ''));
      if (start.error) return res.status(start.status || 400).json({ error: start.error });
      await walk(start.path, 1);
      res.set('Cache-Control', 'no-store');
      res.json({ path: start.path, entries, unreadable, truncated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const TREESIZE_MAX_DEPTH = 32;
  const TREESIZE_TOP_FILES = 10;
  /** How often the walk reports its counters, so the client can show progress. */
  const TREESIZE_PROGRESS_MS = 250;

  async function statTreeSize(rootPath, hooks = {}) {
    const { onProgress = () => {}, onRootFolder = () => {}, isCancelled = () => false } = hooks;
    const startedAt = Date.now();
    const state = { entries: 0, bytes: 0, files: 0, dirs: 0, truncated: false, cancelled: false, topFiles: [] };
    let lastReportAt = 0;

    const newFolder = (fullPath) => ({
      path: fullPath,
      name: path.win32.basename(fullPath) || fullPath,
      sizeBytes: 0,
      fileCount: 0,
      dirCount: 0,
      subFolders: [],
    });

    const rememberTopFile = (dirPath, name, size) => {
      const top = state.topFiles;
      if (top.length === TREESIZE_TOP_FILES && size <= top[top.length - 1].size) return;
      top.push({ path: dirPath, fullName: name, size });
      top.sort((a, b) => b.size - a.size);
      if (top.length > TREESIZE_TOP_FILES) top.length = TREESIZE_TOP_FILES;
    };

    const report = (currentPath, force = false) => {
      const now = Date.now();
      if (!force && now - lastReportAt < TREESIZE_PROGRESS_MS) return;
      lastReportAt = now;
      onProgress({
        entries: state.entries,
        files: state.files,
        dirs: state.dirs,
        bytes: state.bytes,
        currentPath,
        elapsedMs: now - startedAt,
      });
    };

    // Biggest folders first is the whole point of the view.
    const close = (folder) => {
      folder.subFolders.sort((a, b) => b.sizeBytes - a.sizeBytes);
      return folder;
    };

    async function walk(dirPath, depth) {
      const folder = newFolder(dirPath);
      if (depth >= TREESIZE_MAX_DEPTH || isCancelled()) {
        state.truncated = true;
        state.cancelled = state.cancelled || isCancelled();
        return close(folder);
      }

      let entries;
      try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch {
        // An unreadable folder (permissions, or deleted mid-scan) counts as empty
        // instead of failing the whole report.
        state.truncated = true;
        return close(folder);
      }

      for (const entry of entries) {
        if (isCancelled()) {
          state.truncated = true;
          state.cancelled = true;
          break;
        }
        state.entries += 1;
        const fullPath = path.win32.join(dirPath, entry.name);
        let stat = null;
        try {
          stat = await fs.promises.lstat(fullPath);
        } catch {
          continue;
        }
        // Reparse points are never followed: a junction can point back up the
        // tree (an endless scan) or at another volume (bytes counted twice).
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          const sub = await walk(fullPath, depth + 1);
          folder.subFolders.push(sub);
          folder.sizeBytes += sub.sizeBytes;
          folder.fileCount += sub.fileCount;
          folder.dirCount += 1 + sub.dirCount;
          // Each folder is counted once, here, when its parent finishes it.
          state.dirs += 1;
          // The folders directly under the root are worth showing as soon as they
          // are finished: they are the ones a whole-drive scan takes longest to
          // reach, and the ones the user is looking for.
          if (depth === 0) onRootFolder(sub);
        } else if (stat.isFile()) {
          folder.sizeBytes += stat.size;
          folder.fileCount += 1;
          state.bytes += stat.size;
          state.files += 1;
          rememberTopFile(dirPath, entry.name, stat.size);
        }
        report(fullPath);
      }
      return close(folder);
    }

    const tree = await walk(rootPath, 0);
    report(rootPath, true);
    return {
      ...tree,
      truncated: state.truncated,
      cancelled: state.cancelled,
      topFiles: state.topFiles,
    };
  }

  app.get('/api/treesize', async (req, res) => {
    // A scan can take minutes, so every message is flushed as it happens and the
    // last one carries the finished tree. An aborted request stops the walk: the
    // client is not there to read it and a second scan would only compete.
    try {
      // listDirectory already validates the drive and keeps the path inside it, so
      // the scan starts from the same safe path a panel would open.
      const listed = await listDirectory(String(req.query.driveId || ''), String(req.query.path || ''));
      if (listed.error) return res.status(listed.status || 400).json({ error: listed.error });

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      let closed = false;
      req.on('close', () => {
        closed = true;
      });
      const send = (message) => {
        if (closed || res.writableEnded) return;
        res.write(`${JSON.stringify(message)}\n`);
      };

      const tree = await statTreeSize(listed.path, {
        isCancelled: () => closed,
        onProgress: (progress) => send({ type: 'progress', ...progress }),
        onRootFolder: (folder) => send({ type: 'folder', folder }),
      });

      if (closed) return res.end();
      send({ type: 'done', tree });
      res.end();
    } catch (e) {
      if (res.headersSent) {
        try {
          res.write(`${JSON.stringify({ type: 'error', error: e.message })}\n`);
        } catch {
          /* the client is gone */
        }
        return res.end();
      }
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Media bytes for the renderer's own decoders
  //
  // The thumbnail grid, the preview and the player all need the same thing: a URL
  // the browser can put in an <img> or a <video>. Reading the file into a Blob
  // first (which is what the quick view does) copies the whole thing through the
  // IPC bridge and cannot seek inside a video; a URL with Range support can.
  //
  // Only media types are served, so this route cannot be turned into a general
  // file reader, and an <img> cannot send the session header, so the token comes
  // in the query string. That token is per launch, and the response is private to
  // the app's own window.
}

module.exports = { registerTreeRoutes };
