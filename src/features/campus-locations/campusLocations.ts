import type { CampusLocation } from '../../types.ts';
import type {
  CampusLocationDetails,
  CoordinateProvenance,
  DataProvenance,
  LocationProvenance,
} from './types.ts';

/**
 * VERIFIED STATIC DATA — Ohio State campus study locations.
 *
 * What "verified" means:
 * - Names, addresses and official pages were read on 2026-10-19.
 * - `reservable` is true only where an official Ohio State page explicitly
 *   offers study-room booking. It does not mean a room is free right now.
 * - Coordinates are official OSU FITS GIS building points, queried by building
 *   number. They are building centroids, not entrances; precision was not
 *   field-verified.
 *
 * What is NOT here:
 * - Real-time availability, occupancy or reservation status. None of that was
 *   verified, so none is claimed. See `simulatedAvailability.ts` for the
 *   mock schedule still used by the recommender, and `officialSnapshot.ts`
 *   for the dated official hours snapshot.
 */
const VERIFIED_ON = '2026-10-19';

export const LOCATION_DATA_VERIFIED_ON = VERIFIED_ON;

const GIS_URL =
  'https://gissvc.osu.edu/arcgis/rest/services/OSUMaps/BaseMap_RO/MapServer/28';

function identity(source: string, sourceUrl: string): DataProvenance {
  return {
    status: 'official-snapshot',
    source,
    sourceUrl,
    verifiedOn: VERIFIED_ON,
    isLive: false,
    note: 'Official page read for this snapshot; names and addresses can change. Not live.',
  };
}

function coordinateProvenance(buildingId: string): CoordinateProvenance {
  return {
    status: 'official-snapshot',
    source: 'The Ohio State University FITS GIS - OSU Basemap Buildings',
    sourceUrl: GIS_URL,
    verifiedOn: VERIFIED_ON,
    isLive: false,
    note: 'Official OSU building point; building centroid, not an entrance; precision not field-verified.',
    buildingId,
    coordinateSystem: 'WGS84 (EPSG:4326)',
    extraction: 'Queried the Buildings layer by BLDG_NUM and read its Latitude/Longitude fields.',
  };
}

function provenance(source: string, sourceUrl: string, buildingId: string): LocationProvenance {
  return {
    identity: identity(source, sourceUrl),
    coordinates: coordinateProvenance(buildingId),
  };
}

export const CAMPUS_LOCATIONS: readonly CampusLocationDetails[] = [
  {
    id: 'thompson-library',
    name: 'Thompson Library',
    category: 'library',
    address: '1858 Neil Avenue Mall, Columbus, OH 43210',
    coordinates: { lat: 39.99925188, lng: -83.01488152 },
    reservable: true,
    reservationUrl: 'https://libraryroombooking.cloud.osu.edu/',
    infoUrl: 'https://library.osu.edu/locations/thompson',
    notes:
      'Main library on the Oval. Group study rooms can be requested up to a week ahead for up to 4 hours; free rooms are walk-in.',
    provenance: provenance(
      'Ohio State University Libraries',
      'https://library.osu.edu/locations/thompson',
      '0050',
    ),
  },
  {
    id: '18th-avenue-library',
    name: '18th Avenue Library',
    category: 'library',
    address: '175 West 18th Avenue, Columbus, OH 43210',
    coordinates: { lat: 40.0016329, lng: -83.01333843 },
    reservable: true,
    reservationUrl: 'https://libraryroombooking.cloud.osu.edu/',
    infoUrl: 'https://library.osu.edu/locations/18th',
    notes:
      'Science and engineering library, open from Sunday morning through Friday midnight; BuckID required after midnight. Group study rooms can be requested like Thompson rooms.',
    provenance: provenance(
      'Ohio State University Libraries',
      'https://library.osu.edu/locations/18th',
      '0005',
    ),
  },
  {
    id: 'health-sciences-library',
    name: 'Health Sciences Library',
    category: 'library',
    address: '376 W. 10th Avenue, Columbus, OH 43210',
    coordinates: { lat: 39.99477158, lng: -83.0170996 },
    reservable: true,
    reservationUrl: 'https://hsl-osu.libcal.com/spaces?lid=694&gid=24674',
    infoUrl: 'https://hsl.osu.edu/using-library/visit/location-hours-and-parking',
    notes:
      'In Prior Hall. Third-floor study rooms seat up to 5 people, can be booked for 2 hours at a time, and open 3 days ahead.',
    provenance: provenance(
      'Ohio State University Health Sciences Library',
      'https://hsl.osu.edu/using-library/visit/location-hours-and-parking',
      '0302',
    ),
  },
  {
    id: 'faes-library',
    name: 'FAES Library & Student Success Center',
    officialName: 'Food, Agricultural & Environmental Sciences Library',
    category: 'library',
    address: '045 Agricultural Administration Building, 2120 Fyffe Rd, Columbus, OH 43210',
    coordinates: { lat: 40.00542636, lng: -83.02722587 },
    reservable: true,
    reservationUrl: 'https://libraryroombooking.cloud.osu.edu/',
    infoUrl: 'https://library.osu.edu/locations/faes',
    notes:
      'Ground floor of the Agricultural Administration Building. Group study rooms are requested through the same University Libraries system as Thompson and 18th Avenue.',
    provenance: provenance(
      'Ohio State University Libraries',
      'https://library.osu.edu/locations/faes',
      '0003',
    ),
  },
  {
    id: 'ohio-union',
    name: 'Ohio Union',
    category: 'student-center',
    address: '1739 N. High Street, Columbus, OH 43210',
    coordinates: { lat: 39.99765973, lng: -83.00864174 },
    reservable: false,
    infoUrl: 'https://ohiounion.osu.edu/visiting/hours',
    notes:
      'Central student union with dining and open seating. Its listed rooms are event spaces rented through Student Life Event Services; a separate individual study-room booking entry point has not been verified.',
    provenance: provenance(
      'Ohio State University Office of Student Life',
      'https://ohiounion.osu.edu/',
      '0161',
    ),
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
