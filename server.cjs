const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const app = express();

// The renderer is either same-origin (dev: localhost:3000) or loaded from
// file:// in the packaged app, which the browser reports as the literal
// string "null". Any other origin is a third-party page trying to drive the
// local filesystem API.
function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin or non-browser client
  if (origin === 'null') return true; // packaged Electron renderer (file://)
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
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
  // Refusing here (rather than leaving it to the browser) matters: a
  // cross-origin "simple" request would otherwise still reach the handler and
  // mutate the disk, even though the browser hides the response.
  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// The preferred port is only a preference. Another application frequently holds
// it (this machine has seen 3001 taken by unrelated software), and a hard
// EADDRINUSE crash would take the whole Electron main process down with it, so
// the server walks forward until it finds a free port instead.
const PREFERRED_PORT = Number(process.env.PORT) || 3001;
const MAX_PORT_ATTEMPTS = 25;

let activePort = null;
const portReadyListeners = [];

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

function mapWin32DriveType(value) {
  switch (Number(value)) {
    case 2: return { type: 'usb', kind: 'removable' };
    case 3: return { type: 'local', kind: 'fixed' };
    case 4: return { type: 'network', kind: 'network' };
    case 5: return { type: 'usb', kind: 'optical' };
    case 6: return { type: 'ram', kind: 'ram' };
    default: return { type: 'local', kind: 'unknown' };
  }
}

function makeDrive(info) {
  const mapped = mapWin32DriveType(info.driveType);
  const letter = String(info.letter || '').trim().endsWith(':') ? String(info.letter).trim() : `${String(info.letter || '').trim()}:`;
  const volumeName = String(info.volumeName || '').trim() || `Unidad ${letter}`;
  return {
    id: `real_${letter.replace(/[^a-zA-Z0-9]/g, '')}`,
    letter,
    name: volumeName,
    type: mapped.type,
    driveKind: mapped.kind,
    fileSystem: info.fileSystem ? String(info.fileSystem) : undefined,
    serialNumber: info.serialNumber ? String(info.serialNumber) : undefined,
    totalBytes: Number(info.size) || 0,
    freeBytes: Number(info.free) || 0,
    description: `${volumeName} [${mapped.kind}] ${info.fileSystem ? `(${info.fileSystem})` : 'desconocido'}`.trim(),
    isMounted: true
  };
}

let drivesCache = { at: 0, data: null, inflight: null };
const DRIVES_CACHE_MS = 30000;
// Optional, richer per-drive metadata (volume label, filesystem, serial, type)
// discovered asynchronously via WMI. The filesystem probe below always provides
// the drive list itself, so this is only enrichment.
let drivesMeta = new Map();

// Enumerating drives must never block a request: a WMI/CIM query can take
// minutes on a cold or constrained machine. The fast path stats candidate roots
// directly (no child process) and is enriched by a background WMI query.
// Results are cached and concurrent calls are de-duplicated.
async function getRealDrives() {
  const now = Date.now();
  if (drivesCache.data && now - drivesCache.at < DRIVES_CACHE_MS) {
    return drivesCache.data;
  }
  if (drivesCache.inflight) return drivesCache.inflight;
  drivesCache.inflight = (async () => {
    const data = await computeRealDrives();
    drivesCache = { at: Date.now(), data, inflight: null };
    return data;
  })();
  try {
    return await drivesCache.inflight;
  } catch {
    drivesCache.inflight = null;
    return [];
  }
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    if (timer.unref) timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

// Probe C:\ .. Z:\ with fs.stat/statfs only. No child process, so this stays in
// the millisecond range even when the WMI/CIM service is cold.
async function probeDriveLetters() {
  const roots = [];
  for (let code = 67; code <= 90; code++) {
    roots.push(String.fromCharCode(code) + ':\\');
  }
  const probed = await Promise.all(roots.map(async (root) => {
    try {
      const stat = await fs.promises.stat(root);
      if (!stat.isDirectory()) return null;
      let totalBytes = 0;
      let freeBytes = 0;
      try {
        const sf = await fs.promises.statfs(root);
        const blockSize = Number(sf.bsize) || 0;
        totalBytes = blockSize * (Number(sf.blocks) || 0);
        freeBytes = blockSize * (Number(sf.bavail != null ? sf.bavail : sf.bfree) || 0);
      } catch {}
      return { letter: root.slice(0, 2).toUpperCase(), totalBytes, freeBytes };
    } catch {
      return null;
    }
  }));
  const drives = [];
  for (const found of probed) {
    if (!found) continue;
    const meta = drivesMeta.get(found.letter) || {};
    drives.push(makeDrive({
      letter: found.letter,
      volumeName: meta.volumeName,
      driveType: meta.driveType != null ? meta.driveType : 3,
      size: meta.size || found.totalBytes,
      free: meta.free || found.freeBytes,
      fileSystem: meta.fileSystem,
      serialNumber: meta.serialNumber
    }));
  }
  return drives;
}

function drivesFromMeta(meta) {
  const drives = [];
  for (const [letter, m] of meta) {
    drives.push(makeDrive({
      letter,
      volumeName: m.volumeName,
      driveType: m.driveType,
      size: m.size,
      free: m.free,
      fileSystem: m.fileSystem,
      serialNumber: m.serialNumber
    }));
  }
  return drives;
}

// Best-effort WMI/CIM query bounded by a timeout, so a cold WMI service can
// never hang a request. Returns a Map keyed by upper-case drive letter.
async function queryWmiDriveInfo() {
  const command = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,Size,FreeSpace,FileSystem,VolumeSerialNumber | ConvertTo-Json -Compress';
  const { stdout: out } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60000 }
  );
  const parsed = JSON.parse((out || '').trim() || '[]');
  const entries = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  const meta = new Map();
  for (const item of entries) {
    const letter = String(item.DeviceID || item.DeviceId || '').trim().toUpperCase();
    if (!/^[A-Z]:$/.test(letter)) continue;
    meta.set(letter, {
      volumeName: item.VolumeName || item.Label,
      driveType: item.DriveType,
      size: item.Size,
      free: item.FreeSpace,
      fileSystem: item.FileSystem,
      serialNumber: item.VolumeSerialNumber
    });
  }
  return meta;
}

