/**
 * Map tiles, offline downloads, address search and locate.
 *
 * The renderer never builds a tile URL itself: the server owns the cache (in
 * memory and on disk), the identity header each provider asks for and the rate
 * limit, so a provider only ever sees one client. Registered as a function so
 * the app, the session token and the byte-range helpers arrive as arguments.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
function registerMapRoutes(app, deps) {
  const { SESSION_TOKEN, parseByteRange, MEDIA_TYPES, assertSafePath, logDebug } = deps;

  const MAP_LAYER_URLS = {
    osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    humanitarian: (z, x, y) => `https://a.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`,
    cycle: (z, x, y) => `https://a.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`,
    topo: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
    transport: (z, x, y) => `https://tile.memomaps.de/tilegen/${z}/${x}/${y}.png`,
  };
  const MAP_IDENTITY =
    'OmniCommanderPro/1.0 (Windows desktop file manager; +https://github.com/earenbaz80/omni-commander)';
  const MAP_TILE_MAX_ZOOM = 19;
  const MAP_TILE_CACHE_LIMIT = 400;
  /** Tiles kept on disk, which is what makes the map work with no network. */
  const MAP_TILE_DISK_LIMIT = 20000;
  const MAP_TILE_DISK_PRUNE_EVERY = 400;
  const MAP_OFFLINE_MAX_TILES = 400;
  const MAP_OFFLINE_CONCURRENCY = 2;
  // The app passes its userData folder; a bare server run falls back to the temp
  // folder so a test never writes into the real profile.
  const MAP_TILE_DISK_DIR =
    String(process.env.OMNI_MAP_CACHE_DIR || '').trim() || path.join(os.tmpdir(), 'omnicommander-map-tiles');
  const MAP_SEARCH_CACHE_LIMIT = 200;
  const MAP_SEARCH_MIN_INTERVAL_MS = 1100;
  const MAP_SEARCH_CACHE_MS = 60 * 60 * 1000;
  const mapTileCache = new Map();
  const mapSearchCache = new Map();
  let mapSearchLastAt = 0;
  let mapSearchQueue = Promise.resolve();

  /**
   * Answers 403 itself when the per-launch token is missing. A tile is loaded by
   * an <img>, which cannot send a header, so the token rides in the query; a
   * fetch can send one, and the routes that change state take it there.
   */
  function mapsTokenRejected(req, res) {
    if (!SESSION_TOKEN) return false;
    const fromQuery = String(req.query.t || '');
    const fromHeader = String((req.headers || {})['x-omni-token'] || '');
    if (fromQuery === SESSION_TOKEN || fromHeader === SESSION_TOKEN) return false;
    res.status(403).json({ error: 'Missing or invalid session token' });
    return true;
  }

  function rememberMapTile(key, buffer) {
    mapTileCache.set(key, buffer);
    if (mapTileCache.size <= MAP_TILE_CACHE_LIMIT) return;
    // Map keeps insertion order, so the first keys are the oldest.
    const excess = mapTileCache.size - MAP_TILE_CACHE_LIMIT;
    let dropped = 0;
    for (const oldKey of mapTileCache.keys()) {
      if (dropped >= excess) break;
      mapTileCache.delete(oldKey);
      dropped += 1;
    }
  }

  function mapTileDiskPath(layer, z, x, y) {
    return path.join(MAP_TILE_DISK_DIR, layer, String(z), String(x), `${y}.png`);
  }

  /** A tile saved on an earlier run; a miss is an ordinary answer, not an error. */
  async function readMapTileFromDisk(key) {
    const [layer, z, x, y] = String(key).split('/');
    try {
      return await fs.promises.readFile(mapTileDiskPath(layer, Number(z), Number(x), Number(y)));
    } catch {
      return null;
    }
  }

  let mapTileDiskWrites = 0;

  async function writeMapTileToDisk(layer, z, x, y, buffer) {
    try {
      await fs.promises.mkdir(path.join(MAP_TILE_DISK_DIR, layer, String(z), String(x)), { recursive: true });
      await fs.promises.writeFile(mapTileDiskPath(layer, z, x, y), buffer);
    } catch {
      // A profile that refuses the write still gets the in-memory cache.
      return;
    }
    mapTileDiskWrites += 1;
    if (mapTileDiskWrites % MAP_TILE_DISK_PRUNE_EVERY === 0) void pruneMapTileDisk();
  }

  /**
   * Keeps the offline cache inside its budget. It runs every few hundred writes:
   * walking the folder costs a stat per file, and a tile never has to disappear
   * the instant the limit is crossed.
   */
  async function pruneMapTileDisk() {
    try {
      const entries = await fs.promises.readdir(MAP_TILE_DISK_DIR, { recursive: true, withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.png'));
      if (files.length <= MAP_TILE_DISK_LIMIT) return;
      const dated = await Promise.all(
        files.map(async (entry) => {
          const full = path.join(entry.parentPath || entry.path || '', entry.name);
          const info = await fs.promises.stat(full).catch(() => null);
          return { full, at: info ? info.mtimeMs : 0 };
        }),
      );
      dated.sort((a, b) => a.at - b.at);
      const excess = dated.length - MAP_TILE_DISK_LIMIT;
      await Promise.all(dated.slice(0, excess).map((file) => fs.promises.unlink(file.full).catch(() => {})));
    } catch {
      /* A cache that cannot be pruned is still a working cache. */
    }
  }

  /** Reads one tile number set into the shape the routes work with, or null. */
  function parseMapTile(layer, z, x, y) {
    if (!MAP_LAYER_URLS[layer]) return null;
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (z < 0 || z > MAP_TILE_MAX_ZOOM) return null;
    const count = Math.pow(2, z);
    if (x < 0 || y < 0 || x >= count || y >= count) return null;
    return { z, x, y };
  }

  /** Fetches one tile and stores it on both levels of the cache. */
  async function downloadMapTile(layer, z, x, y) {
    const build = MAP_LAYER_URLS[layer];
    const upstream = await fetch(build(z, x, y), {
      headers: { 'User-Agent': MAP_IDENTITY, Accept: 'image/png,image/*;q=0.8' },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) throw new Error(`tile-upstream-${upstream.status}`);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) throw new Error('tile-empty');
    rememberMapTile(`${layer}/${z}/${x}/${y}`, buffer);
    await writeMapTileToDisk(layer, z, x, y, buffer);
    return buffer;
  }

  /** Serialises searches so the one-request-per-second rule holds across tabs of the dialog. */
  function queueMapSearch(task) {
    const run = mapSearchQueue.then(async () => {
      const wait = MAP_SEARCH_MIN_INTERVAL_MS - (Date.now() - mapSearchLastAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      mapSearchLastAt = Date.now();
      return task();
    });
    mapSearchQueue = run.catch(() => {});
    return run;
  }

  app.get('/api/maps/tile', async (req, res) => {
    if (mapsTokenRejected(req, res)) return;
    const layer = String(req.query.layer || 'osm');
    const tile = parseMapTile(layer, Number(req.query.z), Number(req.query.x), Number(req.query.y));
    if (!tile) return res.status(400).json({ error: 'invalid-tile' });
    const { z, x, y } = tile;
    const key = `${layer}/${z}/${x}/${y}`;
    const cached = mapTileCache.get(key);
    if (cached) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(cached);
    }

    // The disk cache is what makes the map usable on a train or a plane: a tile
    // seen once is answered without touching the network at all.
    const stored = await readMapTileFromDisk(key);
    if (stored) {
      rememberMapTile(key, stored);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(stored);
    }

    try {
      const buffer = await downloadMapTile(layer, z, x, y);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(buffer);
    } catch {
      return res.status(502).json({ error: 'tile-fetch-failed' });
    }
  });

  /**
   * Saves a patch of map for later. The dialog works out which tiles it wants and
   * sends them in batches; this route only fetches and stores, two at a time so a
   * downloaded area stays a polite request rather than a bulk crawl.
   */
  app.post('/api/maps/offline', async (req, res) => {
    if (mapsTokenRejected(req, res)) return;
    const layer = String((req.body && req.body.layer) || '');
    if (!MAP_LAYER_URLS[layer]) return res.status(400).json({ error: 'invalid-layer' });
    const asked = req.body && Array.isArray(req.body.tiles) ? req.body.tiles : null;
    if (!asked || asked.length === 0 || asked.length > MAP_OFFLINE_MAX_TILES) {
      return res.status(400).json({ error: 'invalid-tiles' });
    }
    const tiles = [];
    for (const entry of asked) {
      const tile = parseMapTile(layer, Number(entry && entry.z), Number(entry && entry.x), Number(entry && entry.y));
      if (!tile) return res.status(400).json({ error: 'invalid-tiles' });
      tiles.push(tile);
    }

    let stored = 0;
    let skipped = 0;
    let failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < tiles.length) {
        const tile = tiles[cursor];
        cursor += 1;
        const key = `${layer}/${tile.z}/${tile.x}/${tile.y}`;
        if (mapTileCache.has(key) || (await readMapTileFromDisk(key))) {
          skipped += 1;
          continue;
        }
        try {
          await downloadMapTile(layer, tile.z, tile.x, tile.y);
          stored += 1;
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: MAP_OFFLINE_CONCURRENCY }, worker));
    res.json({ stored, skipped, failed, total: tiles.length });
  });

  /**
   * What the disk cache holds, so the dialog can say it instead of the user
   * guessing why the map still works on a plane. Walking the folder costs a
   * stat per tile; the dialog asks for it when it opens and after a download.
   */
  async function measureMapTileDisk() {
    let tiles = 0;
    let bytes = 0;
    const layers = {};
    try {
      const entries = await fs.promises.readdir(MAP_TILE_DISK_DIR, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
        const full = path.join(entry.parentPath || entry.path || '', entry.name);
        const info = await fs.promises.stat(full).catch(() => null);
        if (!info) continue;
        tiles += 1;
        bytes += info.size;
        const layer = path.relative(MAP_TILE_DISK_DIR, full).split(path.sep)[0];
        if (layer) layers[layer] = (layers[layer] || 0) + 1;
      }
    } catch {
      // No folder yet is an empty cache, not an error.
    }
    return { tiles, bytes, layers };
  }

  app.get('/api/maps/cache', async (req, res) => {
    if (mapsTokenRejected(req, res)) return;
    res.json(await measureMapTileDisk());
  });

  /**
   * Empties both levels of the cache. The in-memory copy goes first, so nothing
   * is served from a folder that is about to disappear, and the search cache
   * goes with it: names and coordinates are as reusable as the squares.
   */
  app.delete('/api/maps/cache', async (req, res) => {
    if (mapsTokenRejected(req, res)) return;
    const measured = await measureMapTileDisk();
    mapTileCache.clear();
    mapSearchCache.clear();
    try {
      await fs.promises.rm(MAP_TILE_DISK_DIR, { recursive: true, force: true });
    } catch {
      return res.status(500).json({ error: 'cache-clear-failed' });
    }
    return res.json({ removed: measured.tiles, bytes: measured.bytes });
  });

  app.get('/api/maps/search', async (req, res) => {
    if (mapsTokenRejected(req, res)) return;
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.status(400).json({ error: 'query-too-short' });

    const cacheKey = query.toLowerCase();
    const cached = mapSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MAP_SEARCH_CACHE_MS) return res.json({ results: cached.results });

    try {
      const results = await queueMapSearch(async () => {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', '8');
        url.searchParams.set('q', query);
        const upstream = await fetch(url, {
          headers: { 'User-Agent': MAP_IDENTITY, Accept: 'application/json', 'Accept-Language': 'es,en;q=0.8' },
          signal: AbortSignal.timeout(12000),
        });
        if (!upstream.ok) throw new Error(`nominatim-${upstream.status}`);
        const payload = await upstream.json();
        if (!Array.isArray(payload)) return [];
        return payload.flatMap((entry) => {
          const lat = Number(entry && entry.lat);
          const lon = Number(entry && entry.lon);
          const label = String((entry && (entry.display_name || entry.name)) || '').trim();
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) return [];
          return [{ label, lat, lon }];
        });
      });
      if (mapSearchCache.size >= MAP_SEARCH_CACHE_LIMIT) mapSearchCache.clear();
      mapSearchCache.set(cacheKey, { at: Date.now(), results });
      return res.json({ results });
    } catch {
      return res.status(502).json({ error: 'search-failed' });
    }
  });

  app.get('/api/maps/locate', async (req, res) => {
    if (mapsTokenRejected(req, res)) return;
    try {
      const upstream = await fetch('https://ipwho.is/', {
        headers: { 'User-Agent': MAP_IDENTITY, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) return res.status(502).json({ error: 'locate-failed' });
      const payload = await upstream.json();
      const lat = Number(payload && payload.latitude);
      const lon = Number(payload && payload.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(502).json({ error: 'locate-failed' });
      const label = [payload.city, payload.region, payload.country].filter(Boolean).join(', ');
      return res.json({ lat, lon, label, approximate: true });
    } catch {
      return res.status(502).json({ error: 'locate-failed' });
    }
  });

  app.get('/api/media', async (req, res) => {
    // An <img> or a <video> cannot carry the session header, so the per-launch
    // token travels in the query string instead of being dropped.
    if (SESSION_TOKEN && String(req.query.t || '') !== SESSION_TOKEN) {
      return res.status(403).json({ error: 'Missing or invalid session token' });
    }
    let resolved;
    try {
      resolved = assertSafePath(String(req.query.path || ''));
    } catch {
      return res.status(400).json({ error: 'invalid-path' });
    }
    const type = MEDIA_TYPES.get(path.extname(resolved).slice(1).toUpperCase());
    if (!type) return res.status(415).json({ error: 'unsupported-media-type' });

    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'not-found' });

    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseByteRange(req.headers.range, stat.size);
    if (req.headers.range && !range) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).json({ error: 'range-not-satisfiable' });
    }
    if (!range) {
      res.setHeader('Content-Length', String(stat.size));
      const whole = fs.createReadStream(resolved);
      whole.on('error', () => res.destroy());
      return whole.pipe(res);
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
    const part = fs.createReadStream(resolved, { start: range.start, end: range.end });
    part.on('error', () => res.destroy());
    part.pipe(res);
  });

  /**
   * Asks the shell for its "Open with" picker and returns once it has started.
   *
   * The picker is modal: rundll32 stays alive until the user chooses a program.
   * Waiting for it to exit — what an execFile with a timeout does — is what made
   * the menu item do nothing: the request blocked for 15 s, the launcher was
   * killed while its dialog was still on screen, and the app only ever heard about
   * it as a 502 it did not show. The child is unref'd instead, so the dialog
   * outlives the request and stays with the user until they close it.
   */
  function launchOpenWithPicker(target) {
    return new Promise((resolve, reject) => {
      const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', target], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  /**
   * The Windows "Open with" chooser for one file.
   *
   * Kept apart from /api/open, which hands the file to whatever is registered:
   * this is the dialog the shell shows when there is no default, or when the user
   * wants a different program than the one that would start. The path is resolved
   * through the same safety check as every other route, so only a real file on an
   * allowed drive can be offered to a program.
   */
  app.post('/api/open-with', async (req, res) => {
    const raw = typeof (req.body || {}).path === 'string' ? req.body.path : '';
    if (!raw.trim()) return res.status(400).json({ error: 'empty-path' });
    let resolved;
    try {
      resolved = assertSafePath(raw);
    } catch {
      return res.status(400).json({ error: 'invalid-path' });
    }
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'not-found' });
    if (stat.isDirectory()) return res.status(400).json({ error: 'not-a-file' });

    // Same dry-run switch as the Run box, so the tests can assert the argv
    // without a dialog opening on the machine.
    if (process.env.OMNI_RUN_DRY_RUN === '1') {
      return res.json({ path: resolved, launched: ['rundll32.exe', 'shell32.dll,OpenAs_RunDLL', resolved] });
    }
    try {
      await launchOpenWithPicker(resolved);
      return res.json({ path: resolved });
    } catch (error) {
      logDebug('open-with failed', resolved, error?.message || error);
      return res.status(502).json({ error: 'launch-failed' });
    }
  });

  /** Extensions the submenu is allowed to run. A registry command may name a
   * script or a document; only a real executable is offered as a program. */
}

module.exports = { registerMapRoutes };
