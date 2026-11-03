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

export type MapLayer = 'osm' | 'topo';

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

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
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

/**
 * Every tile that covers the viewport, with its offset. Tiles outside the map
 * (west of -180, for instance) are skipped: there is no image for them.
 */
export function tilesForView(view: MapView, width: number, height: number): TilePlacement[] {
  const zoom = view.zoom;
  const centerX = lonToWorldX(view.lon, zoom);
  const centerY = latToWorldY(view.lat, zoom);
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  const count = Math.pow(2, zoom);

  const firstX = Math.floor(left / TILE_SIZE);
  const lastX = Math.floor((left + width) / TILE_SIZE);
  const firstY = Math.floor(top / TILE_SIZE);
  const lastY = Math.floor((top + height) / TILE_SIZE);

  const tiles: TilePlacement[] = [];
  for (let x = firstX; x <= lastX; x += 1) {
    if (x < 0 || x >= count) continue;
    for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= count) continue;
      tiles.push({
        z: zoom,
        x,
        y,
        left: x * TILE_SIZE - left,
        top: y * TILE_SIZE - top,
      });
    }
  }
  return tiles;
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
