import { normalizeTaskLocation } from '../task-locations/index.ts';
import type { StudyTask } from '../../types.ts';
import { calendarDate, validateDailyWindows } from '../multi-day-schedule/windows.ts';
import type { DailyWindow } from '../multi-day-schedule/windows.ts';

/** ISO weekday: Monday=1 through Sunday=7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RecurrenceRule =
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekly'; interval: number; weekdays: IsoWeekday[] };
export interface TaskSeries {
  id: string;
  title: string;
  durationMinutes: number;
  startDate: string;
  /** Inclusive New York date. Omission means no series end, not unbounded expansion. */
  endDate?: string;
  rule: RecurrenceRule;
  priority?: StudyTask['priority'];
  courseCode?: string;
  location?: StudyTask['location'];
}
export interface TaskOccurrence extends StudyTask {
  notBefore: string;
  seriesId: string;
  occurrenceDate: string;
}

export function validateRule(rule: RecurrenceRule): void {
  if (!rule || (rule.frequency !== 'daily' && rule.frequency !== 'weekly')) {
    throw new Error('Only daily and weekly recurrence is supported.');
  }
  if (!Number.isSafeInteger(rule.interval) || rule.interval < 1) {
    throw new Error('Recurrence interval must be a positive safe integer.');
  }
  if (rule.frequency === 'weekly') {
    if (!Array.isArray(rule.weekdays) || !rule.weekdays.length ||
        rule.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) ||
        new Set(rule.weekdays).size !== rule.weekdays.length) {
      throw new Error('Weekly recurrence requires unique ISO weekdays from 1 to 7.');
    }
  }
}
export function validateTaskSeries(series: TaskSeries): void {
  if (typeof series.id !== 'string' || !series.id.trim() ||
      typeof series.title !== 'string' || !series.title.trim()) throw new Error('Series ID and title are required.');
  if (!Number.isSafeInteger(series.durationMinutes) || series.durationMinutes <= 0) {
    throw new Error('Series duration must be a positive whole number of minutes.');
  }
  const start = calendarDate(series.startDate);
  if (series.endDate !== undefined && calendarDate(series.endDate) < start) {
    throw new Error('Series end date cannot precede start date.');
  }
  normalizeTaskLocation(series.location);
  validateRule(series.rule);
}
const DAY = 86_400_000;
function isoDay(calendarMs: number): number {
  return new Date(calendarMs).getUTCDay() || 7;
}
/**
 * Expand only the supplied New York calendar-date labels (at most 30).
 * UTC numbers here represent calendar labels, never actual New York instants.
 * Weekly intervals are anchored to Monday of the start date's ISO week.
 */
export function expandRecurrenceDates(series: TaskSeries, dates: readonly string[]): string[] {
  validateTaskSeries(series);
  if (dates.length > 30) throw new Error('Expand at most 30 dates.');
  const numbers = dates.map(calendarDate);
  if (new Set(dates).size !== dates.length) throw new Error('Expansion dates must be unique.');
  const start = calendarDate(series.startDate);
  const anchorMonday = start - (isoDay(start) - 1) * DAY;
  return numbers.filter(day => {
    if (day < start || (series.endDate !== undefined && day > calendarDate(series.endDate))) return false;
    const rule = series.rule;
    if (rule.frequency === 'daily') return ((day - start) / DAY) % rule.interval === 0;
    const monday = day - (isoDay(day) - 1) * DAY;
    return ((monday - anchorMonday) / (7 * DAY)) % rule.interval === 0 &&
      rule.weekdays.includes(isoDay(day) as IsoWeekday);
  }).sort((a, b) => a - b).map(day => new Date(day).toISOString().slice(0, 10));
}
/** Fresh occurrences only. Never mutates/accumulates tasks or infers room availability. */
export function generateOccurrences(seriesList: readonly TaskSeries[], windows: DailyWindow[]): TaskOccurrence[] {
  const dates = validateDailyWindows(windows);
  const byDate = new Map(dates.map((date, i) => [date, windows[i]]));
  const ids = new Set<string>();
  const occurrences: TaskOccurrence[] = [];
  for (const series of seriesList) {
    validateTaskSeries(series);
    if (ids.has(series.id)) throw new Error('Series IDs must be unique.');
    ids.add(series.id);
    const location = normalizeTaskLocation(series.location);
    for (const date of expandRecurrenceDates(series, dates)) {
      const window = byDate.get(date)!;
      occurrences.push({
        id: `${series.id}@${date}`,
        title: series.title,
        durationMinutes: series.durationMinutes,
        dueAt: window.windowEnd,
        notBefore: window.windowStart,
        seriesId: series.id,
        occurrenceDate: date,
        ...(location !== undefined ? { location: { ...location } } : {}),
        ...(series.priority !== undefined ? { priority: series.priority } : {}),
        ...(series.courseCode !== undefined ? { courseCode: series.courseCode } : {}),
      });
    }
  }
  return occurrences.sort((a, b) => a.occurrenceDate < b.occurrenceDate ? -1 : a.occurrenceDate > b.occurrenceDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
