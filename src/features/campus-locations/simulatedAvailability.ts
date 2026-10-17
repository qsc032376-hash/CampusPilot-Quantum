/**
 * SIMULATED availability — NOT live data.
 *
 * These weekly windows were typed by hand for the MVP so the recommender has
 * something to rank. They are not fetched from Ohio State systems, not checked
 * against today's calendar, and do not know about holidays, fall break, exams
 * or summer hours. Every record carries `source: 'simulated'` so the UI can
 * label it.
 *
 * Where a window is based on a published page, the note says so. Even then it
 * is static: the page may have changed and holidays are not handled.
 *
 * Every window belongs to one calendar day. A window cannot cross midnight;
 * early-morning hours (e.g. 02:00-04:00) are part of that day's window.
 */

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export const DAYS_OF_WEEK: readonly DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface TimeRange {
  /** Minutes after midnight, inclusive. 8:00 a.m. = 480. */
  startMinutes: number;
  /** Minutes after midnight, exclusive. 1440 means end of day. */
  endMinutes: number;
}

export interface SimulatedAvailability {
  locationId: string;
  /** Always 'simulated' — kept as a field so the UI cannot lose the label. */
  source: 'simulated';
  /** How the windows were produced, and what they do not know. */
  note: string;
  weekly: Record<DayOfWeek, readonly TimeRange[]>;
}

export const AVAILABILITY_DISCLAIMER =
  'Availability is simulated for the MVP: hand-entered weekly windows, not live data. Confirm hours and room availability on the official page before relying on them.';

/** Reused empty value for closed days. */
const CLOSED: readonly TimeRange[] = [];

export const SIMULATED_AVAILABILITY: readonly SimulatedAvailability[] = [
  {
    locationId: 'thompson-library',
    source: 'simulated',
    note: 'Hand-entered fall-term estimate. Holidays and exam-period hours are not handled.',
    weekly: {
      Mon: [{ startMinutes: 450, endMinutes: 1380 }],
      Tue: [{ startMinutes: 450, endMinutes: 1380 }],
      Wed: [{ startMinutes: 450, endMinutes: 1380 }],
      Thu: [{ startMinutes: 450, endMinutes: 1380 }],
      Fri: [{ startMinutes: 450, endMinutes: 1200 }],
      Sat: [{ startMinutes: 540, endMinutes: 1260 }],
      Sun: [{ startMinutes: 600, endMinutes: 1380 }],
    },
  },
  {
    locationId: '18th-avenue-library',
    source: 'simulated',
    note: 'Based on the published term pattern (Sunday 7:30 a.m. through Friday midnight). Not live; break weeks differ.',
    weekly: {
      Mon: [{ startMinutes: 0, endMinutes: 1440 }],
      Tue: [{ startMinutes: 0, endMinutes: 1440 }],
      Wed: [{ startMinutes: 0, endMinutes: 1440 }],
      Thu: [{ startMinutes: 0, endMinutes: 1440 }],
      Fri: [{ startMinutes: 0, endMinutes: 1440 }],
      Sat: [{ startMinutes: 450, endMinutes: 1440 }],
      Sun: [{ startMinutes: 450, endMinutes: 1440 }],
    },
  },
  {
    locationId: 'health-sciences-library',
    source: 'simulated',
    note: 'Hand-entered estimate. The LibCal booking page is the source of truth for real room availability.',
    weekly: {
      Mon: [{ startMinutes: 480, endMinutes: 1200 }],
      Tue: [{ startMinutes: 480, endMinutes: 1200 }],
      Wed: [{ startMinutes: 480, endMinutes: 1200 }],
      Thu: [{ startMinutes: 480, endMinutes: 1200 }],
      Fri: [{ startMinutes: 480, endMinutes: 1200 }],
      Sat: [{ startMinutes: 600, endMinutes: 1080 }],
      Sun: [{ startMinutes: 720, endMinutes: 1200 }],
    },
  },
  {
    locationId: 'faes-library',
    source: 'simulated',
    note: 'Hand-entered weekday estimate; the library is treated as closed on weekends. Not live.',
    weekly: {
      Mon: [{ startMinutes: 480, endMinutes: 1020 }],
      Tue: [{ startMinutes: 480, endMinutes: 1020 }],
      Wed: [{ startMinutes: 480, endMinutes: 1020 }],
      Thu: [{ startMinutes: 480, endMinutes: 1020 }],
      Fri: [{ startMinutes: 480, endMinutes: 1020 }],
      Sat: CLOSED,
      Sun: CLOSED,
    },
  },
  {
    locationId: 'ohio-union',
    source: 'simulated',
    note: 'Based on the published regular building hours (Mon-Fri 8 a.m.-11 p.m., weekends 10 a.m.-11 p.m.). Academic breaks and holidays differ.',
    weekly: {
      Mon: [{ startMinutes: 480, endMinutes: 1380 }],
      Tue: [{ startMinutes: 480, endMinutes: 1380 }],
      Wed: [{ startMinutes: 480, endMinutes: 1380 }],
      Thu: [{ startMinutes: 480, endMinutes: 1380 }],
      Fri: [{ startMinutes: 480, endMinutes: 1380 }],
      Sat: [{ startMinutes: 600, endMinutes: 1380 }],
      Sun: [{ startMinutes: 600, endMinutes: 1380 }],
    },
  },
];
