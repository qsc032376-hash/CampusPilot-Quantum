import type { ScheduleRequest } from '../../types.ts';
import type { DailySchedule, MultiDayScheduleResponse } from '../../features/multi-day-schedule/index.ts';
import { CAMPUS_TIME_ZONE, formatDay, formatDuration, formatRangeDetailed } from '../format.ts';
import { EmptyState } from './EmptyState.tsx';

interface ScheduleResultsProps {
  request: ScheduleRequest;
  multi: MultiDayScheduleResponse | null;
  message: string | null;
  onBuild: () => void;
  selectedDate: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectDate: (date: string) => void;
}

/**
 * Turns the multi-day plan into decisions.
 *
 * Days are grouped explicitly so an empty day can never be confused with a task
 * that did not fit anywhere, and the final unscheduled list is reported once,
 * exactly as the adapter returns it.
 */
export function ScheduleResults({
  request,
  multi,
  message,
  onBuild,
  selectedDate,
  selectedId,
  onSelect,
  onSelectDate,
}: ScheduleResultsProps) {
  const placedMinutes = (multi?.result.blocks ?? []).reduce(
    (total, block) => total + (Date.parse(block.end) - Date.parse(block.start)) / 60_000,
    0,
  );

  function taskTitle(taskId: string): string {
    return request.tasks.find((task) => task.id === taskId)?.title ?? taskId;
  }

  function eventTitle(id: string): string {
    const event =
      request.classes.find((candidate) => candidate.id === id) ??
      request.unavailablePeriods.find((candidate) => candidate.id === id) ??
      multi?.result.blocks.find((candidate) => candidate.id === id);
    return event?.title ?? id;
  }

  const conflicts = multi?.result.conflicts ?? [];
  const unscheduled = multi?.result.unscheduledTasks ?? [];
  const rangeStartIso = multi?.days[0]?.windowStart ?? null;

  /** Tasks whose deadline is earlier than the whole range cannot be placed. */
  function beforeRange(taskId: string): boolean {
    const task = request.tasks.find((candidate) => candidate.id === taskId);
    if (!task || !rangeStartIso) return false;
    return Date.parse(task.dueAt) < Date.parse(rangeStartIso);
  }

  function dayBlocks(day: DailySchedule) {
    return day.result.blocks;
  }

  return (
    <section className="cp-panel" aria-labelledby="cp-results-heading">
      <div className="cp-panel__head">
        <h2 id="cp-results-heading">Study plan</h2>
        <p className="cp-panel__meta">
          By day · earliest deadline first · all times {CAMPUS_TIME_ZONE}
        </p>
      </div>

      <button type="button" className="cp-button cp-button--full" onClick={onBuild}>
        {multi ? 'Rebuild plan' : 'Build plan'} <span aria-hidden="true">→</span>
      </button>

      {message && (
        <p className="cp-error" role="alert">
          {message}
        </p>
      )}

      {!multi ? (
        <EmptyState
          title="No plan yet"
          message="Build the plan to place your tasks inside the selected days and daily hours."
        />
      ) : (
        <div className="cp-results" aria-live="polite">
          <dl className="cp-results__totals">
            <div>
              <dt>Sessions</dt>
              <dd>{multi.result.blocks.length}</dd>
            </div>
            <div>
              <dt>Study time</dt>
              <dd>{formatDuration(placedMinutes)}</dd>
            </div>
            <div>
              <dt>Unscheduled</dt>
              <dd>{unscheduled.length}</dd>
            </div>
          </dl>

          <h3 className="cp-subhead">By day</h3>
          <ul className="cp-days">
            {multi.days.map((day) => {
              const blocks = dayBlocks(day);
              const isActive = day.date === selectedDate;
              return (
                <li key={day.date} className="cp-days__row">
                  <button
                    type="button"
                    className={`cp-days__head${isActive ? ' is-selected' : ''}`}
                    aria-pressed={isActive}
                    onClick={() => onSelectDate(day.date)}
                  >
                    <span className="cp-days__label">{formatDay(day.windowStart)}</span>
                    <span className="cp-days__count">
                      {blocks.length === 0 ? 'No study blocks planned' : `${blocks.length} session${blocks.length === 1 ? '' : 's'}`}
                    </span>
                  </button>

                  {blocks.length === 0 ? (
                    <p className="cp-hint">No study blocks planned for this day.</p>
                  ) : (
                    <ul className="cp-sessions">
                      {blocks.map((block) => {
                        const isSelected = block.id === selectedId;
                        return (
                          <li key={block.id}>
                            <button
                              type="button"
                              className={`cp-session${isSelected ? ' is-selected' : ''}`}
                              onClick={() => onSelect(isSelected ? null : block.id)}
                              aria-pressed={isSelected}
                            >
                              <span className="cp-session__time">{formatRangeDetailed(block.start, block.end, true)}</span>
                              <span className="cp-session__title">{block.title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <h3 className="cp-subhead">Conflicts</h3>
          {conflicts.length === 0 ? (
            <p className="cp-hint">No overlapping commitments reported for this range.</p>
          ) : (
            <ul className="cp-conflicts">
              {conflicts.map((conflict) => (
                <li key={`${conflict.firstId}__${conflict.secondId}`} className="cp-conflicts__row">
                  <span className="cp-conflicts__pair">
                    <strong>{eventTitle(conflict.firstId)}</strong>
                    <span aria-hidden="true"> ↔ </span>
                    <strong>{eventTitle(conflict.secondId)}</strong>
                  </span>
                  <span className="cp-conflicts__meta">{formatDuration(conflict.overlapMinutes)} overlap</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="cp-subhead">Needs another time</h3>
          {unscheduled.length === 0 ? (
            <p className="cp-hint">Every task fits inside the selected days and hours.</p>
          ) : (
            <ul className="cp-unscheduled">
              {unscheduled.map((item) => (
                <li key={item.taskId} className="cp-unscheduled__row">
                  <strong>{taskTitle(item.taskId)}</strong>
                  <span>{item.reason}</span>
                  {beforeRange(item.taskId) && (
                    <span>
                      Its deadline is earlier than {formatDay(multi.days[0].windowStart)}, so the selected range starts
                      too late to schedule it.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="cp-panel__foot">
            This is a personal study plan, not room availability or a reservation. Repeating the same input gives the
            same plan.
          </p>
        </div>
      )}
    </section>
  );
}
