import { createDailyWindows } from '../features/multi-day-schedule/index.ts';
import type { DailyWindow } from '../features/multi-day-schedule/index.ts';
import { CAMPUS_TIME_ZONE } from './format.ts';

/**
 * Schedule range helpers.
 *
 * All campus dates are derived through Intl with an explicit America/New_York
 * time zone and resolved into instants by A's `createDailyWindows`. Nothing here
 * re-implements time-zone or DST conversion: `addCalendarDays` only moves a
 * YYYY-MM-DD calendar label forward, using UTC purely as a date container.
 */

export type ScheduleRangeMode = 'single' | 'week';

export interface ScheduleRange {
  mode: ScheduleRangeMode;
  /** New York calendar date, YYYY-MM-DD. */
  startDate: string;
  /** HH:mm, campus local clock. */
  startTime: string;
  endTime: string;
}

export const DAY_COUNT_BY_MODE: Record<ScheduleRangeMode, number> = { single: 1, week: 7 };
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

/** Default demo range: seven days starting tomorrow in New York. */
export function defaultScheduleRange(now: Date): ScheduleRange {
  return {
    mode: 'week',
    startDate: addCalendarDays(campusToday(now), 1),
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
  };
}

export function dayCountFor(mode: ScheduleRangeMode): number {
  return DAY_COUNT_BY_MODE[mode];
}

/** Candidate dates in the range, derived from the range start. */
export function rangeDates(range: ScheduleRange): string[] {
  const count = dayCountFor(range.mode);
  return Array.from({ length: count }, (_, index) => addCalendarDays(range.startDate, index));
}

export function buildDailyWindows(range: ScheduleRange): DailyWindow[] {
  return createDailyWindows({
    startDate: range.startDate,
    dayCount: dayCountFor(range.mode),
    startTime: range.startTime,
    endTime: range.endTime,
  });
}

export function rangeDayCountLabel(range: ScheduleRange): string {
  return range.mode === 'single' ? '1 day' : '7 days';
}
