import { CAMPUS_LOCATIONS } from '../campus-locations/index.ts';
import type { CampusLocationDetails, CampusLocationCategory } from '../campus-locations/index.ts';
import { MAX_BOUNDS_PADDING_DEGREES, REFERENCE_VIEW } from './config.ts';

/**
 * Pure conversion from the verified location snapshot to map data.
 *
 * Coordinates are approximate **building points**, not entrances or room
 * locations, and nothing here implies that a place is open or available.
 */

export interface MapLocation {
  id: string;
  name: string;
  category: CampusLocationCategory;
  address: string;
  lat: number;
  lng: number;
  infoUrl: string;
  reservationUrl?: string;
  /** Date the snapshot was verified; shown in the list for traceability. */
  verifiedOn: string;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export const MAP_CATEGORY_LABELS: Record<CampusLocationCategory, string> = {
  library: 'Library',
  'student-center': 'Student center',
};

/** Categories that the verified dataset can actually support. */
export const MAP_CATEGORIES: readonly CampusLocationCategory[] = ['library', 'student-center'];

export function isValidBuildingPoint(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Converts verified locations into map points, skipping any invalid coordinate
 * rather than widening the map to accommodate it.
 */
export function toMapLocations(
  locations: readonly CampusLocationDetails[] = CAMPUS_LOCATIONS,
  verifiedOn = '',
): MapLocation[] {
  const result: MapLocation[] = [];
  for (const location of locations) {
    const { lat, lng } = location.coordinates ?? {};
    if (!isValidBuildingPoint(lat, lng)) continue;
    result.push({
      id: location.id,
      name: location.name,
      category: location.category,
      address: location.address,
      lat,
      lng,
      infoUrl: location.infoUrl,
      reservationUrl: location.reservationUrl,
      verifiedOn,
    });
  }
  return result;
}

/** Union of the reference view and every valid location point. */
export function buildInitialBounds(locations: readonly MapLocation[]): MapBounds {
  const bounds: MapBounds = {
    north: REFERENCE_VIEW.north,
    south: REFERENCE_VIEW.south,
    east: REFERENCE_VIEW.east,
    west: REFERENCE_VIEW.west,
  };
  for (const location of locations) {
    if (!isValidBuildingPoint(location.lat, location.lng)) continue;
    bounds.north = Math.max(bounds.north, location.lat);
    bounds.south = Math.min(bounds.south, location.lat);
    bounds.east = Math.max(bounds.east, location.lng);
    bounds.west = Math.min(bounds.west, location.lng);
  }
  return bounds;
}

/** Bounds that already include a little browsing margin, still not official. */
export function buildBrowsingBounds(bounds: MapBounds): MapBounds {
  return {
    north: bounds.north + MAX_BOUNDS_PADDING_DEGREES,
    south: bounds.south - MAX_BOUNDS_PADDING_DEGREES,
    east: bounds.east + MAX_BOUNDS_PADDING_DEGREES,
    west: bounds.west - MAX_BOUNDS_PADDING_DEGREES,
  };
}

export function filterMapLocations(
  locations: readonly MapLocation[],
  activeCategories: ReadonlySet<CampusLocationCategory>,
): MapLocation[] {
  return locations.filter((location) => activeCategories.has(location.category));
}
