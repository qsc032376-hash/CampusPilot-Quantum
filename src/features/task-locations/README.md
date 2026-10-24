# Task-level locations: contract for UI integration

This is personal study-plan metadata only, not a room booking, availability check,
verified custom place, geocoding result or route. No UI is changed in this branch.

`StudyTask.location`, `TaskSeries.location` and explicit `StudyBlock.location` use
`TaskLocation` from `src/types.ts`:

```ts
// New UI MUST send one of these, including when the user clears the field.
{ kind: 'none' }
{ kind: 'campus', locationId: 'ohio-union' }
{ kind: 'custom', name: 'My desk' }
```

- Missing/undefined `location` is a deliberate legacy mode: use
  `request.locations[0]`, or the old `No study location supplied.` failure if no
  location exists. Old sample data and output block shapes remain unchanged.
- Explicit `none` never falls back. It schedules even with `locations: []`.
- `campus` must exactly match an ID in `request.locations`; all currently configured
  four libraries and Ohio Union are supported. Invalid/unconfigured IDs throw;
  they are not silently changed or converted into custom locations. B should use
  the existing catalog as options, not invent entries or add custom names to it.
- `custom` requires a trimmed 1–120-character name (JavaScript string length),
  without control characters. It works with an empty catalog, gets no ID or
  coordinates, and is not sent to recommendation/routing services. Render it as
  plain text, never HTML or a URL. `null` and empty names are errors, not none.
- `normalizeTaskLocation` validates/copies the shape; `resolveTaskLocation` also
  validates membership in the supplied catalog. `taskLocationLabel` returns the
  explicit campus/custom display name or null for none. It never uses a default.

## Output and B's responsibilities

`StudyBlock.locationId` is now optional. Legacy blocks have the same locationId
and no location property. Explicit campus blocks have both matching locationId
and location. None/custom blocks have location but **no locationId**; never fill
in a fallback ID. Output location is a normalized fresh copy.

For one-off forms, persist the selection on StudyTask; for series forms, persist
it on TaskSeries on add/edit. Clearing must send `{ kind: 'none' }`, not delete the
field. While merely displaying old data, retain omission until the user explicitly
chooses or clears a location. Reset/draft behavior belongs to B's UI integration.
Occurrences inherit series location in independent copies. IDs/dates/dueAt and
notBefore are unchanged; changing location does not change task order or time.

The existing UI still only knows locationId; it does not yet display custom names.
B must use the new explicit metadata in task/series editors, timeline/results and
Where display, retaining legacy locationId lookup only for legacy blocks. Do not
call an explicit choice a scheduler default or imply it has been booked. Keep the
recommendation algorithm independent; recommendations are not assigned locations.

The same metadata passes through generateMockSchedule, generateSchedule (both
intensities) and generateMultiDaySchedule without new call options. Multi-day
output.tasks is display data, not input for the next generation. The scheduler
validates explicit campus IDs; standalone recurrence generation validates only
shape because it has no location catalog.

Checks: `node --test tests/task-locations.test.ts`, `node --test tests/*.test.ts`,
`node tests/render-check.mjs`, `npm run build` (includes TypeScript).
