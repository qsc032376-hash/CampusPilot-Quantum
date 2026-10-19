import test from 'node:test';
import assert from 'node:assert/strict';
import type { CampusLocation } from '../src/types.ts';
import {
  AVAILABILITY_DISCLAIMER,
  CAMPUS_LOCATIONS,
  DAYS_OF_WEEK,
  SIMULATED_AVAILABILITY,
  estimateWalkMinutes,
  formatClockTime,
  formatTimeRange,
  isLocationOpen,
  recommendLocations,
  toScheduleLocations,
} from '../src/features/campus-locations/index.ts';

const mondayMorning = { day: 'Mon', startMinutes: 600, endMinutes: 720 } as const;
const fromThompson = { lat: 39.99925188, lng: -83.01488152 };
const ohioUnion = { lat: 39.99765973, lng: -83.00864174 };

// --- Static data -----------------------------------------------------------

test('1. has five campus locations', () => {
  assert.equal(CAMPUS_LOCATIONS.length, 5);
});

test('2. location ids are unique', () => {
  const ids = CAMPUS_LOCATIONS.map((location) => location.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('3. every location has a non-empty id and name', () => {
  for (const location of CAMPUS_LOCATIONS) {
    assert.ok(location.id.length > 0);
    assert.ok(location.name.length > 0);
  }
});

test('4. every official info URL uses HTTPS', () => {
  for (const location of CAMPUS_LOCATIONS) {
    assert.match(location.infoUrl, /^https:\/\//);
  }
});

test('5. every reservable location exposes a booking URL', () => {
  for (const location of CAMPUS_LOCATIONS.filter((item) => item.reservable)) {
    assert.ok(location.reservationUrl, `${location.name} should have a reservation URL`);
  }
});

test('6. non-reservable locations expose no booking URL', () => {
  for (const location of CAMPUS_LOCATIONS.filter((item) => !item.reservable)) {
    assert.equal(location.reservationUrl, undefined);
  }
});

test('7. every booking URL uses HTTPS', () => {
  for (const location of CAMPUS_LOCATIONS) {
    if (location.reservationUrl) {
      assert.match(location.reservationUrl, /^https:\/\//);
    }
  }
});

test('8. every location has a street address', () => {
  for (const location of CAMPUS_LOCATIONS) {
    assert.ok(location.address.length > 10);
  }
});

test('9. coordinates fall inside the Columbus campus area', () => {
  for (const location of CAMPUS_LOCATIONS) {
    assert.ok(location.coordinates.lat > 39.98 && location.coordinates.lat < 40.02);
    assert.ok(location.coordinates.lng > -83.05 && location.coordinates.lng < -82.99);
  }
});

// --- Shared-interface adapter ----------------------------------------------

test('10. toScheduleLocations returns only the shared id and name fields', () => {
  const shared: readonly CampusLocation[] = CAMPUS_LOCATIONS;
  assert.equal(shared.length, CAMPUS_LOCATIONS.length);
  const plain = toScheduleLocations();
  assert.equal(plain.length, 5);
  assert.deepEqual(Object.keys(plain[0]!).sort(), ['id', 'name']);
  assert.deepEqual(plain[0], { id: 'thompson-library', name: 'Thompson Library' });
});

// --- Simulated availability ------------------------------------------------

test('11. every location has an availability record', () => {
  const ids = new Set(SIMULATED_AVAILABILITY.map((record) => record.locationId));
  for (const location of CAMPUS_LOCATIONS) {
    assert.ok(ids.has(location.id), `${location.name} is missing availability`);
  }
});

test('12. there are no orphan availability records', () => {
  for (const record of SIMULATED_AVAILABILITY) {
    assert.ok(CAMPUS_LOCATIONS.some((location) => location.id === record.locationId));
  }
});

test('13. every availability record is labelled simulated', () => {
  for (const record of SIMULATED_AVAILABILITY) {
    assert.equal(record.source, 'simulated');
  }
});

test('14. every location has all seven days', () => {
  for (const record of SIMULATED_AVAILABILITY) {
    assert.equal(Object.keys(record.weekly).length, 7);
    for (const day of DAYS_OF_WEEK) {
      assert.ok(Array.isArray(record.weekly[day]));
    }
  }
});

test('15. the disclaimer says the data is simulated and not live', () => {
  assert.match(AVAILABILITY_DISCLAIMER, /simulated/i);
  assert.match(AVAILABILITY_DISCLAIMER, /not live/i);
});

// --- Known opening and closing windows -------------------------------------

test('16. Thompson is open on Monday 10:00-12:00', () => {
  assert.equal(isLocationOpen('thompson-library', mondayMorning), true);
});

test('17. FAES is closed on Saturday', () => {
  assert.equal(isLocationOpen('faes-library', { day: 'Sat', startMinutes: 600, endMinutes: 720 }), false);
});

test('18. 18th Avenue is open in the early morning on Wednesday', () => {
  assert.equal(isLocationOpen('18th-avenue-library', { day: 'Wed', startMinutes: 120, endMinutes: 240 }), true);
});

test('19. Ohio Union is closed at 3:00 a.m.', () => {
  assert.equal(isLocationOpen('ohio-union', { day: 'Tue', startMinutes: 180, endMinutes: 240 }), false);
});

// --- Recommendation behaviour ----------------------------------------------

test('20. Monday 10:00-12:00 returns all five locations', () => {
  assert.equal(recommendLocations(mondayMorning).length, 5);
});

test('21. results are sorted by descending score', () => {
  const results = recommendLocations(mondayMorning);
  for (let index = 1; index < results.length; index += 1) {
    assert.ok(results[index - 1]!.score >= results[index]!.score);
  }
});

test('22. the walk filter keeps only short walks', () => {
  const nearby = recommendLocations(mondayMorning, { origin: fromThompson, maxWalkMinutes: 10 });
  assert.ok(nearby.length > 0);
  for (const result of nearby) {
    assert.ok((result.walkMinutes ?? 0) <= 10);
  }
});

test('23. the walk filter excludes FAES when starting from Thompson', () => {
  const nearby = recommendLocations(mondayMorning, { origin: fromThompson, maxWalkMinutes: 10 });
  assert.ok(nearby.every((result) => result.location.id !== 'faes-library'));
  assert.ok(nearby.some((result) => result.location.id === 'thompson-library'));
});

test('24. requireReservable excludes the Ohio Union', () => {
  const results = recommendLocations(mondayMorning, { requireReservable: true });
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.location.reservable));
  assert.ok(results.every((result) => result.location.id !== 'ohio-union'));
});

test('25. the category filter keeps only libraries', () => {
  const results = recommendLocations(mondayMorning, { categoryFilter: ['library'] });
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.location.category === 'library'));
});

// --- Edge cases and helpers ------------------------------------------------

test('26. an invalid study block is rejected with RangeError', () => {
  assert.throws(() => recommendLocations({ day: 'Mon', startMinutes: 720, endMinutes: 600 }), RangeError);
  assert.throws(() => recommendLocations({ day: 'Mon', startMinutes: -1, endMinutes: 60 }), RangeError);
});

test('27. empty availability returns no matches', () => {
  assert.deepEqual(recommendLocations(mondayMorning, {}, { availability: [] }), []);
});

test('28. walk estimates are symmetric and formatting is correct', () => {
  const there = estimateWalkMinutes(fromThompson, ohioUnion);
  const back = estimateWalkMinutes(ohioUnion, fromThompson);
  assert.equal(there, back);
  assert.ok(there > 0 && there < 30);
  assert.equal(formatClockTime(0), '12:00 AM');
  assert.equal(formatClockTime(540), '9:00 AM');
  assert.equal(formatClockTime(720), '12:00 PM');
  assert.equal(formatTimeRange({ startMinutes: 0, endMinutes: 1440 }), 'all day');
  assert.equal(formatTimeRange({ startMinutes: 450, endMinutes: 1440 }), '7:30 AM–midnight');
});

test('29. identical coordinates return 0 minutes and survive maxWalkMinutes: 0', () => {
  assert.equal(estimateWalkMinutes(fromThompson, fromThompson), 0);

  const results = recommendLocations(mondayMorning, { origin: fromThompson, maxWalkMinutes: 0 });
  assert.deepEqual(results.map((result) => result.location.id), ['thompson-library']);
  assert.equal(results[0]!.walkMinutes, 0);

  // Normal positive limits still filter as before.
  const nearby = recommendLocations(mondayMorning, { origin: fromThompson, maxWalkMinutes: 5 });
  assert.ok(nearby.length > 0);
  assert.ok(nearby.every((result) => (result.walkMinutes ?? 0) <= 5));
  assert.ok(nearby.every((result) => result.location.id !== 'faes-library'));
});

test('30. Ohio Union reason says booking is unverified, not unavailable', () => {
  const results = recommendLocations(mondayMorning);
  const union = results.find((result) => result.location.id === 'ohio-union');
  assert.ok(union, 'Ohio Union should be recommended in the Monday window');

  const reason = union.reasons.join(' ');
  assert.match(reason, /Individual study-room booking has not been verified\./);
  assert.doesNotMatch(reason, /no advance study-room booking/i);
  assert.doesNotMatch(reason, /no bookable|cannot be booked|no individual study-room booking/i);

  // Other locations keep their booking reason, and ordering is unchanged.
  const thompson = results.find((result) => result.location.id === 'thompson-library');
  assert.ok(thompson?.reasons.includes('Official study-room booking is offered; room availability is unverified.'));
  assert.deepEqual(results.map((result) => result.location.id), [
    '18th-avenue-library',
    'faes-library',
    'health-sciences-library',
    'thompson-library',
    'ohio-union',
  ]);
});

test('31. empty, single and multiple matches follow the simulated weekday windows', () => {
  assert.deepEqual(
    recommendLocations({ day: 'Sun', startMinutes: 0, endMinutes: 60 }),
    [],
  );
  assert.deepEqual(
    recommendLocations({ day: 'Mon', startMinutes: 120, endMinutes: 240 }).map((item) => item.location.id),
    ['18th-avenue-library'],
  );
  assert.deepEqual(
    recommendLocations({ day: 'Mon', startMinutes: 660, endMinutes: 720 }).map((item) => item.location.id),
    ['18th-avenue-library', 'faes-library', 'health-sciences-library', 'thompson-library', 'ohio-union'],
  );
  assert.deepEqual(
    recommendLocations({ day: 'Sat', startMinutes: 540, endMinutes: 600 }).map((item) => item.location.id),
    ['18th-avenue-library', 'thompson-library'],
  );
});

test('32. a block must fit within one window, including exact opening and closing boundaries', () => {
  const closing = { day: 'Mon', startMinutes: 960, endMinutes: 1020 } as const;
  assert.ok(recommendLocations(closing).some((item) => item.location.id === 'faes-library'));
  assert.ok(!recommendLocations({ ...closing, endMinutes: 1021 }).some((item) => item.location.id === 'faes-library'));
  assert.ok(!recommendLocations({ day: 'Mon', startMinutes: 479, endMinutes: 540 }).some((item) => item.location.id === 'faes-library'));
  assert.ok(recommendLocations({ day: 'Mon', startMinutes: 480, endMinutes: 540 }).some((item) => item.location.id === 'faes-library'));
  assert.deepEqual(
    recommendLocations({ day: 'Fri', startMinutes: 1380, endMinutes: 1440 }).map((item) => item.location.id),
    ['18th-avenue-library'],
  );
});

test('33. separate adjacent windows cannot be combined to cover a block', () => {
  const [thompson] = CAMPUS_LOCATIONS;
  const [thompsonHours] = SIMULATED_AVAILABILITY;
  const availability = [{
    ...thompsonHours,
    weekly: { ...thompsonHours.weekly, Mon: [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 660, endMinutes: 720 },
    ] },
  }];
  assert.deepEqual(recommendLocations(mondayMorning, {}, { locations: [thompson], availability }), []);
  assert.equal(recommendLocations({ day: 'Mon', startMinutes: 600, endMinutes: 660 }, {}, { locations: [thompson], availability }).length, 1);
});

