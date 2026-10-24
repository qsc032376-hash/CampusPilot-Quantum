# Schedule intensity

Personal study planning only: no inference about location opening, room availability or reservations.

```ts
import { generateSchedule } from './index.ts';
import type { ScheduleIntensity } from './index.ts';
const intensity: ScheduleIntensity = 'relaxed';
const result = generateSchedule(scheduleRequest, { intensity });
```

For multi-day UI, pass `intensity` directly to `generateMultiDaySchedule({ windows, tasks, taskSeries, classes, unavailablePeriods, locations, intensity })`.
The response types are unchanged. Omission defaults to `intense`, which returns the existing scheduler result unchanged. Invalid runtime values throw. No UI has been added; B should pass the selected value through every Build/replanning entry.

## Rules

- `intense`: original earliest-deadline/ID greedy placement, no added gaps.
- `relaxed`: first obtain that same baseline plan, preserving its placed-task set, chronological order, failures, durations, location allocation and fixed-event conflicts. Then delay blocks within their existing daily window and deadline to aim for 15 elapsed minutes between consecutive study blocks.
- Reserve a legal zero-gap suffix backwards; forward placement cannot exceed those bounds. This protects later tasks from being displaced by earlier breaks. Original starts are lower bounds, preserving notBefore and occurrence dates.
- Existing elapsed gaps, including time occupied by a class/unavailable event, count toward the target. No mandatory buffer before the first block or after the last.
- Prefer earlier chronological breaks. Shorten a later break only as needed to keep the already-placed suffix feasible. With three one-hour blocks and 20 minutes slack, gaps are 15 and 5 minutes; with no slack both are zero. This is deterministic, not a global fairness optimizer.
- No high-priority exemption preference in this version. Priority never changes the existing task order. Every priority receives the same task-preserving fallback.
- Each day is processed independently through the existing New York daily windows/DST resolver. Missed occurrences remain unscheduled; no deadline extension, splitting or spillover is introduced.

Tests: `node --test tests/schedule-intensity.test.ts`.
