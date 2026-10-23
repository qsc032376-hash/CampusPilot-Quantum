import { useMemo, useState } from 'react';
import type { ScheduleRequest } from '../types.ts';
import type { MultiDayScheduleResponse } from '../features/multi-day-schedule/index.ts';
import { generateMultiDaySchedule } from '../features/multi-day-schedule/index.ts';
import type { TaskSeries } from '../features/recurring-tasks/index.ts';
import { AppHeader } from './components/AppHeader.tsx';
import { TaskForm } from './components/TaskForm.tsx';
import type { TaskDraft } from './components/TaskForm.tsx';
import { RecurringTaskForm } from './components/RecurringTaskForm.tsx';
import type { OneOffFromSeries } from './components/RecurringTaskForm.tsx';
import { WeeklySchedule } from './components/WeeklySchedule.tsx';
import { ScheduleResults } from './components/ScheduleResults.tsx';
import { LocationCard } from './components/LocationCard.tsx';
import { RecommendedLocations } from './components/RecommendedLocations.tsx';
import { ReservationPlanner } from './components/ReservationPlanner.tsx';
import { CampusMap } from '../features/campus-map/CampusMap.tsx';
import { createResetState } from './dashboardReset.ts';
import { CAMPUS_TIME_ZONE, formatDay } from './format.ts';
import {
  DAY_COUNT_PRESETS,
  MAX_DAY_COUNT,
  MIN_DAY_COUNT,
  buildDailyWindows,
  campusDateOf,
  clampDayCount,
  defaultScheduleRange,
  rangeDates,
  rangeDayCountLabel,
  dayCountError,
} from './scheduleRange.ts';
import type { ScheduleRange } from './scheduleRange.ts';
import { rangeError, resolveSelection } from './scheduleState.ts';
import './ui.css';

interface DashboardProps {
  request: ScheduleRequest;
  /** Injected clock so demo dates and defaults stay testable. */
  now?: () => Date;
}