// Runs the slow WMI query off the request path and merges its metadata into the
// cached drive list once it resolves.
async function enrichDrivesFromWmi() {
  if (process.platform !== 'win32') return;
  try {
    const meta = await queryWmiDriveInfo();
    if (!meta.size) return;
    drivesMeta = meta;
    drivesCache = { at: 0, data: null, inflight: null };
  } catch {}
}

async function computeRealDrives() {
  if (process.platform === 'win32') {
    const fast = await withTimeout(probeDriveLetters(), 8000, []);
    if (fast.length) return fast;
    // Fall back to WMI only when the filesystem probe found nothing at all.
    try {
      const meta = await queryWmiDriveInfo();
      if (meta.size) {
        drivesMeta = meta;
        return drivesFromMeta(meta);
      }
    } catch {}
    return [];
  }
  // Unix fallback
  try {
    const { stdout: out } = await execFileAsync('df', ['-kP'], { encoding: 'utf8' });
    const lines = out.split(/\r?\n/).slice(1).map(l => l.trim()).filter(Boolean);
    const drives = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const mapped = { type: 'local', kind: 'fixed' };
        drives.push({
          id: `real_${parts[5].replace(/[^a-zA-Z0-9]/g, '')}`,
          letter: parts[5],
          name: parts[0],
          type: mapped.type,
          driveKind: mapped.kind,
          fileSystem: parts[0],
          totalBytes: Number(parts[1]) * 1024,
          freeBytes: Number(parts[3]) * 1024,
          description: `Unidad [${mapped.kind}]`,
          isMounted: true
        });
      }
    }
    return drives.length ? drives : [];
  } catch {
    return [];
  }
}

function formatDt(date) {
  if (!date) return new Date().toISOString().replace('T', ' ').substring(0, 19);
  return new Date(date).toISOString().replace('T', ' ').substring(0, 19);
}

// Directory listing cache (short TTL) + parallel stat, so navigating back and
// forth or listing from both panes doesn't re-read the disk every time.
const listCache = new Map();
const LIST_CACHE_MS = 2000;

async function readDirectoryEntries(safePath) {
  const entries = await fs.promises.readdir(safePath, { withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const full = path.win32.join(safePath, entry.name);
      let stat = null;
      try { stat = await fs.promises.stat(full); } catch {}
      const isDirectory = entry.isDirectory();
      let ext = '';
      let name = entry.name;
      // Never split a directory name: a folder called "Python 3.11" must render
      // as "Python 3.11", not as "Python 3" plus extension "11". Dotfiles also
      // keep their whole name. `lastIndexOf` with an index > 0 handles names
      // like "file.tar.gz" and ".env.local" correctly.
      if (!isDirectory && !entry.name.startsWith('.')) {
        const dot = entry.name.lastIndexOf('.');
        if (dot > 0) {
          ext = entry.name.slice(dot + 1).toUpperCase();
          name = entry.name.slice(0, dot);
        }
      }
      return {
        name,
        ext,
        fullName: entry.name,
        isDirectory,
        size: stat && !isDirectory ? stat.size : 0,
        modifiedAt: formatDt(stat && stat.mtime),
        createdAt: formatDt(stat && stat.birthtime),
        attributes: { readOnly: !!stat && !(stat.mode & 0o200), hidden: entry.name.startsWith('.'), system: false, archive: !isDirectory },
        content: ''
      };
    })
  );
}

