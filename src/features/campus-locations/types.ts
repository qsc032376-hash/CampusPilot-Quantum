import type { CampusLocation } from '../../types.ts';

/**
 * Feature-local, richer view of a study location.
 *
 * The shared `CampusLocation` in `src/types.ts` is owned by the technical lead
 * and stays `{ id, name }`. This interface EXTENDS it, so every value in
 * `CAMPUS_LOCATIONS` is still a valid `CampusLocation` for the scheduler.
 * No shared file is modified.
 */
export type CampusLocationCategory = 'library' | 'student-center';

/** How a fact was obtained. `isLive` is always false: this module never polls. */
export type DataStatus = 'official-snapshot' | 'simulated' | 'unverified';

export interface DataProvenance {
  status: DataStatus;
  /** Publisher or data owner, e.g. "Ohio State University Libraries". */
  source: string;
  /** Exact official page or service used. */
  sourceUrl: string;
  /** Date the source was read, ISO 8601 date. */
  verifiedOn: string;
  /** This module uses static snapshots only; it never claims live data. */
  isLive: false;
  /** Scope, date range or "not verified" caveat. */
  note: string;
}

/** Extra evidence required for an official building point. */
export interface CoordinateProvenance extends DataProvenance {
  /** OSU building number from the GIS Buildings layer, e.g. "0050". */
  buildingId: string;
  /** Coordinates returned by the GIS query in this reference system. */
  coordinateSystem: 'WGS84 (EPSG:4326)';
  /** How the point was extracted. */
  extraction: string;
}

export interface LocationProvenance {
  /** Source for name and address. */
  identity: DataProvenance;
  /** Source and method for the building point. */
  coordinates: CoordinateProvenance;
}

/** A WGS84 point, used only for approximate walking-time estimates. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CampusLocationDetails extends CampusLocation {
  category: CampusLocationCategory;
  /** Street address as published by Ohio State. */
  address: string;
  /** Official OSU building point; a building centroid, not an entrance. */
  coordinates: GeoPoint;
  /** True only when an official page offers bookable study rooms. False means "not verified", not proof that none exists. */
  reservable: boolean;
  /** Official booking page; present only when `reservable` is true. */
  reservationUrl?: string;
  /** Official page that was read and verified for this location. */
  infoUrl: string;
  /** Short room rules / access context. */
  notes?: string;
  /** Official full name when the display name is a shorter service name. */
  officialName?: string;
  /** Traceable source for name/address and coordinates. */
  provenance: LocationProvenance;
}
