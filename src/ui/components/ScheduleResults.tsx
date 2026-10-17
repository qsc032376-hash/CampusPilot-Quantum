import type { ScheduleRequest, ScheduleResponse } from '../../types.ts';
import { formatClock, formatDuration, formatRange } from '../format.ts';
import { EmptyState } from './EmptyState.tsx';

interface ScheduleResultsProps {
  request: ScheduleRequest;
  result: ScheduleResponse | null;
  message: string | null;
  onBuild: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** Turns the timeline into decisions: totals, placed sessions, and what did not fit. */
export function ScheduleResults({ request, result, message, onBuild, selectedId, onSelect }: ScheduleResultsProps) {
  const placedMinutes = (result?.blocks ?? []).reduce(
    (total, block) => total + (Date.parse(block.end) - Date.parse(block.start)) / 60_000,
    0,
  );

  function taskTitle(taskId: string): string {
    return request.tasks.find((task) => task.id === taskId)?.title ?? taskId;
  }

  return (
    <section className="cp-panel" aria-labelledby="cp-results-heading">
      <div className="cp-panel__head">
        <h2 id="cp-results-heading">Study plan</h2>
        <p className="cp-panel__meta">Earliest deadline first, inside the window.</p>
      </div>

      <button type="button" className="cp-button cp-button--full" onClick={onBuild}>
        {result ? 'Rebuild my day' : 'Build my day'} <span aria-hidden="true">→</span>
      </button>

      {message && (
        <p className="cp-error" role="alert">
          {message}
        </p>
      )}

      {!result ? (
        <EmptyState
          title="No plan yet"
          message="Build the day to place your tasks around classes and commitments."
        />
      ) : (
        <div className="cp-results" aria-live="polite">
          <dl className="cp-results__totals">
            <div>
              <dt>Sessions</dt>
              <dd>{result.blocks.length}</dd>
            </div>
            <div>
              <dt>Study time</dt>
              <dd>{formatDuration(placedMinutes)}</dd>
            </div>
            <div>
              <dt>Unscheduled</dt>
              <dd>{result.unscheduledTasks.length}</dd>
            </div>
          </dl>

          <h3 className="cp-subhead">Placed</h3>
          {result.blocks.length === 0 ? (
            <p className="cp-hint">No task could be placed in this window.</p>
          ) : (
            <ul className="cp-sessions">
              {result.blocks.map((block) => {
                const isSelected = block.id === selectedId;
                return (
                  <li key={block.id}>
                    <button
                      type="button"
                      className={`cp-session${isSelected ? ' is-selected' : ''}`}
                      onClick={() => onSelect(isSelected ? null : block.id)}
                      aria-pressed={isSelected}
                    >
                      <span className="cp-session__time">{formatRange(block.start, block.end)}</span>
                      <span className="cp-session__title">{block.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="cp-subhead">Needs another time</h3>
          {result.unscheduledTasks.length === 0 ? (
            <p className="cp-hint">Everything fits this window.</p>
          ) : (
            <ul className="cp-unscheduled">
              {result.unscheduledTasks.map((item) => (
                <li key={item.taskId} className="cp-unscheduled__row">
                  <strong>{taskTitle(item.taskId)}</strong>
                  <span>{item.reason}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="cp-panel__foot">Built with the shared mock scheduler. Repeating the same input gives the same plan.</p>
        </div>
      )}

      {result && result.blocks.length > 0 && (
        <p className="cp-panel__foot">First session starts at {formatClock(result.blocks[0].start)}.</p>
      )}
    </section>
  );
}
