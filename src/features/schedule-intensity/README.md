# Schedule intensity

Personal study planning only: no inference about location opening, room availability or reservations.

```ts
import { generateSchedule } from './index.ts';
import type { ScheduleIntensity } from './index.ts';
const intensity: ScheduleIntensity = 'relaxed';
const result = generateSchedule(scheduleRequest, { intensity });
```

For multi-day UI, pass `intensity` directly to `generateMultiDaySchedule({ windows, tasks, taskSeries, classes, unavailablePeriods, locations, intensity })`.
The response types are unchanged. Omission defaults to `intense`, which returns the existing scheduler result unchanged. Invalid runtime values throw.

## UI

`src/ui/components/ScheduleIntensitySwitch.tsx` renders the pace control in the Dashboard's "Schedule range" panel, below the day-navigation controls; the Build button lives in the separate "Study plan" panel. The options are **Relaxed** (the default, sends `'relaxed'`) and **High intensity** (sends `'intense'`), each with a one-line description.

The Dashboard owns the selection. Build, one-off task changes, series changes and switching the pace go through `planWith`, which validates the raw day-count text and the daily windows before calling `runSchedule` with the current intensity. Range edits validate the same two things themselves and then call `runSchedule` directly. Both paths pass the current intensity to `generateMultiDaySchedule`. Switching the pace re-plans an existing plan under the same validation, Reset returns to Relaxed, and browsing days or switching the task mode never changes the pace.

## Rules

- `intense`: original earliest-deadline/ID greedy placement, no added gaps.
- `relaxed`: first obtain that same baseline plan, preserving its placed-task set, chronological order, failures, durations, location allocation and fixed-event conflicts. Then delay blocks within their existing daily window and deadline to aim for 15 elapsed minutes between consecutive study blocks.
- Reserve a legal zero-gap suffix backwards; forward placement cannot exceed those bounds. This protects later tasks from being displaced by earlier breaks. Original starts are lower bounds, preserving notBefore and occurrence dates.
- Classes and unavailable periods are not rest. When a block has to move past a fixed event, it starts a full 15 minutes after that event ends instead of the moment it lets out, and a block that fits before an event is pulled earlier when a feasible slot exists so the buffer survives.
- The first block also gets that buffer when it comes after an event, but no buffer is required before the window start, so the day may still begin immediately. Nothing is required after the last block either.
- 15 minutes is a soft target: it is shortened when keeping it would miss a deadline or drop a task. Every placed task still ends by its deadline, and the baseline placed-task set is preserved.
- Prefer earlier chronological breaks. Shorten a later break only as needed to keep the already-placed suffix feasible. With three one-hour blocks and 20 minutes slack, gaps are 15 and 5 minutes; with no slack both are zero. This is deterministic, not a global fairness optimizer.
- No high-priority exemption preference in this version. Priority never changes the existing task order. Every priority receives the same task-preserving fallback.
- Each day is processed independently through the existing New York daily windows/DST resolver. Missed occurrences remain unscheduled; no deadline extension, splitting or spillover is introduced.

Tests: `node --test tests/schedule-intensity.test.ts tests/relaxed-breaks.test.ts tests/relaxed-first-block.test.ts`.