test('34. booking and category filters intersect and an empty category list applies no filter', () => {
  assert.deepEqual(
    recommendLocations(mondayMorning, { requireReservable: true }).map((item) => item.location.id),
    ['18th-avenue-library', 'faes-library', 'health-sciences-library', 'thompson-library'],
  );
  assert.deepEqual(
    recommendLocations(mondayMorning, { categoryFilter: ['student-center'] }).map((item) => item.location.id),
    ['ohio-union'],
  );
  assert.deepEqual(
    recommendLocations(mondayMorning, { requireReservable: true, categoryFilter: ['student-center'] }),
    [],
  );
  assert.deepEqual(
    recommendLocations(mondayMorning, { categoryFilter: [] }),
    recommendLocations(mondayMorning),
  );
});

test('35. walking limit uses the origin, while no origin keeps unknown walking time null', () => {
  const nearby = recommendLocations(mondayMorning, { origin: fromThompson, maxWalkMinutes: 5 });
  assert.deepEqual(nearby.map((item) => [item.location.id, item.walkMinutes, item.score]), [
    ['thompson-library', 0, 100],
    ['18th-avenue-library', 5, 95],
  ]);
  const withoutOrigin = recommendLocations(mondayMorning, { maxWalkMinutes: 0 });
  assert.deepEqual(withoutOrigin, recommendLocations(mondayMorning));
  assert.ok(withoutOrigin.every((item) => item.walkMinutes === null));
  assert.ok(withoutOrigin.every((item) => item.reasons.every((reason) => !reason.includes('min walk'))));
});

