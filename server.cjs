const express = require('express');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const net = require('net');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
// Two responsibilities already live on their own so they can be tested without
// booting the server: path validation, which every route goes through, and the
// CPU/RAM reading behind the info drawer.
const { isAbsoluteLocalPath, assertSafePath } = require('./server/pathSafety.cjs');
const { readSystemStats, readElevation } = require('./server/systemLoad.cjs');
const { registerJobRoutes } = require('./server/routes/jobs.cjs');
const { registerTransferRoutes } = require('./server/routes/transfers.cjs');
const { registerFileRoutes } = require('./server/routes/files.cjs');
const { registerArchiveRoutes } = require('./server/archiveReader.cjs');
const { registerRunRoutes } = require('./server/runLauncher.cjs');
const { registerSpaceRoutes } = require('./server/routes/space.cjs');
const { dashboardHtml } = require('./server/dashboard.cjs');
const { createJobEngine } = require('./server/jobEngine.cjs');
const { createFileOps } = require('./server/fileOps.cjs');
const { appendLog } = require('./server/scratch.cjs');
const { registerMapRoutes } = require('./server/routes/maps.cjs');
const { registerOpenWithRoutes } = require('./server/openWith.cjs');
const { createCatalog } = require('./server/catalog.cjs');
const { registerProcessRoutes } = require('./server/processes.cjs');
const { registerTreeRoutes } = require('./server/tree.cjs');
const { createShareService } = require('./server/share.cjs');
const { registerShareRoutes } = require('./server/routes/share.cjs');
const app = express();

/**
 * Measurement hook, not part of the API.
 *
 * Node writes its V8 coverage dump (NODE_V8_COVERAGE) on a graceful exit only,
 * and on Windows a killed child never gets to run anything, so the suites that
 * measure the server need a way to ask it to stop. The route exists only while
 * the measurement sets SERVER_COVERAGE_SHUTDOWN, so a shipped build has no such
 * door, and it is registered before the origin guard because the caller is a
 * test process, not a page.
 */
if (process.env.SERVER_COVERAGE_SHUTDOWN === '1') {
  app.post('/api/__coverage-shutdown', (_req, res) => {
    res.json({ ok: true, pid: process.pid });
    setImmediate(() => process.exit(0));
  });
}

// The renderer is either same-origin (dev: localhost:3000) or loaded from
// file:// in the packaged app, which the browser reports as the literal string
// "null". Any other origin is a third-party page trying to drive the local
// filesystem API.
//
// `Origin: null` is an opaque origin shared by two callers: the packaged
// renderer AND a sandboxed iframe on any web page. It is therefore only allowed
// when the request also proves it is the app by carrying the per-launch session
// token. A remote page can never know that token (contextBridge keeps it out of
// reach of any iframe), so this refuses the attacker while keeping the packaged
// file:// renderer -- which does send `Origin: null` -- working.
//
// A loopback host is not enough on its own: another dev server, a local tool's
// web UI or a page served by any other process on 127.0.0.1 used to pass, and
// the whole point is that only the app talks to this API. The port has to be
// one of the app's two: 3000, where the Vite proxy presents the dev UI, or the
// port this listener bound, where the dashboard is served.
const DEV_UI_PORT = 3000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isAllowedOrigin(origin, tokenValid, ownPort) {
  if (!origin) return true; // same-origin or non-browser client
  if (origin === 'null') return tokenValid; // packaged file:// renderer only
  try {
    // WHATWG parsing keeps the brackets around an IPv6 literal, so the hostname
    // of `http://[::1]:3000` is the four-character string `[::1]`. Comparing it
    // against a bare `::1` — as this did — can never match, and the dev server
    // binding IPv6 loopback is exactly the case that hits it: every mutation
    // came back 403 for anyone opening the app on that address. Strip the
    // brackets and fold case, which is how host names compare anyway.
    const url = new URL(origin);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(host)) return false;
    // Its own port is the dashboard talking to itself; before listening it is
    // null, which allows nothing extra.
    return port === DEV_UI_PORT || (ownPort != null && port === ownPort);
  } catch {
    return false;
  }
}

