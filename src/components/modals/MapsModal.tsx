import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crop, Crosshair, Download, Globe, Layers, MapPin, Search, Trash2, WifiOff } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { API_BASE } from '../../services/apiBase';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
  panBy,
  projectToScreen,
  tileLayoutFor,
  tilesCoveringView,
  tilesForWorld,
  worldTileCount,
  tilesCoveringRect,
  unprojectFromScreen,
  zoomAround,
  zoomForPinch,
  type MapLayer,
  type MapView,
} from '../../services/slippyMap';

import ModalShell from '../ModalShell';

interface MapsModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  onClose: () => void;
}

interface Place {
  label: string;
  lat: number;
  lon: number;
  approximate?: boolean;
}

interface Point {
  x: number;
  y: number;
}

/**
 * What the fingers are doing. Both variants remember the view the gesture
 * started from and compute from it, so a drag cannot drift from rounding error
 * and a pinch cannot compound its own zoom.
 */
type Gesture =
  | { kind: 'pan'; start: Point; from: MapView }
  | { kind: 'pinch'; startDistance: number; startMid: Point; from: MapView };

const DEFAULT_VIEW: MapView = { lat: 40.4168, lon: -3.7038, zoom: 6 };

type Translate = ReturnType<typeof getTranslations>;

interface MapLayerInfo {
  id: MapLayer;
  label: (t: Translate) => string;
  attribution: (t: Translate) => string;
  /** The tile server has no images past this level. */
  maxZoom: number;
  /** Where the layer's attribution sends the reader: the OSM family asks for it. */
  licenseUrl: string;
}

/**
 * Free, keyless OSM renders, in the order the buttons appear. No layer needs an
 * account or an API key, which is the whole reason the map needs no setup.
 */
const MAP_LAYERS: MapLayerInfo[] = [
  {
    id: 'osm',
    label: (t) => t.mapsLayerStandard,
    attribution: (t) => t.mapsAttribution,
    maxZoom: MAX_ZOOM,
    licenseUrl: 'https://www.openstreetmap.org/copyright',
  },
  {
    id: 'humanitarian',
    label: (t) => t.mapsLayerHumanitarian,
    attribution: (t) => t.mapsAttrHumanitarian,
    maxZoom: MAX_ZOOM,
    licenseUrl: 'https://www.hotosm.org/',
  },
  {
    id: 'cycle',
    label: (t) => t.mapsLayerCycle,
    attribution: (t) => t.mapsAttrCycle,
    maxZoom: MAX_ZOOM,
    licenseUrl: 'https://www.cyclosm.org/',
  },
  {
    id: 'topo',
    label: (t) => t.mapsLayerTopographic,
    attribution: (t) => t.mapsAttrTopo,
    maxZoom: 17,
    licenseUrl: 'https://opentopomap.org/about',
  },
  {
    id: 'transport',
    label: (t) => t.mapsLayerTransport,
    attribution: (t) => t.mapsAttrTransport,
    maxZoom: 18,
    licenseUrl: 'https://memomaps.de/',
  },
];

/** Levels a "save this area" click keeps: what is on screen and two steps closer. */
const OFFLINE_LEVELS = 3;
/** Tiles per request, so one batch stays a quick round trip. */
const OFFLINE_BATCH = 40;

/** Tiles an extra ring beyond the viewport are kept, so short drags need no request. */
const TILE_PADDING = 1;
/** How long the images may stay behind a zoom change before the next level is fetched. */
const TILE_SETTLE_MS = 180;

/** Ceiling for one dragged rectangle: a careless selection must not crawl a continent. */
const RECT_MAX_TILES = 900;

/** Levels a whole-world download offers, and why the list stops there. */
const WORLD_LEVELS = [4, 5, 6];
/** The disk cache prunes to 20 000 tiles, and level 7 alone would be 21 845. */
const WORLD_MAX_LEVEL = 6;
/** Thousands of tiles at once: fewer, larger requests, still polite. */
const WORLD_BATCH = 400;

