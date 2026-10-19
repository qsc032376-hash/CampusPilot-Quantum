# Campus locations module

Feature module for verified Ohio State study locations, official reservation
links, and a deterministic location recommender.

Built for the CampusPilot hackathon on **2026-10-17**; official location snapshot
updated **2026-10-19**. This module does **not**
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
  officialName?: string;
  provenance: LocationProvenance;
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
  types.ts                  CampusLocationDetails, provenance types
  campusLocations.ts        Verified IDs/names/addresses + toScheduleLocations()
  officialSnapshot.ts       Dated official building/study-space hours and rules
  simulatedAvailability.ts  Clearly labelled mock weekly hours (still used by recommender)
  recommendLocations.ts     Pure matching/ranking helper
  index.ts                  Public exports
  README.md                 This document
tests/
  campus-locations.test.ts          39 node:test checks
  campus-locations-snapshot.test.ts 17 snapshot checks
```

## Verified locations (2026-10-19)

All official pages below returned HTTP 200 and were read on 2026-10-19.
`reservable` is true only where an official page explicitly offers study-room
booking. It does **not** mean a room is free now.

| Location | Address | Bookable study rooms | Official booking page | Official info page |
| --- | --- | --- | --- | --- |
| Thompson Library | 1858 Neil Avenue Mall, 43210 | Yes | [Libraries room booking](https://libraryroombooking.cloud.osu.edu/) | [library.osu.edu/locations/thompson](https://library.osu.edu/locations/thompson) |
| 18th Avenue Library | 175 West 18th Avenue | Yes | [Libraries room booking](https://libraryroombooking.cloud.osu.edu/) | [library.osu.edu/locations/18th](https://library.osu.edu/locations/18th) |
| Health Sciences Library | 376 W. 10th Avenue (Prior Hall) | Yes | [HSL LibCal](https://hsl-osu.libcal.com/spaces?lid=694&gid=24674) | [hsl.osu.edu location page](https://hsl.osu.edu/using-library/visit/location-hours-and-parking) |
| FAES Library & Student Success Center (official: Food, Agricultural & Environmental Sciences Library) | 045 Agricultural Administration Building, 2120 Fyffe Rd | Yes | [Libraries room booking](https://libraryroombooking.cloud.osu.edu/) | [library.osu.edu/locations/faes](https://library.osu.edu/locations/faes) |
| Ohio Union | 1739 N. High Street | **No verified individual booking** | — | [ohiounion.osu.edu/visiting/hours](https://ohiounion.osu.edu/visiting/hours) |

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
  lists event/meeting rooms rented through Student Life Event Services. It is
  included as a walk-in study spot only. A separate individual study-room
  booking entry point was **not verified**; this is not a claim that no such
  option exists.

Unverified or corrected details are called out rather than guessed.

### Coordinate sources

Coordinates are official OSU FITS GIS building points, queried from the
[OSU Basemap Buildings layer](https://gissvc.osu.edu/arcgis/rest/services/OSUMaps/BaseMap_RO/MapServer/28)
by building number. Each point is a **building centroid, not an entrance**;
precision was not field-verified. They are used only for walking-time ranking,
not navigation or accessibility.

| Location | OSU building ID | Coordinate system | How the point was obtained |
| --- | --- | --- | --- |
| Thompson Library | 0050 | WGS84 (EPSG:4326) | GIS `Latitude`/`Longitude` fields for `BLDG_NUM` |
| 18th Avenue Library | 0005 | WGS84 (EPSG:4326) | same |
| Health Sciences Library | 0302 | WGS84 (EPSG:4326) | same (Prior Hall) |
| FAES Library | 0003 | WGS84 (EPSG:4326) | same (Agricultural Administration) |
| Ohio Union | 0161 | WGS84 (EPSG:4326) | same |

The earlier OpenStreetMap points were replaced by this official snapshot. The
GIS layer is a facilities reference, not a routing or entrance service.

Other corrections:

- The old HSL URL `/dept/using-the-library/reserve-study-rooms` returns 404;
  the current verified path is `/reserve-space/study-rooms`.
- `union.osu.edu` is the Union County Extension office. The student union is
  `ohiounion.osu.edu`.
- No live availability, occupancy or reservation status was found or verified.

## Official hours snapshot (2026-10-19)

`officialSnapshot.ts` stores a **dated** official snapshot. It is not live and
does not claim real-time availability.

- Libraries (Thompson, 18th Avenue, FAES): **2026-10-18 to 2026-10-24**
- Health Sciences Library: **2026-10-19 to 2026-10-25**
- Ohio Union: **2026-10-19 to 2026-10-25** (regular fall/spring term week)

These dates are part of the data. Do not describe the hours as permanent.

### Building hours in the snapshot

- **Thompson**: Sun 11:00-24:00; Mon-Thu 7:30-24:00; Fri 7:30-22:00; Sat
  8:00-22:00.
- **18th Avenue**: Sun 7:30-24:00; Mon-Fri 24 hours (00:00-07:00 requires a
  current OSU ID); Friday closes at 23:59; Sat 7:30-24:00.
- **FAES**: Sun closed; Mon-Thu 8:00-18:00; Fri 8:00-17:00; Sat closed.
- **Health Sciences**: Mon-Thu 7:30-19:30; Fri 7:30-17:30; Sat 10:00-17:30;
  Sun 12:00-19:30.
- **Ohio Union**: regular term Mon-Fri 8:00-23:00; Sat/Sun 10:00-23:00.
  Academic breaks and summer use 8:00-20:00 weekdays and 10:00-20:00 weekends.

### Building hours are not study-space availability

- **Thompson Group Study Rooms**: Sun 11:00-23:30; Mon-Thu 7:30-23:30; Fri
  7:30-22:00; Sat 8:00-22:00. Rooms close 30 minutes before the building
  Sunday-Thursday.
- **18th Avenue Group Study Rooms**: the hours page lists them separately, but
  the full weekly room row was not captured. `studySpaceHours` is intentionally
  omitted and marked unverified. The building's 24-hour access is **not**
  24-hour room availability.
- **Health Sciences study rooms**: the HSL page says reservations are during
  normal operating hours; LibCal shows no separate room-hours row. Room-level
  hours are unverified; use the LibCal UI.
- **FAES study rooms**: no separate FAES room hours were published on the hours
  page. Room availability is only in the Libraries booking UI and was not
  verified.
- **Ohio Union**: no bookable individual study room was verified. Building
  hours are not study-room availability; the listed rooms are event spaces.

### Booking rules in the snapshot

- **Thompson / 18th / FAES**: OSU students, faculty and staff; group study,
  not individual study; up to 4 hours; same day up to one week ahead; a group
  more than 15 minutes late forfeits the room; unscheduled rooms are walk-in
  with group priority.
- **Health Sciences**: 3rd floor; up to 5 people; 2-hour reservations; up to 3
  days ahead; online or phone; rooms may be released if unoccupied after 10
  minutes; Extended Library Access hours are first-come and not reservable.
- **Ohio Union**: listed rooms are event/meeting spaces handled by Student Life
  Event Services. No individual study-room booking entry point was verified;
  this does not prove that none exists.

`officialSnapshot.ts` is intentionally not wired into the recommender yet.
`recommendLocations()` and `isLocationOpen()` still use
`SIMULATED_AVAILABILITY`; D will integrate the dated snapshot in a later change.

## Simulated availability

`simulatedAvailability.ts` contains hand-entered weekly windows. Every record
has `source: 'simulated'` and a note, and the module exports
`AVAILABILITY_DISCLAIMER`. Recommendation reasons also say
"(simulated hours)".

This is still the recommender's input. The dated official snapshot above is
separate and is not substituted here.

| Location | Mon-Fri | Sat | Sun |
| --- | --- | --- | --- |
| Thompson | 7:30 a.m.-11 p.m. (Fri to 8 p.m.) | 9 a.m.-9 p.m. | 10 a.m.-11 p.m. |
| 18th Avenue | all day (Sun 7:30 a.m.-Fri midnight pattern) | 7:30 a.m.-midnight | 7:30 a.m.-midnight |
| Health Sciences | 8 a.m.-8 p.m. | 10 a.m.-6 p.m. | noon-8 p.m. |
| FAES | 8 a.m.-5 p.m. | closed | closed |
| Ohio Union | 8 a.m.-11 p.m. | 10 a.m.-11 p.m. | 10 a.m.-11 p.m. |

The 18th Avenue and Ohio Union windows are based on published hours; the others
are estimates. **All are static**: holidays, fall break, exams and summer hours
are not handled, and nothing is fetched at runtime. The windows are per calendar
day and cannot cross midnight; "overnight" here only means early-morning hours
on the stated date.

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

interface LocationRecommendation {
  location: CampusLocationDetails;
  score: number;
  walkMinutes: number | null;
  reasons: readonly string[];
}
```

