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
import { CAMPUS_TIME_ZONE } from './format.ts';

/**
 * Turns one scheduled study block into everything the "Where" card needs.
 *
 * The scheduler assigns a single location to a block and this module never
 * changes that. What it adds is the list of other campus locations that the
 * shared recommender reports as open for the same block, so the UI can show
 * the five verified places instead of just the assigned one.
 *
 * Everything here is pure: no network, no clock reads, no booking.
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

const calendarDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function minuteOfDay(iso: string): number {
  const parts = clockPartsFormatter.formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Campus-time window for the recommender, or null when it cannot be described
 * as a single calendar day (the recommender rejects cross-midnight blocks).
 */
export function toStudyBlockWindow(startIso: string, endIso: string): StudyBlockWindow | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const day = weekdayFormatter.format(new Date(start));
  if (!DAYS_OF_WEEK.includes(day as DayOfWeek)) return null;

  if (calendarDayFormatter.format(new Date(start)) !== calendarDayFormatter.format(new Date(end))) {
    return null;
  }

  const startMinutes = minuteOfDay(startIso);
  const endMinutes = minuteOfDay(endIso);
  if (endMinutes <= startMinutes) return null;

  return { day: day as DayOfWeek, startMinutes, endMinutes };
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

export type LocationPlanStatus = 'ok' | 'no-match' | 'unavailable-window';

export interface LocationPlan {
  /** The location the scheduler put this block in. */
  scheduled: ScheduledLocationView | null;
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
        details: findDetails(assigned.id, locations),
      }
    : null;

  const window = toStudyBlockWindow(block.start, block.end);
  if (!window) {
    return { scheduled, window: null, recommendations: [], status: 'unavailable-window' };
  }

  try {
    const recommendations = recommendLocations(window, {}, { locations, availability: options.availability });
    return {
      scheduled,
      window,
      recommendations,
      status: recommendations.length > 0 ? 'ok' : 'no-match',
    };
  } catch {
    return { scheduled, window, recommendations: [], status: 'unavailable-window' };
  }
}
