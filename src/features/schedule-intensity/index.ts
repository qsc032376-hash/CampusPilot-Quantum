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
  if (intensity === 'intense' || result.blocks.length === 0) return result;
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
  // fixed. Classes and unavailable periods are not rest: passing one restarts
  // the 15-minute target after it ends, and a block that fits before one is
  // pulled earlier when that keeps the buffer without breaking its release
  // time. The target is soft, so a tight day keeps deadlines over breaks.
  for (let i = 0; i < blocks.length; i += 1) {
    const original = Date.parse(blocks[i].start);
    // The first block only has the window start behind it; later blocks also
    // have to keep the break from the previous study block.
    const previousEnd = i === 0 ? Date.parse(request.windowStart) : Date.parse(blocks[i - 1].end);
    // A block may never start before its own release time, even when moving
    // earlier would buy the pre-class buffer.
    const released = tasks.get(blocks[i].taskId)!.notBefore;
    const release = released === undefined ? Date.parse(request.windowStart) : Date.parse(released);
    const floor = Math.max(release, i === 0 ? previousEnd : previousEnd + BREAK_MS);
    let candidate = Math.max(original, floor);
    for (const obstacle of obstacles) {
      // Only events that finished strictly before the previous block are
      // irrelevant; one that ends exactly at it still resets the break.
      if (obstacle.end < previousEnd) continue;
      if (obstacle.start >= candidate + durations[i]) {
        // The block fits before the event but would sit right against it; pull
        // it earlier when that is allowed and buys the buffer.
        const earlier = obstacle.start - durations[i] - BREAK_MS;
        if (candidate + durations[i] + BREAK_MS > obstacle.start && earlier >= floor && earlier < candidate) {
          candidate = earlier;
        }
        break;
      }
      // A class is not rest. Passing one moves the block to a full break after
      // the class ends instead of starting the moment it lets out.
      candidate = Math.max(candidate, obstacle.end + BREAK_MS);
    }
    candidate = Math.min(candidate, latest[i]);
    blocks[i].start = new Date(candidate).toISOString();
    blocks[i].end = new Date(candidate + durations[i]).toISOString();
  }
  // Existing conflict pairs involve fixed events: the baseline study blocks
  // avoid those events, and the adjusted blocks still do. Failure text is kept.
  return { ...result, blocks };
}
