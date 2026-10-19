import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScheduleRequest, StudyBlock } from '../src/types.ts';
import { buildLocationPlan, toStudyBlockWindow } from '../src/ui/locationPlan.ts';

function block(start: string, end: string, locationId = 'thompson'): StudyBlock {
  return { id: 'study-t1', taskId: 't1', title: 'Study', start, end, locationId };
}

function requestWith(locations: ScheduleRequest['locations']): ScheduleRequest {
  return {
    windowStart: '2026-10-19T09:00:00-04:00',
    windowEnd: '2026-10-19T17:00:00-04:00',
    classes: [],
    tasks: [{ id: 't1', title: 'Study', durationMinutes: 90, dueAt: '2026-10-19T17:00:00-04:00' }],
    unavailablePeriods: [],
    locations,
  };
}

const plainRequest = requestWith([{ id: 'thompson', name: 'Thompson Library' }]);

test('a same-day block becomes a campus-time window', () => {
  const window = toStudyBlockWindow('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00');
  assert.deepEqual(window, { day: 'Mon', startMinutes: 900, endMinutes: 990 });
});

test('a block crossing midnight cannot be expressed as one campus day', () => {
  assert.equal(toStudyBlockWindow('2026-10-19T23:30:00-04:00', '2026-10-20T01:00:00-04:00'), null);
});

test('several locations are recommended for an ordinary afternoon block', () => {
  const plan = buildLocationPlan(block('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00'), plainRequest);
  assert.equal(plan.status, 'ok');
  assert.equal(plan.recommendations.length, 5);
  const names = plan.recommendations.map((item) => item.location.name);
  assert.ok(names.includes('Thompson Library'));
  assert.ok(names.includes('Ohio Union'));
  assert.ok(names.includes('18th Avenue Library'));
  // Every reason says the hours are simulated rather than live.
  for (const recommendation of plan.recommendations) {
    assert.match(String(recommendation.reasons[0]), /simulated hours/i);
  }
});

test('a block open at only one place returns exactly one recommendation', () => {
  const plan = buildLocationPlan(block('2026-10-19T00:30:00-04:00', '2026-10-19T01:00:00-04:00'), plainRequest);
  assert.equal(plan.status, 'ok');
  assert.equal(plan.recommendations.length, 1);
  assert.equal(plan.recommendations[0].location.id, '18th-avenue-library');
});

test('a block outside every simulated window reports no match instead of throwing', () => {
  const plan = buildLocationPlan(block('2026-10-18T02:00:00-04:00', '2026-10-18T03:00:00-04:00'), plainRequest);
  assert.equal(plan.status, 'no-match');
  assert.deepEqual(plan.recommendations, []);
});

test('the scheduled location comes from the request, not from the recommender', () => {
  const plan = buildLocationPlan(block('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00'), plainRequest);
  assert.equal(plan.scheduled?.id, 'thompson');
  assert.equal(plan.scheduled?.name, 'Thompson Library');
});

test('a legacy id still resolves the verified record by name', () => {
  // Older sample data used `thompson`; the verified dataset uses `thompson-library`.
  const plan = buildLocationPlan(block('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00'), plainRequest);
  assert.equal(plan.scheduled?.details?.id, 'thompson-library');
  assert.equal(plan.scheduled?.details?.address, '1858 Neil Avenue Mall, Columbus, OH 43210');
});

test('a matching verified id exposes the location address', () => {
  const request = requestWith([{ id: 'thompson-library', name: 'Thompson Library' }]);
  const plan = buildLocationPlan(
    block('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00', 'thompson-library'),
    request,
  );
  assert.equal(plan.scheduled?.details?.address, '1858 Neil Avenue Mall, Columbus, OH 43210');
});

test('optional building, room and hours pass through untouched', () => {
  const request = requestWith([
    { id: 'thompson', name: 'Thompson Library', building: 'Thompson', room: 'Room 304', hours: 'Demo hours only' },
  ]);
  const plan = buildLocationPlan(block('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00'), request);
  assert.equal(plan.scheduled?.building, 'Thompson');
  assert.equal(plan.scheduled?.room, 'Room 304');
  assert.equal(plan.scheduled?.hours, 'Demo hours only');
});

test('a cross-midnight block degrades without a location list', () => {
  const plan = buildLocationPlan(block('2026-10-19T23:30:00-04:00', '2026-10-20T01:00:00-04:00'), plainRequest);
  assert.equal(plan.status, 'unavailable-window');
  assert.equal(plan.window, null);
  assert.deepEqual(plan.recommendations, []);
});

test('an empty availability dataset yields no match rather than an error', () => {
  const plan = buildLocationPlan(
    block('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00'),
    plainRequest,
    { availability: [] },
  );
  assert.equal(plan.status, 'no-match');
  assert.deepEqual(plan.recommendations, []);
});

test('the sample request uses ids that exist in the verified dataset', async () => {
  const { sampleRequest } = await import('../src/sample.ts');
  const { CAMPUS_LOCATIONS } = await import('../src/features/campus-locations/index.ts');
  const verifiedIds = new Set(CAMPUS_LOCATIONS.map((location) => location.id));

  assert.ok(sampleRequest.locations.length >= 2, 'sample should carry the verified list');
  for (const location of sampleRequest.locations) {
    assert.ok(verifiedIds.has(location.id), `${location.id} is not in CAMPUS_LOCATIONS`);
  }
});
