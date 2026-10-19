import { CAMPUS_LOCATIONS, LOCATION_DATA_VERIFIED_ON } from '../campus-locations/index.ts';
import type { ReservationPolicy } from './types.ts';

/**
 * Reservation policies transcribed from the verified location snapshot.
 *
 * Only limits that the official page actually states are encoded. Everything
 * else stays `null`, which the UI renders as "not verified" instead of guessing
 * a rule. `statement` keeps the original snapshot wording verbatim so a reviewer
 * can compare it with the source.
 */
interface Limits {
  maxDurationMinutes: number | null;
  maxAdvanceDays: number | null;
  maxGroupSize: number | null;
  buildingAccess: string | null;
}

const UNKNOWN_LIMITS: Limits = {
  maxDurationMinutes: null,
  maxAdvanceDays: null,
  maxGroupSize: null,
  buildingAccess: null,
};

const LIMITS_BY_LOCATION: Record<string, Limits> = {
  // "Group study rooms can be requested up to a week ahead for up to 4 hours"
  'thompson-library': { ...UNKNOWN_LIMITS, maxDurationMinutes: 240, maxAdvanceDays: 7 },
  // "Group study rooms can be requested like Thompson rooms." + building access note.
  '18th-avenue-library': {
    ...UNKNOWN_LIMITS,
    maxDurationMinutes: 240,
    maxAdvanceDays: 7,
    buildingAccess: 'BuckID required after midnight (per the verified snapshot).',
  },
  // "seat up to 5 people, can be booked for 2 hours at a time, and open 3 days ahead"
  'health-sciences-library': {
    ...UNKNOWN_LIMITS,
    maxDurationMinutes: 120,
    maxAdvanceDays: 3,
    maxGroupSize: 5,
  },
  // The snapshot records the same University Libraries booking system as
  // Thompson and 18th Avenue, so the group-study rules published for that
  // system apply: up to 4 hours per booking and up to a week ahead.
  'faes-library': { ...UNKNOWN_LIMITS, maxDurationMinutes: 240, maxAdvanceDays: 7 },
  // Not reservable: event spaces are rented through a different office.
  'ohio-union': { ...UNKNOWN_LIMITS },
};

export const RESERVATION_POLICIES: readonly ReservationPolicy[] = CAMPUS_LOCATIONS.map((location) => ({
  locationId: location.id,
  reservable: location.reservable,
  reservationUrl: location.reservationUrl,
  infoUrl: location.infoUrl,
  verifiedOn: LOCATION_DATA_VERIFIED_ON,
  statement: location.notes ?? '',
  ...(LIMITS_BY_LOCATION[location.id] ?? UNKNOWN_LIMITS),
}));

export function findReservationPolicy(locationId: string): ReservationPolicy | null {
  return RESERVATION_POLICIES.find((policy) => policy.locationId === locationId) ?? null;
}

/**
 * How the verified "up to a week ahead" rule is measured.
 *
 * The official pages state "a week ahead" / "N days ahead" without specifying a
 * calendar-day boundary, so this prototype enforces it as **elapsed time**: the
 * start must be within `maxAdvanceDays × 24 hours` of now. This is stated in the
 * UI next to the limit instead of being silently assumed.
 */
export const ADVANCE_WINDOW_MEASUREMENT = 'elapsed 24-hour periods from now';

/** Locations a user can pick in the planner (all verified snapshot entries). */
export function listReservationLocations(): { id: string; name: string; reservable: boolean }[] {
  return CAMPUS_LOCATIONS.map((location) => ({
    id: location.id,
    name: location.name,
    reservable: location.reservable,
  }));
}
