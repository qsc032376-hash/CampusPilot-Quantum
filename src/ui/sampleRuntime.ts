import type { ScheduleRequest } from '../types.ts';
import { createDailyWindows } from '../features/multi-day-schedule/index.ts';
import { CAMPUS_LOCATIONS } from '../features/campus-locations/index.ts';
import { toScheduleLocations } from '../features/campus-locations/index.ts';
import { DAY_COUNT_BY_MODE, DEFAULT_END_TIME, DEFAULT_START_TIME, addCalendarDays, campusToday } from './scheduleRange.ts';

/**
 * Runtime demo data.
 *
 * The fixed fixture in `src/sample.ts` stays untouched for deterministic tests.
 * This factory builds a *labelled example* request for the running app so the
 * default seven-day range always contains something, whatever today happens to
 * be. Every title starts with "Example · " and the UI states that these are
 * sample events: they are not real courses and they say nothing about room
 * availability.
 *
 * Dates are derived only from the injected clock and `America/New_York`
 * calendar arithmetic; no date literal is baked in.
 */

export const RUNTIME_SAMPLE_PREFIX = 'Example · ';

/** Minutes after the day's window start, so every instant stays inside the window. */
const CLASS_PLAN: readonly { day: number; startOffset: number; endOffset: number; title: string }[] = [
  { day: 0, startOffset: 30, endOffset: 105, title: 'Lecture' },
  { day: 0, startOffset: 240, endOffset: 315, title: 'Discussion section' },
  { day: 1, startOffset: 60, endOffset: 120, title: 'Laboratory' },
];

const BUSY_PLAN: readonly { day: number; startOffset: number; endOffset: number; title: string }[] = [
  { day: 2, startOffset: 180, endOffset: 240, title: 'Club meeting' },
];

const TASK_PLAN: readonly { day: number; durationMinutes: number; title: string }[] = [
  { day: 1, durationMinutes: 60, title: 'Review lecture notes' },
  { day: 2, durationMinutes: 90, title: 'Practice problem set' },
  { day: 4, durationMinutes: 120, title: 'Reading response' },
];

function atOffset(dayStart: string, offsetMinutes: number): string {
  return new Date(Date.parse(dayStart) + offsetMinutes * 60_000).toISOString();
}

export interface RuntimeSampleOptions {
  /** Window start/end used as the deadline for the last example task. */
  locations?: ScheduleRequest['locations'];
}

/** Builds the labelled example request for the default seven-day range. */
export function createRuntimeSampleRequest(now: Date, options: RuntimeSampleOptions = {}): ScheduleRequest {
  const startDate = addCalendarDays(campusToday(now), 1);
  const dayCount = DAY_COUNT_BY_MODE.week;
  const windows = createDailyWindows({
    startDate,
    dayCount,
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
  });
  const dayStart = (index: number) => windows[Math.min(index, windows.length - 1)].windowStart;
  const dayEnd = (index: number) => windows[Math.min(index, windows.length - 1)].windowEnd;

  const classes = CLASS_PLAN.map((entry, index) => ({
    id: `example-class-${index + 1}`,
    title: `${RUNTIME_SAMPLE_PREFIX}${entry.title}`,
    start: atOffset(dayStart(entry.day), entry.startOffset),
    end: atOffset(dayStart(entry.day), entry.endOffset),
  }));

  const unavailablePeriods = BUSY_PLAN.map((entry, index) => ({
    id: `example-busy-${index + 1}`,
    title: `${RUNTIME_SAMPLE_PREFIX}${entry.title}`,
    start: atOffset(dayStart(entry.day), entry.startOffset),
    end: atOffset(dayStart(entry.day), entry.endOffset),
  }));

  const tasks = TASK_PLAN.map((entry, index) => ({
    id: `example-task-${index + 1}`,
    title: `${RUNTIME_SAMPLE_PREFIX}${entry.title}`,
    durationMinutes: entry.durationMinutes,
    // Deadlines sit at the end of a day in the range, so tasks stay placeable.
    dueAt: dayEnd(entry.day),
  }));

  return {
    windowStart: windows[0].windowStart,
    windowEnd: windows[windows.length - 1].windowEnd,
    classes,
    tasks,
    unavailablePeriods,
    locations: options.locations ?? toScheduleLocations(CAMPUS_LOCATIONS),
  };
}