A block must start and end on the same calendar day. It cannot cross midnight:
`endMinutes <= startMinutes` is rejected, and 1440 means midnight at the end of
that date. "Overnight" refers only to early-morning hours such as 02:00-04:00 on
the stated day, not a span across two dates.

Determinism and edge cases:

- A location is included only if **one** simulated window fully covers the
  block (18th Avenue's all-day window also covers early-morning blocks such as
  02:00-04:00).
- Filters run before scoring.
- Score: 50 for a matching simulated open window, +20 when official room
  booking is offered, plus `max(0, 30 - walkMinutes)` when an origin exists.
  There is no distance bonus and `walkMinutes` is `null` without an origin.
- Sort: score descending, then shorter walk, then name, then ID using
  locale-independent comparison. Same input always gives the same output,
  even when two locations have the same name.
- No matching location, no availability record, or an empty availability array
  returns `[]` — never throws.
- Invalid blocks throw `RangeError` (end before start, minutes outside 0-1440,
  unknown day). A negative or non-finite `maxWalkMinutes` or invalid latitude/
  longitude also throws.
- Walking time is straight-line distance × 1.25 at 80 m/min, rounded up.
  Identical points return 0 minutes; any positive distance returns at least 1.
  It is a ranking estimate, not a route or an accessibility measure.

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

