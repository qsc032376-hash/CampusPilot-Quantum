import { createDailyWindows } from '../features/multi-day-schedule/index.ts';
import type { DailyWindow } from '../features/multi-day-schedule/index.ts';
import { CAMPUS_TIME_ZONE } from './format.ts';

/**
 * Schedule range helpers.
 *
 * All campus dates come from Intl with an explicit America/New_York time zone and
 * are resolved into instants by A's `createDailyWindows`. Nothing here
 * re-implements time-zone or DST conversion: `addCalendarDays` only moves a
 * YYYY-MM-DD calendar label, using UTC purely as a date container.
 */

export interface ScheduleRange {
  /** Consecutive New York calendar days, 1 through 30. */
  dayCount: number;
  /** New York calendar date, YYYY-MM-DD. */
  startDate: string;
  /** HH:mm, campus local clock. */
  startTime: string;
  endTime: string;
}

export const MIN_DAY_COUNT = 1;
export const MAX_DAY_COUNT = 30;
export const DEFAULT_DAY_COUNT = 7;
export const DAY_COUNT_PRESETS: readonly number[] = [1, 7, 14, 30];
export const DEFAULT_START_TIME = '09:00';
export const DEFAULT_END_TIME = '17:00';

const campusDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in New York, independent of the host time zone. */
export function campusToday(now: Date): string {
  return campusDateOf(now.toISOString());
}

/** New York calendar date of an ISO instant. */
export function campusDateOf(iso: string): string {
  const parts = campusDateFormatter.formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Calendar arithmetic on YYYY-MM-DD; not an instant conversion. */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('Expected a YYYY-MM-DD calendar date.');
  }
  const base = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(base)) throw new Error('Expected a valid calendar date.');
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Clamps a requested day count into the supported 1-30 range. */
export function clampDayCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAY_COUNT;
  return Math.min(MAX_DAY_COUNT, Math.max(MIN_DAY_COUNT, Math.trunc(value)));
}

/** Default demo range: seven days starting tomorrow in New York. */
export function defaultScheduleRange(now: Date): ScheduleRange {
  return {
    dayCount: DEFAULT_DAY_COUNT,
    startDate: addCalendarDays(campusToday(now), 1),
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
  };
}

/** Candidate dates in the range, derived from the range start. */
export function rangeDates(range: ScheduleRange): string[] {
  const count = clampDayCount(range.dayCount);
  return Array.from({ length: count }, (_, index) => addCalendarDays(range.startDate, index));
}

export function buildDailyWindows(range: ScheduleRange): DailyWindow[] {
  return createDailyWindows({
    startDate: range.startDate,
    dayCount: clampDayCount(range.dayCount),
    startTime: range.startTime,
    endTime: range.endTime,
  });
}

export function rangeDayCountLabel(range: ScheduleRange): string {
  const count = clampDayCount(range.dayCount);
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}
