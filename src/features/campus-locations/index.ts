export type {
  CampusLocationCategory,
  CampusLocationDetails,
  CoordinateProvenance,
  DataProvenance,
  DataStatus,
  GeoPoint,
  LocationProvenance,
} from './types.ts';

export {
  CAMPUS_LOCATIONS,
  LOCATION_DATA_VERIFIED_ON,
  toScheduleLocations,
} from './campusLocations.ts';

export type {
  BookingSnapshot,
  BuildingAccessSnapshot,
  HoursSnapshot,
  LocationSnapshot,
} from './officialSnapshot.ts';
export {
  OFFICIAL_LOCATION_SNAPSHOTS,
  OFFICIAL_SNAPSHOT_DISCLAIMER,
  OFFICIAL_SNAPSHOT_VERIFIED_ON,
} from './officialSnapshot.ts';

export type { DayOfWeek, SimulatedAvailability, TimeRange } from './simulatedAvailability.ts';
export {
  AVAILABILITY_DISCLAIMER,
  DAYS_OF_WEEK,
  SIMULATED_AVAILABILITY,
} from './simulatedAvailability.ts';

export type {
  LocationPreferences,
  LocationRecommendation,
  RecommendationOptions,
  StudyBlockWindow,
} from './recommendLocations.ts';
export {
  estimateWalkMinutes,
  formatClockTime,
  formatTimeRange,
  isLocationOpen,
  recommendLocations,
} from './recommendLocations.ts';
