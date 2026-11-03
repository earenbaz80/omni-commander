/**
 * Web-Mercator tile arithmetic for the built-in map.
 *
 * The dialog draws raster tiles itself instead of pulling in a map library: it
 * only needs to know which 256px tiles cover the viewport and where to put them.
 * These functions are pure so the maths can be tested without a browser.
 *
 * Coordinates follow the usual slippy-map convention: world pixel space at zoom
 * `z` is `256 * 2^z` wide and tall, with the origin at the north-west corner.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;
/** Latitude the Mercator projection is cut at; beyond it the value diverges. */
export const MAX_LATITUDE = 85.05112878;

export type MapLayer = 'osm' | 'humanitarian' | 'cycle' | 'topo' | 'transport';

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

export interface TilePlacement {
  z: number;
  x: number;
  y: number;
  /** Offset inside the viewport, in CSS pixels. */
  left: number;
  top: number;
}

export function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** Longitudes wrap, so panning east past the antimeridian keeps working. */
export function wrapLongitude(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * A pinch is continuous, so this clamps without rounding: only the tile images
 * need whole levels, and `tileLayoutFor` is the one that rounds for them.
 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldSize(zoom: number): number {
  return TILE_SIZE * Math.pow(2, zoom);
}

export function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * worldSize(zoom);
}

export function latToWorldY(lat: number, zoom: number): number {
  const clamped = clampLatitude(lat);
  const radians = (clamped * Math.PI) / 180;
  const mercator = Math.log(Math.tan(Math.PI / 4 + radians / 2));
  return ((1 - mercator / Math.PI) / 2) * worldSize(zoom);
}

export function worldXToLon(x: number, zoom: number): number {
  return wrapLongitude((x / worldSize(zoom)) * 360 - 180);
}

export function worldYToLat(y: number, zoom: number): number {
  const size = worldSize(zoom);
  const mercator = Math.PI * (1 - (2 * y) / size);
  return clampLatitude((Math.atan(Math.sinh(mercator)) * 180) / Math.PI);
}

/** Screen position of a coordinate inside a viewport centred on `view`. */
export function projectToScreen(
  point: { lat: number; lon: number },
  view: MapView,
  width: number,
  height: number,
): { x: number; y: number } {
  const centerX = lonToWorldX(view.lon, view.zoom);
  const centerY = latToWorldY(view.lat, view.zoom);
  // Unwrap the longitude difference so a point just across the antimeridian
  // lands beside the centre instead of at the far edge of the world.
  let deltaLon = point.lon - view.lon;
  if (deltaLon > 180) deltaLon -= 360;
  if (deltaLon < -180) deltaLon += 360;
  const x = lonToWorldX(view.lon + deltaLon, view.zoom) - centerX + width / 2;
  const y = latToWorldY(point.lat, view.zoom) - centerY + height / 2;
  return { x, y };
}

/** The coordinate under a screen point; the inverse of `projectToScreen`. */
export function unprojectFromScreen(
  screen: { x: number; y: number },
  view: MapView,
  width: number,
  height: number,
): { lat: number; lon: number } {
  const worldX = lonToWorldX(view.lon, view.zoom) + (screen.x - width / 2);
  const worldY = latToWorldY(view.lat, view.zoom) + (screen.y - height / 2);
  return { lat: worldYToLat(worldY, view.zoom), lon: worldXToLon(worldX, view.zoom) };
}

/** Drags the map by a pixel offset, keeping the point under the cursor still. */
export function panBy(view: MapView, dx: number, dy: number): MapView {
  const worldX = lonToWorldX(view.lon, view.zoom) - dx;
  const worldY = latToWorldY(view.lat, view.zoom) - dy;
  return {
    lat: worldYToLat(worldY, view.zoom),
    lon: worldXToLon(worldX, view.zoom),
    zoom: view.zoom,
  };
}

/**
 * Changes the zoom while keeping the coordinate under `anchor` fixed, which is
 * what the wheel should do: zooming into the pointer, not into the centre.
 */
export function zoomAround(
  view: MapView,
  deltaZoom: number,
  anchor: { x: number; y: number },
  width: number,
  height: number,
): MapView {
  const target = clampZoom(view.zoom + deltaZoom);
  if (target === view.zoom) return view;
  const before = unprojectFromScreen(anchor, view, width, height);
  const worldX = lonToWorldX(before.lon, target) - (anchor.x - width / 2);
  const worldY = latToWorldY(before.lat, target) - (anchor.y - height / 2);
  return { lat: worldYToLat(worldY, target), lon: worldXToLon(worldX, target), zoom: target };
}

export interface TileLayout {
  /** Zoom level the images themselves come from; always whole. */
  zoom: number;
  /** Screen pixels per tile pixel, which is `2^(view.zoom - zoom)`. */
  scale: number;
  /** Where the tile layer starts, relative to the viewport. */
  offsetX: number;
  offsetY: number;
  /** Tiles placed relative to the layer origin, in screen pixels. */
  tiles: TilePlacement[];
}

