# Campus locations module

Feature module for verified Ohio State study locations, official reservation
links, and a deterministic location recommender.

Built for the CampusPilot hackathon on **2026-10-17**. This module does **not**
modify the shared interfaces, the scheduler, the app shell or any dependency.

## Shared interface: extended, not changed

`src/types.ts` defines the shared contract as:

```ts
export interface CampusLocation {
  id: string;
  name: string;
}
```

That file is owned by the technical lead and is untouched. This module adds a
local, richer subtype:

```ts
export interface CampusLocationDetails extends CampusLocation {
  category: 'library' | 'student-center';
  address: string;
  coordinates: { lat: number; lng: number };
  reservable: boolean;
  reservationUrl?: string;
  infoUrl: string;
  notes?: string;
}
```

Because it extends `CampusLocation`, every entry is still assignable to the
shared type. `toScheduleLocations()` makes the boundary explicit by returning
exactly `{ id, name }`, so the scheduler never receives extra fields.

```ts
import { toScheduleLocations } from './features/campus-locations/index.ts';

const locations = toScheduleLocations(); // CampusLocation[]
```

To wire the real data into the demo, the lead can change `src/sample.ts`
`locations` to `toScheduleLocations()`. That file was intentionally left alone.
If the shared interface later gains optional `address` / `reservationUrl`
fields, the local interface can be deleted without changing the data.

## Files

```
src/features/campus-locations/
  types.ts                  CampusLocationDetails, GeoPoint, category
  campusLocations.ts        Verified data + toScheduleLocations()
  simulatedAvailability.ts  Clearly labelled mock weekly hours
  recommendLocations.ts     Pure matching/ranking helper
  index.ts                  Public exports
  README.md                 This document
tests/
  campus-locations.test.ts  28 node:test checks
```

## Verified locations (2026-10-17)

All official pages below returned HTTP 200 and were read on 2026-10-17.
`reservable` is true only where an official page explicitly offers study-room
booking. It does **not** mean a room is free now.

