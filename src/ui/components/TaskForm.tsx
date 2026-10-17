import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { ScheduleRequest } from '../../types.ts';
import { CAMPUS_TIME_ZONE, formatDateTime, isoToCampusInput, parseCampusInput } from '../format.ts';

export interface TaskDraft {
  title: string;
  durationMinutes: number;
  dueAt: string;
}

interface TaskFormProps {
  request: ScheduleRequest;
  onAdd: (draft: TaskDraft) => void;
  onRemove: (id: string) => void;
}

const MAX_TITLE_LENGTH = 80;
const MAX_DURATION_MINUTES = 600;

/**
 * Collects one study task. Input is validated here so the pure scheduler in
 * src/scheduler.ts never receives a value it would reject with a thrown error.
 *
 * Campus wall times are resolved explicitly: a spring-forward gap is refused
 * rather than shifted, and a fall-back repeated hour asks which offset applies.
 */
export function TaskForm({ request, onAdd, onRemove }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('60');
  const [due, setDue] = useState(() => isoToCampusInput(request.windowEnd));
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  const preview = parseCampusInput(due);
  const options = preview.status === 'ambiguous' ? preview.options : [];
  const activeChoice = Math.min(choiceIndex, Math.max(0, options.length - 1));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Give the task a short title.');
      return;
    }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      setError(`Keep the title under ${MAX_TITLE_LENGTH} characters.`);
      return;
    }

    const minutes = Number(duration);
    if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) {
      setError(`Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MINUTES}.`);
      return;
    }

    const parsed = parseCampusInput(due);
    if (parsed.status === 'invalid') {
      setError(parsed.message);
      return;
    }
    if (parsed.status === 'nonexistent') {
      setError(parsed.message);
      return;
    }

    const dueAt = parsed.status === 'ok' ? parsed.iso : parsed.options[activeChoice].iso;
    if (Date.parse(dueAt) <= Date.parse(request.windowStart)) {
      setError('The deadline must be after the scheduling window starts.');
      return;
    }

    setError(null);
    onAdd({ title: trimmedTitle, durationMinutes: minutes, dueAt });
    setTitle('');
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
              onChange={(event) => setDue(event.target.value)}
            />
          </label>
        </div>

        {preview.status === 'ambiguous' && (
          <label className="cp-field">
            <span className="cp-field__label">This hour happens twice — pick which one</span>
            <select
              className="cp-input"
              value={activeChoice}
              onChange={(event) => setChoiceIndex(Number(event.target.value))}
            >
              {options.map((option, index) => (
                <option key={option.iso} value={index}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {preview.status === 'ok' && (
          <p className="cp-hint">
            Deadline resolves to {formatDateTime(preview.iso)}.
          </p>
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
                {task.durationMinutes} min · due {formatDateTime(task.dueAt)}
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
