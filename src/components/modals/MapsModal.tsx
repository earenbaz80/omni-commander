import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers, MapPin, Search } from 'lucide-react';
import { LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { API_BASE } from '../../services/apiBase';
import {
  clampZoom,
  panBy,
  projectToScreen,
  tilesForView,
  zoomAround,
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

const DEFAULT_VIEW: MapView = { lat: 40.4168, lon: -3.7038, zoom: 6 };

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
 */
export const MapsModal: React.FC<MapsModalProps> = ({ theme, lang, onClose }) => {
  const t = getTranslations(lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<MapView>(DEFAULT_VIEW);
  const [layer, setLayer] = useState<MapLayer>('osm');
  const [size, setSize] = useState({ width: 820, height: 460 });
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [marker, setMarker] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const tiles = useMemo(() => tilesForView(view, size.width, size.height), [view, size.width, size.height]);
  const markerPosition = useMemo(
    () => (marker ? projectToScreen({ lat: marker.lat, lon: marker.lon }, view, size.width, size.height) : null),
    [marker, view, size.width, size.height],
  );

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
    setView({ lat: place.lat, lon: place.lon, zoom: 14 });
    setPlaces([]);
    setQuery(place.label);
  };

  const zoomBy = (delta: number) => {
    setView((current) =>
      zoomAround(current, delta, { x: size.width / 2, y: size.height / 2 }, size.width, size.height),
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
    <ModalShell title={t.toolMaps} theme={theme} onClose={onClose} closeButtonLabel={t.btnClose}>
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
          className="relative h-[46vh] min-h-56 touch-none overflow-hidden rounded border border-white/15 bg-slate-900"
          onPointerDown={(event) => {
            dragRef.current = { x: event.clientX, y: event.clientY };
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = dragRef.current;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (dx === 0 && dy === 0) return;
            dragRef.current = { x: event.clientX, y: event.clientY };
            setView((current) => panBy(current, dx, dy));
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerLeave={() => {
            dragRef.current = null;
          }}
          onWheel={(event) => {
            const element = containerRef.current;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            setView((current) => zoomAround(current, event.deltaY < 0 ? 1 : -1, anchor, size.width, size.height));
          }}
        >
          {tiles.map((tile) => (
            <img
              key={`${layer}-${tile.z}-${tile.x}-${tile.y}`}
              src={tileUrl(layer, tile.z, tile.x, tile.y)}
              alt=""
              draggable={false}
              width={256}
              height={256}
              loading="lazy"
              className="pointer-events-none absolute select-none"
              style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
            />
          ))}

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
            {view.lat.toFixed(4)}, {view.lon.toFixed(4)} · z{clampZoom(view.zoom)}
          </span>
        </div>

        {notice && <p className="text-xs text-amber-300">{notice}</p>}
      </div>
    </ModalShell>
  );
};
