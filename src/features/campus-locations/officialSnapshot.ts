import type { DayOfWeek, TimeRange } from './simulatedAvailability.ts';
import type { DataProvenance } from './types.ts';

/**
 * OFFICIAL STATIC SNAPSHOT — not live data.
 *
 * This file records what the official Ohio State pages said on 2026-10-19 for
 * one specific date range. It is deliberately separate from
 * `simulatedAvailability.ts`: the recommender still uses the simulated windows
 * until D integrates this snapshot in a later change.
 *
 * Building hours are not room availability. Where the official pages publish a
 * separate study-space schedule it is included; where they do not, the space is
 * intentionally omitted and marked unverified in `notes`.
 */

export interface HoursSnapshot {
  scope: 'building' | 'service' | 'study-space';
  label: string;
  /** First local date the snapshot applies to, inclusive (YYYY-MM-DD). */
  appliesFrom: string;
  /** Last local date the snapshot applies to, inclusive (YYYY-MM-DD). */
  appliesTo: string;
  timeZone: 'America/New_York';
  weekly: Record<DayOfWeek, readonly TimeRange[]>;
  provenance: DataProvenance;
}

export interface BookingSnapshot {
  eligibility: string;
  rules: string;
  rulesUrl: string;
  provenance: DataProvenance;
}

export interface BuildingAccessSnapshot {
  label: string;
  appliesFrom: string;
  appliesTo: string;
  timeZone: 'America/New_York';
  /** Hours the public can enter without a badge; empty means no public entry recorded. */
  publicEntry: Record<DayOfWeek, readonly TimeRange[]>;
  /** Days for which the official page explicitly requires a badge. */
  badgeRequiredDays: readonly DayOfWeek[];
  provenance: DataProvenance;
  /** What the source does not say, so callers do not infer access rules. */
  note: string;
}

export interface LocationSnapshot {
  locationId: string;
  buildingHours: HoursSnapshot;
  /** Present only when official public building-entry rules were verified. */
  buildingAccess?: BuildingAccessSnapshot;
  /** Present only when official room-specific hours were verified. */
  studySpaceHours?: readonly HoursSnapshot[];
  booking: BookingSnapshot;
  /** Why a field is absent or unverified. */
  notes?: string;
}

export const OFFICIAL_SNAPSHOT_VERIFIED_ON = '2026-10-19';

export const OFFICIAL_SNAPSHOT_DISCLAIMER =
  'Official hours snapshot for the stated date range, not live availability. Building hours do not prove a study room is free or bookable; check the official page before relying on them.';

const LIBRARIES_HOURS_URL = 'https://library.osu.edu/hours';
const HSL_HOURS_URL = 'https://hsl-osu.libcal.com/hours/';
const UNION_HOURS_URL = 'https://ohiounion.osu.edu/visiting/hours';
const LIBRARIES_RULES_URL =
  'https://library.osu.edu/group-study-rooms-for-ohio-state-students-faculty-and-staff';
const HSL_RULES_URL = 'https://hsl.osu.edu/reserve-space/study-rooms';
const UNION_SPACES_URL = 'https://ohiounion.osu.edu/whats-inside/our-spaces';

/** A single contiguous window on one calendar day. End is exclusive. */
const at = (startMinutes: number, endMinutes: number): readonly TimeRange[] => [
  { startMinutes, endMinutes },
];

const closed: readonly TimeRange[] = [];

function official(source: string, sourceUrl: string, note: string): DataProvenance {
  return {
    status: 'official-snapshot',
    source,
    sourceUrl,
    verifiedOn: OFFICIAL_SNAPSHOT_VERIFIED_ON,
    isLive: false,
    note,
  };
}

function unverified(source: string, sourceUrl: string, note: string): DataProvenance {
  return {
    status: 'unverified',
    source,
    sourceUrl,
    verifiedOn: OFFICIAL_SNAPSHOT_VERIFIED_ON,
    isLive: false,
    note,
  };
}