function readDirectoryCached(safePath) {
  const key = safePath.toUpperCase();
  const now = Date.now();
  const cached = listCache.get(key);
  if (cached) {
    if (cached.inflight) return cached.inflight;
    if (cached.data && now - cached.at < LIST_CACHE_MS) return Promise.resolve(cached.data);
  }
  const inflight = readDirectoryEntries(safePath).then(
    (data) => { listCache.set(key, { at: Date.now(), data, inflight: null }); return data; },
    (err) => { listCache.delete(key); throw err; }
  );
  listCache.set(key, { at: now, data: null, inflight });
  return inflight;
}

async function listDirectory(driveId, requestedPath) {
  const drives = await getRealDrives();
  const drive = drives.find(d => d.id === driveId);
  if (!drive) return { error: 'Unknown drive' };

  const root = `${drive.letter}\\`;
  const letterPattern = drive.letter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  let input = String(requestedPath || drive.letter).trim();
  let rel = input.replace(new RegExp(`^${letterPattern}`, 'i'), '').replace(/^[\\\/]+/, '');
  const safePath = path.win32.join(drive.letter + '\\', rel || '.');

  // Safety: stay within the selected drive root.
  if (!safePath.toUpperCase().startsWith(root.toUpperCase())) {
    return { error: 'Path outside drive' };
  }

  const items = await readDirectoryCached(safePath);
  return { path: safePath, items };
}

