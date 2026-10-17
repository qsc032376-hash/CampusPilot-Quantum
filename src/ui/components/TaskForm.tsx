import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { ScheduleRequest } from '../../types.ts';
import { CAMPUS_TIME_ZONE, formatDateTimeWithZone, isoToCampusInput, parseCampusInput } from '../format.ts';
import {
  MAX_COURSE_CODE_LENGTH,
  MAX_DURATION_MINUTES,
  MAX_TITLE_LENGTH,
  PRIORITY_VALUES,
  resolveTaskInput,
} from '../taskValidation.ts';
import type { PendingChoice, TaskDraft } from '../taskValidation.ts';

export type { TaskDraft } from '../taskValidation.ts';

interface TaskFormProps {
  request: ScheduleRequest;
  onAdd: (draft: TaskDraft) => void;
  onRemove: (id: string) => void;
}

/**
 * Collects one study task. Input is validated in resolveTaskInput so the pure
 * scheduler in src/scheduler.ts never receives a value it would reject.
 *
 * A campus wall time that exists twice is never resolved implicitly: the select
 * starts empty, editing the deadline discards any earlier pick, and submitting
 * without a pick is refused.
 */
export function TaskForm({ request, onAdd, onRemove }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('60');
  const [due, setDue] = useState(() => isoToCampusInput(request.windowEnd));
  const [choice, setChoice] = useState<PendingChoice | null>(null);
  const [priority, setPriority] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const preview = parseCampusInput(due);
  const options = preview.status === 'ambiguous' ? preview.options : [];
  const activeChoice = choice !== null && choice.due === due ? choice.iso : '';

  function handleDueChange(value: string) {
    setDue(value);
    setChoice(null);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = resolveTaskInput({
      title,
      duration,
      due,
      choice,
      windowStart: request.windowStart,
      priority,
      courseCode,
    });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setError(null);
    onAdd(result.draft);
    setTitle('');
    setCourseCode('');
    setChoice(null);
  }

  return (
    <section className="cp-panel" aria-labelledby={`${fieldId}-heading`}>
      <div className="cp-panel__head">
        <h2 id={`${fieldId}-heading`}>Add a study task</h2>
        <p className="cp-panel__meta">All times are {CAMPUS_TIME_ZONE}.</p>
      </div>

      <form className="cp-form" onSubmit={handleSubmit} noValidate>
        <label className="cp-field">
          <span className="cp-field__label">Task</span>
          <input
            className="cp-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Review lecture notes"
            maxLength={MAX_TITLE_LENGTH + 20}
            autoComplete="off"
          />
        </label>

        <div className="cp-field-row">
          <label className="cp-field">
            <span className="cp-field__label">Minutes</span>
            <input
              className="cp-input"
              type="number"
              min={1}
              max={MAX_DURATION_MINUTES}
              step={15}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>

          <label className="cp-field">
            <span className="cp-field__label">Due ({CAMPUS_TIME_ZONE})</span>
            <input
              className="cp-input"
              type="datetime-local"
              value={due}
              onChange={(event) => handleDueChange(event.target.value)}
            />
          </label>
        </div>

        <div className="cp-field-row cp-field-row--split">
          <label className="cp-field">
            <span className="cp-field__label">Course code (optional)</span>
            <input
              className="cp-input"
              value={courseCode}
              onChange={(event) => setCourseCode(event.target.value)}
              placeholder="CSE 201"
              maxLength={MAX_COURSE_CODE_LENGTH}
              autoComplete="off"
            />
          </label>

          <label className="cp-field">
            <span className="cp-field__label">Priority (optional)</span>
            <select className="cp-input" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="">None</option>
              {PRIORITY_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        {preview.status === 'ambiguous' && (
          <label className="cp-field">
            <span className="cp-field__label">This time happens twice — choose one (required)</span>
            <select className="cp-input" value={activeChoice} onChange={(event) => {
              setChoice({ due, iso: event.target.value });
              setError(null);
            }}>
              <option value="" disabled>
                Choose EDT (earlier) or EST (later)…
              </option>
              {options.map((option) => (
                <option key={option.iso} value={option.iso}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {preview.status === 'ok' && (
          <p className="cp-hint">Deadline resolves to {formatDateTimeWithZone(preview.iso)}.</p>
        )}

        {preview.status === 'nonexistent' && (
          <p className="cp-error" role="alert">
            {preview.message}
          </p>
        )}

        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="cp-button">
          Add task <span aria-hidden="true">+</span>
        </button>
      </form>

      <h3 className="cp-subhead">In the plan</h3>
      {request.tasks.length === 0 ? (
        <p className="cp-hint">No study tasks yet. Add one above.</p>
      ) : (
        <ul className="cp-tasks">
          {request.tasks.map((task) => (
            <li key={task.id} className="cp-tasks__row">
              <span className="cp-tasks__title">{task.title}</span>
              <span className="cp-tasks__meta">
                {task.durationMinutes} min · due {formatDateTimeWithZone(task.dueAt)}
                {task.courseCode && <span className="cp-tag">{task.courseCode}</span>}
                {task.priority && <span className={`cp-tag cp-tag--${task.priority}`}>{task.priority}</span>}
              </span>
              <button
                type="button"
                className="cp-link"
                onClick={() => onRemove(task.id)}
                aria-label={`Remove ${task.title}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
