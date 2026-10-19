import type { ScheduleRequest, StudyBlock } from '../types.ts';
import {
  AVAILABILITY_DISCLAIMER,
  CAMPUS_LOCATIONS,
  DAYS_OF_WEEK,
  recommendLocations,
} from '../features/campus-locations/index.ts';
import type {
  CampusLocationDetails,
  DayOfWeek,
  LocationRecommendation,
  SimulatedAvailability,
  StudyBlockWindow,
} from '../features/campus-locations/index.ts';
import { CAMPUS_TIME_ZONE, formatOffset } from './format.ts';

/**
 * Turns one scheduled study block into everything the "Where" / recommendation
 * panels need.
 *
 * The scheduler assigns a single location to a block and this module never
 * changes that. What it adds is the list of other campus locations that the
 * shared recommender reports as open for the same block.
 *
 * Time conversion is deliberately strict. The recommender works in whole
 * campus-time minutes on one calendar day, so a block is only convertible when
 * it is minute-aligned, stays inside one local day, and does not span a
 * daylight-saving offset change. Anything else is rejected with a reason the UI
 * can explain, rather than being silently rounded into a claim that the place
 * is open.
 */

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  weekday: 'short',
});

const clockPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Whole days since the epoch for a campus calendar date. */
function calendarDayNumber(iso: string): number {
  const parts = datePartsFormatter.formatToParts(new Date(iso));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return Math.floor(Date.UTC(value('year'), value('month') - 1, value('day')) / 86_400_000);
}

/** Why a block cannot be expressed as a campus-time window. */
export type WindowIssue = 'invalid-range' | 'not-minute-aligned' | 'crosses-dst' | 'crosses-midnight';

export type StudyBlockWindowResult =
  | { ok: true; window: StudyBlockWindow }
  | { ok: false; reason: WindowIssue };

function minuteOfDay(iso: string): number {
  const parts = clockPartsFormatter.formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Campus-time window for the recommender.
 *
 * Rejection rules, in order:
 * - end is not after start, or a timestamp is unparseable -> `invalid-range`
 * - start or end carries seconds/milliseconds -> `not-minute-aligned`
 *   (truncating would claim the place is open for time it does not cover)
 * - the UTC offset differs between start and end -> `crosses-dst`
 *   (wall-clock length would no longer equal real elapsed time)
 * - the two timestamps fall on different campus dates -> `crosses-midnight`
 *
 * A block that sits inside the repeated fall-back hour with the same offset
 * throughout is still a normal window and is accepted.
 */
export function toStudyBlockWindow(startIso: string, endIso: string): StudyBlockWindowResult {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: false, reason: 'invalid-range' };
  }

  if (Math.abs(start % 60_000) !== 0 || Math.abs(end % 60_000) !== 0) {
    return { ok: false, reason: 'not-minute-aligned' };
  }

  if (formatOffset(start) !== formatOffset(end)) {
    return { ok: false, reason: 'crosses-dst' };
  }

  const day = weekdayFormatter.format(new Date(start));
  if (!DAYS_OF_WEEK.includes(day as DayOfWeek)) {
    return { ok: false, reason: 'invalid-range' };
  }

  const startDay = calendarDayNumber(startIso);
  const endDay = calendarDayNumber(endIso);
  const startMinutes = minuteOfDay(startIso);
  let endMinutes = minuteOfDay(endIso);

  if (startDay !== endDay) {
    // Midnight at the end of the start date is representable as 1440 and is not
    // a real midnight crossing.
    const endsAtMidnight = endMinutes === 0 && endDay === startDay + 1;
    if (!endsAtMidnight) return { ok: false, reason: 'crosses-midnight' };
    endMinutes = 1440;
  }

  if (endMinutes <= startMinutes) {
    return { ok: false, reason: 'invalid-range' };
  }

  return { ok: true, window: { day: day as DayOfWeek, startMinutes, endMinutes } };
}

export interface ScheduledLocationView {
  id: string;
  name: string;
  building?: string;
  room?: string;
  hours?: string;
  /** Richer verified record from the campus-locations feature, when one exists. */
  details: CampusLocationDetails | null;
}

export type LocationPlanStatus = 'ok' | 'no-match' | WindowIssue;

export interface LocationPlan {
  /** The location the scheduler put this block in. Never re-assigned here. */
  scheduled: ScheduledLocationView | null;
  /** Canonical id from the verified dataset when known, otherwise the request id. */
  canonicalScheduledId: string | null;
  /**
   * True only when the scheduler's location also appears in the recommendation
   * list, i.e. it passed the open-hours check for this block.
   */
  scheduledIsRecommended: boolean;
  window: StudyBlockWindow | null;
  recommendations: readonly LocationRecommendation[];
  status: LocationPlanStatus;
}

export interface LocationPlanOptions {
  locations?: readonly CampusLocationDetails[];
  availability?: readonly SimulatedAvailability[];
}

export const LOCATION_AVAILABILITY_NOTE = AVAILABILITY_DISCLAIMER;

function findDetails(locationId: string, locations: readonly CampusLocationDetails[]): CampusLocationDetails | null {
  return locations.find((candidate) => candidate.id === locationId) ?? null;
}

/**
 * Fallback for older data that used a different id for the same building
 * (for example `thompson` vs `thompson-library`). Id wins; the name is only a
 * safety net so a mismatched id cannot silently drop the verified record.
 */
function findDetailsByName(
  name: string,
  locations: readonly CampusLocationDetails[],
): CampusLocationDetails | null {
  return locations.find((candidate) => candidate.name === name) ?? null;
}

/**
 * Builds the plan for one block. Never throws: an unusable window or a
 * recommender error degrades to an explanatory status instead of breaking the
 * card, and a block outside every simulated window simply gets no matches.
 */
export function buildLocationPlan(
  block: StudyBlock,
  request: ScheduleRequest,
  options: LocationPlanOptions = {},
): LocationPlan {
  const locations = options.locations ?? CAMPUS_LOCATIONS;
  const assigned = request.locations.find((candidate) => candidate.id === block.locationId);

  const scheduled: ScheduledLocationView | null = assigned
    ? {
        id: assigned.id,
        name: assigned.name,
        building: assigned.building,
        room: assigned.room,
        hours: assigned.hours,
        details: findDetails(assigned.id, locations) ?? findDetailsByName(assigned.name, locations),
      }
    : null;

  const canonicalScheduledId = scheduled?.details?.id ?? scheduled?.id ?? null;
  const windowResult = toStudyBlockWindow(block.start, block.end);

  if (!windowResult.ok) {
    return {
      scheduled,
      canonicalScheduledId,
      scheduledIsRecommended: false,
      window: null,
      recommendations: [],
      status: windowResult.reason,
    };
  }

  try {
    const recommendations = recommendLocations(windowResult.window, {}, { locations, availability: options.availability });
    const scheduledIsRecommended =
      canonicalScheduledId !== null &&
      recommendations.some((recommendation) => recommendation.location.id === canonicalScheduledId);

    return {
      scheduled,
      canonicalScheduledId,
      scheduledIsRecommended,
      window: windowResult.window,
      recommendations,
      status: recommendations.length > 0 ? 'ok' : 'no-match',
    };
  } catch {
    return {
      scheduled,
      canonicalScheduledId,
      scheduledIsRecommended: false,
      window: windowResult.window,
      recommendations: [],
      status: 'invalid-range',
    };
  }
}