The official snapshot is data-only for now. If B renders it, use
`OFFICIAL_SNAPSHOT_DISCLAIMER` and show the applicable date range; never label
it "open now" or treat building hours as room availability. The existing
recommendation list still uses simulated hours until D switches it.

### UI handoff for B

In a component under `src/ui/components/`, use this import path. For the
sample's Monday 11:00 a.m.–noon study block, call the function with campus-local
minutes after midnight. The result is an array, so render every item rather
than only `matches[0]`:

```ts
import {
  AVAILABILITY_DISCLAIMER,
  recommendLocations,
} from '../../features/campus-locations/index.ts';

const matches = recommendLocations(
  { day: 'Mon', startMinutes: 11 * 60, endMinutes: 12 * 60 },
  { requireReservable: false, categoryFilter: [] },
);

// matches.map(({ location, score, walkMinutes, reasons }) => ...)
// Display AVAILABILITY_DISCLAIMER beside the list.
```

`matches` contains five items with the current simulated Monday hours. Each
item has `location.id` (the canonical key), `location.name`, `address`,
`category`, `reservable`, optional `reservationUrl` and `infoUrl`; `score` is
the ranking number, `walkMinutes` is `null` without `origin`, and `reasons`
contains display text including the **simulated hours** label. `score` is not
live occupancy or a room booking status. With no `origin`, reservable places
score 70 and Ohio Union scores 50; tied places sort by name, then ID. An empty
array means no candidate passed all filters.

Scheduler block timestamps are UTC ISO strings, but `StudyBlockWindow` takes
`America/New_York` weekday and wall-clock minutes. Convert **both** instants
using `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`; do not use
`getUTCDay()`, the viewer's local time zone, or a fixed UTC offset. Check that
the converted start and end belong to the same campus-local date before
calling this same-day API. A block crossing a daylight-saving transition also
needs explicit handling: the repeated fall hour cannot be represented by one
increasing `startMinutes`/`endMinutes` pair, and the spring gap distorts elapsed
minutes. Do not silently convert such a block into a misleading window.