test('36. missing availability is excluded and recommendation IDs match the canonical dataset', () => {
  const availability = SIMULATED_AVAILABILITY.filter((record) => record.locationId !== 'thompson-library');
  const results = recommendLocations(mondayMorning, {}, { availability });
  assert.deepEqual(results.map((item) => item.location.id), [
    '18th-avenue-library', 'faes-library', 'health-sciences-library', 'ohio-union',
  ]);
  const knownIds = new Set(CAMPUS_LOCATIONS.map((location) => location.id));
  assert.ok(results.every((item) => knownIds.has(item.location.id)));
  assert.ok(!results.some((item) => item.location.id === 'thompson'));
});

test('37. no-origin scores and reasons describe simulated hours, not live availability', () => {
  const results = recommendLocations(mondayMorning);
  assert.deepEqual(results.map((item) => item.score), [70, 70, 70, 70, 50]);
  for (const item of results) {
    assert.equal(item.walkMinutes, null);
    assert.ok(item.reasons.some((reason) => /simulated hours/i.test(reason)));
    assert.ok(item.reasons.every((reason) => !/live|available now|free now/i.test(reason)));
    if (item.location.reservable) {
      assert.ok(item.reasons.some((reason) => /room availability is unverified/i.test(reason)));
    }
  }
  assert.match(AVAILABILITY_DISCLAIMER, /not live/i);
});

