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

/** A WGS84 point, used only for approximate walking-time estimates. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CampusLocationDetails extends CampusLocation {
  category: CampusLocationCategory;
  /** Street address as published by Ohio State. */
  address: string;
  /** Approximate building coordinate; precision is unverified. Not for navigation. */
  coordinates: GeoPoint;
  /** True only when an official page offers bookable study rooms. False means "not verified", not proof that none exists. */
  reservable: boolean;
  /** Official booking page; present only when `reservable` is true. */
  reservationUrl?: string;
  /** Official page that was read and verified for this location. */
  infoUrl: string;
  /** Short room rules / access context. */
  notes?: string;
}
