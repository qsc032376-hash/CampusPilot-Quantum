import type { ScheduleConflict, ScheduleRequest, ScheduleResponse } from './types.ts';

const MINUTE = 60_000;
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(result)) {
    throw new Error('Timestamps must include a valid date and explicit time zone offset.');
  }
  return result;
}

/** Pure mock: earliest deadline first, then ID; whole tasks in earliest free gaps. */
export function generateMockSchedule(request: ScheduleRequest): ScheduleResponse {
  const start = timestamp(request.windowStart);
  const end = timestamp(request.windowEnd);
  if (end <= start) throw new Error('The scheduling window must end after it starts.');
  const occupied = [...request.classes, ...request.unavailablePeriods].map(event => {
    const interval = { start: timestamp(event.start), end: timestamp(event.end) };
    if (interval.end <= interval.start) throw new Error('Events must have positive duration.');
    return interval;
  });
  const ids = new Set<string>();
  const tasks = request.tasks.map(task => {
    if (ids.has(task.id)) throw new Error('Task IDs must be unique.');
    ids.add(task.id);
    if (!Number.isSafeInteger(task.durationMinutes) || task.durationMinutes <= 0) {
      throw new Error('Task duration must be a positive whole number of minutes.');
    }
    return { ...task, deadline: timestamp(task.dueAt) };
  }).sort((a, b) => a.deadline - b.deadline || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const response: ScheduleResponse = { blocks: [], unscheduledTasks: [] };
  const location = request.locations[0];
  for (const task of tasks) {
    if (!location) {
      response.unscheduledTasks.push({ taskId: task.id, reason: 'No study location supplied.' });
      continue;
    }
    const duration = task.durationMinutes * MINUTE;
    const limit = Math.min(end, task.deadline);
    let candidate = start;
    occupied.sort((a, b) => a.start - b.start);
    for (const interval of occupied) {
      if (interval.end <= candidate) continue;
      if (candidate + duration <= interval.start) break;
      candidate = interval.end;
    }
    if (candidate + duration > limit) {
      response.unscheduledTasks.push({ taskId: task.id, reason: 'No continuous slot before the deadline within this window.' });
      continue;
    }
    occupied.push({ start: candidate, end: candidate + duration });
    response.blocks.push({
      id: `study-${task.id}`, taskId: task.id, title: task.title,
      start: new Date(candidate).toISOString(),
      end: new Date(candidate + duration).toISOString(), locationId: location.id,
    });
  }
  response.blocks.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  // Report only after placement; this never changes occupied intervals or task order.
  const conflicts = findConflicts(request, response.blocks, start, end);
  if (conflicts.length > 0) response.conflicts = conflicts;
  return response;
}

function findConflicts(
  request: ScheduleRequest,
  blocks: ScheduleResponse['blocks'],
  windowStart: number,
  windowEnd: number,
): ScheduleConflict[] {
  const ids = new Set<string>();
  const intervals = [...request.classes, ...request.unavailablePeriods, ...blocks].map(event => {
    if (ids.has(event.id)) throw new Error('Class, unavailable period and study block IDs must be unique across collections.');
    ids.add(event.id);
    return { id: event.id, start: Math.max(windowStart, timestamp(event.start)), end: Math.min(windowEnd, timestamp(event.end)) };
  }).filter(event => event.end > event.start)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const conflicts: ScheduleConflict[] = [];
  for (let first = 0; first < intervals.length; first += 1) {
    for (let second = first + 1; second < intervals.length; second += 1) {
      const a = intervals[first];
      const b = intervals[second];
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (overlap > 0) conflicts.push({ firstId: a.id, secondId: b.id, overlapMinutes: overlap / MINUTE });
    }
  }
  return conflicts;
}