export interface TileLayoutOptions {
  /**
   * Extra rings of tiles kept around the viewport. One ring absorbs a 256px
   * drag before a single new image has to be fetched.
   */
  padding?: number;
  /**
   * Zoom of the images when it should lag behind `view.zoom`, so a pinch is not
   * a burst of requests for every level it passes through.
   */
  tileZoom?: number;
}

/**
 * The tile layer for a viewport, aligned to a tile boundary so that panning
 * only moves the layer: tiles keep their position and the offsets change, which
 * is what lets the browser move them without touching any image.
 *
 * Tiles outside the map (west of -180, for instance) are skipped: there is no
 * image for them.
 */
export function tileLayoutFor(
  view: MapView,
  width: number,
  height: number,
  options: TileLayoutOptions = {},
): TileLayout {
  const padding = Math.max(0, Math.floor(options.padding ?? 0));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(options.tileZoom ?? view.zoom)));
  // A fractional zoom only stretches the level it rounded to; no tile exists
  // for zoom 12.4, so its images are drawn at 2^0.4 of their size instead.
  const scale = Math.pow(2, view.zoom - zoom);
  const centerX = lonToWorldX(view.lon, zoom);
  const centerY = latToWorldY(view.lat, zoom);
  const left = centerX - width / (2 * scale);
  const top = centerY - height / (2 * scale);
  const count = Math.pow(2, zoom);

  const originX = Math.floor(left / TILE_SIZE) * TILE_SIZE - padding * TILE_SIZE;
  const originY = Math.floor(top / TILE_SIZE) * TILE_SIZE - padding * TILE_SIZE;
  const firstX = originX / TILE_SIZE;
  const firstY = originY / TILE_SIZE;
  const lastX = Math.floor((left + width / scale) / TILE_SIZE) + padding;
  const lastY = Math.floor((top + height / scale) / TILE_SIZE) + padding;

  const tiles: TilePlacement[] = [];
  for (let x = firstX; x <= lastX; x += 1) {
    if (x < 0 || x >= count) continue;
    for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= count) continue;
      tiles.push({
        z: zoom,
        x,
        y,
        left: (x * TILE_SIZE - originX) * scale,
        top: (y * TILE_SIZE - originY) * scale,
      });
    }
  }
  return {
    zoom,
    scale,
    offsetX: -(left - originX) * scale,
    offsetY: -(top - originY) * scale,
    tiles,
  };
}

/** Every tile that covers the viewport, with its absolute screen offset. */
export function tilesForView(view: MapView, width: number, height: number): TilePlacement[] {
  const layout = tileLayoutFor(view, width, height);
  return layout.tiles.map((tile) => ({
    ...tile,
    left: tile.left + layout.offsetX,
    top: tile.top + layout.offsetY,
  }));
}

/**
 * Every tile of one whole level that the viewport touches.
 *
 * `tileLayoutFor` answers what to draw right now; this answers what to save, so
 * the caller can walk the levels it wants to keep for offline use. Longitudes
 * wrap, so x folds into the world instead of being dropped at the
 * antimeridian; latitudes do not, so y stays inside the world.
 */
export function tilesCoveringView(
  view: MapView,
  width: number,
  height: number,
  zoom: number,
  padding = 0,
): Array<{ z: number; x: number; y: number }> {
  const level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
  const ring = Math.max(0, Math.floor(padding));
  const count = Math.pow(2, level);
  const scale = Math.pow(2, view.zoom - level);
  const centerX = lonToWorldX(view.lon, level);
  const centerY = latToWorldY(view.lat, level);
  const left = (centerX - width / (2 * scale)) / TILE_SIZE;
  const right = (centerX + width / (2 * scale)) / TILE_SIZE;
  const top = (centerY - height / (2 * scale)) / TILE_SIZE;
  const bottom = (centerY + height / (2 * scale)) / TILE_SIZE;

  const firstX = Math.floor(left) - ring;
  const lastX = Math.floor(right) + ring;
  const firstY = Math.max(0, Math.floor(top) - ring);
  const lastY = Math.min(count - 1, Math.floor(bottom) + ring);

  const tiles: Array<{ z: number; x: number; y: number }> = [];
  const seen = new Set<number>();
  for (let x = firstX; x <= lastX; x += 1) {
    const wrapped = ((x % count) + count) % count;
    if (seen.has(wrapped)) continue;
    seen.add(wrapped);
    for (let y = firstY; y <= lastY; y += 1) tiles.push({ z: level, x: wrapped, y });
  }
  return tiles;
}

/**
 * The zoom two fingers ask for: the distance between them doubles, the map goes
 * up one level. Sub-pixel distances and a missing first pinch are ignored.
 */
export function zoomForPinch(startZoom: number, startDistance: number, currentDistance: number): number {
  if (!(startDistance > 0) || !(currentDistance > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom + Math.log2(currentDistance / startDistance));
}

export function boundsForView(view: MapView, width: number, height: number) {
  const northWest = unprojectFromScreen({ x: 0, y: 0 }, view, width, height);
  const southEast = unprojectFromScreen({ x: width, y: height }, view, width, height);
  return {
    north: northWest.lat,
    west: northWest.lon,
    south: southEast.lat,
    east: southEast.lon,
  };
}
