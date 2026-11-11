/**
 * Sharing one folder with the rest of the local network.
 *
 * The app's own API stays on loopback on purpose, so this is a second, separate
 * listener: it only exists while the user has started a share, and it serves one
 * folder read-only. The token in the path is the whole credential — anyone who
 * has the link can read the folder — so the surface is deliberately small: a
 * listing and a download, nothing that writes, and no route that names a path
 * outside the shared folder.
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { assertSafePath } = require('./pathSafety.cjs');

/** Where the share goes unless the user asked for another port. */
const DEFAULT_PORT = 8090;
/** How many ports past the preferred one may be tried before giving up. */
const MAX_PORT_ATTEMPTS = 10;

/**
 * Types a browser may render in place. Everything else is sent as an attachment
 * and without a sniffable type, so a shared folder cannot hand a page to the
 * browser that then runs with the share's own origin.
 */
const INLINE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
  ['.avif', 'image/avif'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.log', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
]);

/** Every IPv4 address another machine on this network could reach. */
function lanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const address of list || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      addresses.push(address.address);
    }
  }
  return addresses;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * True when `target` is the folder itself or something inside it. Compared
 * case-insensitively on Windows, which is how that filesystem compares paths.
 */
function isWithin(root, target) {
  const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const base = fold(path.resolve(root));
  const candidate = fold(path.resolve(target));
  return candidate === base || candidate.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

/**
 * Turns the relative path a browser asked for into a path inside the share.
 *
 * `path.resolve` alone is not enough: segments are checked before it runs, so
 * `..` never climbs and an absolute or drive-qualified value cannot replace the
 * root. Anything that still lands outside is refused.
 */
function resolveWithin(root, requested) {
  const relative = String(requested || '').replace(/\\/g, '/');
  const segments = relative.split('/').filter((segment) => segment !== '' && segment !== '.');
  // `..` climbs and a colon makes a segment drive-qualified. Neither can name an
  // entry inside the share: Windows file names cannot contain a colon, and a
  // drive letter there would let a request pick the base the join starts from.
  if (segments.some((segment) => segment === '..' || segment.includes(':'))) {
    throw new Error('Path leaves the shared folder');
  }
  const target = path.resolve(root, ...segments);
  if (!isWithin(root, target)) throw new Error('Path leaves the shared folder');
  return target;
}

/** The path the browser used, back in its own slash form. */
function relativeFromRoot(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function linkFor(token, relativePath) {
  return `/s/${encodeURIComponent(token)}?p=${encodeURIComponent(relativePath)}`;
}

function tokenMatches(provided, expected) {
  const given = Buffer.from(String(provided || ''));
  const wanted = Buffer.from(String(expected || ''));
  if (!wanted.length || given.length !== wanted.length) return false;
  return crypto.timingSafeEqual(given, wanted);
}

const PAGE_STYLE = `
    :root { color-scheme: light dark; }
    body { font-family: ui-monospace, Consolas, monospace; margin: 0; padding: 24px; background: #0b1020; color: #e6e6e6; }
    h1 { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
    nav { font-size: 13px; margin-bottom: 14px; word-break: break-all; }
    a { color: #7dd3fc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #26304a; }
    th { font-size: 11px; text-transform: uppercase; opacity: 0.6; }
    .size, .date { white-space: nowrap; opacity: 0.8; }
    .size { text-align: right; }
    footer { margin-top: 18px; font-size: 11px; opacity: 0.55; }
    .empty { padding: 10px 8px; opacity: 0.6; }
  `;

/** The listing page: one table, folders first, every row a link back into this share. */
function renderListing({ folderName, token, relativePath, entries }) {
  const crumbs = [`<a href="${linkFor(token, '')}">${escapeHtml(folderName)}</a>`];
  let walked = '';
  for (const segment of relativePath.split('/').filter(Boolean)) {
    walked = walked ? `${walked}/${segment}` : segment;
    crumbs.push(`<a href="${linkFor(token, walked)}">${escapeHtml(segment)}</a>`);
  }

  const rows = entries
    .map((entry) => {
      const icon = entry.isDirectory ? '&#128193;' : '&#128196;';
      const size = entry.isDirectory ? '' : formatSize(entry.size);
      return `<tr><td>${icon} <a href="${linkFor(token, entry.relativePath)}">${escapeHtml(entry.name)}</a></td><td class="size">${size}</td><td class="date">${escapeHtml(formatDate(entry.modifiedAt))}</td></tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(folderName)}${relativePath ? ` / ${escapeHtml(relativePath)}` : ''} · OmniCommander</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>OmniCommander Pro &middot; ${escapeHtml(folderName)}</h1>
  <nav>${crumbs.join(' / ')}</nav>
  ${
    entries.length
      ? `<table><thead><tr><th>Nombre</th><th class="size">Tamaño</th><th class="date">Modificado</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="empty">Carpeta vacía</div>'
  }
  <footer>Solo lectura. Cierra la compartición en la aplicación para cortar este acceso.</footer>
</body>
</html>`;
}

/**
 * One request against an active share: the token, then the folder listing or the
 * file itself. Every failure is answered without naming the real path, so a
 * wrong link learns nothing about this machine.
 */
async function serveShared({ folder, token, request, response }) {
  if (!tokenMatches(String(request.params.token || ''), token)) {
    response.status(404).type('text').send('This link is not valid.');
    return;
  }

  let target;
  try {
    target = resolveWithin(folder, request.query.p);
  } catch {
    response.status(403).type('text').send('Forbidden path.');
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    response.status(404).type('text').send('Not found.');
    return;
  }

  // A symlink or junction inside the share must not become a door to the rest of
  // the disk, so what the filesystem resolves is checked against what we meant
  // to share before anything is read.
  try {
    const realTarget = await fs.promises.realpath(target);
    const realRoot = await fs.promises.realpath(folder);
    if (!isWithin(realRoot, realTarget)) {
      response.status(403).type('text').send('Forbidden path.');
      return;
    }
    target = realTarget;
  } catch {
    response.status(404).type('text').send('Not found.');
    return;
  }

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (stat.isDirectory()) {
    let dirents;
    try {
      dirents = await fs.promises.readdir(target, { withFileTypes: true });
    } catch {
      response.status(403).type('text').send('This folder cannot be read.');
      return;
    }
    const entries = await Promise.all(
      dirents.map(async (dirent) => {
        const full = path.join(target, dirent.name);
        let entryStat = null;
        try {
          entryStat = await fs.promises.stat(full);
        } catch {
          entryStat = null;
        }
        return {
          name: dirent.name,
          isDirectory: dirent.isDirectory(),
          size: entryStat && !entryStat.isDirectory() ? entryStat.size : 0,
          modifiedAt: entryStat ? entryStat.mtime : null,
          relativePath: relativeFromRoot(folder, full),
        };
      }),
    );
    entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'",
    );
    response
      .status(200)
      .type('html')
      .send(
        renderListing({
          folderName: path.basename(folder) || folder,
          token,
          relativePath: relativeFromRoot(folder, target),
          entries,
        }),
      );
    return;
  }

  if (!stat.isFile()) {
    response.status(404).type('text').send('Not found.');
    return;
  }

  const name = path.basename(target);
  const extension = path.extname(name).toLowerCase();
  const inline = INLINE_TYPES.get(extension);
  response.setHeader('Content-Type', inline || 'application/octet-stream');
  response.setHeader('Content-Length', String(stat.size));
  if (!inline) {
    // Only the ASCII fallback needs its quotes removed; the UTF-8 form carries
    // the real name for anything a header cannot hold.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  }

  const stream = fs.createReadStream(target);
  stream.on('error', () => {
    // The client may be gone or the file may have moved between the stat above
    // and this read; either way there is nothing left to send.
    response.destroy();
  });
  stream.pipe(response);
}

/**
 * The service behind the sharing panel: one share at a time, started and stopped
 * from the app, listening on every interface so another machine can reach it.
 */
function createShareService({ logDebug = () => {} } = {}) {
  /** The running share, or null. Never persisted: closing the app ends it. */
  let state = null;

  function status() {
    if (!state) {
      return { active: false, folder: null, port: null, token: null, startedAt: null, urls: [] };
    }
    return {
      active: true,
      folder: state.folder,
      port: state.port,
      token: state.token,
      startedAt: state.startedAt,
      urls: state.urls,
    };
  }

  function stop() {
    const current = state;
    state = null;
    if (!current) return;
    try {
      // A browser that opened a listing keeps its connection alive, and close()
      // alone would wait for it; the share has to end when the user says so.
      current.server.closeAllConnections?.();
      current.server.close(() => logDebug('share listener closed'));
    } catch (error) {
      logDebug('share listener could not close:', error?.message || error);
    }
  }

  function listenOnce(expressApp, port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(expressApp);
      const onError = (error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve({ server, port: server.address().port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '0.0.0.0');
    });
  }

  async function listen(expressApp, preferredPort) {
    let attempt = 0;
    for (;;) {
      try {
        return await listenOnce(expressApp, preferredPort + attempt);
      } catch (error) {
        if (error && error.code === 'EADDRINUSE' && preferredPort !== 0 && attempt < MAX_PORT_ATTEMPTS) {
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
  }

  async function start({ folder, port } = {}) {
    const safeFolder = assertSafePath(folder);
    const folderStat = await fs.promises.stat(safeFolder).catch(() => null);
    if (!folderStat || !folderStat.isDirectory()) {
      throw new Error(`Not a folder: ${safeFolder}`);
    }

    const requested = Number(port);
    const preferredPort = Number.isInteger(requested) && requested >= 0 ? Math.min(requested, 65535) : DEFAULT_PORT;

    // One share at a time: starting another retires the previous listener so no
    // token stays alive behind the user's back.
    stop();

    const expressApp = express();
    expressApp.disable('x-powered-by');
    const token = crypto.randomBytes(16).toString('hex');
    const pending = { folder: safeFolder, token, port: null, server: null, startedAt: null, urls: [] };

    expressApp.get('/s/:token', (request, response) => {
      if (state !== pending) {
        response.status(404).type('text').send('This share is no longer active.');
        return;
      }
      void serveShared({ folder: pending.folder, token: pending.token, request, response });
    });
    expressApp.get('/', (_request, response) => {
      response
        .status(404)
        .type('html')
        .send(
          '<!doctype html><meta charset="utf-8"><title>OmniCommander Pro</title><p>This is a private share. Open the full link, token included, on the computer it was given to.</p>',
        );
    });

    const { server, port: boundPort } = await listen(expressApp, preferredPort);
    pending.server = server;
    pending.port = boundPort;
    pending.startedAt = new Date().toISOString();
    pending.urls = lanAddresses().map((address) => `http://${address}:${boundPort}/s/${token}`);
    state = pending;
    logDebug(`sharing ${safeFolder} on port ${boundPort}`);
    return status();
  }

  return { start, stop, status, lanAddresses };
}

module.exports = { createShareService, lanAddresses, resolveWithin, isWithin };
