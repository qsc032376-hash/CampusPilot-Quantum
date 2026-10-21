import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_CATEGORIES,
  MAP_CATEGORY_LABELS,
  buildBrowsingBounds,
  buildInitialBounds,
  filterMapLocations,
  isValidBuildingPoint,
  toMapLocations,
} from '../src/features/campus-map/mapLocations.ts';
import {
  MAP_DISCLAIMER,
  OSM_ATTRIBUTION_HTML,
  OSM_COPYRIGHT_URL,
  OSM_TILE_URL,
  REFERENCE_VIEW,
} from '../src/features/campus-map/config.ts';
import { CAMPUS_LOCATIONS } from '../src/features/campus-locations/index.ts';

function withCoordinates(lat: number, lng: number) {
  return {
    ...CAMPUS_LOCATIONS[0],
    id: 'synthetic',
    name: 'Synthetic place',
    coordinates: { lat, lng },
  };
}

test('every verified location becomes a map point', () => {
  const points = toMapLocations(CAMPUS_LOCATIONS, '2026-10-17');
  assert.equal(points.length, CAMPUS_LOCATIONS.length);
  assert.equal(points.length, 5);
  for (const point of points) {
    assert.ok(isValidBuildingPoint(point.lat, point.lng), point.id);
    assert.ok(point.infoUrl.startsWith('https://'), point.id);
    assert.equal(point.verifiedOn, '2026-10-17');
  }
});

test('invalid coordinates are skipped instead of widening the map', () => {
  for (const [lat, lng] of [
    [Number.NaN, -83.01],
    [40.0, Number.POSITIVE_INFINITY],
    [91, -83.01],
    [40.0, -181],
  ] as const) {
    const points = toMapLocations([withCoordinates(lat, lng)], '2026-10-17');
    assert.equal(points.length, 0, `${lat},${lng} must be skipped`);

    // Bounds must stay identical to the reference view when nothing is valid.
    const bounds = buildInitialBounds(points);
    assert.deepEqual(bounds, { ...REFERENCE_VIEW });
  }
});

test('the initial view contains the reference view and FAES', () => {
  const points = toMapLocations(CAMPUS_LOCATIONS, '2026-10-17');
  const bounds = buildInitialBounds(points);

  assert.ok(bounds.north >= REFERENCE_VIEW.north);
  assert.ok(bounds.south <= REFERENCE_VIEW.south);
  assert.ok(bounds.east >= REFERENCE_VIEW.east);

  // FAES sits west of the reference box, so the west edge must grow past it.
  const faes = CAMPUS_LOCATIONS.find((location) => location.id === 'faes-library');
  assert.ok(faes, 'FAES must exist in the verified snapshot');
  assert.ok(faes!.coordinates.lng < REFERENCE_VIEW.west, 'FAES is outside the reference box');
  assert.ok(bounds.west <= faes!.coordinates.lng, 'FAES must not be clipped');

  for (const point of points) {
    assert.ok(point.lat <= bounds.north && point.lat >= bounds.south, `${point.id} lat`);
    assert.ok(point.lng <= bounds.east && point.lng >= bounds.west, `${point.id} lng`);
  }
});

test('browsing bounds add margin around the initial view', () => {
  const bounds = buildInitialBounds(toMapLocations(CAMPUS_LOCATIONS, '2026-10-17'));
  const browsing = buildBrowsingBounds(bounds);
  assert.ok(browsing.north > bounds.north);
  assert.ok(browsing.south < bounds.south);
  assert.ok(browsing.east > bounds.east);
  assert.ok(browsing.west < bounds.west);
});

test('category filtering only uses categories the data supports', () => {
  const points = toMapLocations(CAMPUS_LOCATIONS, '2026-10-17');
  const libraries = filterMapLocations(points, new Set(['library']));
  const everything = filterMapLocations(points, new Set(MAP_CATEGORIES));

  assert.equal(libraries.length, 4);
  assert.ok(libraries.every((point) => point.category === 'library'));
  assert.equal(everything.length, 5);

  const studentCenter = filterMapLocations(points, new Set(['student-center']));
  assert.equal(studentCenter.length, 1);
  assert.equal(studentCenter[0].id, 'ohio-union');

  assert.deepEqual(MAP_CATEGORIES, ['library', 'student-center']);
  for (const category of MAP_CATEGORIES) {
    assert.ok(MAP_CATEGORY_LABELS[category]);
  }
});

test('tile configuration is explicit and attributed', () => {
  assert.equal(OSM_TILE_URL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(OSM_ATTRIBUTION_HTML, /OpenStreetMap/);
  assert.match(OSM_ATTRIBUTION_HTML, /openstreetmap\.org\/copyright/);
  assert.equal(OSM_COPYRIGHT_URL, 'https://www.openstreetmap.org/copyright');
  assert.match(MAP_DISCLAIMER, /building points/);
  assert.match(MAP_DISCLAIMER, /not an official campus boundary/);
  assert.match(MAP_DISCLAIMER, /No live/i);
});

test('the reference view is not treated as a campus boundary', () => {
  // It is a starting rectangle: FAES already falls outside it.
  const west = Math.min(...CAMPUS_LOCATIONS.map((location) => location.coordinates.lng));
  assert.ok(west < REFERENCE_VIEW.west);
});