const librariesBooking: BookingSnapshot = {
  eligibility: 'Ohio State students, faculty and staff.',
  rules:
    'Group study rooms; up to 4 hours; request from the same day up to one week ahead; a group more than 15 minutes late forfeits the reservation; unscheduled rooms are walk-in with group priority.',
  rulesUrl: LIBRARIES_RULES_URL,
  provenance: official(
    'Ohio State University Libraries',
    LIBRARIES_RULES_URL,
    'Static booking rules, not live availability. Room availability is only in the official booking UI.',
  ),
};

const hslBooking: BookingSnapshot = {
  eligibility: 'Ohio State students have first priority.',
  rules:
    'Third-floor study rooms; up to 5 people; 2-hour reservations; up to 3 days ahead; online or by phone; reservations may be released if unoccupied after 10 minutes; Extended Library Access hours are first-come and not reservable.',
  rulesUrl: HSL_RULES_URL,
  provenance: official(
    'Ohio State University Health Sciences Library',
    HSL_RULES_URL,
    'Static booking rules, not live availability. Room availability is only in the LibCal UI.',
  ),
};

const unionBooking: BookingSnapshot = {
  eligibility: 'Not verified for individual study rooms.',
  rules:
    'The listed rooms are event/meeting spaces handled by Student Life Event Services. No individual study-room booking entry point was verified; this does not prove that none exists.',
  rulesUrl: UNION_SPACES_URL,
  provenance: unverified(
    'Ohio State University Office of Student Life',
    UNION_SPACES_URL,
    'No individual study-room booking entry point was found on the official pages. This is not proof that none exists.',
  ),
};

