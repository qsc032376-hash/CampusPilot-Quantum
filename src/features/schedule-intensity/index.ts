import { generateMockSchedule } from '../../scheduler.ts';
import type { ScheduleRequest, ScheduleResponse } from '../../types.ts';

export type ScheduleIntensity = 'relaxed' | 'intense';
export interface ScheduleIntensityOptions { intensity?: ScheduleIntensity }
const BREAK_MS = 15 * 60_000;

/** Personal planning only. Omission preserves the original scheduler exactly. */
export function generateSchedule(
  request: ScheduleRequest,
  { intensity = 'intense' }: ScheduleIntensityOptions = {},
): ScheduleResponse {
  if (intensity !== 'relaxed' && intensity !== 'intense') {
    throw new Error('Schedule intensity must be relaxed or intense.');
  }
  const result = generateMockSchedule(request);
  if (intensity === 'intense' || result.blocks.length < 2) return result;
  const obstacles = [...request.classes, ...request.unavailablePeriods]
    .map(event => ({ start: Date.parse(event.start), end: Date.parse(event.end) }))
    .sort((a, b) => a.start - b.start);
  const tasks = new Map(request.tasks.map(task => [task.id, task]));
  const blocks = result.blocks.map(block => ({ ...block }));
  const durations = blocks.map(block => Date.parse(block.end) - Date.parse(block.start));
  const latest: number[] = [];
  let nextStart = Date.parse(request.windowEnd);
  // Reserve enough legal space for every already-placed task, with zero extra
  // breaks. Backward bounds never move a task before its original placement.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const task = tasks.get(blocks[i].taskId)!;
    let candidate = Math.min(nextStart, Date.parse(task.dueAt)) - durations[i];
    for (let j = obstacles.length - 1; j >= 0; j -= 1) {
      const obstacle = obstacles[j];
      if (obstacle.start >= candidate + durations[i]) continue;
      if (obstacle.end <= candidate) continue;
      candidate = obstacle.start - durations[i];
    }
    latest[i] = candidate;
    nextStart = candidate;
  }
  // Prefer earlier chronological breaks. A later break is shortened only when
  // retaining it would lose a baseline task; task order and placement set stay
  // fixed. Natural elapsed gaps count toward the same 15-minute target.
  for (let i = 1; i < blocks.length; i += 1) {
    const original = Date.parse(blocks[i].start);
    const previousEnd = Date.parse(blocks[i - 1].end);
    let candidate = Math.max(original, previousEnd + BREAK_MS);
    for (const obstacle of obstacles) {
      if (obstacle.end <= candidate) continue;
      if (candidate + durations[i] <= obstacle.start) break;
      candidate = obstacle.end;
    }
    candidate = Math.min(candidate, latest[i]);
    blocks[i].start = new Date(candidate).toISOString();
    blocks[i].end = new Date(candidate + durations[i]).toISOString();
  }
  // Existing conflict pairs involve fixed events: the baseline study blocks
  // avoid those events, and the adjusted blocks still do. Failure text is kept.
  return { ...result, blocks };
}
