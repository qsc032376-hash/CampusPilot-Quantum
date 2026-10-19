import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScheduleRequest, StudyBlock } from '../src/types.ts';
import { buildLocationPlan, toStudyBlockWindow } from '../src/ui/locationPlan.ts';
import { sampleRequest } from '../src/sample.ts';
import { CAMPUS_LOCATIONS } from '../src/features/campus-locations/index.ts';

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
const AFTERNOON = ['2026-10-19T15:00:00-04:00', '2026-10-19T16:30:00-04:00'] as const;

// --- time conversion -------------------------------------------------------

test('an ordinary same-day block converts to a campus-time window', () => {
  assert.deepEqual(toStudyBlockWindow(AFTERNOON[0], AFTERNOON[1]), {
    ok: true,
    window: { day: 'Mon', startMinutes: 900, endMinutes: 990 },
  });
});

test('a block crossing midnight is rejected, not silently wrapped', () => {
  assert.deepEqual(toStudyBlockWindow('2026-10-19T23:30:00-04:00', '2026-10-20T01:00:00-04:00'), {
    ok: false,
    reason: 'crosses-midnight',
  });
});

test('an end before the start is rejected', () => {
  assert.deepEqual(toStudyBlockWindow('2026-10-19T16:30:00-04:00', '2026-10-19T15:00:00-04:00'), {
    ok: false,
    reason: 'invalid-range',
  });
});

// --- DST cases -------------------------------------------------------------

test('fall-back transition: EDT start to EST end is rejected as cross-DST', () => {
  // 01:30 EDT -> 01:45 EST looks like 15 wall minutes but is 75 real minutes.
  const result = toStudyBlockWindow('2026-11-01T01:30:00-04:00', '2026-11-01T01:45:00-05:00');
  assert.deepEqual(result, { ok: false, reason: 'crosses-dst' });
});

test('spring-forward transition: EST start to EDT end is rejected as cross-DST', () => {
  // 01:30 -> 03:30 on the spring-forward date skips the missing hour entirely.
  const result = toStudyBlockWindow('2027-03-14T01:30:00-05:00', '2027-03-14T03:30:00-04:00');
  assert.deepEqual(result, { ok: false, reason: 'crosses-dst' });
});

test('a block inside the repeated fall-back hour with one offset stays valid', () => {
  const result = toStudyBlockWindow('2026-11-01T01:10:00-04:00', '2026-11-01T01:20:00-04:00');
  assert.deepEqual(result, { ok: true, window: { day: 'Sun', startMinutes: 70, endMinutes: 80 } });
});

// --- second boundaries -----------------------------------------------------

test('a block with seconds is rejected instead of truncated', () => {
  assert.deepEqual(toStudyBlockWindow('2026-10-19T15:00:30-04:00', '2026-10-19T16:30:00-04:00'), {
    ok: false,
    reason: 'not-minute-aligned',
  });
  assert.deepEqual(toStudyBlockWindow('2026-10-19T15:00:00-04:00', '2026-10-19T16:30:30-04:00'), {
    ok: false,
    reason: 'not-minute-aligned',
  });
});

test('a block with milliseconds is rejected too', () => {
  assert.deepEqual(toStudyBlockWindow('2026-10-19T15:00:00.500-04:00', '2026-10-19T16:30:00-04:00'), {
    ok: false,
    reason: 'not-minute-aligned',
  });
});

// --- plan level ------------------------------------------------------------

test('several locations are recommended for an ordinary afternoon block', () => {
  const plan = buildLocationPlan(block(AFTERNOON[0], AFTERNOON[1]), plainRequest);
  assert.equal(plan.status, 'ok');
  assert.equal(plan.recommendations.length, 5);
  const names = plan.recommendations.map((item) => item.location.name);
  assert.ok(names.includes('Thompson Library'));
  assert.ok(names.includes('Ohio Union'));
  assert.ok(names.includes('18th Avenue Library'));
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
  const plan = buildLocationPlan(block(AFTERNOON[0], AFTERNOON[1]), plainRequest);
  assert.equal(plan.scheduled?.id, 'thompson');
  assert.equal(plan.scheduled?.name, 'Thompson Library');
});