| Location | Address | Bookable study rooms | Official booking page | Official info page |
| --- | --- | --- | --- | --- |
| Thompson Library | 1858 Neil Avenue Mall | Yes | [Libraries room booking](https://libraryroombooking.cloud.osu.edu/) | [library.osu.edu/locations/thompson](https://library.osu.edu/locations/thompson) |
| 18th Avenue Library | 175 West 18th Avenue | Yes | [Libraries room booking](https://libraryroombooking.cloud.osu.edu/) | [library.osu.edu/locations/18th](https://library.osu.edu/locations/18th) |
| Health Sciences Library | 376 West 10th Avenue (Prior Hall) | Yes | [HSL LibCal](https://hsl-osu.libcal.com/spaces?lid=694&gid=24674) | [hsl.osu.edu/reserve-space/study-rooms](https://hsl.osu.edu/reserve-space/study-rooms) |
| FAES Library & Student Success Center | 2120 Fyffe Road (Ag Admin, room 045) | Yes | [Libraries room booking](https://libraryroombooking.cloud.osu.edu/) | [library.osu.edu/locations/faes](https://library.osu.edu/locations/faes) |
| Ohio Union | 1739 N. High Street | **No** (event space only) | — | [ohiounion.osu.edu/visiting/hours](https://ohiounion.osu.edu/visiting/hours) |

What the pages say:

- **Thompson / 18th Avenue / FAES** — the [Libraries group study room page](https://library.osu.edu/group-study-rooms-for-ohio-state-students-faculty-and-staff)
  says rooms are requested through the Ohio State mobile app, for up to 4
  hours, from the same day up to a week ahead. The [Reserve a Room page](https://library.osu.edu/roomreservation)
  links the web booking portal. The portal returned HTTP 200 but is a
  JavaScript app; whether it prompts for OSU login was **not tested**.
- **Health Sciences Library** — the [study rooms page](https://hsl.osu.edu/reserve-space/study-rooms)
  says rooms are on the 3rd floor, seat up to 5, are booked for 2 hours, and
  open 3 days ahead. The LibCal page shows a live availability calendar; this
  module only links to it.
- **Ohio Union** — [Our Spaces](https://ohiounion.osu.edu/whats-inside/our-spaces)
  lists event/meeting rooms rented through Student Life Event Services, not
  individual study rooms. It is included as a walk-in study spot only.

Unverified or corrected details are called out rather than guessed:

- Coordinates are from OpenStreetMap building records, **not** an Ohio State
  API. They are approximate (roughly 10-30 m).
- The old HSL URL `/dept/using-the-library/reserve-study-rooms` returns 404;
  the current verified path is `/reserve-space/study-rooms`.
- `union.osu.edu` is the Union County Extension office. The student union is
  `ohiounion.osu.edu`.
- No live availability, occupancy or reservation status was found or verified.

## Simulated availability

`simulatedAvailability.ts` contains hand-entered weekly windows. Every record
has `source: 'simulated'` and a note, and the module exports
`AVAILABILITY_DISCLAIMER`. Recommendation reasons also say
"(simulated hours)".

| Location | Mon-Fri | Sat | Sun |
| --- | --- | --- | --- |
| Thompson | 7:30 a.m.-11 p.m. (Fri to 8 p.m.) | 9 a.m.-9 p.m. | 10 a.m.-11 p.m. |
| 18th Avenue | all day (Sun 7:30 a.m.-Fri midnight pattern) | 7:30 a.m.-midnight | 7:30 a.m.-midnight |
| Health Sciences | 8 a.m.-8 p.m. | 10 a.m.-6 p.m. | noon-8 p.m. |
| FAES | 8 a.m.-5 p.m. | closed | closed |
| Ohio Union | 8 a.m.-11 p.m. | 10 a.m.-11 p.m. | 10 a.m.-11 p.m. |

The 18th Avenue and Ohio Union windows are based on published hours; the others
are estimates. **All are static**: holidays, fall break, exams and summer hours
are not handled, and nothing is fetched at runtime.

## Helper API

```ts
recommendLocations(
  block: StudyBlockWindow,
  preferences?: LocationPreferences,
  options?: RecommendationOptions,
): LocationRecommendation[]

isLocationOpen(
  locationId: string,
  block: StudyBlockWindow,
  availability?: readonly SimulatedAvailability[],
): boolean

estimateWalkMinutes(from: GeoPoint, to: GeoPoint): number
formatClockTime(minutesAfterMidnight: number): string
formatTimeRange(range: TimeRange): string
toScheduleLocations(locations?: readonly CampusLocation[]): CampusLocation[]
```

```ts
interface StudyBlockWindow {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  startMinutes: number; // minutes after midnight, inclusive
  endMinutes: number;   // minutes after midnight, exclusive
}

interface LocationPreferences {
  origin?: GeoPoint;
  maxWalkMinutes?: number;   // ignored without origin
  requireReservable?: boolean;
  categoryFilter?: readonly CampusLocationCategory[]; // empty = no filter
}
```

Determinism and edge cases:

- A location is included only if **one** simulated window fully covers the
  block (18th Avenue's all-day window covers overnight blocks).
- Filters run before scoring.
- Sort: score descending, then shorter walk, then name using locale-independent
  comparison. Same input always gives the same output.
- No matching location, no availability record, or an empty availability array
  returns `[]` — never throws.
- Invalid blocks throw `RangeError` (end before start, minutes outside 0-1440,
  unknown day). A negative or non-finite `maxWalkMinutes` also throws.
- Walking time is straight-line distance × 1.25 at 80 m/min, rounded up. It is
  a ranking estimate, not a route or an accessibility measure.

Example:

```ts
import { recommendLocations } from './features/campus-locations/index.ts';

const matches = recommendLocations(
  { day: 'Tue', startMinutes: 14 * 60, endMinutes: 16 * 60 },
  { origin: { lat: 40.0016, lng: -83.0133 }, maxWalkMinutes: 12, requireReservable: true },
);

const top = matches[0];
const bookingUrl = top?.location.reservationUrl; // open it in a new tab
```

Only render a "Reserve" button when `location.reservationUrl` exists. The app
must not attempt login, form submission or booking.

## Tests

From the repository root:

```bash
node --test tests/campus-locations.test.ts
```

Expected: **28/28 passing**. The file uses Node's built-in test runner and
assertions, matching `tests/scheduler.test.ts`; no test dependency is added.

Run the existing scheduler suite too, to prove the shared code is untouched:

```bash
node --test tests/scheduler.test.ts tests/campus-locations.test.ts
npm test          # existing script, still scheduler-only
npm run build     # tsc --noEmit && vite build
```

`package.json` was not changed, so `npm test` intentionally does not include the
new file. The lead can add it to the script when merging.

## Limitations

- **No live availability.** Nothing is scraped, polled or reserved. Opening the
  official page is the whole MVP.
- **Static hours.** Simulated windows ignore holidays, breaks and exams.
- **Five locations**, Columbus campus only.
- **Approximate coordinates and walking times.** Not routing, not accessible
  route aware.
- **Booking eligibility is not checked.** OSU login and room policies are the
  student's responsibility on the official site.
- **The booking portal is a general entry point**, not a deep link to a specific
  room or date.
- The module is not yet wired into `src/main.tsx` or `src/sample.ts`; that is a
  deliberate boundary because the app shell belongs to the technical lead.

## Sources (fetched 2026-10-17)

- [Libraries group study rooms](https://library.osu.edu/group-study-rooms-for-ohio-state-students-faculty-and-staff)
- [Libraries Reserve a Room](https://library.osu.edu/roomreservation)
- [Libraries room booking portal](https://libraryroombooking.cloud.osu.edu/)
- [Thompson Library](https://library.osu.edu/locations/thompson)
- [18th Avenue Library](https://library.osu.edu/locations/18th)
- [FAES Library](https://library.osu.edu/locations/faes)
- [Health Sciences Library study rooms](https://hsl.osu.edu/reserve-space/study-rooms)
- [HSL LibCal space availability](https://hsl-osu.libcal.com/spaces?lid=694&gid=24674)
- [Ohio Union hours](https://ohiounion.osu.edu/visiting/hours)
- [Ohio Union spaces](https://ohiounion.osu.edu/whats-inside/our-spaces)
- Coordinates: [OpenStreetMap](https://www.openstreetmap.org/) building records
