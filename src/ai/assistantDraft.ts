import { resolveTaskInput } from '../ui/taskValidation.ts';
import type { TaskDraft } from '../ui/taskValidation.ts';
import type { AssistantDraftTask } from './assistantClient.ts';

export type DraftItem =
  | { ok: true; draft: TaskDraft }
  | { ok: false; title: string; message: string };

export interface DraftPreview {
  items: DraftItem[];
  notes: string[];
  validCount: number;
}

/** Converts an ISO instant into the local input value the form uses. */
export function toLocalInput(iso: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = formatter.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** Runs every candidate task through the same validation the form uses. */
export function previewDraft(
  tasks: AssistantDraftTask[],
  windowStart: string,
): DraftPreview {
  const items: DraftItem[] = tasks.slice(0, 5).map((task) => {
    const result = resolveTaskInput({
      title: task.title,
      duration: String(task.durationMinutes),
      due: toLocalInput(task.dueAt),
      choice: null,
      windowStart,
      priority: task.priority ?? '',
      courseCode: task.courseCode ?? '',
    });
    return result.ok
      ? { ok: true as const, draft: result.draft }
      : { ok: false as const, title: task.title, message: result.message };
  });
  return {
    items,
    notes: [],
    validCount: items.filter((item) => item.ok).length,
  };
}
