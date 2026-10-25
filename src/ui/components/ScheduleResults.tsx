import type { ScheduleRequest, StudyTask } from '../../types.ts';
import type { DailySchedule, MultiDayScheduleResponse } from '../../features/multi-day-schedule/index.ts';
import type { TaskSeries } from '../../features/recurring-tasks/index.ts';
import { CAMPUS_TIME_ZONE, formatDay, formatDayShort, formatDuration, formatRangeDetailed } from '../format.ts';
import { describeRule } from '../recurring.ts';
import { EmptyState } from './EmptyState.tsx';

interface ScheduleResultsProps {
  request: ScheduleRequest;
  series: readonly TaskSeries[];
  multi: MultiDayScheduleResponse | null;
  message: string | null;
  onBuild: () => void;
  selectedDate: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectDate: (date: string) => void;
}

const WEEK = 7;

/** Splits the range into display weeks of seven days each. */
function groupByWeek(days: readonly DailySchedule[]): DailySchedule[][] {
  const groups: DailySchedule[][] = [];
  for (let index = 0; index < days.length; index += WEEK) groups.push(days.slice(index, index + WEEK));
  return groups;
}

/**
 * Turns the multi-day plan into decisions.
 *
 * Titles come from `output.tasks`, which lists one-offs followed by the
 * occurrences generated for this run. Empty days stay visible but short, and the
 * final unscheduled list is reported once per task.
 */
export function ScheduleResults({
  request,
  series,
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

  function titleOf(taskId: string): string {
    const fromOutput = multi?.tasks.find((task: StudyTask) => task.id === taskId);
    if (fromOutput) return fromOutput.title;
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

  const occurrenceIds = new Set((multi?.tasks ?? []).filter((task) => task.seriesId).map((task) => task.id));
  const placedOccurrences = (multi?.result.blocks ?? []).filter((block) => occurrenceIds.has(block.taskId)).length;

  /** Occurrence day label, so an unscheduled occurrence is not just its series title. */
  function occurrenceLabel(taskId: string): string | null {
    const task = multi?.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.occurrenceDate) return null;
    const day = multi?.days.find((candidate) => candidate.date === task.occurrenceDate);
    return day ? formatDayShort(day.windowStart) : task.occurrenceDate;
  }

  /** Tasks whose deadline is earlier than the whole range cannot be placed. */
  function beforeRange(taskId: string): boolean {
    const task =
      multi?.tasks.find((candidate) => candidate.id === taskId) ??
      request.tasks.find((candidate) => candidate.id === taskId);
    if (!task || !rangeStartIso) return false;
    return Date.parse(task.dueAt) < Date.parse(rangeStartIso);
  }

  return (
    <section className="cp-panel" aria-labelledby="cp-results-heading">
      <div className="cp-panel__head">
        <h2 id="cp-results-heading">Study plan</h2>
        <p className="cp-panel__meta">By day · earliest deadline first</p>
      </div>

      <button type="button" className="cp-button cp-button--full" data-tour="build" onClick={onBuild}>
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

          <p className="cp-hint">
            One-off tasks: {request.tasks.length} · Repeating series: {series.length} · Placed occurrences:{' '}
            {placedOccurrences}
          </p>

          {series.length > 0 && (
            <>
              <h3 className="cp-subhead">Repeating</h3>
              <ul className="cp-series cp-series--summary">
                {series.map((item) => (
                  <li key={item.id} className="cp-series__row">
                    <span className="cp-series__title">{item.title}</span>
                    <span className="cp-series__meta">{describeRule(item)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="cp-subhead">By day</h3>
          {groupByWeek(multi.days).map((weekDays, weekIndex) => (
            <div key={weekDays[0].date} className="cp-week">
              <h4 className="cp-week__head">
                Week {weekIndex + 1}
                <span className="cp-week__range">
                  {formatDayShort(weekDays[0].windowStart)} – {formatDayShort(weekDays[weekDays.length - 1].windowStart)}
                </span>
              </h4>
              <ul className="cp-days">
                {weekDays.map((day) => {
                  const blocks = day.result.blocks;
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
                          {blocks.length === 0
                            ? 'No study blocks'
                            : `${blocks.length} session${blocks.length === 1 ? '' : 's'}`}
                        </span>
                      </button>

                      {blocks.length > 0 && (
                        <ul className="cp-sessions">
                          {blocks.map((block) => {
                            const isSelected = block.id === selectedId;
                            const recurring = occurrenceIds.has(block.taskId);
                            return (
                              <li key={block.id}>
                                <button
                                  type="button"
                                  className={`cp-session${isSelected ? ' is-selected' : ''}`}
                                  onClick={() => onSelect(isSelected ? null : block.id)}
                                  aria-pressed={isSelected}
                                >
                                  <span className="cp-session__time">
                                    {formatRangeDetailed(block.start, block.end, true)}
                                  </span>
                                  <span className="cp-session__title">
                                    {block.title}
                                    {recurring && <span className="cp-tag">repeating</span>}
                                  </span>
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
            </div>
          ))}

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
                  <strong>
                    {titleOf(item.taskId)}
                    {occurrenceLabel(item.taskId) && (
                      <span className="cp-tag">{occurrenceLabel(item.taskId)}</span>
                    )}
                  </strong>
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

        </div>
      )}
    </section>
  );
}
