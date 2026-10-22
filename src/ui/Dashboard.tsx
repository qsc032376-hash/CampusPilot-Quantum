import { useMemo, useState } from 'react';
import type { ScheduleRequest } from '../types.ts';
import type { MultiDayScheduleResponse } from '../features/multi-day-schedule/index.ts';
import { generateMultiDaySchedule } from '../features/multi-day-schedule/index.ts';
import { AppHeader } from './components/AppHeader.tsx';
import { TaskForm } from './components/TaskForm.tsx';
import type { TaskDraft } from './components/TaskForm.tsx';
import { WeeklySchedule } from './components/WeeklySchedule.tsx';
import { ScheduleResults } from './components/ScheduleResults.tsx';
import { LocationCard } from './components/LocationCard.tsx';
import { RecommendedLocations } from './components/RecommendedLocations.tsx';
import { ReservationPlanner } from './components/ReservationPlanner.tsx';
import { CampusMap } from '../features/campus-map/CampusMap.tsx';
import { createResetState } from './dashboardReset.ts';
import { CAMPUS_TIME_ZONE, formatDay, formatDayShort } from './format.ts';
import {
  buildDailyWindows,
  campusDateOf,
  defaultScheduleRange,
  rangeDates,
  rangeDayCountLabel,
} from './scheduleRange.ts';
import type { ScheduleRange, ScheduleRangeMode } from './scheduleRange.ts';
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
 * Owns the editable request, the multi-day range and A's schedule output. Every
 * placement decision is delegated to `generateMultiDaySchedule`; this component
 * only chooses the range and which day to display.
 */
export function Dashboard({ request: initialRequest, now = () => new Date() }: DashboardProps) {
  const [initialRange] = useState<ScheduleRange>(() => defaultScheduleRange(now()));
  const [request, setRequest] = useState<ScheduleRequest>(initialRequest);
  const [range, setRange] = useState<ScheduleRange>(initialRange);
  const [multi, setMulti] = useState<MultiDayScheduleResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialRange.startDate);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

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

  function runSchedule(nextRequest: ScheduleRequest, nextRange: ScheduleRange): MultiDayScheduleResponse | null {
    try {
      const windows = buildDailyWindows(nextRange);
      const output = generateMultiDaySchedule({
        windows,
        tasks: nextRequest.tasks,
        classes: nextRequest.classes,
        unavailablePeriods: nextRequest.unavailablePeriods,
        locations: nextRequest.locations,
      });
      setMulti(output);
      setMessage(null);
      return output;
    } catch (error) {
      setMulti(null);
      setMessage(error instanceof Error ? error.message : 'The plan could not be built.');
      return null;
    }
  }

  /** A selection that no longer exists after re-planning is cleared. */
  function pruneSelection(output: MultiDayScheduleResponse, currentId: string | null) {
    if (!currentId) return;
    if (!output.result.blocks.some((block) => block.id === currentId)) setSelectedId(null);
  }

  function handleBuild() {
    const output = runSchedule(request, range);
    if (!output) return;
    pruneSelection(output, selectedId);
    if (output.days.length > 0 && !output.days.some((day) => day.date === selectedDate)) {
      setSelectedDate(output.days[0].date);
    }
  }

  /** Applies a request change and keeps an already-built plan in sync. */
  function applyRequest(next: ScheduleRequest) {
    setRequest(next);
    if (!multi) return;
    const output = runSchedule(next, range);
    if (output) pruneSelection(output, selectedId);
  }

  function handleAddTask(draft: TaskDraft) {
    applyRequest({ ...request, tasks: [...request.tasks, { id: makeTaskId(), ...draft }] });
  }

  function handleRemoveTask(id: string) {
    applyRequest({ ...request, tasks: request.tasks.filter((task) => task.id !== id) });
    setSelectedId((current) => (current === `study-${id}` ? null : current));
  }

  function handleRangeChange(patch: Partial<ScheduleRange>) {
    const next: ScheduleRange = { ...range, ...patch };
    setRange(next);
    setSelectedDate(next.startDate);
    setSelectedId(null);
    if (multi) runSchedule(request, next);
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
    setMulti(null);
    setMessage(next.message);
    setSelectedId(next.selectedId);
    setFormKey(next.formKey);
    setRange(freshRange);
    setSelectedDate(freshRange.startDate);
  }

  const activeDay = multi?.days.find((day) => day.date === selectedDate) ?? null;
  const previewIndex = preview.dates.indexOf(selectedDate);
  const previewWindow = previewIndex >= 0 ? preview.windows[previewIndex] : preview.windows[0];
  const windowStart = activeDay?.windowStart ?? previewWindow?.windowStart ?? null;
  const windowEnd = activeDay?.windowEnd ?? previewWindow?.windowEnd ?? null;

  const dayDates = multi?.days.map((day) => day.date) ?? preview.dates;
  const dayWindows = multi?.days ?? preview.windows.map((window, index) => ({ ...window, date: preview.dates[index] }));

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
            key={formKey}
            request={request}
            defaultDueIso={windowEnd}
            rangeStartIso={multi?.days[0]?.windowStart ?? preview.windows[0]?.windowStart ?? null}
            onAdd={handleAddTask}
            onRemove={handleRemoveTask}
          />
          <LocationCard block={selectedBlock} request={request} />
          <RecommendedLocations block={selectedBlock} request={request} />
        </div>

        <div className="cp-column">
          <section className="cp-panel" aria-labelledby="cp-range-heading">
            <div className="cp-panel__head">
              <h2 id="cp-range-heading">Schedule range</h2>
              <p className="cp-panel__meta">Personal study planning only · all times {CAMPUS_TIME_ZONE}</p>
            </div>

            <div className="cp-form">
              <div className="cp-field-row cp-field-row--split">
                <label className="cp-field">
                  <span className="cp-field__label">Range</span>
                  <select
                    className="cp-input"
                    value={range.mode}
                    onChange={(event) => handleRangeChange({ mode: event.target.value as ScheduleRangeMode })}
                  >
                    <option value="single">Single day</option>
                    <option value="week">7 consecutive days</option>
                  </select>
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

            <div className="cp-daytabs" role="group" aria-label="Choose a day to view">
              {dayDates.map((date, index) => {
                const dayWindow = dayWindows[index];
                const label = dayWindow ? formatDayShort(dayWindow.windowStart) : date;
                return (
                  <button
                    key={date}
                    type="button"
                    className={`cp-daytab${date === selectedDate ? ' is-active' : ''}`}
                    aria-pressed={date === selectedDate}
                    onClick={() => handleSelectDate(date)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <p className="cp-panel__foot">
              Switching the viewed day does not re-run the planner. Changing the range or the task list does. Events
              labelled “Example · ” are demo data, not real courses, and they say nothing about room availability.
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