test('38. ties with the same name use ID, independent of source array order', () => {
  const [thompson, avenue] = CAMPUS_LOCATIONS;
  const [thompsonHours, avenueHours] = SIMULATED_AVAILABILITY;
  const locations = [
    { ...thompson, id: 'z-library', name: 'Same name' },
    { ...avenue, id: 'a-library', name: 'Same name' },
  ];
  const availability = [
    { ...thompsonHours, locationId: 'z-library' },
    { ...avenueHours, locationId: 'a-library' },
  ];
  for (const ordered of [locations, [...locations].reverse()]) {
    assert.deepEqual(
      recommendLocations(mondayMorning, {}, { locations: ordered, availability }).map((item) => item.location.id),
      ['a-library', 'z-library'],
    );
  }
});

test('39. invalid time, day, walking limit and coordinates fail clearly', () => {
  assert.throws(() => recommendLocations({ day: 'Mon', startMinutes: 600, endMinutes: 600 }), RangeError);
  assert.throws(() => recommendLocations({ day: 'Mon', startMinutes: 600.5, endMinutes: 720 }), RangeError);
  assert.throws(() => recommendLocations({ day: 'Mon', startMinutes: 600, endMinutes: 1441 }), RangeError);
  assert.throws(() => recommendLocations({ day: 'Bad' as 'Mon', startMinutes: 600, endMinutes: 720 }), RangeError);
  assert.throws(() => recommendLocations(mondayMorning, { maxWalkMinutes: Number.NaN }), RangeError);
  assert.throws(() => recommendLocations(mondayMorning, { maxWalkMinutes: -1 }), RangeError);
  assert.throws(() => recommendLocations(mondayMorning, { origin: { lat: Number.NaN, lng: -83 } }), RangeError);
  assert.throws(() => recommendLocations(mondayMorning, { origin: { lat: 91, lng: -83 } }), RangeError);
  assert.throws(() => estimateWalkMinutes(fromThompson, { lat: 40, lng: 181 }), RangeError);
});
