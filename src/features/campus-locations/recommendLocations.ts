import { CAMPUS_LOCATIONS } from './campusLocations.ts';
import { DAYS_OF_WEEK, SIMULATED_AVAILABILITY } from './simulatedAvailability.ts';
import type { DayOfWeek, SimulatedAvailability, TimeRange } from './simulatedAvailability.ts';
import type { CampusLocationCategory, CampusLocationDetails, GeoPoint } from './types.ts';

/**
 * Pure location-matching helper.
 *
 * It joins verified static locations (`campusLocations.ts`) with clearly
 * labelled simulated availability (`simulatedAvailability.ts`). It does not
 * call any network, read the clock, or book anything. The UI still has to
 * open the official reservation page itself.
 */

/** Average walking pace on campus, metres per minute (~4.8 km/h). */
const WALKING_SPEED_METERS_PER_MINUTE = 80;

/** Straight-line distance is shorter than a real route; pad it a little. */
const STREET_ROUTE_FACTOR = 1.25;

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * A study window in campus local time, expressed as minutes after midnight.
 * Example: Tuesday 1:30-3:00 p.m. -> { day: 'Tue', startMinutes: 810, endMinutes: 900 }.
 *
 * The window must start and end on the same calendar day. Cross-midnight
 * blocks are not supported; "overnight" means early-morning hours on the
 * stated day (for example 02:00-04:00), not a window spanning two dates.
 */
export interface StudyBlockWindow {
  day: DayOfWeek;
  /** Minutes after midnight, inclusive. */
  startMinutes: number;
  /** Minutes after midnight, exclusive. 1440 means midnight at the end of the day. */
  endMinutes: number;
}

/** Simple user preferences. Every field is optional. */
export interface LocationPreferences {
  /** Where the student is coming from. Enables walking-time ranking. */
  origin?: GeoPoint;
  /** Drop locations estimated to be farther than this many walking minutes. Ignored without `origin`. */
  maxWalkMinutes?: number;
  /** Keep only locations with official bookable study rooms. */
  requireReservable?: boolean;
  /** Keep only these categories. An empty list means "no filter". */
  categoryFilter?: readonly CampusLocationCategory[];
}

export interface LocationRecommendation {
  location: CampusLocationDetails;
  /** 50 for being open, +20 if reservable, +0-30 for closeness. */
  score: number;
  /** Estimated walking minutes from `preferences.origin`; null when no origin was given. */
  walkMinutes: number | null;
  /** Short explanations suitable for rendering in a list. */
  reasons: readonly string[];
}

/** Injection points so the helper is easy to test with a different dataset. */
export interface RecommendationOptions {
  locations?: readonly CampusLocationDetails[];
  availability?: readonly SimulatedAvailability[];
}

/**
 * Return open locations for a study block, best match first.
 *
 * A location is included only when one simulated window fully covers the block.
 * The result is a plain array; the caller decides how many to show. Returns an
 * empty array when nothing matches or when no availability data is supplied.
 */
export function recommendLocations(
  block: StudyBlockWindow,
  preferences: LocationPreferences = {},
  options: RecommendationOptions = {},
): LocationRecommendation[] {
  assertValidBlock(block);
  assertValidPreferences(preferences);

  const locations = options.locations ?? CAMPUS_LOCATIONS;
  const availability = options.availability ?? SIMULATED_AVAILABILITY;
  const availabilityByLocation = new Map<string, SimulatedAvailability>(
    availability.map((record) => [record.locationId, record]),
  );

  const recommendations: LocationRecommendation[] = [];

  for (const location of locations) {
    if (preferences.requireReservable && !location.reservable) {
      continue;
    }

    const categoryFilter = preferences.categoryFilter;
    if (categoryFilter && categoryFilter.length > 0 && !categoryFilter.includes(location.category)) {
      continue;
    }

    const record = availabilityByLocation.get(location.id);
    const window = record?.weekly[block.day].find(
      (candidate) => candidate.startMinutes <= block.startMinutes && block.endMinutes <= candidate.endMinutes,
    );
    if (!window) {
      continue;
    }

    const walkMinutes = preferences.origin ? estimateWalkMinutes(preferences.origin, location.coordinates) : null;
    if (walkMinutes !== null && preferences.maxWalkMinutes !== undefined && walkMinutes > preferences.maxWalkMinutes) {
      continue;
    }

    recommendations.push(buildRecommendation(location, window, walkMinutes));
  }

  return recommendations.sort(compareRecommendations);
}