/** Bytes as a person reads them, because the cache is about disk space. */
function formatCacheSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function spread(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The per-launch token rides in the query: a tile is loaded by an <img>, which cannot send a header. */
function withToken(url: string): string {
  const token = typeof window !== 'undefined' ? window.electronAPI?.apiToken : null;
  if (typeof token !== 'string' || !token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

function tileUrl(layer: MapLayer, z: number, x: number, y: number): string {
  return withToken(`${API_BASE}/api/maps/tile?layer=${layer}&z=${z}&x=${x}&y=${y}`);
}

/** A POST cannot hide the token in the query: the server wants the header for it. */
function sessionHeader(): Record<string, string> {
  const token = typeof window !== 'undefined' ? window.electronAPI?.apiToken : null;
  return typeof token === 'string' && token ? { 'x-omni-token': token } : {};
}

/**
 * Maps dialog on OpenStreetMap raster tiles.
 *
 * The dialog draws the tiles itself (the arithmetic lives in `slippyMap`), which
 * keeps a 30 KB map library out of the bundle. Tiles and place searches go
 * through the local server: Nominatim requires a User-Agent a browser will not
 * let a page set, and the server adds the cache that keeps the app inside the
 * usage policy of both services.
 *
 * The viewport is a pointer surface rather than a scroll area: one finger or the
 * mouse pans, two fingers pinch, and the wheel zooms towards the pointer. The
 * tiles sit on a layer that is aligned to a tile boundary, so dragging moves one
 * transform instead of asking for a fresh grid every frame.
 */
export const MapsModal: React.FC<MapsModalProps> = ({ theme, lang, onClose }) => {
  const t = getTranslations(lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView>(DEFAULT_VIEW);
  /** Level the images come from; it follows `view.zoom` once the gesture settles. */
  const [tileZoom, setTileZoom] = useState(DEFAULT_VIEW.zoom);
  const [layer, setLayer] = useState<MapLayer>('osm');
  const [size, setSize] = useState({ width: 820, height: 460 });
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [marker, setMarker] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The dialog tells us when it has a height of its own — maximised or dragged
  // to a size — so the map can take that height instead of keeping its default.
  const [fills, setFills] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  /** Images that failed to arrive, which offline is every one of them. */
  const [tileFailures, setTileFailures] = useState(0);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveNote, setSaveNote] = useState<{ text: string; ok: boolean } | null>(null);
  /** What the disk cache holds, or null while it has not been read yet. */
  const [cache, setCache] = useState<{ tiles: number; bytes: number } | null>(null);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  /** True while a drag draws a rectangle to save instead of panning. */
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<{ from: Point; to: Point } | null>(null);
  const selectionStart = useRef<Point | null>(null);
  /** How far down a whole-world download goes, and whether its warning is up. */
  const [worldLevel, setWorldLevel] = useState(5);
  const [worldPrompt, setWorldPrompt] = useState(false);
  /** What the server answered once an image failed: a blank map hides the why. */
  const [tileError, setTileError] = useState<string | null>(null);

  const zoomCap = useMemo(() => MAP_LAYERS.find((entry) => entry.id === layer)?.maxZoom ?? MAX_ZOOM, [layer]);
  const zoomCapRef = useRef(zoomCap);
  useEffect(() => {
    zoomCapRef.current = zoomCap;
  }, [zoomCap]);

  /**
   * The cache is on disk, so the dialog asks the server for it rather than
   * guessing from what it has downloaded in this session.
   */
  const refreshCache = useCallback(async () => {
    if (typeof fetch !== 'function') return;
    try {
      const response = await fetch(withToken(`${API_BASE}/api/maps/cache`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { tiles?: number; bytes?: number };
      setCache({ tiles: Number(payload.tiles) || 0, bytes: Number(payload.bytes) || 0 });
    } catch {
      setCache(null);
    }
  }, []);

  useEffect(() => {
    void refreshCache();
  }, [refreshCache]);

  const clearCache = useCallback(async () => {
    soundManager.playKeyTick();
    setClearing(true);
    setCacheNote(null);
    try {
      const response = await fetch(withToken(`${API_BASE}/api/maps/cache`), {
        method: 'DELETE',
        headers: sessionHeader(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCache({ tiles: 0, bytes: 0 });
      setCacheNote(t.mapsCacheCleared);
    } catch {
      setCacheNote(t.mapsCacheClearFailed);
    } finally {
      setClearing(false);
    }
  }, [t.mapsCacheClearFailed, t.mapsCacheCleared]);

  /** Fingers currently down, by pointer id, in the order they arrived. */
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  /** The view as of the last frame applied, which can be ahead of `view`. */
  const latestView = useRef(view);
  const queuedView = useRef<MapView | null>(null);
  const frame = useRef<number | null>(null);
  const settle = useRef<number | null>(null);

  useEffect(() => {
    latestView.current = view;
  }, [view]);

  // The tile grid has to know the real viewport, otherwise the edges stay empty
  // after the window is resized.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0)
        setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Pointer events arrive far faster than the screen refreshes; one update per
   * frame keeps a drag at a steady cost no matter how chatty the device is.
   */
  const applyView = useCallback((next: MapView) => {
    // A layer that stops at 17 (OpenTopoMap) has to hold the view at its last
    // level instead of asking for squares that do not exist.
    const capped = Math.min(zoomCapRef.current, next.zoom);
    const settledView = capped === next.zoom ? next : { ...next, zoom: capped };
    queuedView.current = settledView;
    latestView.current = settledView;
    if (frame.current !== null) return;
    const flush = () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      if (settle.current !== null) window.clearTimeout(settle.current);
      frame.current = null;
      settle.current = null;
      const pending = queuedView.current;
      queuedView.current = null;
      if (pending) setView(pending);
    };
    frame.current = window.requestAnimationFrame(flush);
    // A hidden or occluded window (a minimised Electron one, a background tab)
    // never runs the animation frame, and the map would keep the old view until
    // it was shown again. The timer applies the latest one regardless.
    settle.current = window.setTimeout(flush, 120);
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      if (settle.current !== null) window.clearTimeout(settle.current);
    },
    [],
  );

  // Only whole levels have images, and a pinch crosses several of them. The
  // images stay a moment behind the pinch — stretched, not blank — and catch up
  // once it stops; a jump big enough to look blurred swaps at once.
  useEffect(() => {
    const wanted = Math.min(zoomCap, Math.max(MIN_ZOOM, Math.round(view.zoom)));
    if (wanted === tileZoom) return;
    const delay = Math.abs(view.zoom - tileZoom) >= 1.5 ? 0 : TILE_SETTLE_MS;
    const timer = window.setTimeout(() => setTileZoom(wanted), delay);
    return () => window.clearTimeout(timer);
  }, [view.zoom, tileZoom, zoomCap]);

  const layout = useMemo(
    () => tileLayoutFor(view, size.width, size.height, { padding: TILE_PADDING, tileZoom }),
    [view, size.width, size.height, tileZoom],
  );

  // The layer is positioned but empty, so it has no size of its own. Giving it
  // the extent of the grid keeps percentage-based rules (the base sheet sets
  // `img { max-width: 100% }`) from clamping every tile to zero width.
  const layerExtent = useMemo(
    () =>
      layout.tiles.reduce(
        (extent, tile) => ({
          width: Math.max(extent.width, tile.left + TILE_SIZE * layout.scale),
          height: Math.max(extent.height, tile.top + TILE_SIZE * layout.scale),
        }),
        { width: 0, height: 0 },
      ),
    [layout],
  );

  const markerPosition = useMemo(
    () => (marker ? projectToScreen({ lat: marker.lat, lon: marker.lon }, view, size.width, size.height) : null),
    [marker, view, size.width, size.height],
  );

  /** Client coordinates to point inside the viewport. */
  const toLocal = useCallback((point: Point): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: point.x - rect.left, y: point.y - rect.top };
  }, []);

  /**
   * Sends a set of tiles to the server in batches and reports how it went. Both
   * the visible area and a dragged rectangle end here, so the progress bar and
   * the batch ceiling are the same for the two.
   */
  const storeTiles = useCallback(
    async (tiles: Array<{ z: number; x: number; y: number }>, truncated = false, batchSize = OFFLINE_BATCH) => {
      if (tiles.length === 0) return;
      setSaving({ done: 0, total: tiles.length });
      setSaveNote(null);
      let failed = 0;
      for (let index = 0; index < tiles.length; index += batchSize) {
        const batch = tiles.slice(index, index + batchSize);
        try {
          const response = await fetch(withToken(`${API_BASE}/api/maps/offline`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...sessionHeader() },
            body: JSON.stringify({ layer, tiles: batch }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = (await response.json()) as { failed?: number };
          failed += Number(payload.failed) || 0;
        } catch {
          failed += batch.length;
        }
        setSaving({ done: Math.min(tiles.length, index + batch.length), total: tiles.length });
      }
      setSaving(null);
      const text = failed > 0 ? t.mapsOfflineSaveFailed : truncated ? t.mapsOfflineTooMany : t.mapsOfflineSaved;
      setSaveNote({ text, ok: failed === 0 });
      void refreshCache();
    },
    [layer, refreshCache, t.mapsOfflineSaveFailed, t.mapsOfflineSaved, t.mapsOfflineTooMany],
  );

  /**
   * Turns a rectangle dragged on screen into the tiles it covers, at the levels
   * the visible-area download keeps. The coordinates come back from the same
   * projection the tiles are drawn with, so the saved patch is the patch the
   * user framed, not a rectangle around the centre.
   */
  const saveRect = useCallback(
    async (from: Point, to: Point) => {
      const current = latestView.current;
      const left = Math.min(from.x, to.x);
      const top = Math.min(from.y, to.y);
      const right = Math.max(from.x, to.x);
      const bottom = Math.max(from.y, to.y);
      const northWest = unprojectFromScreen({ x: left, y: top }, current, size.width, size.height);
      const southEast = unprojectFromScreen({ x: right, y: bottom }, current, size.width, size.height);
      const bounds = { north: northWest.lat, west: northWest.lon, south: southEast.lat, east: southEast.lon };
      const base = Math.min(zoomCapRef.current, Math.max(MIN_ZOOM, Math.round(current.zoom)));
      const levels = Array.from({ length: OFFLINE_LEVELS }, (_, step) => base + step).filter(
        (level) => level <= zoomCapRef.current,
      );
      const wanted = levels.flatMap((level) => tilesCoveringRect(bounds, level, 0));
      setSelecting(false);
      await storeTiles(wanted.slice(0, RECT_MAX_TILES), wanted.length > RECT_MAX_TILES);
    },
    [size.height, size.width, storeTiles],
  );

  /**
   * A whole-world download at the level the user picked. Levels 0 to 2 are kept
   * even though the map never zooms that far out: they cost 21 tiles and make
   * the set complete for anything that later wants a coastline.
   *
   * The ceiling is not arbitrary. The disk cache prunes to 20 000 tiles and
   * level 7 alone is 21 845, so offering it would download tiles that are
   * deleted before the download finishes.
   */
  const saveWorld = useCallback(async () => {
    setWorldPrompt(false);
    soundManager.playKeyTick();
    await storeTiles(tilesForWorld(worldLevel), false, WORLD_BATCH);
  }, [storeTiles, worldLevel]);

  const worldTotal = worldTileCount(worldLevel);

  /**
   * The first failed image asks the server what it answered. An image cannot
   * report a status, so a blank map used to be indistinguishable from a blocked
   * token, a provider outage or no network at all.
   */
  const explainTileFailure = useCallback(async () => {
    try {
      const response = await fetch(tileUrl(layer, Math.min(tileZoom, MAX_ZOOM), 0, 0));
      setTileError(response.ok ? 'images' : String(response.status));
    } catch {
      setTileError('network');
    }
  }, [layer, tileZoom]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = containerRef.current;
    if (!element) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Captured on the container, not on the tile under the finger, so a drag
    // that leaves the map keeps panning instead of stopping at the border. A
    // platform that refuses the capture still pans, only without that margin.
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer to capture on this platform */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // A selection drag is not a pan: the map must not move under the rectangle
    // the user is framing.
    if (selecting) {
      const local = toLocal({ x: event.clientX, y: event.clientY });
      selectionStart.current = local;
      setSelection({ from: local, to: local });
      return;
    }
    const fingers = [...pointers.current.values()];
    const from = latestView.current;
    if (fingers.length === 1) {
      gesture.current = { kind: 'pan', start: fingers[0], from };
    } else if (fingers.length === 2) {
      gesture.current = {
        kind: 'pinch',
        startDistance: spread(fingers[0], fingers[1]),
        startMid: midpoint(fingers[0], fingers[1]),
        from,
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const fingers = pointers.current;
    if (!fingers.has(event.pointerId)) return;
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const anchor = selectionStart.current;
    if (anchor) {
      const local = toLocal({ x: event.clientX, y: event.clientY });
      setSelection({ from: anchor, to: local });
      return;
    }
    const active = gesture.current;
    if (!active) return;
    const points = [...fingers.values()];

    if (active.kind === 'pinch' && points.length >= 2) {
      const [first, second] = points;
      const distance = spread(first, second);
      const mid = midpoint(first, second);
      const zoom = zoomForPinch(active.from.zoom, active.startDistance, distance);
      // Hold the coordinate the fingers grabbed, then follow their midpoint so
      // two fingers can also slide the map while they zoom it.
      const zoomed = zoomAround(
        active.from,
        zoom - active.from.zoom,
        toLocal(active.startMid),
        size.width,
        size.height,
      );
      applyView(panBy(zoomed, mid.x - active.startMid.x, mid.y - active.startMid.y));
      return;
    }

    if (active.kind === 'pan') {
      applyView(panBy(active.from, event.clientX - active.start.x, event.clientY - active.start.y));
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const anchor = selectionStart.current;
    if (anchor) {
      selectionStart.current = null;
      const local = toLocal({ x: event.clientX, y: event.clientY });
      setSelection(null);
      // A click is not a rectangle: a drag of a few pixels would ask for a
      // single tile the user did not mean to mark.
      if (Math.abs(local.x - anchor.x) >= 8 && Math.abs(local.y - anchor.y) >= 8) {
        void saveRect(anchor, local);
      }
      return;
    }
    const element = containerRef.current;
    if (element?.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    const remaining = [...pointers.current.values()];
    const from = latestView.current;
    if (remaining.length >= 2) {
      gesture.current = {
        kind: 'pinch',
        startDistance: spread(remaining[0], remaining[1]),
        startMid: midpoint(remaining[0], remaining[1]),
        from,
      };
    } else if (remaining.length === 1) {
      // Lifting one finger of a pinch must not make the map jump to where the
      // remaining finger was when the gesture began.
      gesture.current = { kind: 'pan', start: remaining[0], from };
    } else {
      gesture.current = null;
    }
  };

  // React listens for wheel passively, so `preventDefault` in an onWheel prop is
  // ignored and the dialog scrolls while the map zooms. A native listener is the
  // only way to own the gesture.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // A mouse wheel reports whole lines, a trackpad small pixels, and a
      // trackpad pinch arrives as ctrl+wheel; normalising the three keeps one
      // flick from crossing several levels.
      const unit = event.deltaMode === 1 ? 16 : event.ctrlKey ? 1 : 0.35;
      const step = Math.max(-0.75, Math.min(0.75, (-event.deltaY * unit) / 400));
      if (step === 0) return;
      applyView(zoomAround(latestView.current, step, anchor, size.width, size.height));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [applyView, size.width, size.height]);

  // `navigator.onLine` only knows about the network interface, but it is what
  // the window hears before a tile request fails, and the badge it drives says
  // "saved tiles", which is what the map is actually doing.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      setOnline(navigator.onLine !== false);
      setTileFailures(0);
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const selectLayer = (next: MapLayer) => {
    soundManager.playKeyTick();
    setLayer(next);
    setTileFailures(0);
    setTileError(null);
    setSaveNote(null);
    const cap = MAP_LAYERS.find((entry) => entry.id === next)?.maxZoom ?? MAX_ZOOM;
    if (latestView.current.zoom > cap) {
      setTileZoom(cap);
      setView({ ...latestView.current, zoom: cap });
    }
  };

  /**
   * Saves what is on screen, and the two levels below it, so the same place can
   * be opened again with no network. The server owns the disk and the fetch;
   * this only decides which tiles to ask for and how far the bar has got.
   */
  const saveArea = useCallback(async () => {
    soundManager.playKeyTick();
    const base = Math.min(zoomCapRef.current, Math.max(MIN_ZOOM, Math.round(latestView.current.zoom)));
    const levels = Array.from({ length: OFFLINE_LEVELS }, (_, step) => base + step).filter(
      (level) => level <= zoomCapRef.current,
    );
    const tiles = levels.flatMap((level) => tilesCoveringView(latestView.current, size.width, size.height, level, 1));
    await storeTiles(tiles);
  }, [size.width, size.height, storeTiles]);

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (term.length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(withToken(`${API_BASE}/api/maps/search?q=${encodeURIComponent(term)}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { results?: Place[] };
      const results = Array.isArray(payload.results) ? payload.results : [];
      setPlaces(results);
      if (results.length === 0) setSearchError(t.mapsNoResults);
    } catch {
      setSearchError(t.mapsSearchError);
      setPlaces([]);
    } finally {
      setSearching(false);
    }
  }, [query, t.mapsNoResults, t.mapsSearchError]);

  const locate = useCallback(() => {
    soundManager.playKeyTick();
    setLocating(true);
    setNotice(null);
    const fallback = async () => {
      try {
        const response = await fetch(withToken(`${API_BASE}/api/maps/locate`));
        if (!response.ok) throw new Error('locate-failed');
        const payload = (await response.json()) as { lat: number; lon: number; label?: string };
        const place: Place = {
          label: payload.label || t.mapsApproxLocation,
          lat: payload.lat,
          lon: payload.lon,
          approximate: true,
        };
        setMarker(place);
        setTileZoom(11);
        setView({ lat: place.lat, lon: place.lon, zoom: 11 });
        setNotice(t.mapsApproxLocation);
      } catch {
        setNotice(t.mapsLocationDenied);
      } finally {
        setLocating(false);
      }
    };

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      void fallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const place: Place = {
          label: t.mapsMyLocation,
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setMarker(place);
        setTileZoom(14);
        setView({ lat: place.lat, lon: place.lon, zoom: 14 });
        setLocating(false);
      },
      () => {
        void fallback();
      },
      { timeout: 8000, maximumAge: 60000 },
    );
  }, [t.mapsApproxLocation, t.mapsLocationDenied, t.mapsMyLocation]);

  const goToPlace = (place: Place) => {
    soundManager.playKeyTick();
    setMarker(place);
    setTileZoom(14);
    setView({ lat: place.lat, lon: place.lon, zoom: 14 });
    setPlaces([]);
    setQuery(place.label);
  };

  /** The +/- buttons land on whole levels; only the fingers ask for halves. */
  const zoomBy = (delta: number) => {
    const current = latestView.current;
    const target = Math.min(zoomCap, Math.max(MIN_ZOOM, Math.round(current.zoom) + delta));
    setTileZoom(target);
    setView(
      zoomAround(current, target - current.zoom, { x: size.width / 2, y: size.height / 2 }, size.width, size.height),
    );
  };

  const layerButton = (id: MapLayer, label: string) => (
    <button
      key={id}
      onClick={() => {
        selectLayer(id);
      }}
      className={`cursor-pointer rounded border px-[var(--space-2)] py-[var(--space-1)] text-[11px] font-bold transition-colors ${
        layer === id
          ? 'border-amber-300 bg-amber-400 text-black'
          : 'border-white/15 bg-white/5 text-white hover:bg-white/15'
      }`}
    >
      {label}
    </button>
  );

  const activeLayer = MAP_LAYERS.find((entry) => entry.id === layer) ?? MAP_LAYERS[0];

  /** Electron blocks navigation out of the window, so the licence page goes to the shell. */
  const openLicense = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    const open = typeof window === 'undefined' ? undefined : window.electronAPI?.openExternal;
    if (typeof open !== 'function') return;
    event.preventDefault();
    void open(url).catch(() => {});
  };

  const toggleSelecting = () => {
    soundManager.playKeyTick();
    selectionStart.current = null;
    setSelection(null);
    setSaveNote(null);
    setSelecting((current) => !current);
  };

  return (
    <ModalShell
      title={t.toolMaps}
      theme={theme}
      onClose={onClose}
      closeButtonLabel={t.btnClose}
      windowControls
      minimizeLabel={t.minimize}
      maximizeLabel={t.maximizeRestore}
      restoreLabel={t.maximizeRestore}
      resizable
      resizeLabel={t.resizeWindow}
      moveLabel={t.moveWindow}
      fill
      onFillChange={setFills}
    >
      <div className={`flex min-h-0 flex-col gap-[var(--space-2)] font-mono ${fills ? 'flex-1' : ''}`}>
        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          <form
            className="flex min-w-0 flex-1 items-center gap-[var(--space-1)]"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-[var(--space-1)] rounded border border-white/15 bg-black/30 px-[var(--space-2)]">
              <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.mapsSearchPlaceholder}
                aria-label={t.mapsSearchPlaceholder}
                className="min-w-0 flex-1 bg-transparent py-[var(--space-1)] text-xs text-white outline-none placeholder:text-white/40"
              />
            </div>
            <button
              type="submit"
              disabled={searching || query.trim().length < 2}
              className="cursor-pointer rounded border border-white/15 bg-white/10 px-[var(--space-2)] py-[var(--space-1)] text-xs font-bold hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {searching ? t.loading : t.mapsSearchButton}
            </button>
          </form>
          <button
            onClick={locate}
            disabled={locating}
            title={t.mapsLocateMe}
            className="flex cursor-pointer items-center gap-[var(--space-1)] rounded border border-cyan-400/60 bg-cyan-400/15 px-[var(--space-2)] py-[var(--space-1)] text-[11px] font-bold text-cyan-200 hover:bg-cyan-400/25 disabled:opacity-40"
          >
            <Crosshair className="h-3.5 w-3.5" /> {locating ? t.mapsLocating : t.mapsLocateMe}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          <span className="flex items-center gap-[var(--space-1)] text-[11px] opacity-60">
            <Layers className="h-3.5 w-3.5" />
          </span>
          {MAP_LAYERS.map((entry) => layerButton(entry.id, entry.label(t)))}
          <button
            onClick={() => void saveArea()}
            disabled={saving !== null}
            title={t.mapsOfflineSave}
            className="flex cursor-pointer items-center gap-[var(--space-1)] rounded border border-emerald-400/60 bg-emerald-400/15 px-[var(--space-2)] py-[var(--space-1)] text-[11px] font-bold text-emerald-200 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            {saving ? t.mapsOfflineSaving : t.mapsOfflineSave}
            {saving && (
              <span className="opacity-70">
                {saving.done}/{saving.total}
              </span>
            )}
          </button>
          <a
            href={activeLayer.licenseUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={t.mapsLicense}
            onClick={(event) => openLicense(event, activeLayer.licenseUrl)}
            className="ml-auto text-[10px] underline decoration-dotted opacity-50 transition-opacity hover:opacity-80"
          >
            {activeLayer.attribution(t)}
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-1)] text-[11px]">
          <span className="opacity-70">
            {cache && cache.tiles > 0
              ? `${t.mapsCache}: ${cache.tiles} · ${formatCacheSize(cache.bytes)}`
              : t.mapsCacheEmpty}
          </span>
          <button
            onClick={() => void clearCache()}
            disabled={clearing || !cache || cache.tiles === 0}
            title={t.mapsCacheClear}
            className="flex cursor-pointer items-center gap-[var(--space-1)] rounded border border-white/15 bg-white/5 px-[var(--space-2)] py-[2px] text-[11px] font-bold text-white/80 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t.mapsCacheClear}
          </button>
          <button
            onClick={toggleSelecting}
            aria-pressed={selecting}
            title={t.mapsSelectArea}
            className={`flex cursor-pointer items-center gap-[var(--space-1)] rounded border px-[var(--space-2)] py-[2px] text-[11px] font-bold transition-colors ${
              selecting
                ? 'border-amber-300 bg-amber-400 text-black'
                : 'border-white/15 bg-white/5 text-white hover:bg-white/15'
            }`}
          >
            <Crop className="h-3.5 w-3.5" /> {selecting ? t.mapsSelectAreaOn : t.mapsSelectArea}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-1)] text-[11px]">
          <label className="flex items-center gap-[var(--space-1)] opacity-70">
            <Globe className="h-3.5 w-3.5" />
            {t.mapsWorldLevel}
            <select
              aria-label={t.mapsWorldLevel}
              value={worldLevel}
              onChange={(event) => {
                setWorldLevel(Number(event.target.value));
                setWorldPrompt(false);
              }}
              className="cursor-pointer rounded border border-white/15 bg-black/40 px-[var(--space-1)] py-[2px] text-[11px] text-white"
            >
              {WORLD_LEVELS.filter((level) => level <= WORLD_MAX_LEVEL).map((level) => (
                <option key={level} value={level}>
                  0–{level}
                </option>
              ))}
            </select>
          </label>
          <span className="opacity-60">
            {worldTotal.toLocaleString(lang)} {t.mapsWorldTiles}
          </span>
          <button
            onClick={() => (worldPrompt ? void saveWorld() : setWorldPrompt(true))}
            disabled={saving !== null}
            title={t.mapsWorld}
            className={
              'flex cursor-pointer items-center gap-[var(--space-1)] rounded border px-[var(--space-2)] py-[2px] text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
              (worldPrompt
                ? 'border-amber-300 bg-amber-400 text-black'
                : 'border-white/15 bg-white/5 text-white hover:bg-white/15')
            }
          >
            <Globe className="h-3.5 w-3.5" /> {worldPrompt ? t.mapsWorldConfirm : t.mapsWorld}
          </button>
        </div>
        {worldPrompt && <p className="text-[11px] text-amber-300">{t.mapsWorldWarning}</p>}
        {selecting && <p className="text-[11px] text-amber-300">{t.mapsSelectAreaHint}</p>}
        {tileError && (
          <p className="text-[11px] text-amber-300">
            {t.mapsTileError}
            {/^[0-9]+$/.test(tileError) ? ' (HTTP ' + tileError + ')' : ''}
          </p>
        )}
        {cacheNote && <p className="text-[11px] text-emerald-300">{cacheNote}</p>}
        {saveNote && (
          <p className={`text-[11px] ${saveNote.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{saveNote.text}</p>
        )}

        {places.length > 0 && (
          <div className="max-h-36 overflow-y-auto rounded border border-white/15 bg-black/50 p-[var(--space-1)] text-xs">
            {places.map((place, index) => (
              <button
                key={`${place.lat}-${place.lon}-${index}`}
                onClick={() => goToPlace(place)}
                className="flex w-full cursor-pointer items-center gap-[var(--space-1)] rounded px-[var(--space-1)] py-1 text-left hover:bg-white/15"
              >
                <MapPin className="h-3 w-3 shrink-0 text-amber-300" />
                <span className="truncate">{place.label}</span>
              </button>
            ))}
          </div>
        )}
        {searchError && <p className="text-xs text-amber-300">{searchError}</p>}

        {/* The map has no height of its own: it takes whatever the dialog
            leaves, so maximising or dragging the window makes it bigger. */}
        <div
          ref={containerRef}
          data-map-surface="true"
          // A window dragged small has to take the room from the map instead of
          // pushing it past the panel's edge, so the floor drops in that mode.
          className={`relative touch-none select-none overflow-hidden rounded border border-white/15 bg-slate-900 ${
            selecting ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
          } ${fills ? 'min-h-24 flex-1' : 'h-[46vh] min-h-56'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onDoubleClick={(event) => {
            const current = latestView.current;
            const target = Math.min(MAX_ZOOM, Math.round(current.zoom) + 1);
            setTileZoom(target);
            setView(
              zoomAround(
                current,
                target - current.zoom,
                toLocal({ x: event.clientX, y: event.clientY }),
                size.width,
                size.height,
              ),
            );
          }}
        >
          <div
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: `${layerExtent.width}px`,
              height: `${layerExtent.height}px`,
              transform: `translate3d(${layout.offsetX}px, ${layout.offsetY}px, 0)`,
              willChange: 'transform',
            }}
          >
            {layout.tiles.map((tile) => (
              <img
                key={`${layer}-${tile.z}-${tile.x}-${tile.y}`}
                src={tileUrl(layer, tile.z, tile.x, tile.y)}
                alt=""
                onError={() => {
                  setTileFailures((count) => count + 1);
                  if (!tileError) void explainTileFailure();
                }}
                draggable={false}
                decoding="async"
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  left: `${tile.left}px`,
                  top: `${tile.top}px`,
                  width: `${TILE_SIZE * layout.scale}px`,
                  height: `${TILE_SIZE * layout.scale}px`,
                }}
              />
            ))}
          </div>

          {selection && (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-amber-300 bg-amber-300/20"
              style={{
                left: `${Math.min(selection.from.x, selection.to.x)}px`,
                top: `${Math.min(selection.from.y, selection.to.y)}px`,
                width: `${Math.abs(selection.to.x - selection.from.x)}px`,
                height: `${Math.abs(selection.to.y - selection.from.y)}px`,
              }}
            />
          )}

          {markerPosition && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-red-500 drop-shadow"
              style={{ left: `${markerPosition.x}px`, top: `${markerPosition.y}px` }}
              aria-label={marker?.label}
            >
              <MapPin className="h-6 w-6 fill-current" />
            </span>
          )}

          <div className="absolute bottom-[var(--space-1)] right-[var(--space-1)] flex flex-col gap-[2px]">
            <button
              onClick={() => zoomBy(1)}
              aria-label={t.imageZoomIn}
              className="h-6 w-6 cursor-pointer rounded border border-white/25 bg-black/60 text-sm font-bold text-white hover:bg-black/80"
            >
              +
            </button>
            <button
              onClick={() => zoomBy(-1)}
              aria-label={t.imageZoomOut}
              className="h-6 w-6 cursor-pointer rounded border border-white/25 bg-black/60 text-sm font-bold text-white hover:bg-black/80"
            >
              −
            </button>
          </div>

          <span className="pointer-events-none absolute left-[var(--space-1)] top-[var(--space-1)] rounded bg-black/60 px-[var(--space-1)] py-[2px] text-[10px] text-white/80">
            {view.lat.toFixed(4)}, {view.lon.toFixed(4)} · z{view.zoom.toFixed(1)}
          </span>

          {(!online || tileFailures > 0) && (
            <span className="pointer-events-none absolute right-[var(--space-1)] top-[var(--space-1)] flex items-center gap-[var(--space-1)] rounded bg-amber-400/90 px-[var(--space-1)] py-[2px] text-[10px] font-bold text-black">
              <WifiOff className="h-3 w-3" /> {t.mapsOffline}
            </span>
          )}
        </div>

        {notice && <p className="text-xs text-amber-300">{notice}</p>}
      </div>
    </ModalShell>
  );
};
