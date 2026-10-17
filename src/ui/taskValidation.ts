import type { StudyTask } from '../types.ts';
import { parseCampusInput } from './format.ts';

export type TaskPriority = NonNullable<StudyTask['priority']>;

export interface TaskDraft {
  title: string;
  durationMinutes: number;
  dueAt: string;
  /** Optional display metadata; never affects scheduling order. */
  priority?: TaskPriority;
  courseCode?: string;
}

/** A repeat-hour pick, remembered together with the input it was made for. */
export interface PendingChoice {
  due: string;
  iso: string;
}

export type TaskInputResult = { ok: true; draft: TaskDraft } | { ok: false; message: string };

export const MAX_TITLE_LENGTH = 80;
export const MAX_DURATION_MINUTES = 600;
export const MAX_COURSE_CODE_LENGTH = 12;
export const PRIORITY_VALUES: TaskPriority[] = ['low', 'medium', 'high'];

interface TaskInput {
  title: string;
  duration: string;
  due: string;
  choice: PendingChoice | null;
  windowStart: string;
  priority?: string;
  courseCode?: string;
}

/**
 * Turns raw form fields into a task, or into the reason it cannot be added.
 *
 * A campus wall time that happens twice (fall-back) is never resolved
 * implicitly: the caller must pass a choice that was made for this exact input.
 * A choice made for a previous deadline is stale and ignored, so editing the
 * deadline can never reuse the wrong offset. Priority and course code are
 * optional display metadata and never change scheduling order.
 */
export function resolveTaskInput({
  title,
  duration,
  due,
  choice,
  windowStart,
  priority,
  courseCode,
}: TaskInput): TaskInputResult {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { ok: false, message: 'Give the task a short title.' };
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: `Keep the title under ${MAX_TITLE_LENGTH} characters.` };
  }

  const minutes = Number(duration);
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) {
    return {
      ok: false,
      message: `Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MINUTES}.`,
    };
  }

  const trimmedCourse = (courseCode ?? '').trim();
  if (trimmedCourse.length > MAX_COURSE_CODE_LENGTH) {
    return { ok: false, message: `Keep the course code under ${MAX_COURSE_CODE_LENGTH} characters.` };
  }

  const trimmedPriority = (priority ?? '').trim();
  if (trimmedPriority && !PRIORITY_VALUES.includes(trimmedPriority as TaskPriority)) {
    return { ok: false, message: 'Choose a priority of low, medium, high, or none.' };
  }

  const parsed = parseCampusInput(due);
  if (parsed.status === 'invalid') return { ok: false, message: parsed.message };
  if (parsed.status === 'nonexistent') return { ok: false, message: parsed.message };

  let dueAt: string;
  if (parsed.status === 'ambiguous') {
    const usable = choice !== null && choice.due === due && parsed.options.some((option) => option.iso === choice.iso);
    if (!usable) {
      const zones = parsed.options.map((option) => option.label).join('  /  ');
      return {
        ok: false,
        message: `That time happens twice in New York. Choose which one before adding: ${zones}`,
      };
    }
    dueAt = choice.iso;
  } else {
    dueAt = parsed.iso;
  }

  if (Date.parse(dueAt) <= Date.parse(windowStart)) {
    return { ok: false, message: 'The deadline must be after the scheduling window starts.' };
  }

  return {
    ok: true,
    draft: {
      title: trimmedTitle,
      durationMinutes: minutes,
      dueAt,
      ...(trimmedPriority ? { priority: trimmedPriority as TaskPriority } : {}),
      ...(trimmedCourse ? { courseCode: trimmedCourse } : {}),
    },
  };
}
