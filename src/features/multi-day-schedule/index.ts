import { generateMockSchedule } from '../../scheduler.ts';
import type { ScheduleRequest, ScheduleResponse } from '../../types.ts';

export const SCHEDULE_TIME_ZONE = 'America/New_York';
export interface DailyWindow { windowStart: string; windowEnd: string }
export interface DailyWindowOptions {
  /** New York calendar date, YYYY-MM-DD. Caller chooses the future start date. */
  startDate: string;
  dayCount?: number;
  startTime?: string;
  endTime?: string;
}
export interface MultiDayScheduleRequest extends Omit<ScheduleRequest, 'windowStart' | 'windowEnd'> {
  windows: DailyWindow[];
}
export interface DailySchedule extends DailyWindow {
  date: string;
  /** Day-local conflicts; transient placement failures are deliberately not exposed. */
  result: Pick<ScheduleResponse, 'blocks' | 'conflicts'>;
}
export interface MultiDayScheduleResponse {
  days: DailySchedule[];
  /** Final failures only; conflicts aggregate elapsed overlap across daily windows. */
  result: ScheduleResponse;
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function localParts(ms: number) {
  const parts = formatter.formatToParts(ms);
  const get = (name: string) => parts.find(p => p.type === name)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, second: get('second') };
}
function calendarDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected YYYY-MM-DD.');
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date.');
  return ms;
}
function nextDate(date: string): string {
  // UTC is used only as a calendar arithmetic container, never as a campus instant.
  const value = new Date(calendarDate(date));
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
function countCheck(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 7) throw new Error('Provide 1 to 7 consecutive days.');
}
function clockCheck(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Expected HH:mm from 00:00 to 23:59.');
}
function resolveWall(date: string, time: string): string {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const instant = wall + delta;
    const p = localParts(instant);
    offsets.add(Date.parse(`${p.date}T${p.time}:${p.second}Z`) - instant);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(ms => {
    const p = localParts(ms);
    return p.date === date && p.time === time;
  });
  if (candidates.length !== 1) {
    throw new Error(`${date} ${time} is ${candidates.length ? 'ambiguous' : 'nonexistent'} in ${SCHEDULE_TIME_ZONE}; choose another time or provide explicit-offset windows.`);
  }
  return new Date(candidates[0]).toISOString();
}

/** Pure calendar generation; no clock, booking policy, or availability lookup. */
export function createDailyWindows({ startDate, dayCount = 7, startTime = '09:00', endTime = '17:00' }: DailyWindowOptions): DailyWindow[] {
  calendarDate(startDate);
  countCheck(dayCount);
  clockCheck(startTime);
  clockCheck(endTime);
  if (endTime <= startTime) throw new Error('Daily hours must end after they start; overnight windows are unsupported.');
  const windows: DailyWindow[] = [];
  let date = startDate;
  for (let day = 0; day < dayCount; day += 1) {
    windows.push({ windowStart: resolveWall(date, startTime), windowEnd: resolveWall(date, endTime) });
    if (day + 1 < dayCount) date = nextDate(date);
  }
  return windows;
}
function instant(value: string): number {
  const ms = Date.parse(value);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(ms)) throw new Error('Window timestamps require an explicit offset.');
  if (ms % 60000 !== 0) throw new Error('Daily windows must use whole minutes.');
  return ms;
}
function validateWindows(windows: DailyWindow[]): string[] {
  countCheck(windows.length);
  const dates: string[] = [];
  for (const window of windows) {
    const start = instant(window.windowStart);
    const end = instant(window.windowEnd);
    const a = localParts(start);
    const b = localParts(end);
    if (end <= start || a.date !== b.date || a.time >= b.time) throw new Error('Each window must have increasing hours within one New York date.');
    if (dates.length && a.date !== nextDate(dates[dates.length - 1])) throw new Error('Daily windows must be ordered consecutive New York dates.');
    dates.push(a.date);
  }
  return dates;
}

/** Personal study planning only. Default location and greedy placement remain owned by the existing scheduler. */
export function generateMultiDaySchedule(request: MultiDayScheduleRequest): MultiDayScheduleResponse {
  const { windows, ...input } = request;
  const dates = validateWindows(windows);
  // Exact existing response (including omitted conflicts and failure wording) for one day.
  if (windows.length === 1) {
    const result = generateMockSchedule({ ...input, ...windows[0] });
    return { days: [{ ...windows[0], date: dates[0], result: dayResult(result) }], result };
  }
  let remaining = input.tasks;
  const days: DailySchedule[] = [];
  const result: ScheduleResponse = { blocks: [], unscheduledTasks: [] };
  const conflicts = new Map<string, NonNullable<ScheduleResponse['conflicts']>[number]>();
  for (let i = 0; i < windows.length; i += 1) {
    const response = generateMockSchedule({ ...input, ...windows[i], tasks: remaining });
    days.push({ ...windows[i], date: dates[i], result: dayResult(response) });
    result.blocks.push(...response.blocks);
    const placed = new Set(response.blocks.map(block => block.taskId));
    remaining = remaining.filter(task => !placed.has(task.id));
    for (const conflict of response.conflicts ?? []) {
      const key = JSON.stringify([conflict.firstId, conflict.secondId]);
      const previous = conflicts.get(key);
      conflicts.set(key, { ...conflict, overlapMinutes: conflict.overlapMinutes + (previous?.overlapMinutes ?? 0) });
    }
    if (i === windows.length - 1) result.unscheduledTasks = response.unscheduledTasks.map(item => ({
      ...item,
      reason: item.reason === 'No continuous slot before the deadline within this window.'
        ? 'No continuous slot before the deadline within the selected daily windows.' : item.reason,
    }));
  }
  if (conflicts.size) result.conflicts = [...conflicts.values()].sort((a, b) =>
    a.firstId < b.firstId ? -1 : a.firstId > b.firstId ? 1 : a.secondId < b.secondId ? -1 : a.secondId > b.secondId ? 1 : 0);
  return { days, result };
}
function dayResult(result: ScheduleResponse): DailySchedule['result'] {
  return { blocks: result.blocks, ...(result.conflicts ? { conflicts: result.conflicts } : {}) };
}