Suggested UI conversion fixtures (UTC → `America/New_York`):

| UTC instant | Expected campus-local time |
| --- | --- |
| `2026-10-19T15:00:00Z` | Mon 2026-10-19 11:00, GMT-4 |
| `2026-10-20T01:00:00Z` | Mon 2026-10-19 21:00, GMT-4 |
| `2026-03-08T06:30:00Z` / `2026-03-08T07:30:00Z` | Sun 01:30 GMT-5 / Sun 03:30 GMT-4 (spring transition) |
| `2026-11-01T05:30:00Z` / `2026-11-01T06:30:00Z` | Sun 01:30 GMT-4 / Sun 01:30 GMT-5 (repeated fall hour) |

## Tests

From the repository root:

```bash
node --test tests/campus-locations.test.ts tests/campus-locations-snapshot.test.ts
```

Expected: **39/39 location checks and 17/17 snapshot checks** (56 total). Both
files use Node's built-in test runner and assertions; no test dependency is
added.

Run the scheduler suite and type/build checks too:

```bash
node --test tests/scheduler.test.ts tests/campus-locations.test.ts tests/campus-locations-snapshot.test.ts
npm test          # existing script, still scheduler-only
npx tsc --noEmit
npm run build     # tsc --noEmit && vite build
```

`package.json` was not changed, so `npm test` intentionally does not include the
new file. The lead can add it to the script when merging.

## Limitations

- **No live availability.** Nothing is scraped, polled or reserved. Opening the
  official page is the whole MVP.
- **Dated hours snapshot.** The official hours apply only to 2026-10-18 to
  2026-10-25; they are not permanent and ignore later holidays, breaks and
  exams. The recommender still uses simulated windows until D integrates the
  snapshot.
- **Official building centroids, not entrances.** Precision was not
  field-verified; walking estimates are not routing or accessibility aware.
- **Five locations**, Columbus campus only.
- **Booking eligibility is not checked.** OSU login and room policies are the
  student's responsibility on the official site.
- **Ohio Union has no verified individual study-room booking entry point.**
  Only event spaces are documented; this is not a claim that no option exists.
- **The booking portal is a general entry point**, not a deep link to a specific
  room or date.
- The module is not yet wired into `src/main.tsx` or `src/sample.ts`; that is a
  deliberate boundary because the app shell belongs to the technical lead.

## Sources (read 2026-10-19)

- [Libraries group study rooms](https://library.osu.edu/group-study-rooms-for-ohio-state-students-faculty-and-staff)
- [Libraries Reserve a Room](https://library.osu.edu/roomreservation)
- [Libraries room booking portal](https://libraryroombooking.cloud.osu.edu/)
- [Libraries locations JSON:API](https://library.osu.edu/jsonapi/node/location)
- [Libraries hours](https://library.osu.edu/hours)
- [Thompson Library](https://library.osu.edu/locations/thompson)
- [18th Avenue Library](https://library.osu.edu/locations/18th)
- [FAES Library](https://library.osu.edu/locations/faes)
- [Health Sciences Library location/hours](https://hsl.osu.edu/using-library/visit/location-hours-and-parking)
- [Health Sciences Library study rooms](https://hsl.osu.edu/reserve-space/study-rooms)
- [HSL LibCal hours](https://hsl-osu.libcal.com/hours/)
- [HSL LibCal space availability](https://hsl-osu.libcal.com/spaces?lid=694&gid=24674)
- [Ohio Union hours](https://ohiounion.osu.edu/visiting/hours)
- [Ohio Union spaces](https://ohiounion.osu.edu/whats-inside/our-spaces)
- Coordinates: [OSU FITS GIS OSU Basemap Buildings layer](https://gissvc.osu.edu/arcgis/rest/services/OSUMaps/BaseMap_RO/MapServer/28) (see the coordinate table above).
