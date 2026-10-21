/**
 * Campus map configuration.
 *
 * The tile URL is a single replaceable constant so the prototype can switch
 * providers without touching components. The public OpenStreetMap tile service
 * has no SLA and must not be pre-fetched, bulk-downloaded or used offline; the
 * app only requests the tiles Leaflet needs for the visible viewport.
 */

/** Public OSM raster tiles. Replaceable; no SLA. */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Attribution must stay visible whenever OSM tiles are shown. */
export const OSM_ATTRIBUTION_HTML =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> contributors';

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * Reference view from the product request. It is a convenience starting area,
 * NOT an official campus boundary and NOT an authoritative extent for the data.
 */
export const REFERENCE_VIEW = { north: 40.00545, south: 39.99085, west: -83.02216, east: -82.99321 } as const;

/** Soft browsing limit so users cannot drag to the other side of the planet. */
export const MAX_BOUNDS_PADDING_DEGREES = 0.02;

export const MAP_MIN_ZOOM = 13;
export const MAP_MAX_ZOOM = 19;
export const MAP_FIT_PADDING_PX: [number, number] = [24, 24];

export const MAP_DISCLAIMER =
  'Base map © OpenStreetMap contributors. Markers are approximate building points, not entrances or rooms. The view is a browsing aid, not an official campus boundary. No live opening hours, occupancy, access permission or booking status is shown.';