/** True when the given location's simulated schedule covers the whole block. */
export function isLocationOpen(
  locationId: string,
  block: StudyBlockWindow,
  availability: readonly SimulatedAvailability[] = SIMULATED_AVAILABILITY,
): boolean {
  assertValidBlock(block);
  const record = availability.find((candidate) => candidate.locationId === locationId);
  if (!record) {
    return false;
  }
  return record.weekly[block.day].some(
    (window) => window.startMinutes <= block.startMinutes && block.endMinutes <= window.endMinutes,
  );
}

/**
 * Rough walking time between two points. Straight-line distance, padded for
 * streets, at a calm pace. Identical points return 0 minutes; any positive
 * distance rounds up to at least 1. Good enough to rank; not a route.
 */
export function estimateWalkMinutes(from: GeoPoint, to: GeoPoint): number {
  const metres = haversineMeters(from, to) * STREET_ROUTE_FACTOR;
  return Math.ceil(metres / WALKING_SPEED_METERS_PER_MINUTE);
}

/** Format minutes after midnight as a 12-hour clock time. 540 -> "9:00 AM". */
export function formatClockTime(minutesAfterMidnight: number): string {
  const normalized = ((minutesAfterMidnight % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

/** Format a window for a UI reason string. 0-1440 -> "all day". */
export function formatTimeRange(range: TimeRange): string {
  if (range.startMinutes === 0 && range.endMinutes === 1440) {
    return 'all day';
  }
  const end = range.endMinutes === 1440 ? 'midnight' : formatClockTime(range.endMinutes);
  return `${formatClockTime(range.startMinutes)}–${end}`;
}

function buildRecommendation(
  location: CampusLocationDetails,
  window: TimeRange,
  walkMinutes: number | null,
): LocationRecommendation {
  const reasons: string[] = [`Open ${formatTimeRange(window)} (simulated hours).`];
  let score = 50;

  if (location.reservable) {
    score += 20;
    reasons.push('Official study-room booking is available.');
  } else {
    reasons.push('Walk-in space; no advance study-room booking.');
  }

  if (walkMinutes !== null) {
    score += Math.max(0, 30 - walkMinutes);
    reasons.push(`About ${walkMinutes} min walk (straight-line estimate).`);
  }

  return { location, score: Math.round(score), walkMinutes, reasons };
}

function compareRecommendations(a: LocationRecommendation, b: LocationRecommendation): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  const aWalk = a.walkMinutes ?? Number.POSITIVE_INFINITY;
  const bWalk = b.walkMinutes ?? Number.POSITIVE_INFINITY;
  if (aWalk !== bWalk) {
    return aWalk - bWalk;
  }
  // Locale-independent comparison keeps ordering deterministic everywhere.
  return a.location.name < b.location.name ? -1 : a.location.name > b.location.name ? 1 : 0;
}

function assertValidBlock(block: StudyBlockWindow): void {
  if (!DAYS_OF_WEEK.includes(block.day)) {
    throw new RangeError(`Unknown day "${String(block.day)}". Use one of: ${DAYS_OF_WEEK.join(', ')}.`);
  }

  for (const field of ['startMinutes', 'endMinutes'] as const) {
    const value = block[field];
    if (!Number.isInteger(value) || value < 0 || value > 1440) {
      throw new RangeError(`Study block ${field} must be a whole number from 0 to 1440; received ${value}.`);
    }
  }

  if (block.endMinutes <= block.startMinutes) {
    throw new RangeError('Study block must end after it starts (endMinutes > startMinutes).');
  }
}

function assertValidPreferences(preferences: LocationPreferences): void {
  if (
    preferences.maxWalkMinutes !== undefined &&
    (!Number.isFinite(preferences.maxWalkMinutes) || preferences.maxWalkMinutes < 0)
  ) {
    throw new RangeError('maxWalkMinutes must be a non-negative number.');
  }
}

function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}