// Per-launch random token generated by the Electron main process and handed to
// both the server and the renderer through argv. Requiring it closes the
// remaining hole: a browser can send a cross-origin "simple" POST without a
// preflight, so the origin check alone cannot keep a remote page out. It covers
// every mutation plus the GETs that describe the disk (see
// SENSITIVE_GET_ROUTES); the routes that only report whether the server is up
// stay open, so a readiness probe needs no secret.
const SESSION_TOKEN = String(process.env.OMNI_SESSION_TOKEN || '').trim();
// Header the renderer attaches centrally in src/utils/fetchWithRetry.ts.
const SESSION_TOKEN_HEADER = 'x-omni-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reads that expose the user's disk: folder listings and trees, file hashes,
 * job paths, drive inventory and the programs the run box can launch. A page on
 * another origin is already refused, and this makes a client that got past the
 * origin rule — a non-browser one, or the proxy — prove it holds the app's
 * token before it can map the disk. The machine reads below belong here for the
 * same reason: a process table, the addresses of the network cards and the live
 * load describe the computer the same way the drive inventory does, and none of
 * them needs the token to answer anything else.
 */
const SENSITIVE_GET_ROUTES = new Set([
  '/api/drives',
  '/api/user-folders',
  '/api/list',
  // The tree route walks real folders to draw the panel; it exposes the same
  // structure as a listing and had been left out of this set by oversight.
  '/api/tree',
  '/api/treesize',
  '/api/fs/hash',
  '/api/fs/jobs',
  '/api/fs/dashboard',
  '/__jobs',
  '/api/run/suggestions',
  // Names of the programs installed for an extension: what the Open-with
  // submenu lists before the user has clicked anything.
  '/api/open-with/programs',
  // What the machine is doing: the processes it runs, the addresses its cards
  // hold and how loaded it is. They take no path argument, so they were left
  // out at first, but the disclosure is the same — an inventory of this box.
  '/api/processes',
  '/api/net/adapters',
  '/api/system/stats',
  // A share names a folder on this disk, and its token is the key to that folder.
  // Handing either of them to a client that cannot prove it is the app would be
  // handing out the folder.
  '/api/share',
]);

/**
 * The one page a browser is meant to open by navigation, which cannot send a
 * header. Its URL carries the token (`?t=`), and that proof covers the HTML only:
 * everything the page then reads or orders sends the header, so a token in an
 * address bar can never read the jobs or steer them by itself.
 */
const QUERY_TOKEN_ROUTES = new Set(['/__jobs']);

/** Mutations, and the GETs that describe the disk, need the per-launch token. */
function requiresSessionToken(req) {
  if (MUTATING_METHODS.has(req.method)) return true;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  // Job detail carries the source and target paths of a transfer.
  return SENSITIVE_GET_ROUTES.has(req.path) || req.path.startsWith('/api/fs/job/');
}

function isTokenValid(req) {
  // No token configured means the server was started directly (tests, curl):
  // requests are allowed so the loopback-only dev workflow still works.
  if (!SESSION_TOKEN) return true;
  const provided = req.headers[SESSION_TOKEN_HEADER];
  return typeof provided === 'string' && provided === SESSION_TOKEN;
}

/**
 * The same secret, as it travels for things that cannot send a header.
 *
 * An `<img>` or a `<video>` gets the per-launch token in the query string
 * (`?t=`), which is the only place it can carry one. This is proof for the
 * origin gate, not for the token requirement: a mutation still has to send the
 * header, so a token that ends up in a URL can never authorise a write.
 */
/**
 * The proof the dashboard page leaves behind once it has been opened.
 *
 * The page takes the token out of its own address bar, so a reload arrives with
 * nothing in the URL; the cookie is what lets that reload through, and it can only
 * open the page, never authorise a write.
 */
const PAGE_COOKIE = 'omni-page';
const PAGE_COOKIE_MAX_AGE = 12 * 60 * 60;

function hasPageCookie(req) {
  if (!SESSION_TOKEN) return true;
  if (typeof req.headers.cookie !== 'string') return false;
  const match = new RegExp(`(?:^|;\\s*)${PAGE_COOKIE}=([^;]+)`).exec(req.headers.cookie);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) === SESSION_TOKEN;
  } catch {
    return false;
  }
}