let idCounter = 0;
function makeTaskId(): string {
  idCounter += 1;
  return `task-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Dashboard composition root.
 *
 * Owns the editable request, the repeating series, the 1-30 day range and A's
 * schedule output. Input state always keeps the original one-off tasks and
 * series; `output.tasks` is display data and is never passed back in.
 */
export function Dashboard({ request: initialRequest, now = () => new Date() }: DashboardProps) {
  const [initialRange] = useState<ScheduleRange>(() => defaultScheduleRange(now()));
  const [request, setRequest] = useState<ScheduleRequest>(initialRequest);
  const [series, setSeries] = useState<TaskSeries[]>([]);
  const [range, setRange] = useState<ScheduleRange>(initialRange);
  const [multi, setMulti] = useState<MultiDayScheduleResponse | null>(null);
  /** True once a plan has succeeded; drives recovery after an invalid edit. */
  const [hasBuilt, setHasBuilt] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialRange.startDate);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [seriesFormKey, setSeriesFormKey] = useState(0);
  /** Raw text of the day-count field, validated before it is applied. */
  const [dayCountInput, setDayCountInput] = useState(() => String(initialRange.dayCount));

  // Windows are previewed before a plan exists so the timeline can show the
  // chosen day even when nothing has been scheduled yet.
  const preview = useMemo(() => {
    try {
      const windows = buildDailyWindows(range);
      return { windows, dates: rangeDates(range), error: null as string | null };
    } catch (error) {
      return {
        windows: [] as ReturnType<typeof buildDailyWindows>,
        dates: [] as string[],
        error: error instanceof Error ? error.message : 'The selected range is not valid.',
      };
    }
  }, [range]);

  function runSchedule(
    nextRequest: ScheduleRequest,
    nextRange: ScheduleRange,
    nextSeries: TaskSeries[],
  ): MultiDayScheduleResponse | null {
    try {
      const windows = buildDailyWindows(nextRange);
      const output = generateMultiDaySchedule({
        windows,
        tasks: nextRequest.tasks,
        taskSeries: nextSeries,
        classes: nextRequest.classes,
        unavailablePeriods: nextRequest.unavailablePeriods,
        locations: nextRequest.locations,
      });
      setMulti(output);
      setMessage(null);
      setHasBuilt(true);
      return output;
    } catch (error) {
      setMulti(null);
      setMessage(error instanceof Error ? error.message : 'The plan could not be built.');
      return null;
    }
  }

  /**
   * Keeps the selection consistent with a fresh plan: it follows its block to a
   * new day, or is cleared when the block no longer exists.
   */
  function syncSelection(output: MultiDayScheduleResponse, currentId: string | null) {
    const resolved = resolveSelection(output, currentId);
    setSelectedId(resolved.id);
    if (resolved.date) setSelectedDate(resolved.date);
  }

  function handleBuild() {
    const output = runSchedule(request, range, series);
    if (!output) return;
    syncSelection(output, selectedId);
    if (output.days.length > 0 && !output.days.some((day) => day.date === selectedDate)) {
      setSelectedDate(output.days[0].date);
    }
  }

  /** Applies a request change and keeps an already-built plan in sync. */
  function applyRequest(next: ScheduleRequest) {
    setRequest(next);
    if (!hasBuilt) return;
    const output = runSchedule(next, range, series);
    if (output) syncSelection(output, selectedId);
  }

  /** Applies a series change and keeps an already-built plan in sync. */
  function applySeries(next: TaskSeries[]) {
    setSeries(next);
    if (!hasBuilt) return;
    const output = runSchedule(request, range, next);
    if (output) syncSelection(output, selectedId);
  }

  function handleAddTask(draft: TaskDraft) {
    applyRequest({ ...request, tasks: [...request.tasks, { id: makeTaskId(), ...draft }] });
  }

  function handleRemoveTask(id: string) {
    applyRequest({ ...request, tasks: request.tasks.filter((task) => task.id !== id) });
    setSelectedId((current) => (current === `study-${id}` ? null : current));
  }

  function handleAddSeries(next: TaskSeries) {
    applySeries([...series, next]);
  }

  function handleUpdateSeries(next: TaskSeries) {
    applySeries(series.map((item) => (item.id === next.id ? next : item)));
  }

  function handleDeleteSeries(id: string) {
    applySeries(series.filter((item) => item.id !== id));
  }

  function handleRangeChange(patch: Partial<ScheduleRange>) {
    const next: ScheduleRange = { ...range, ...patch };
    if (patch.dayCount !== undefined) next.dayCount = clampDayCount(patch.dayCount);
    setDayCountInput(String(next.dayCount));
    const invalid = rangeError(next);
    setRange(next);
    setSelectedDate(next.startDate);
    setSelectedId(null);

    if (invalid) {
      // An invalid range must never keep presenting the previous plan as current.
      setMulti(null);
      setMessage(invalid);
      return;
    }

    setMessage(null);
    // A plan the user already generated is recomputed; otherwise nothing is shown.
    if (hasBuilt) runSchedule(request, next, series);
  }

  /** Rejects out-of-range or non-numeric day counts instead of clamping them. */
  function handleDayCountInput(value: string) {
    setDayCountInput(value);
    const invalid = dayCountError(value);
    if (invalid) {
      // Keep the raw value visible, report it, and never plan a corrected value.
      setMessage(invalid);
      setMulti(null);
      setSelectedId(null);
      return;
    }
    handleRangeChange({ dayCount: Number(value) });
  }

  /** Switching the viewed day never re-runs the planner. */
  function handleSelectDate(date: string) {
    setSelectedDate(date);
    if (!selectedId) return;
    const block = multi?.result.blocks.find((candidate) => candidate.id === selectedId);
    if (!block || campusDateOf(block.start) !== date) setSelectedId(null);
  }

  function handleSelectBlock(id: string | null) {
    setSelectedId(id);
    if (!id) return;
    const block = multi?.result.blocks.find((candidate) => candidate.id === id);
    if (block) setSelectedDate(campusDateOf(block.start));
  }

  function handleReset() {
    const next = createResetState(initialRequest, formKey);
    const freshRange = defaultScheduleRange(now());
    setRequest(next.request);
    setSeries([]);
    setMulti(null);
    setMessage(next.message);
    setSelectedId(next.selectedId);
    setFormKey(next.formKey);
    setRange(freshRange);
    setDayCountInput(String(freshRange.dayCount));
    setSelectedDate(freshRange.startDate);
    setHasBuilt(false);
    setSeriesFormKey((current) => current + 1);
  }

  const activeDay = multi?.days.find((day) => day.date === selectedDate) ?? null;
  const previewIndex = preview.dates.indexOf(selectedDate);
  const previewWindow = previewIndex >= 0 ? preview.windows[previewIndex] : preview.windows[0];
  const windowStart = activeDay?.windowStart ?? previewWindow?.windowStart ?? null;
  const windowEnd = activeDay?.windowEnd ?? previewWindow?.windowEnd ?? null;

  const dayDates = multi?.days.map((day) => day.date) ?? preview.dates;
  const dayIndex = Math.max(0, dayDates.indexOf(selectedDate));
  const canGoPrevious = dayIndex > 0;
  const canGoNext = dayIndex >= 0 && dayIndex < dayDates.length - 1;

  const rangeLabel = preview.windows[0]
    ? `${rangeDayCountLabel(range)} from ${formatDay(preview.windows[0].windowStart)} · ${range.startTime}–${range.endTime} ${CAMPUS_TIME_ZONE}`
    : `${range.startDate} · ${range.startTime}–${range.endTime}`;

  const selectedBlock = multi?.result.blocks.find((block) => block.id === selectedId) ?? null;

  return (
    <div className="cp-app">
      <AppHeader request={request} result={multi?.result ?? null} rangeLabel={rangeLabel} onReset={handleReset} />

      <main className="cp-main">
        <div className="cp-column">
          <TaskForm
            key={`oneoff-${formKey}`}
            request={request}
            defaultDueIso={windowEnd}
            rangeStartIso={multi?.days[0]?.windowStart ?? preview.windows[0]?.windowStart ?? null}
            onAdd={handleAddTask}
            onRemove={handleRemoveTask}
          />
          <RecurringTaskForm
            key={`series-${seriesFormKey}`}
            series={series}
            dates={preview.dates}
            defaultStartDate={selectedDate}
            rangeStart={range.startDate}
            rangeEnd={preview.dates[preview.dates.length - 1] ?? range.startDate}
            dueAtFor={(date) => {
              const index = preview.dates.indexOf(date);
              return index >= 0 ? preview.windows[index].windowEnd : null;
            }}
            onAddSeries={handleAddSeries}
            onUpdateSeries={handleUpdateSeries}
            onDeleteSeries={handleDeleteSeries}
            onAddOneOff={(task: OneOffFromSeries) =>
              applyRequest({ ...request, tasks: [...request.tasks, { id: makeTaskId(), ...task }] })
            }
          />
          <LocationCard block={selectedBlock} request={request} />
          <RecommendedLocations block={selectedBlock} request={request} />
        </div>

        <div className="cp-column">
          <section className="cp-panel" aria-labelledby="cp-range-heading">
            <div className="cp-panel__head">
              <h2 id="cp-range-heading">Schedule range</h2>
              <p className="cp-panel__meta">
                {MIN_DAY_COUNT}–{MAX_DAY_COUNT} consecutive New York calendar days · all times {CAMPUS_TIME_ZONE}
              </p>
            </div>

            <div className="cp-form">
              <div className="cp-field-row cp-field-row--split">
                <label className="cp-field">
                  <span className="cp-field__label">Days</span>
                  <input
                    className="cp-input"
                    type="number"
                    min={MIN_DAY_COUNT}
                    max={MAX_DAY_COUNT}
                    step={1}
                    value={dayCountInput}
                    onChange={(event) => handleDayCountInput(event.target.value)}
                  />
                </label>

                <label className="cp-field">
                  <span className="cp-field__label">Start date (New York)</span>
                  <input
                    className="cp-input"
                    type="date"
                    value={range.startDate}
                    onChange={(event) => handleRangeChange({ startDate: event.target.value })}
                  />
                </label>
              </div>

              <div className="cp-presets" role="group" aria-label="Day count presets">
                {DAY_COUNT_PRESETS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`cp-preset${range.dayCount === count ? ' is-active' : ''}`}
                    aria-pressed={range.dayCount === count}
                    onClick={() => handleRangeChange({ dayCount: count })}
                  >
                    {count} {count === 1 ? 'day' : 'days'}
                  </button>
                ))}
              </div>

              <div className="cp-field-row cp-field-row--split">
                <label className="cp-field">
                  <span className="cp-field__label">Daily start</span>
                  <input
                    className="cp-input"
                    type="time"
                    value={range.startTime}
                    onChange={(event) => handleRangeChange({ startTime: event.target.value })}
                  />
                </label>

                <label className="cp-field">
                  <span className="cp-field__label">Daily end</span>
                  <input
                    className="cp-input"
                    type="time"
                    value={range.endTime}
                    onChange={(event) => handleRangeChange({ endTime: event.target.value })}
                  />
                </label>
              </div>
            </div>

            <div className="cp-daynav" role="group" aria-label="Choose a day to view">
              <button
                type="button"
                className="cp-preset"
                onClick={() => handleSelectDate(dayDates[dayIndex - 1])}
                disabled={!canGoPrevious}
              >
                Previous day
              </button>
              <p className="cp-daynav__label" aria-live="polite">
                {dayDates.length > 0 ? `Day ${dayIndex + 1} of ${dayDates.length}` : 'No day selected'}
              </p>
              <button
                type="button"
                className="cp-preset"
                onClick={() => handleSelectDate(dayDates[dayIndex + 1])}
                disabled={!canGoNext}
              >
                Next day
              </button>
            </div>

            <p className="cp-panel__foot">
              Switching the viewed day does not re-run the planner. Changing the range, the task list or a repeating
              series does. Events labelled “Example · ” are demo data, not real courses, and they say nothing about room
              availability.
            </p>
          </section>

          <WeeklySchedule
            windowStart={windowStart}
            windowEnd={windowEnd}
            dayLabel={windowStart ? formatDay(windowStart) : 'No day selected'}
            classes={request.classes}
            unavailablePeriods={request.unavailablePeriods}
            blocks={activeDay?.result.blocks ?? []}
            conflicts={activeDay?.result.conflicts ?? []}
            hasPlan={multi !== null}
            selectedId={selectedId}
            onSelect={handleSelectBlock}
          />
        </div>

        <div className="cp-column">
          <ScheduleResults
            request={request}
            series={series}
            multi={multi}
            message={message ?? preview.error}
            onBuild={handleBuild}
            selectedDate={selectedDate}
            selectedId={selectedId}
            onSelect={handleSelectBlock}
            onSelectDate={handleSelectDate}
          />
        </div>
      </main>

      <div className="cp-reservation">
        <ReservationPlanner />
      </div>

      <div className="cp-map-mount">
        <CampusMap />
      </div>

      <footer className="cp-foot">
        Student-built prototype · Data is in memory and resets on reload · Availability is not verified
      </footer>
    </div>
  );
}
