import { generateSchedule } from '../schedule-intensity/index.ts';
import type { ScheduleIntensity } from '../schedule-intensity/index.ts';
import type { ScheduleRequest, ScheduleResponse, StudyTask } from '../../types.ts';
import { generateOccurrences } from '../recurring-tasks/index.ts';
import type { TaskSeries } from '../recurring-tasks/index.ts';
import { validateDailyWindows } from './windows.ts';
import type { DailyWindow } from './windows.ts';
export { createDailyWindows, SCHEDULE_TIME_ZONE } from './windows.ts';
export type { DailyWindow, DailyWindowOptions } from './windows.ts';
export interface MultiDayScheduleRequest extends Omit<ScheduleRequest, 'windowStart' | 'windowEnd'> {
  windows: DailyWindow[];
  taskSeries?: TaskSeries[];
  intensity?: ScheduleIntensity;
}
export interface DailySchedule extends DailyWindow {
  date: string;
  /** Day-local conflicts; transient placement failures are deliberately not exposed. */
  result: Pick<ScheduleResponse, 'blocks' | 'conflicts'>;
}
export interface MultiDayScheduleResponse {
  /** One-offs followed by freshly generated occurrences; use for title lookup, not as next input. */
  tasks: StudyTask[];
  days: DailySchedule[];
  /** Final failures only; conflicts aggregate elapsed overlap across daily windows. */
  result: ScheduleResponse;
}

/** Personal study planning only. Default location and greedy placement remain owned by the existing scheduler. */
export function generateMultiDaySchedule(request: MultiDayScheduleRequest): MultiDayScheduleResponse {
  const { windows, taskSeries = [], intensity, ...oneOffInput } = request;
  const dates = validateDailyWindows(windows);
  const occurrences = generateOccurrences(taskSeries, windows);
  const tasks = [...oneOffInput.tasks.map(task => ({ ...task })), ...occurrences];
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error('Task and occurrence IDs must be unique.');
    ids.add(task.id);
  }
  const input = { ...oneOffInput, tasks };
  // Omitted/intense preserves the exact existing one-day response and failure wording.
  if (windows.length === 1) {
    const result = generateSchedule({ ...input, ...windows[0] }, { intensity });
    return { tasks, days: [{ ...windows[0], date: dates[0], result: dayResult(result) }], result };
  }
  let remaining = input.tasks;
  const days: DailySchedule[] = [];
  const result: ScheduleResponse = { blocks: [], unscheduledTasks: [] };
  const conflicts = new Map<string, NonNullable<ScheduleResponse['conflicts']>[number]>();
  for (let i = 0; i < windows.length; i += 1) {
    const response = generateSchedule({ ...input, ...windows[i], tasks: remaining }, { intensity });
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
  return { tasks, days, result };
}
function dayResult(result: ScheduleResponse): DailySchedule['result'] {
  return { blocks: result.blocks, ...(result.conflicts ? { conflicts: result.conflicts } : {}) };
}