function hasQueryToken(req) {
  if (!SESSION_TOKEN) return true;
  const fromQuery = req.query && typeof req.query.t === 'string' ? req.query.t : '';
  if (fromQuery) return fromQuery === SESSION_TOKEN;
  try {
    // Middleware can run before the query parser has filled `req.query` in.
    const parsed = new URL(String(req.originalUrl || req.url || ''), 'http://127.0.0.1');
    return String(parsed.searchParams.get('t') || '') === SESSION_TOKEN;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  // Marks every response as ours, even error responses. The bind handshake at
  // the bottom of this file relies on it to prove that the socket which
  // answered is this server and not a foreign app sharing the same port.
  res.setHeader('X-OmniCmd-Server', '1');
  const origin = req.headers.origin;
  // Two proofs are accepted for the origin gate: the header a fetch can send,
  // and the query parameter an <img> can be given. The packaged renderer is
  // loaded from file://, where Chromium reports `Origin: null` for every
  // subresource — a tile carried its token in the query and was still refused as
  // an opaque origin, so the map and the media viewer painted nothing.
  const headerTokenValid = isTokenValid(req);
  const tokenValid = headerTokenValid || hasQueryToken(req);
  // Refusing here (rather than leaving it to the browser) matters: a
  // cross-origin "simple" request would otherwise still reach the handler and
  // mutate the disk, even though the browser hides the response.
  if (!isAllowedOrigin(origin, tokenValid, activePort)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  // A write, and any read of the disk, still has to prove itself with the header:
  // the query token is only good enough to load a picture, or the dashboard page.
  const pageTokenValid = QUERY_TOKEN_ROUTES.has(req.path) && (hasQueryToken(req) || hasPageCookie(req));
  if (requiresSessionToken(req) && !headerTokenValid && !pageTokenValid) {
    res.status(403).json({ error: 'Missing or invalid session token' });
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${SESSION_TOKEN_HEADER}`);
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// Probe and WMI failures are expected on locked or unmounted volumes, so they
// never change control flow. They do leave a trail at debug level, because a
// permanently failing query with no diagnostic is the hardest kind to notice.
function logDebug(...args) {
  if (process.env.OMNI_DEBUG) console.error('[omni]', ...args);
}

// Timer tuning, in milliseconds. Named so the polling intervals and the WMI
// timeout can be reasoned about instead of appearing as bare literals.
const JOB_TICK_MS = 120; // pause / cancel polling granularity
const POWERSHELL_TIMEOUT_MS = 60000; // normal ceiling for one PowerShell query
const WMI_TIMEOUT_MS = 300000; // hard ceiling for the slow os/WMI fallback

// The preferred port is only a preference. Another application frequently holds
// it (this machine has seen 3001 taken by unrelated software), and a hard
// EADDRINUSE crash would take the whole Electron main process down with it, so
// the server walks forward until it finds a free port instead.
const PREFERRED_PORT = Number(process.env.PORT) || 3001;
const MAX_PORT_ATTEMPTS = 25;

let activePort = null;
const portReadyListeners = [];
const jobFinishedListeners = [];

/**
 * Runs `listener` for every job that reaches a final state. The host application
 * uses it to announce a transfer that ended with nobody looking at the window.
 */
function onJobFinished(listener) {
  jobFinishedListeners.push(listener);
}

function announceJobFinished(job) {
  // The engine already keeps a throwing listener from failing the transfer; this
  // only has to reach every subscriber.
  for (const listener of jobFinishedListeners) listener(job);
}

/** Runs `listener` as soon as the server is listening, or immediately if it already is. */
function onPortReady(listener) {
  if (activePort != null) listener(activePort);
  else portReadyListeners.push(listener);
}

function announcePort(port) {
  activePort = port;
  // Also exported through process.env so a parent process can read it without
  // reaching into this module.
  process.env.OMNI_API_PORT = String(port);
  while (portReadyListeners.length > 0) {
    const listener = portReadyListeners.shift();
    try {
      listener(port);
    } catch (error) {
      console.error('Port listener failed:', error);
    }
  }
}

const MEDIA_TYPES = new Map([
  ['PNG', 'image/png'],
  ['JPG', 'image/jpeg'],
  ['JPEG', 'image/jpeg'],
  ['WEBP', 'image/webp'],
  ['GIF', 'image/gif'],
  ['BMP', 'image/bmp'],
  ['ICO', 'image/x-icon'],
  ['AVIF', 'image/avif'],
  ['MP3', 'audio/mpeg'],
  ['WAV', 'audio/wav'],
  ['OGG', 'audio/ogg'],
  ['OPUS', 'audio/ogg'],
  ['M4A', 'audio/mp4'],
  ['AAC', 'audio/aac'],
  ['FLAC', 'audio/flac'],
  ['WMA', 'audio/x-ms-wma'],
  ['MID', 'audio/midi'],
  ['MP4', 'video/mp4'],
  ['M4V', 'video/mp4'],
  ['WEBM', 'video/webm'],
  ['MKV', 'video/x-matroska'],
  ['AVI', 'video/x-msvideo'],
  ['MOV', 'video/quicktime'],
  ['WMV', 'video/x-ms-wmv'],
  ['MPG', 'video/mpeg'],
  ['MPEG', 'video/mpeg'],
]);

/**
 * Turns a single `bytes=start-end` header into a byte window, or null when the
 * request asks for something this file cannot give. Only one range is honoured:
 * the browser's own players ask for one at a time.
 */
function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  // "bytes=-500" is the last 500 bytes, which is how a player looks for a moov
  // atom at the end of an MP4.
  let start = rawStart === '' ? size - Number(rawEnd) : Number(rawStart);
  let end = rawStart === '' || rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end || size === 0) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Maps: tile proxy, place search and approximate positioning
//
// Both upstream services require an identifiable User-Agent, which a page is
// not allowed to set, and both ask clients to cache instead of hammering them.
// So the renderer asks this server, and this server identifies itself, keeps an
// in-memory cache and never issues more than one Nominatim search per second.
// ---------------------------------------------------------------------------
// Tiles, search, locate and the offline tile cache live in their own module:
// they are the only part of the server that talks to a map provider.
registerMapRoutes(app, { SESSION_TOKEN, parseByteRange, MEDIA_TYPES, assertSafePath, logDebug });

// "Open with" enumerates registered programs through PowerShell and then
// launches one of them, so it owns its own module and its own quoting rules.
registerOpenWithRoutes(app, { assertSafePath, isAbsoluteLocalPath, logDebug });

const { once } = require('events');

function invalidateListings() {
  clearListCache();
}

// The transfer bookkeeping lives in its own module so the routes and the copy
// loop share one job table without sharing a file.
const {
  jobs,
  makeJob,
  finishJob,
  jobSnapshot,
  noteFile,
  waitWhilePaused,
  sleep,
  conflictAnswerMs: CONFLICT_ANSWER_MS,
} = createJobEngine({
  invalidateListings,
  onJobFinished: announceJobFinished,
  jobTickMs: JOB_TICK_MS,
});

// ---------------------------------------------------------------------------
// Disposable-folder cleanup
//
// The renderer never names a path here: it names a target from this table and
// the server resolves the folder itself, so a hostile request cannot aim a
// recursive delete at C:\. Windows Temp and Prefetch live under %SystemRoot%
// and need an elevated token, so they are advertised with `requiresAdmin` and
// refused with a clear reason instead of failing halfway through a folder.

// The copy/move engine, the cleanup routines and Send-To live in their own
// module: they are handed the job bookkeeping instead of reaching for it.
const {
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
} = createFileOps({
  noteFile,
  waitWhilePaused,
  sleep,
  finishJob,
  jobTickMs: JOB_TICK_MS,
  conflictAnswerMs: CONFLICT_ANSWER_MS,
  powershellTimeoutMs: POWERSHELL_TIMEOUT_MS,
  wmiTimeoutMs: WMI_TIMEOUT_MS,
});

// Drives, user folders, load and listings: the catalog of what this machine
// holds, caches included. It is built after the file operations because the
// user-folder resolution it serves is theirs.
const catalog = createCatalog({
  app,
  assertSafePath,
  readSystemStats,
  readElevation,
  readUserLibraries,
  logDebug,
  powershellTimeoutMs: POWERSHELL_TIMEOUT_MS,
});
const { clearListCache, listDirectory } = catalog;

// The shallow tree and TreeSize live in their own module: both only read the
// disk, and a folder size can walk a whole drive.
registerTreeRoutes(app, { assertSafePath, logDebug, listDirectory });

// The adapter names carry drive letters, so these routes read the same listing
// cache the catalog owns and are registered once it exists.
registerProcessRoutes(app, { logDebug, powershellTimeoutMs: POWERSHELL_TIMEOUT_MS });

// Sharing a folder with the rest of the network is its own listener, so the API
// above stays on loopback. Nothing listens there until the user starts a share
// from the panel, and closing the list ends it: none of it is on disk.
const shareService = createShareService({ logDebug });
registerShareRoutes(app, { share: shareService });
function registerFsRoutes() {
  registerJobRoutes(app, {
    jobs,
    jobSnapshot,
    preferredPort: PREFERRED_PORT,
    getActivePort: () => activePort,
  });

  // Live monitoring surface for the transfer engine.
  app.get('/__jobs', (req, res) => {
    // The page strips the token from its own URL, so the visit that carried it
    // leaves the proof in a same-site cookie for the reload to use.
    if (hasQueryToken(req)) {
      res.setHeader(
        'Set-Cookie',
        `${PAGE_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}; Path=/; Max-Age=${PAGE_COOKIE_MAX_AGE}; SameSite=Strict`,
      );
    }
    res.type('html').send(dashboardHtml());
  });

  /**
   * Writes a rejected filesystem request to the app's diagnostic log. A transfer
   * that never starts leaves no other trace: the client can only surface a short
   * message, so the full request body is recorded here to make the cause
   * diagnosable after the fact. `scratch.cjs` keeps the file from growing without
   * bound.
   */
  function logRejected(route, body, err) {
    appendLog(
      'omnicommander-fs.log',
      JSON.stringify({
        at: new Date().toISOString(),
        route,
        body,
        error: err && err.message ? err.message : String(err),
      }),
    );
  }

  registerTransferRoutes(app, {
    fs,
    assertSafePath,
    makeJob,
    startJob,
    waitWhilePaused,
    runTransferJob,
    noteFile,
    deleteTarget,
    invalidateListings,
    logRejected,
    CLEANUP_TARGETS,
    cleanupTargetPath,
    resolveCleanupRoot,
    clampCleanupDays,
    scanCleanup,
    runCleanup,
  });

  registerFileRoutes(app, {
    fs,
    path,
    express,
    assertSafePath,
    assertArchiveDestination,
    invalidateListings,
    pathExists,
    assertFolder,
    sendToFolder,
    createShortcut,
    copyIntoFolder,
    uniqueName,
  });

  registerArchiveRoutes(app, { assertSafePath, assertArchiveDestination });
  // The Run box ("Ejecutar") and the resolution rules behind it live in their
  // own module: it is the only part of the server that starts a process, and it
  // needs pathSafety plus the debug log, both declared there.
  registerRunRoutes(app, { logDebug });

  // Room left on a volume, a real file digest, and the copy list on disk: they
  // answer about a volume or one file, so they live together in their own module.
  registerSpaceRoutes(app, { fs, path, os, crypto, assertSafePath, measureTree, logDebug });
}

registerFsRoutes();

// Optional static serving
app.use(express.static(path.join(__dirname, 'dist')));

// Warm the drive metadata cache in the background. Never blocks a request.
catalog.enrichDrivesFromWmi();

/**
 * True when something already accepts connections on this loopback port.
 *
 * On Windows a process may bind 127.0.0.1:PORT while another one holds the same
 * port on 0.0.0.0, and the two then split incoming requests between them. A
 * silent EADDRINUSE never happens, so we ask the port instead of trusting bind().
 */
function probePortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const settle = (busy) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(500, () => settle(true));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

/**
 * True when the socket answering this port is this server.
 * A foreign server on the same port answers without our marker header.
 */
function probeOwned(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/fs/jobs', timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.headers['x-omnicmd-server'] === '1');
    });
    let settled = false;
    const settle = (owned) => {
      if (settled) return;
      settled = true;
      resolve(owned);
    };
    request.on('timeout', () => {
      request.destroy();
      settle(false);
    });
    request.on('error', () => settle(false));
  });
}

async function listenOn(port, attempt) {
  if (attempt >= MAX_PORT_ATTEMPTS || port > 65535) {
    console.error(`Local drive server found no usable port after ${MAX_PORT_ATTEMPTS} attempts (last: ${port}).`);
    return;
  }
  if (await probePortBusy(port)) {
    console.warn(`Port ${port} is in use, trying ${port + 1}...`);
    return listenOn(port + 1, attempt + 1);
  }

  const server = app.listen(port, '127.0.0.1');
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is in use, trying ${port + 1}...`);
      listenOn(port + 1, attempt + 1);
      return;
    }
    // Never throw out of here: an unhandled 'error' event kills the Electron
    // main process. The renderer already degrades to its offline state.
    console.error('Local drive server failed to listen:', error);
  });
  server.on('listening', async () => {
    const bound = server.address().port;
    if (!(await probeOwned(bound))) {
      // Another process claimed this port between the probe and the bind.
      server.close();
      console.warn(`Port ${bound} answers to another application, trying ${bound + 1}...`);
      listenOn(bound + 1, attempt + 1);
      return;
    }
    announcePort(bound);
    console.log(`REA/local drive server listening on http://localhost:${bound}`);
  });
}

listenOn(PREFERRED_PORT, 0).catch((error) => {
  // A dead local server must never take the host application down with it.
  console.error('Local drive server failed to start:', error);
});

module.exports = { onPortReady, onJobFinished, getPort: () => activePort, PREFERRED_PORT };
