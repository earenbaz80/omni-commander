import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers, MapPin, Search } from 'lucide-react';
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
/** Tiles an extra ring beyond the viewport are kept, so short drags need no request. */
const TILE_PADDING = 1;
/** How long the images may stay behind a zoom change before the next level is fetched. */
const TILE_SETTLE_MS = 180;

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function spread(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The per-launch token rides in the query: a tile is loaded by an <img>, which cannot send a header. */
function withToken(url: string): string {
  const token = (typeof window !== 'undefined' ? (window as any).electronAPI?.apiToken : null) as
    string | null | undefined;
  if (typeof token !== 'string' || !token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

function tileUrl(layer: MapLayer, z: number, x: number, y: number): string {
  return withToken(`${API_BASE}/api/maps/tile?layer=${layer}&z=${z}&x=${x}&y=${y}`);
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
  // The dialog tells us when it fills the viewport so the map can grow with it.
  const [expanded, setExpanded] = useState(false);

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
    queuedView.current = next;
    latestView.current = next;
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
    const wanted = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(view.zoom)));
    if (wanted === tileZoom) return;
    const delay = Math.abs(view.zoom - tileZoom) >= 1.5 ? 0 : TILE_SETTLE_MS;
    const timer = window.setTimeout(() => setTileZoom(wanted), delay);
    return () => window.clearTimeout(timer);
  }, [view.zoom, tileZoom]);

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
    const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(current.zoom) + delta));
    setTileZoom(target);
    setView(
      zoomAround(current, target - current.zoom, { x: size.width / 2, y: size.height / 2 }, size.width, size.height),
    );
  };

  const layerButton = (id: MapLayer, label: string) => (
    <button
      key={id}
      onClick={() => {
        soundManager.playKeyTick();
        setLayer(id);
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
      onMaximizeChange={setExpanded}
    >
      <div className="flex flex-col gap-[var(--space-2)] font-mono">
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
          {layerButton('osm', t.mapsLayerStandard)}
          {layerButton('topo', t.mapsLayerTopographic)}
          <span className="ml-auto text-[10px] opacity-50">{t.mapsAttribution}</span>
        </div>

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

        <div
          ref={containerRef}
          className={`relative min-h-56 cursor-grab touch-none select-none overflow-hidden rounded border border-white/15 bg-slate-900 active:cursor-grabbing ${
            expanded ? 'h-[calc(100vh-19rem)]' : 'h-[46vh]'
          }`}
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
        </div>

        {notice && <p className="text-xs text-amber-300">{notice}</p>}
      </div>
    </ModalShell>
  );
};