app.get('/api/drives', async (_req, res) => {
  try {
    res.json(await getRealDrives());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/list', async (req, res) => {
  try {
    const result = await listDirectory(String(req.query.driveId || ''), String(req.query.path || ''));
    if (result.error) return res.status(400).json(result);
    res.json(result.items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Real filesystem operations: copy / move / delete / mkdir / rename / write
// ---------------------------------------------------------------------------
// A renderer cannot write to arbitrary paths (the File System Access API needs
// a user-granted handle per directory), so every mutating operation on a real
// drive runs here, where Node has full filesystem access. Long transfers are
// modelled as jobs that report byte progress and can be paused, resumed or
// cancelled while they are running.

const { once } = require('events');
const os = require('os');

const jobs = new Map();
let jobSeq = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invalidateListings() {
  listCache.clear();
}

function jobSnapshot(job) {
  const elapsedSec = Math.max(0.05, ((job.endedAt || Date.now()) - job.startedAt) / 1000);
  const rate = job.copiedBytes / elapsedSec;
  // Skipped entries will never be copied, so they leave the goal. Without this a
  // job that skipped anything would sit short of 100% forever.
  const goalBytes = Math.max(0, job.totalBytes - (job.bytesSkipped || 0));
  const remaining = Math.max(0, goalBytes - job.copiedBytes);
  // A paused or waiting job is still "in flight"; exposing that as a status keeps
  // clients from polling forever or mistaking it for completion.
  let status = job.status;
  if (job.status === 'running') {
    if (job.pendingConflict) status = 'waiting';
    else if (job.paused) status = 'paused';
  }
  return {
    id: job.id,
    op: job.op,
    status,
    label: job.label,
    totalBytes: goalBytes,
    copiedBytes: job.copiedBytes,
    itemsTotal: job.itemsTotal,
    itemsDone: job.itemsDone,
    itemsSkipped: job.itemsSkipped,
    currentFile: job.currentFile,
    pendingConflict: job.pendingConflict
      ? { source: job.pendingConflict.source, destination: job.pendingConflict.destination }
      : null,
    recentFiles: (job.recentFiles || []).map(f => ({
      path: f.path,
      name: f.name,
      size: f.size,
      copied: f.copied,
      status: f.status
    })),
    speedBps: Math.round(rate),
    etaSeconds: rate > 0 && remaining > 0 ? Math.round(remaining / rate) : 0,
    errors: job.errors,
    startedAt: job.startedAt,
    endedAt: job.endedAt
  };
}

// Zero-build monitoring page for the real filesystem engine. It is served
// straight from this file so the packaged app needs no extra assets: opening
// http://127.0.0.1:<port>/__jobs shows every transfer with live bytes, speed
// and ETA, and can pause/resume/cancel a running job from outside the app.
function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OmniCommander Pro - Transfer Engine</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#020617; color:#e2e8f0; font:13px/1.5 "Segoe UI",system-ui,sans-serif; }
  header { padding:16px 20px; border-bottom:1px solid #1e293b; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  h1 { font-size:14px; margin:0 8px 0 0; letter-spacing:.5px; color:#67e8f9; text-transform:uppercase; }
  .pill { border:1px solid #1e293b; border-radius:999px; padding:3px 10px; font-size:11px; color:#94a3b8; }
  .pill b { color:#e2e8f0; font-weight:600; }
  main { padding:18px 20px 40px; display:grid; gap:12px; }
  .job { border:1px solid #1e293b; border-radius:10px; background:#0b1220; padding:14px; }
  .job.paused { border-color:#a16207; }
  .job.done { border-color:#14532d; opacity:.72; }
  .job.done-with-errors { border-color:#7f1d1d; }
  .row { display:flex; align-items:center; gap:10px; justify-content:space-between; flex-wrap:wrap; }
  .name { font-weight:600; }
  .badge { font-size:10px; text-transform:uppercase; letter-spacing:.6px; border-radius:4px; padding:2px 7px; border:1px solid currentColor; }
  .s-running { color:#22d3ee; } .s-paused { color:#fbbf24; } .s-waiting { color:#f472b6; } .s-done { color:#4ade80; }
  .s-done-with-errors, .s-error, .s-cancelled { color:#f87171; }
  .bar { height:7px; border-radius:4px; background:#1e293b; overflow:hidden; margin:10px 0 8px; }
  .fill { height:100%; background:linear-gradient(90deg,#0891b2,#22d3ee); transition:width .25s linear; }
  .fill.warn { background:linear-gradient(90deg,#b45309,#fbbf24); }
  .fill.bad { background:linear-gradient(90deg,#b91c1c,#f87171); }
  .stats { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; color:#94a3b8; }
  .stats b { color:#e2e8f0; }
  .file { margin-top:8px; font-size:11px; color:#64748b; word-break:break-all; font-family:ui-monospace,Consolas,monospace; }
  .files { margin-top:6px; display:grid; gap:2px; }
  .frow { display:flex; align-items:center; gap:8px; font:11px/1.4 ui-monospace,Consolas,monospace; color:#94a3b8; }
  .frow .fn { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .frow .fb { width:110px; height:5px; background:#1e293b; border-radius:3px; overflow:hidden; flex:none; }
  .frow .fb i { display:block; height:100%; background:#22d3ee; }
  .frow .fp { width:38px; text-align:right; flex:none; }
  .frow.done .fb i { background:#4ade80; }
  .frow.done .fp { color:#4ade80; }
  .frow.skipped { color:#64748b; }
  .frow.skipped .fp, .frow.error .fp { color:#f87171; }
  .errs { margin:8px 0 0; padding:8px 10px; border-left:2px solid #b91c1c; background:#1a0d0d; border-radius:4px; font-size:11px; color:#fca5a5; }
  .errs div + div { margin-top:4px; }
  .acts { display:flex; gap:6px; }
  button { background:#111c30; color:#cbd5e1; border:1px solid #1e293b; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; }
  button:hover { border-color:#22d3ee; color:#67e8f9; }
  .empty { border:1px dashed #1e293b; border-radius:10px; padding:26px; text-align:center; color:#475569; }
</style>
</head>
<body>
<header>
  <h1>OmniCommander Pro &middot; Transfer Engine</h1>
  <span class="pill">port <b id="port">-</b></span>
  <span class="pill">platform <b id="platform">-</b></span>
  <span class="pill">uptime <b id="uptime">-</b></span>
  <span class="pill">active <b id="active">0</b></span>
</header>
<main id="jobs"><div class="empty">Loading jobs...</div></main>
<script>
(function(){
  var KB=1024, MB=KB*1024, GB=MB*1024;
  function bytes(n){
    n=Number(n)||0;
    if(n>=GB) return (n/GB).toFixed(2)+' GB';
    if(n>=MB) return (n/MB).toFixed(1)+' MB';
    if(n>=KB) return (n/KB).toFixed(1)+' KB';
    return n+' B';
  }
  function dur(s){
    s=Math.round(Number(s)||0);
    if(s<=0) return '-';
    if(s<60) return s+'s';
    var m=Math.floor(s/60), r=s%60;
    if(m<60) return m+'m '+r+'s';
    return Math.floor(m/60)+'h '+(m%60)+'m';
  }
  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  var ORDER={running:0,waiting:0,paused:1,'done-with-errors':2,error:2,cancelled:3,done:4};
  function render(list){
    var host=document.getElementById('jobs');
    if(!list.length){ host.innerHTML='<div class="empty">No transfer jobs yet. Start a copy or move in the app.</div>'; return; }
    list.sort(function(a,b){
      var d=(ORDER[a.status]==null?9:ORDER[a.status])-(ORDER[b.status]==null?9:ORDER[b.status]);
      return d!==0?d:(b.startedAt||0)-(a.startedAt||0);
    });
    host.innerHTML=list.map(function(j){
      var pct=j.totalBytes>0?Math.min(100,Math.round(j.copiedBytes/j.totalBytes*100)):0;
      var cls=j.status==='done'?'done':(j.status==='paused'?'paused':(j.status==='done-with-errors'||j.status==='error'?'done-with-errors':''));
      var fillCls=j.status==='paused'?'warn':((j.status==='done-with-errors'||j.status==='error')?'bad':'');
      var canAct=j.status==='running'||j.status==='paused'||j.status==='waiting';
      var btns=canAct?('<div class="acts">'+
          (j.status==='paused'
            ? '<button data-act="resume" data-id="'+esc(j.id)+'">Resume</button>'
            : '<button data-act="pause" data-id="'+esc(j.id)+'">Pause</button>')+
          '<button data-act="cancel" data-id="'+esc(j.id)+'">Cancel</button></div>'):'';
      var errs=(j.errors&&j.errors.length)?('<div class="errs">'+j.errors.map(function(e){
        return '<div>'+esc(e.path||'(job)')+' &mdash; '+esc(e.message)+'</div>';
      }).join('')+'</div>'):'';
      // Newest rows first: the file being written right now is always on top.
      var recent=(j.recentFiles||[]).slice(-6).reverse();
      var files=recent.length?('<div class="files">'+recent.map(function(f){
        var fp=f.size>0?Math.min(100,Math.round(f.copied/f.size*100)):0;
        var right=f.status==='skipped'?'skip':(f.status==='error'?'fail':fp+'%');
        return '<div class="frow '+esc(f.status)+'"><span class="fn">'+esc(f.name)+'</span>'+
          '<span class="fb"><i style="width:'+fp+'%"></i></span>'+
          '<span class="fp">'+right+'</span></div>';
      }).join('')+'</div>'):'';
      return '<section class="job '+cls+'">'+
        '<div class="row"><div><span class="badge s-'+esc(j.status)+'">'+esc(j.status)+'</span> '+
        '<span class="name">'+esc(j.label)+'</span> <span class="pill">'+esc(j.op)+'</span></div>'+btns+'</div>'+
        '<div class="bar"><div class="fill '+fillCls+'" style="width:'+pct+'%"></div></div>'+
        '<div class="stats">'+
          '<span>progress <b>'+pct+'%</b></span>'+
          '<span>copied <b>'+bytes(j.copiedBytes)+'</b> / '+bytes(j.totalBytes)+'</span>'+
          '<span>speed <b>'+(j.status==='running'&&j.speedBps>0?bytes(j.speedBps)+'/s':'-')+'</b></span>'+
          '<span>eta <b>'+dur(j.etaSeconds)+'</b></span>'+
          '<span>items <b>'+(j.itemsDone||0)+'</b> / '+(j.itemsTotal||0)+'</span>'+
          (j.itemsSkipped?'<span>skipped <b>'+j.itemsSkipped+'</b></span>':'')+
        '</div>'+
        (j.currentFile?'<div class="file">'+esc(j.currentFile)+'</div>':'')+
        files+
        (j.pendingConflict?('<div class="file">waiting for answer: '+esc(j.pendingConflict.destination)+'</div>'):'')+
        errs+
      '</section>';
    }).join('');
  }
  document.addEventListener('click', function(ev){
    var btn=ev.target.closest('button[data-act]');
    if(!btn) return;
    fetch('/api/fs/job/'+encodeURIComponent(btn.getAttribute('data-id'))+'/'+btn.getAttribute('data-act'), { method:'POST' }).catch(function(){});
  });
  var lastMeta=0;
  function tick(){
    fetch('/api/fs/jobs').then(function(r){return r.json();}).then(render).catch(function(){});
    var now=Date.now();
    if(now-lastMeta>2000){
      lastMeta=now;
      fetch('/api/fs/dashboard').then(function(r){return r.json();}).then(function(m){
        document.getElementById('port').textContent=m.port;
        document.getElementById('platform').textContent=m.platform;
        document.getElementById('uptime').textContent=dur(m.uptimeSeconds);
        document.getElementById('active').textContent=m.activeCount;
      }).catch(function(){});
    }
  }
  tick();
  setInterval(tick,600);
})();
</script>
</body>
</html>`;
}

// Per-file progress is a bounded window: a scanned tree can hold hundreds of
// thousands of files, so the snapshot keeps only the tail of what was touched
// instead of growing a list nobody could ever render.
const RECENT_FILES_LIMIT = 40;

// Registers one entry as it enters the transfer so the UI can show a progress
// row per file instead of only the file currently being written.
function noteFile(job, filePath, size) {
  const entry = {
    path: filePath,
    name: path.win32.basename(filePath),
    size: Number(size) || 0,
    copied: 0,
    status: 'copying'
  };
  job.recentFiles.push(entry);
  if (job.recentFiles.length > RECENT_FILES_LIMIT) {
    job.recentFiles.splice(0, job.recentFiles.length - RECENT_FILES_LIMIT);
  }
  return entry;
}

function makeJob(op, label) {
  const id = `job_${++jobSeq}_${Date.now().toString(36)}`;
  const job = {
    id,
    op,
    label,
    status: 'running',
    totalBytes: 0,
    copiedBytes: 0,
    itemsTotal: 0,
    itemsDone: 0,
    itemsSkipped: 0,
    currentFile: '',
    errors: [],
    startedAt: Date.now(),
    endedAt: null,
    paused: false,
    cancelled: false,
    throttleBps: 0,
    collision: 'overwrite',
    // Bytes belonging to entries that were skipped. Tracking them separately lets
    // the progress goal shrink instead of stalling short of 100% forever.
    bytesSkipped: 0,
    // Interactive collision state: set while the transfer parks waiting for a
    // human answer, then consumed as soon as that answer arrives.
    pendingConflict: null,
    conflictDecision: null,
    // "Apply to all" promotes one answer into the policy for the whole job.
    conflictOverride: null,
    // Tail of the files this job touched, newest last. Bounded by
    // RECENT_FILES_LIMIT so a huge tree cannot blow up the snapshot.
    recentFiles: []
  };
  jobs.set(id, job);
  // Keep memory bounded: drop the oldest finished jobs.
  if (jobs.size > 200) {
    for (const [key, value] of jobs) {
      if (value.status !== 'running' && value.status !== 'paused') { jobs.delete(key); break; }
    }
  }
  return job;
}

function finishJob(job) {
  // Never leave a finished job advertising a conflict prompt that nobody can
  // answer any more.
  job.pendingConflict = null;
  job.endedAt = Date.now();
  if (job.cancelled) job.status = 'cancelled';
  else if (job.errors.length) job.status = 'done-with-errors';
  else job.status = 'done';
  invalidateListings();
}

async function waitWhilePaused(job) {
  while (job.paused && !job.cancelled) await sleep(120);
  if (job.cancelled) throw new Error('__cancelled__');
}

function isAbsoluteLocalPath(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z]:[\\/]/.test(text) || /^\\\\[^\\]/.test(text);
}

// Reject anything that is not an absolute local/UNC path so a malformed or
// hostile request can never be resolved relative to the server's cwd.
function assertSafePath(value) {
  if (!isAbsoluteLocalPath(value)) throw new Error(`Unsafe path: ${value}`);
  return path.win32.normalize(String(value).trim());
}

async function measureTree(target) {
  let bytes = 0;
  let files = 0;
  let stat;
  try { stat = await fs.promises.lstat(target); } catch { return { bytes, files }; }
  if (stat.isDirectory()) {
    let entries = [];
    try { entries = await fs.promises.readdir(target); } catch { return { bytes, files }; }
    for (const name of entries) {
      const sub = await measureTree(path.win32.join(target, name));
      bytes += sub.bytes;
      files += sub.files;
    }
  } else {
    bytes += stat.size;
    files += 1;
  }
  return { bytes, files };
}

async function pathExists(target) {
  try { await fs.promises.access(target); return true; } catch { return false; }
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
async function awaitConflictAnswer(job, src, dest) {
  job.conflictDecision = null;
  job.pendingConflict = { source: src, destination: dest };
  while (!job.cancelled && job.pendingConflict) await sleep(120);
  job.pendingConflict = null;
  if (job.cancelled) throw new Error('__cancelled__');
  const answer = job.conflictDecision;
  job.conflictDecision = null;
  return answer || 'overwrite';
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
    } catch { /* unreadable source is reported by the copy itself */ }
    // Recorded here so every skip surfaces as a row, whether it happened at the
    // top level or deep inside a copied tree.
    const skipped = noteFile(job, dest, 0);
    skipped.status = 'skipped';
    return null;
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

async function copyOneFile(src, dest, job) {
  const stat = await fs.promises.stat(src);
  await fs.promises.mkdir(path.win32.dirname(dest), { recursive: true });
  job.currentFile = dest;
  const entry = noteFile(job, dest, stat.size);
  const reader = fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
  const writer = fs.createWriteStream(dest);
  const fileStart = Date.now();
  let bytesThisFile = 0;
  try {
    for await (const chunk of reader) {
      await waitWhilePaused(job);
      if (!writer.write(chunk)) await once(writer, 'drain');
      job.copiedBytes += chunk.length;
      bytesThisFile += chunk.length;
      entry.copied = bytesThisFile;
      if (job.throttleBps > 0) {
        const expectedMs = (bytesThisFile / job.throttleBps) * 1000;
        const actualMs = Date.now() - fileStart;
        if (expectedMs > actualMs) await sleep(expectedMs - actualMs);
      }
    }
    await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    reader.destroy();
    writer.destroy();
    entry.status = 'error';
    throw err;
  }
  entry.copied = stat.size;
  entry.status = 'done';
  try { await fs.promises.utimes(dest, stat.atime, stat.mtime); } catch {}
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
  if (!planned) { job.itemsSkipped += 1; return; }
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
    '}'
  ];
  fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
  recycleScriptPath = scriptPath;
  return scriptPath;
}

async function sendToRecycleBin(targets) {
  await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureRecycleScript(), ...targets],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 300000 }
  );
}

async function deleteTarget(target, useTrash) {
  if (useTrash && process.platform === 'win32') {
    await sendToRecycleBin([target]);
    return;
  }
  await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3 });
}

function startJob(job, runner) {
  runner
    .then(() => finishJob(job))
    .catch((err) => {
      if (err && err.message === '__cancelled__') {
        job.cancelled = true;
      } else {
        job.errors.push({ path: '', message: err && err.message ? err.message : String(err) });
      }
      finishJob(job);
    });
  return job;
}

async function runTransferJob(job, sources, targetDir) {
  for (const src of sources) {
    await waitWhilePaused(job);
    const dest = await resolveDestination(src, targetDir, job);
    if (!dest) { job.itemsSkipped += 1; continue; }
    try {
      if (job.op === 'move') await moveTree(src, dest, job, true);
      else await copyTree(src, dest, job, true);
    } catch (err) {
      if (err.message === '__cancelled__') throw err;
      job.errors.push({ path: src, message: err.message });
    }
  }
}

function registerFsRoutes() {
  app.get('/api/fs/jobs', (_req, res) => {
    res.json([...jobs.values()].map(jobSnapshot));
  });

  // Live monitoring surface for the transfer engine.
  app.get('/__jobs', (_req, res) => {
    res.type('html').send(dashboardHtml());
  });

  app.get('/api/fs/dashboard', (_req, res) => {
    const all = [...jobs.values()];
    res.json({
      port: activePort ?? PREFERRED_PORT,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      activeCount: all.filter(j => j.status === 'running' || j.status === 'paused').length,
      totalCount: all.length
    });
  });

  app.get('/api/fs/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    res.json(jobSnapshot(job));
  });

  app.post('/api/fs/job/:id/:action', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    const action = req.params.action;
    if (action === 'resolve') {
      // Answer for one queued collision prompt. `applyToAll` promotes the answer
      // into the job policy so the rest of the transfer stops asking.
      const decision = String((req.body || {}).decision || '').toLowerCase();
      if (!['overwrite', 'skip', 'rename'].includes(decision)) {
        return res.status(400).json({ error: 'Unknown conflict answer' });
      }
      if (!job.pendingConflict) return res.status(409).json({ error: 'No pending conflict' });
      if (req.body && req.body.applyToAll) job.conflictOverride = decision;
      job.conflictDecision = decision;
      job.pendingConflict = null;
      return res.json(jobSnapshot(job));
    }
    if (action === 'pause') job.paused = true;
    else if (action === 'resume') job.paused = false;
    else if (action === 'cancel') { job.cancelled = true; job.paused = false; }
    else return res.status(400).json({ error: 'Unknown action' });
    res.json(jobSnapshot(job));
  });

  const transfer = (op) => async (req, res) => {
    try {
      const body = req.body || {};
      const sources = (body.sources || []).map(assertSafePath);
      const targetDir = assertSafePath(body.targetDir);
      if (!sources.length) return res.status(400).json({ error: 'No sources provided' });
      const targetStat = await fs.promises.stat(targetDir).catch(() => null);
      if (!targetStat || !targetStat.isDirectory()) {
        return res.status(400).json({ error: 'Target is not a directory' });
      }
      for (const src of sources) {
        if (src.toUpperCase() === targetDir.toUpperCase()) {
          return res.status(400).json({ error: 'Source and target are the same' });
        }
      }
      const verb = op === 'move' ? 'Mover' : 'Copiar';
      const job = makeJob(op, `${verb} ${sources.length} elemento(s)`);
      const requestedPolicy = String(body.collision || '').toLowerCase();
      job.collision = ['overwrite', 'skip', 'rename', 'ask'].includes(requestedPolicy)
        ? requestedPolicy
        : (body.overwrite === false ? 'rename' : 'overwrite');
      job.throttleBps = Number(body.throttleBps) > 0 ? Number(body.throttleBps) : 0;
      let bytes = 0;
      let files = 0;
      for (const src of sources) {
        const measured = await measureTree(src);
        bytes += measured.bytes;
        files += measured.files;
      }
      job.totalBytes = bytes;
      job.itemsTotal = files;
      startJob(job, runTransferJob(job, sources, targetDir));
      res.json({ jobId: job.id, totalBytes: bytes, itemsTotal: files });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  app.post('/api/fs/copy', transfer('copy'));
  app.post('/api/fs/move', transfer('move'));

  app.post('/api/fs/delete', (req, res) => {
    try {
      const body = req.body || {};
      const targets = (body.targets || []).map(assertSafePath);
      const useTrash = body.useTrash !== false;
      if (!targets.length) return res.status(400).json({ error: 'No targets provided' });
      const job = makeJob('delete', `Eliminar ${targets.length} elemento(s)`);
      job.itemsTotal = targets.length;
      startJob(job, (async () => {
        for (const target of targets) {
          await waitWhilePaused(job);
          let entry = null;
          try {
            const stat = await fs.promises.lstat(target).catch(() => null);
            entry = noteFile(job, target, stat && stat.isFile() ? stat.size : 0);
            await deleteTarget(target, useTrash);
            entry.copied = entry.size;
            entry.status = 'done';
            job.itemsDone += 1;
          } catch (err) {
            if (entry) entry.status = 'error';
            if (err.message === '__cancelled__') throw err;
            job.errors.push({ path: target, message: err.message });
          }
        }
      })());
      res.json({ jobId: job.id, itemsTotal: targets.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/mkdir', async (req, res) => {
    try {
      const target = assertSafePath((req.body || {}).path);
      await fs.promises.mkdir(target, { recursive: true });
      invalidateListings();
      res.json({ ok: true, path: target });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/rename', async (req, res) => {
    try {
      const body = req.body || {};
      const source = assertSafePath(body.path);
      const newName = String(body.newName || '').trim();
      if (!newName || /[\\/:*?"<>|]/.test(newName)) {
        return res.status(400).json({ error: 'Invalid file name' });
      }
      const dest = path.win32.join(path.win32.dirname(source), newName);
      if (await pathExists(dest)) return res.status(409).json({ error: 'A file with that name already exists' });
      await fs.promises.rename(source, dest);
      invalidateListings();
      res.json({ ok: true, path: dest });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/fs/write', async (req, res) => {
    try {
      const body = req.body || {};
      const target = assertSafePath(body.path);
      await fs.promises.mkdir(path.win32.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, body.content == null ? '' : String(body.content), 'utf8');
      invalidateListings();
      res.json({ ok: true, path: target });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

registerFsRoutes();

// Optional static serving
app.use(express.static(path.join(__dirname, 'dist')));

// Warm the drive metadata cache in the background. Never blocks a request.
enrichDrivesFromWmi();

/**
 * True when something already accepts connections on this loopback port.
 *
 * On Windows a process may bind 127.0.0.1:PORT while another one holds the same
 * port on 0.0.0.0, and the two then split incoming requests between them. A
 * silent EADDRINUSE never happens, so we ask the port instead of trusting bind().
 */
function probePortBusy(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const settle = busy => {
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
  return new Promise(resolve => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/api/fs/jobs', timeout: 1000 },
      response => {
        response.resume();
        resolve(response.headers['x-omnicmd-server'] === '1');
      }
    );
    let settled = false;
    const settle = owned => {
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
  server.on('error', error => {
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

listenOn(PREFERRED_PORT, 0).catch(error => {
  // A dead local server must never take the host application down with it.
  console.error('Local drive server failed to start:', error);
});

module.exports = { onPortReady, getPort: () => activePort, PREFERRED_PORT };