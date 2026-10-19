import { CAMPUS_LOCATIONS, LOCATION_DATA_VERIFIED_ON, OFFICIAL_LOCATION_SNAPSHOTS } from '../campus-locations/index.ts';
import type { ReservationPolicy } from './types.ts';

/**
 * Reservation policies derived from the verified campus-location snapshot.
 *
 * The official booking text (`BookingSnapshot.rules`) is the source of truth.
 * Structured numbers below are only those the text states; the test suite
 * asserts each one is still present in that text, so the two cannot drift.
 */

interface Limits {
  maxDurationMinutes: number | null;
  maxAdvanceDays: number | null;
  maxGroupSize: number | null;
  buildingAccess: string | null;
  /** True only for the University Libraries group-study rooms. */
  groupStudyOnly: boolean;
}

const UNKNOWN_LIMITS: Limits = {
  maxDurationMinutes: null,
  maxAdvanceDays: null,
  maxGroupSize: null,
  buildingAccess: null,
  groupStudyOnly: false,
};

/**
 * Transcribed from the official booking rules recorded in the snapshot:
 * - Libraries: "Group study rooms; up to 4 hours; request from the same day up
 *   to one week ahead; a group more than 15 minutes late forfeits ..."
 * - HSL: "up to 5 people; 2-hour reservations; up to 3 days ahead".
 */
const LIMITS_BY_LOCATION: Record<string, Limits> = {
  'thompson-library': { ...UNKNOWN_LIMITS, maxDurationMinutes: 240, maxAdvanceDays: 7, groupStudyOnly: true },
  '18th-avenue-library': {
    ...UNKNOWN_LIMITS,
    maxDurationMinutes: 240,
    maxAdvanceDays: 7,
    groupStudyOnly: true,
    buildingAccess: 'BuckID required after midnight (per the verified snapshot).',
  },
  'health-sciences-library': {
    ...UNKNOWN_LIMITS,
    maxDurationMinutes: 120,
    maxAdvanceDays: 3,
    maxGroupSize: 5,
    groupStudyOnly: false,
  },
  // Same University Libraries system and rules as Thompson and 18th Avenue.
  'faes-library': { ...UNKNOWN_LIMITS, maxDurationMinutes: 240, maxAdvanceDays: 7, groupStudyOnly: true },
  'ohio-union': { ...UNKNOWN_LIMITS },
};

/**
 * Verbatim clauses from the official rules text, only shown when the snapshot
 * actually contains them. Kept lowercase so they remain exact substrings.
 */
const LIBRARIES_LATE_CLAUSE = 'a group more than 15 minutes late forfeits the reservation';
const HSL_RELEASE_CLAUSE = 'reservations may be released if unoccupied after 10 minutes';

function clause(rules: string, text: string): string | null {
  return rules.includes(text) ? text : null;
}

export const RESERVATION_POLICIES: readonly ReservationPolicy[] = CAMPUS_LOCATIONS.map((location) => {
  const snapshot = OFFICIAL_LOCATION_SNAPSHOTS.find((candidate) => candidate.locationId === location.id);
  const booking = snapshot?.booking;
  const rules = booking?.rules ?? '';
  const limits = LIMITS_BY_LOCATION[location.id] ?? UNKNOWN_LIMITS;

  return {
    locationId: location.id,
    reservable: location.reservable,
    reservationUrl: location.reservationUrl,
    infoUrl: location.infoUrl,
    verifiedOn: LOCATION_DATA_VERIFIED_ON,
    statement: location.notes ?? '',
    ...limits,
    eligibility: booking?.eligibility ?? 'Not verified.',
    bookingRules: booking?.rules ?? 'Not verified.',
    rulesUrl: booking?.rulesUrl ?? location.infoUrl,
    rulesVerifiedOn: booking?.provenance.verifiedOn ?? LOCATION_DATA_VERIFIED_ON,
    lateArrivalRule: clause(rules, LIBRARIES_LATE_CLAUSE),
    unoccupiedReleaseRule: clause(rules, HSL_RELEASE_CLAUSE),
  };
});

export function findReservationPolicy(locationId: string): ReservationPolicy | null {
  return RESERVATION_POLICIES.find((policy) => policy.locationId === locationId) ?? null;
}

/**
 * How the verified "up to a week ahead" rule is measured.
 *
 * The official pages state "up to one week ahead" / "up to 3 days ahead"
 * without defining a calendar boundary, so this prototype enforces it as
 * **elapsed time**: the start must be within `maxAdvanceDays × 24 hours` of now.
 * This is stated in the UI next to the limit instead of being silently assumed.
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