export const OFFICIAL_LOCATION_SNAPSHOTS: readonly LocationSnapshot[] = [
  {
    locationId: 'thompson-library',
    buildingHours: {
      scope: 'building',
      label: 'Thompson Library building hours',
      appliesFrom: '2026-10-18',
      appliesTo: '2026-10-24',
      timeZone: 'America/New_York',
      weekly: {
        Sun: at(660, 1440),
        Mon: at(450, 1440),
        Tue: at(450, 1440),
        Wed: at(450, 1440),
        Thu: at(450, 1440),
        Fri: at(450, 1320),
        Sat: at(480, 1320),
      },
      provenance: official(
        'Ohio State University Libraries',
        LIBRARIES_HOURS_URL,
        'Weekly snapshot for 2026-10-18 to 2026-10-24. Holidays, breaks and exam periods differ; not live.',
      ),
    },
    studySpaceHours: [
      {
        scope: 'study-space',
        label: 'Thompson Group Study Rooms',
        appliesFrom: '2026-10-18',
        appliesTo: '2026-10-24',
        timeZone: 'America/New_York',
        weekly: {
          Sun: at(660, 1410),
          Mon: at(450, 1410),
          Tue: at(450, 1410),
          Wed: at(450, 1410),
          Thu: at(450, 1410),
          Fri: at(450, 1320),
          Sat: at(480, 1320),
        },
        provenance: official(
          'Ohio State University Libraries',
          LIBRARIES_HOURS_URL,
          'Group study room hours are listed separately from building hours; rooms close 30 minutes earlier Sunday-Thursday. Not live.',
        ),
      },
    ],
    booking: librariesBooking,
    notes:
      'Building hours are not room availability. Group study rooms close at 23:30 Sunday-Thursday while the building remains open until 24:00.',
  },
  {
    locationId: '18th-avenue-library',
    buildingHours: {
      scope: 'building',
      label: '18th Avenue Library building hours',
      appliesFrom: '2026-10-18',
      appliesTo: '2026-10-24',
      timeZone: 'America/New_York',
      weekly: {
        Sun: at(450, 1440),
        Mon: at(0, 1440),
        Tue: at(0, 1440),
        Wed: at(0, 1440),
        Thu: at(0, 1440),
        Fri: at(0, 1439),
        Sat: at(450, 1440),
      },
      provenance: official(
        'Ohio State University Libraries',
        LIBRARIES_HOURS_URL,
        'Weekly snapshot for 2026-10-18 to 2026-10-24. The page says Friday closes at 11:59 p.m., so the end is stored as 1439 (23:59); the 23:59-24:00 minute is outside the window. Not live.',
      ),
    },
    booking: librariesBooking,
    notes:
      'The hours page lists 18th Group Study Rooms separately, but the full weekly room row was not captured. studySpaceHours is intentionally omitted; building 24-hour access is not room availability.',
  },
  {
    locationId: 'health-sciences-library',
    buildingHours: {
      scope: 'service',
      label: 'Health Sciences Library service hours',
      appliesFrom: '2026-10-19',
      appliesTo: '2026-10-25',
      timeZone: 'America/New_York',
      weekly: {
        Sun: at(720, 1170),
        Mon: at(450, 1170),
        Tue: at(450, 1170),
        Wed: at(450, 1170),
        Thu: at(450, 1170),
        Fri: at(450, 1050),
        Sat: at(600, 1050),
      },
      provenance: official(
        'Ohio State University Health Sciences Library',
        HSL_HOURS_URL,
        'Library service hours for 2026-10-19 to 2026-10-25 from LibCal. These are not Prior Hall public building-access hours. Not live.',
      ),
    },
    buildingAccess: {
      label: 'Prior Hall public entry',
      appliesFrom: '2026-10-19',
      appliesTo: '2026-10-25',
      timeZone: 'America/New_York',
      publicEntry: {
        Sun: closed,
        Mon: at(450, 1050),
        Tue: at(450, 1050),
        Wed: at(450, 1050),
        Thu: at(450, 1050),
        Fri: at(450, 1050),
        Sat: closed,
      },
      badgeRequiredDays: ['Sat', 'Sun'],
      provenance: official(
        'Ohio State University Health Sciences Library',
        'https://hsl.osu.edu/using-library/visit/location-hours-and-parking',
        'Prior Hall public access: Monday-Friday 7:30-17:30; weekends and university holidays require badge swipe. Snapshot week; not live.',
      ),
      note: 'Public entry after 17:30 on weekdays is not explicitly described on the page. Library service hours continue to 19:30 Monday-Thursday; do not infer building access from them.',
    },
    booking: hslBooking,
    notes:
      'Library service hours and Prior Hall public entry are separate; see buildingAccess. LibCal has a Study Room Hours row, but every day is a dash (hours not published), so studySpaceHours is omitted and room-level hours remain unverified; use the LibCal calendar.',
  },
  {
    locationId: 'faes-library',
    buildingHours: {
      scope: 'building',
      label: 'FAES Library building hours',
      appliesFrom: '2026-10-18',
      appliesTo: '2026-10-24',
      timeZone: 'America/New_York',
      weekly: {
        Sun: closed,
        Mon: at(480, 1080),
        Tue: at(480, 1080),
        Wed: at(480, 1080),
        Thu: at(480, 1080),
        Fri: at(480, 1020),
        Sat: closed,
      },
      provenance: official(
        'Ohio State University Libraries',
        LIBRARIES_HOURS_URL,
        'Weekly snapshot for 2026-10-18 to 2026-10-24. Holidays and breaks differ; not live.',
      ),
    },
    booking: librariesBooking,
    notes:
      'No separate FAES group study room hours were published on the hours page. studySpaceHours is omitted; room availability is only in the Libraries booking UI and was not verified.',
  },
  {
    locationId: 'ohio-union',
    buildingHours: {
      scope: 'building',
      label: 'Ohio Union regular building hours',
      appliesFrom: '2026-10-19',
      appliesTo: '2026-10-25',
      timeZone: 'America/New_York',
      weekly: {
        Sun: at(600, 1380),
        Mon: at(480, 1380),
        Tue: at(480, 1380),
        Wed: at(480, 1380),
        Thu: at(480, 1380),
        Fri: at(480, 1380),
        Sat: at(600, 1380),
      },
      provenance: official(
        'Ohio State University Office of Student Life',
        UNION_HOURS_URL,
        'Regular fall/spring term hours for the snapshot week 2026-10-19 to 2026-10-25. Academic breaks, holidays and summer differ; not live.',
      ),
    },
    booking: unionBooking,
    notes:
      'Building hours are not study-room availability. No individual study-room booking entry point was verified; the listed rooms are event spaces.',
  },
];
