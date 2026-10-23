import type { MultiDayScheduleResponse } from '../features/multi-day-schedule/index.ts';
import { buildDailyWindows, campusDateOf } from './scheduleRange.ts';
import type { ScheduleRange } from './scheduleRange.ts';

/**
 * Small, pure state helpers for the multi-day dashboard so the two
 * consistency rules can be tested without a browser.
 */

export interface SelectionResolution {
  /** Surviving selection id, or null when the block no longer exists. */
  id: string | null;
  /** Day the selected block moved to, or null when it disappeared. */
  date: string | null;
}

/**
 * After re-planning, a selection must follow its block to the block's new day,
 * and must be cleared when the block is gone. Returning one object keeps the
 * timeline, result highlight, Where card and recommendation card in lockstep.
 */
export function resolveSelection(
  output: MultiDayScheduleResponse,
  currentId: string | null,
): SelectionResolution {
  if (!currentId) return { id: null, date: null };
  const block = output.result.blocks.find((candidate) => candidate.id === currentId);
  if (!block) return { id: null, date: null };
  return { id: block.id, date: campusDateOf(block.start) };
}

/** Null when the range is usable, otherwise the validation message to show. */
export function rangeError(range: ScheduleRange): string | null {
  try {
    buildDailyWindows(range);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The selected range is not valid.';
  }
}