test('a legacy id still resolves the verified record by name', () => {
  const plan = buildLocationPlan(block(AFTERNOON[0], AFTERNOON[1]), plainRequest);
  assert.equal(plan.scheduled?.details?.id, 'thompson-library');
  assert.equal(plan.canonicalScheduledId, 'thompson-library');
  assert.equal(plan.scheduled?.details?.address, '1858 Neil Avenue Mall, Columbus, OH 43210');
});

test('the scheduled place is flagged only when the recommender includes it', () => {
  const afternoon = buildLocationPlan(block(AFTERNOON[0], AFTERNOON[1], 'thompson-library'), sampleRequest);
  assert.equal(afternoon.status, 'ok');
  assert.equal(afternoon.scheduledIsRecommended, true);

  // 00:30 is outside Thompson's simulated hours, so the scheduler's location is
  // deliberately not in the recommendation list.
  const early = buildLocationPlan(block('2026-10-19T00:30:00-04:00', '2026-10-19T01:00:00-04:00', 'thompson-library'), sampleRequest);
  assert.equal(early.status, 'ok');
  assert.equal(early.scheduledIsRecommended, false);
  assert.ok(!early.recommendations.some((item) => item.location.id === 'thompson-library'));
});

test('a cross-DST block yields no recommendation list and no false verification', () => {
  const plan = buildLocationPlan(
    block('2026-11-01T01:30:00-04:00', '2026-11-01T01:45:00-05:00', 'thompson-library'),
    sampleRequest,
  );
  assert.equal(plan.status, 'crosses-dst');
  assert.equal(plan.window, null);
  assert.deepEqual(plan.recommendations, []);
  assert.equal(plan.scheduledIsRecommended, false);
  // The scheduler's assignment is still shown, just not claimed as verified.
  assert.equal(plan.scheduled?.name, 'Thompson Library');
});

test('a seconds-aligned block yields no recommendation list', () => {
  const plan = buildLocationPlan(block('2026-10-19T15:00:30-04:00', '2026-10-19T16:30:00-04:00'), plainRequest);
  assert.equal(plan.status, 'not-minute-aligned');
  assert.deepEqual(plan.recommendations, []);
});

test('optional building, room and hours pass through untouched', () => {
  const request = requestWith([
    { id: 'thompson', name: 'Thompson Library', building: 'Thompson', room: 'Room 304', hours: 'Demo hours only' },
  ]);
  const plan = buildLocationPlan(block(AFTERNOON[0], AFTERNOON[1]), request);
  assert.equal(plan.scheduled?.building, 'Thompson');
  assert.equal(plan.scheduled?.room, 'Room 304');
  assert.equal(plan.scheduled?.hours, 'Demo hours only');
});

test('a cross-midnight block degrades without a location list', () => {
  const plan = buildLocationPlan(block('2026-10-19T23:30:00-04:00', '2026-10-20T01:00:00-04:00'), plainRequest);
  assert.equal(plan.status, 'crosses-midnight');
  assert.equal(plan.window, null);
  assert.deepEqual(plan.recommendations, []);
});

test('an empty availability dataset yields no match rather than an error', () => {
  const plan = buildLocationPlan(block(AFTERNOON[0], AFTERNOON[1]), plainRequest, { availability: [] });
  assert.equal(plan.status, 'no-match');
  assert.deepEqual(plan.recommendations, []);
});

test('the sample request uses ids that exist in the verified dataset', () => {
  const verifiedIds = new Set(CAMPUS_LOCATIONS.map((location) => location.id));
  assert.ok(sampleRequest.locations.length >= 2, 'sample should carry the verified list');
  for (const location of sampleRequest.locations) {
    assert.ok(verifiedIds.has(location.id), `${location.id} is not in CAMPUS_LOCATIONS`);
  }
});
