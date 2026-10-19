import test from 'node:test';
import assert from 'node:assert/strict';
import type { CampusLocation } from '../src/types.ts';
import {
  CAMPUS_LOCATIONS,
  DAYS_OF_WEEK,
  OFFICIAL_LOCATION_SNAPSHOTS,
  OFFICIAL_SNAPSHOT_DISCLAIMER,
  OFFICIAL_SNAPSHOT_VERIFIED_ON,
  toScheduleLocations,
} from '../src/features/campus-locations/index.ts';
import type { HoursSnapshot } from '../src/features/campus-locations/index.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function allHours(): readonly HoursSnapshot[] {
  return OFFICIAL_LOCATION_SNAPSHOTS.flatMap((snapshot) => [
    snapshot.buildingHours,
    ...(snapshot.studySpaceHours ?? []),
  ]);
}

test('S1. exactly five snapshots match the five canonical location IDs', () => {
  assert.equal(OFFICIAL_LOCATION_SNAPSHOTS.length, 5);
  const ids = OFFICIAL_LOCATION_SNAPSHOTS.map((snapshot) => snapshot.locationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const location of CAMPUS_LOCATIONS) {
    assert.ok(ids.includes(location.id), `${location.id} has no official snapshot`);
  }
});

test('S2. every location has identity and coordinate provenance that is not live', () => {
  for (const location of CAMPUS_LOCATIONS) {
    const { identity, coordinates } = location.provenance;
    assert.equal(identity.status, 'official-snapshot');
    assert.equal(identity.isLive, false);
    assert.match(identity.verifiedOn, ISO_DATE);
    assert.match(identity.sourceUrl, /^https:\/\//);
    assert.ok(identity.source.length > 0);
    assert.ok(identity.note.length > 0);

    assert.equal(coordinates.status, 'official-snapshot');
    assert.equal(coordinates.isLive, false);
    assert.match(coordinates.verifiedOn, ISO_DATE);
    assert.match(coordinates.sourceUrl, /^https:\/\//);
  }
});

test('S3. coordinate provenance records building ID, CRS and extraction', () => {
  for (const location of CAMPUS_LOCATIONS) {
    const provenance = location.provenance.coordinates;
    assert.match(provenance.buildingId, /^\d{4}$/);
    assert.equal(provenance.coordinateSystem, 'WGS84 (EPSG:4326)');
    assert.ok(provenance.extraction.length > 10);
    assert.ok(location.coordinates.lat > 39.98 && location.coordinates.lat < 40.02);
    assert.ok(location.coordinates.lng > -83.05 && location.coordinates.lng < -82.99);
  }
});

test('S4. every snapshot provenance URL uses HTTPS', () => {
  for (const snapshot of OFFICIAL_LOCATION_SNAPSHOTS) {
    assert.match(snapshot.buildingHours.provenance.sourceUrl, /^https:\/\//);
    assert.match(snapshot.booking.provenance.sourceUrl, /^https:\/\//);
    for (const hours of snapshot.studySpaceHours ?? []) {
      assert.match(hours.provenance.sourceUrl, /^https:\/\//);
    }
  }
});

test('S5. verified date and status are recorded for every snapshot fact', () => {
  for (const hours of allHours()) {
    assert.equal(hours.provenance.verifiedOn, OFFICIAL_SNAPSHOT_VERIFIED_ON);
    assert.equal(hours.provenance.isLive, false);
    assert.equal(hours.provenance.status, 'official-snapshot');
  }
  for (const snapshot of OFFICIAL_LOCATION_SNAPSHOTS) {
    assert.equal(snapshot.booking.provenance.verifiedOn, OFFICIAL_SNAPSHOT_VERIFIED_ON);
    assert.equal(snapshot.booking.provenance.isLive, false);
    assert.ok(['official-snapshot', 'unverified'].includes(snapshot.booking.provenance.status));
  }
});

test('S6. every hours snapshot has a valid applicable date range and time zone', () => {
  for (const hours of allHours()) {
    assert.match(hours.appliesFrom, ISO_DATE);
    assert.match(hours.appliesTo, ISO_DATE);
    assert.ok(hours.appliesFrom <= hours.appliesTo);
    assert.equal(hours.timeZone, 'America/New_York');
  }
});

test('S7. every weekly schedule has seven days and valid same-day ranges', () => {
  for (const hours of allHours()) {
    assert.equal(Object.keys(hours.weekly).length, 7);
    for (const day of DAYS_OF_WEEK) {
      assert.ok(Array.isArray(hours.weekly[day]));
      for (const range of hours.weekly[day]) {
        assert.ok(Number.isInteger(range.startMinutes));
        assert.ok(Number.isInteger(range.endMinutes));
        assert.ok(range.startMinutes >= 0);
        assert.ok(range.endMinutes <= 1440);
        assert.ok(range.startMinutes < range.endMinutes);
      }
    }
  }
});

test('S8. Thompson building hours and group-room hours are modelled separately', () => {
  const thompson = OFFICIAL_LOCATION_SNAPSHOTS.find((item) => item.locationId === 'thompson-library');
  assert.ok(thompson?.studySpaceHours?.[0]);
  const buildingMonday = thompson.buildingHours.weekly.Mon[0];
  const roomsMonday = thompson.studySpaceHours[0].weekly.Mon[0];
  assert.ok(buildingMonday);
  assert.ok(roomsMonday);
  assert.equal(buildingMonday.endMinutes, 1440);
  assert.equal(roomsMonday.endMinutes, 1410);
  assert.ok(roomsMonday.endMinutes < buildingMonday.endMinutes);
  assert.match(thompson.notes ?? '', /not room availability/i);
});

test('S9. Health Sciences snapshot matches the official LibCal hours', () => {
  const hsl = OFFICIAL_LOCATION_SNAPSHOTS.find((item) => item.locationId === 'health-sciences-library');
  assert.ok(hsl);
  assert.deepEqual(hsl.buildingHours.weekly.Mon, [{ startMinutes: 450, endMinutes: 1170 }]);
  assert.deepEqual(hsl.buildingHours.weekly.Fri, [{ startMinutes: 450, endMinutes: 1050 }]);
  assert.deepEqual(hsl.buildingHours.weekly.Sat, [{ startMinutes: 600, endMinutes: 1050 }]);
  assert.deepEqual(hsl.buildingHours.weekly.Sun, [{ startMinutes: 720, endMinutes: 1170 }]);
  assert.equal(hsl.studySpaceHours, undefined);
});

test('S10. FAES snapshot uses the published weekday hours and closed weekend', () => {
  const faes = OFFICIAL_LOCATION_SNAPSHOTS.find((item) => item.locationId === 'faes-library');
  assert.ok(faes);
  assert.deepEqual(faes.buildingHours.weekly.Mon, [{ startMinutes: 480, endMinutes: 1080 }]);
  assert.deepEqual(faes.buildingHours.weekly.Fri, [{ startMinutes: 480, endMinutes: 1020 }]);
  assert.deepEqual(faes.buildingHours.weekly.Sat, []);
  assert.deepEqual(faes.buildingHours.weekly.Sun, []);
});

test('S11. 18th Avenue room hours are explicitly left unverified', () => {
  const avenue = OFFICIAL_LOCATION_SNAPSHOTS.find((item) => item.locationId === '18th-avenue-library');
  assert.ok(avenue);
  assert.equal(avenue.studySpaceHours, undefined);
  assert.match(avenue.notes ?? '', /not captured|intentionally omitted/i);
  assert.match(avenue.notes ?? '', /not room availability/i);
});

test('S12. Ohio Union keeps booking unverified and does not claim absence', () => {
  const union = CAMPUS_LOCATIONS.find((item) => item.id === 'ohio-union');
  const snapshot = OFFICIAL_LOCATION_SNAPSHOTS.find((item) => item.locationId === 'ohio-union');
  assert.ok(union);
  assert.ok(snapshot);
  assert.equal(union.reservable, false);
  assert.equal(union.reservationUrl, undefined);
  assert.equal(snapshot.booking.provenance.status, 'unverified');
  assert.match(snapshot.booking.rules, /does not prove that none exists/i);
  assert.match(snapshot.notes ?? '', /not study-room availability/i);
});

test('S13. reservable flags and booking URLs stay consistent', () => {
  for (const location of CAMPUS_LOCATIONS) {
    if (location.reservable) {
      assert.match(location.reservationUrl ?? '', /^https:\/\//);
    } else {
      assert.equal(location.reservationUrl, undefined);
    }
  }
});

test('S14. the snapshot disclaimer says it is not live and not room availability', () => {
  assert.match(OFFICIAL_SNAPSHOT_DISCLAIMER, /not live/i);
  assert.match(OFFICIAL_SNAPSHOT_DISCLAIMER, /building hours/i);
  assert.match(OFFICIAL_SNAPSHOT_DISCLAIMER, /study room/i);
});

test('S15. detailed locations remain assignable to the shared CampusLocation contract', () => {
  const shared: readonly CampusLocation[] = CAMPUS_LOCATIONS;
  assert.equal(shared.length, 5);
  assert.equal(toScheduleLocations().length, 5);
  assert.deepEqual(Object.keys(toScheduleLocations()[0]!).sort(), ['id', 'name']);
});

test('S16. coordinate values match the OSU GIS building records used for this snapshot', () => {
  const expected = new Map<string, readonly [number, number]>([
    ['thompson-library', [39.99925188, -83.01488152]],
    ['18th-avenue-library', [40.0016329, -83.01333843]],
    ['health-sciences-library', [39.99477158, -83.0170996]],
    ['faes-library', [40.00542636, -83.02722587]],
    ['ohio-union', [39.99765973, -83.00864174]],
  ]);
  for (const location of CAMPUS_LOCATIONS) {
    const point = expected.get(location.id);
    assert.ok(point, `${location.id} is missing an expected point`);
    assert.equal(location.coordinates.lat, point[0]);
    assert.equal(location.coordinates.lng, point[1]);
  }
});

test('S17. FAES keeps the service name and records the official name', () => {
  const faes = CAMPUS_LOCATIONS.find((item) => item.id === 'faes-library');
  assert.ok(faes);
  assert.equal(faes.name, 'FAES Library & Student Success Center');
  assert.equal(faes.officialName, 'Food, Agricultural & Environmental Sciences Library');
  assert.match(faes.address, /Agricultural Administration Building/);
});
