# Multi-day personal study scheduling

Pure adapter around the existing scheduler. This is not room availability,
opening hours, a booking window, or booking confirmation. No network or clock
is read. No tasks, commitments, deadlines or locations are mutated.

## UI contract for B

Import `createDailyWindows` and `generateMultiDaySchedule` from `./index.ts`.

```ts
const windows = createDailyWindows({
  startDate: '2026-10-30', // New York date, chosen by caller
  dayCount: 7,            // default 7; accepts 1 through 7
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
  location. Priority does not affect placement. No splitting or recurring events.
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
