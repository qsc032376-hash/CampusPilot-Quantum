import type { CampusLocation } from '../../types.ts';
import type { CampusLocationDetails } from './types.ts';

/**
 * VERIFIED STATIC DATA — Ohio State campus study locations.
 *
 * What "verified" means:
 * - `infoUrl` and `reservationUrl` returned HTTP 200 on 2026-10-17 and were read.
 * - `reservable` is true only where an official Ohio State page explicitly
 *   offers study-room booking. It does not mean a room is free right now.
 * - Addresses and room rules come from those official pages.
 *
 * What is NOT here:
 * - Real-time availability, occupancy or reservation status. None of that was
 *   verified, so none is claimed. See `simulatedAvailability.ts` for the
 *   clearly labelled mock schedule.
 *
 * Coordinates come from OpenStreetMap building records because the OSU campus
 * map has no public coordinate endpoint. They are approximate and only used
 * for walking-time estimates.
 */
export const LOCATION_DATA_VERIFIED_ON = '2026-10-17';

export const CAMPUS_LOCATIONS: readonly CampusLocationDetails[] = [
  {
    id: 'thompson-library',
    name: 'Thompson Library',
    category: 'library',
    address: '1858 Neil Avenue Mall, Columbus, OH 43210',
    coordinates: { lat: 39.999263, lng: -83.0149043 },
    reservable: true,
    reservationUrl: 'https://libraryroombooking.cloud.osu.edu/',
    infoUrl: 'https://library.osu.edu/locations/thompson',
    notes:
      'Main library on the Oval. Group study rooms can be requested up to a week ahead for up to 4 hours; free rooms are walk-in.',
  },
  {
    id: '18th-avenue-library',
    name: '18th Avenue Library',
    category: 'library',
    address: '175 West 18th Avenue, Columbus, OH 43210',
    coordinates: { lat: 40.0015988, lng: -83.0133326 },
    reservable: true,
    reservationUrl: 'https://libraryroombooking.cloud.osu.edu/',
    infoUrl: 'https://library.osu.edu/locations/18th',
    notes:
      'Science and engineering library, open from Sunday morning through Friday midnight; BuckID required after midnight. Group study rooms can be requested like Thompson rooms.',
  },
  {
    id: 'health-sciences-library',
    name: 'Health Sciences Library',
    category: 'library',
    address: '376 West 10th Avenue (Prior Hall), Columbus, OH 43210',
    coordinates: { lat: 39.9947751, lng: -83.017086 },
    reservable: true,
    reservationUrl: 'https://hsl-osu.libcal.com/spaces?lid=694&gid=24674',
    infoUrl: 'https://hsl.osu.edu/reserve-space/study-rooms',
    notes:
      'Third-floor study rooms seat up to 5 people, can be booked for 2 hours at a time, and open 3 days ahead.',
  },
  {
    id: 'faes-library',
    name: 'FAES Library & Student Success Center',
    category: 'library',
    address: '2120 Fyffe Road (Agricultural Administration Building, room 045), Columbus, OH 43210',
    coordinates: { lat: 40.0054711, lng: -83.0270647 },
    reservable: true,
    reservationUrl: 'https://libraryroombooking.cloud.osu.edu/',
    infoUrl: 'https://library.osu.edu/locations/faes',
    notes:
      'Ground floor of the Agricultural Administration Building. Group study rooms are requested through the same University Libraries system as Thompson and 18th Avenue.',
  },
  {
    id: 'ohio-union',
    name: 'Ohio Union',
    category: 'student-center',
    address: '1739 N. High Street, Columbus, OH 43210',
    coordinates: { lat: 39.9976645, lng: -83.0085472 },
    reservable: false,
    infoUrl: 'https://ohiounion.osu.edu/visiting/hours',
    notes:
      'Central student union with dining and open seating. Its listed rooms are event spaces rented through Student Life Event Services — there are no bookable individual study rooms.',
  },
];

/**
 * Convert detailed locations into the exact shape the scheduler expects.
 * The scheduler only needs `{ id, name }`; extra fields never leak into it.
 */
export function toScheduleLocations(
  locations: readonly CampusLocation[] = CAMPUS_LOCATIONS,
): CampusLocation[] {
  return locations.map(({ id, name }) => ({ id, name }));
}
