# Multi-day personal study scheduling

Pure adapter around the existing scheduler. This is not room availability,
opening hours, a booking window, or booking confirmation. No network or clock
is read. No tasks, commitments, deadlines or locations are mutated.

## UI contract for B

Import `createDailyWindows` and `generateMultiDaySchedule` from `./index.ts`.

```ts
const windows = createDailyWindows({
  startDate: '2026-10-30', // New York date, chosen by caller
  dayCount: 7,            // default 7; accepts 1 through 30
  startTime: '09:00',     // default
  endTime: '17:00',       // default
});
const output = generateMultiDaySchedule({
  windows,
  tasks: request.tasks,
  classes: request.classes,
  unavailablePeriods: request.unavailablePeriods,
  locations: request.locations,
});
```

- `output.days`: all dates, including empty days, in ascending order. Each has
  `date` (YYYY-MM-DD), `windowStart`, `windowEnd`, and `result` containing `blocks`
  and optional day-local `conflicts`. Use these conflicts for daily highlighting.
- `output.result`: chronological blocks across all dates, final `unscheduledTasks`
  once per remaining task, and optional conflicts aggregated by ID pair. Aggregated
  overlap counts only elapsed minutes inside the daily windows, excluding nights.
- Empty conflicts are omitted (A1). The single-window `output.result` is exactly
  the existing scheduler response, including its reason strings.
- Daily failures are temporary and deliberately absent from daily results. Use
  only `output.result.unscheduledTasks` for the final needs-another-time panel.
- Placement remains earliest deadline then ID, whole tasks, first supplied
  location. Priority does not affect placement. No splitting; optional taskSeries generates date-bound occurrences.
- Caller supplies the desired future date using America/New_York and owns UI
  selection/reset/now validation. Explicit dates keep this module deterministic
  and allow fixed historical regression fixtures. The module does not infer today.
- Windows must be ordered consecutive New York dates, one increasing same-date
  interval each, on whole minutes. Overnight study windows are unsupported.
- Natural-day generation resolves each day's local clock separately. Invalid
  dates and nonexistent/ambiguous DST wall times throw. The UI must not silently
  choose EDT/EST: choose another time, or supply explicitly resolved ISO windows
  to the scheduler. All timestamps must carry Z or an explicit offset.
- Existing class/unavailable intervals are passed through intact even when they
  cross midnight. Their original timestamps remain authoritative.
- Catch validation errors in the UI; no partial result is returned on error.
- This module does not replace the location recommender's DST/cross-midnight
  guards and does not establish real opening hours or room availability.

## Verification

```text
node --test tests/multi-day-schedule.test.ts tests/scheduler.test.ts
npx tsc --noEmit
npm run build
```

## Recurring tasks and longer ranges

Daily windows now accept 1–30 consecutive New York dates; default 7.
Window resolution lives in `windows.ts`, shared with recurrence generation.

```ts
const output = generateMultiDaySchedule({
  windows: createDailyWindows({ startDate: '2026-10-26', dayCount: 30 }),
  tasks: oneOffTasks,
  taskSeries: [{
    id: 'weekly-review', title: 'Weekly review', durationMinutes: 60,
    startDate: '2026-10-26', endDate: '2026-11-24', // optional, inclusive
    rule: { frequency: 'weekly', interval: 2, weekdays: [1, 3] },
  }],
  classes, unavailablePeriods, locations,
});
```

- Rules: `{ frequency: 'daily', interval: N }` or
  `{ frequency: 'weekly', interval: N, weekdays: [1, ..., 7] }`.
  N is a positive safe integer; ISO weekdays are Monday=1 through Sunday=7,
  nonempty and unique. Weekly intervals anchor to Monday of the series start
  date's ISO week. Dates before the start are excluded, even in that week.
- `output.tasks` contains copied one-off tasks followed by generated occurrences.
  Use it to resolve block/unscheduled task IDs to titles. Keep original one-offs
  and series as input state: do NOT feed output.tasks back alongside taskSeries.
  Such duplicate occurrence IDs are rejected rather than silently accumulated.
- Occurrence IDs are `${series.id}@${date}` and stay stable when the visible range
  changes. Each occurrence includes `seriesId`, `occurrenceDate`, `notBefore`
  (its window start), and `dueAt` (its window end).
- The scheduler honors optional `StudyTask.notBefore`, validates its explicit
  offset and requires it to precede dueAt. Without it placement is unchanged.
  Sorting remains deadline then ID; neither priority nor series changes order.
  Occurrences cannot be placed before their date, after its window, or split.
  Failed occurrences remain in the final unscheduled list.
- Series IDs must be unique. Combined one-off/occurrence IDs must be unique.
  Events and generated study blocks retain existing cross-collection ID rules.
- Missing taskSeries or an empty list preserves the single-day result exactly;
  the wrapper adds output.tasks for UI lookup, not fields to ScheduleResponse.
- Series outside the visible range produce no occurrences. Omitting endDate never
  expands beyond the supplied windows. The generator never reads the clock.
- No monthly rules, fixed appointment times, occurrence editing or skipping.
  No UI changes, policy changes, or external availability data are included.

Additional verification: `node --test tests/recurring-tasks.test.ts`.
