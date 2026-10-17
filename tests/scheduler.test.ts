import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMockSchedule } from '../src/scheduler.ts';
import { sampleRequest } from '../src/sample.ts';

test('sample is deterministic, does not mutate input, and reports overflow', () => {
  const original = structuredClone(sampleRequest);
  const result = generateMockSchedule(sampleRequest);
  assert.deepEqual(result, generateMockSchedule(sampleRequest));
  assert.deepEqual(sampleRequest, original);
  assert.deepEqual(result.blocks.map(block => [block.taskId, block.start]), [
    ['math-review', '2026-10-19T15:00:00.000Z'],
    ['writing', '2026-10-19T17:00:00.000Z'],
    ['cse-practice', '2026-10-19T19:00:00.000Z'],
  ]);
  assert.deepEqual(result.unscheduledTasks.map(task => task.taskId), ['reading']);
});

test('blocks respect window, deadlines, durations and all conflicts', () => {
  const result = generateMockSchedule(sampleRequest);
  for (const block of result.blocks) {
    const task = sampleRequest.tasks.find(task => task.id === block.taskId)!;
    assert.ok(Date.parse(block.start) >= Date.parse(sampleRequest.windowStart));
    assert.ok(Date.parse(block.end) <= Date.parse(sampleRequest.windowEnd));
    assert.ok(Date.parse(block.end) <= Date.parse(task.dueAt));
    assert.equal(Date.parse(block.end) - Date.parse(block.start), task.durationMinutes * 60_000);
    for (const other of [...sampleRequest.classes, ...sampleRequest.unavailablePeriods, ...result.blocks.filter(item => item.id !== block.id)]) {
      assert.ok(Date.parse(block.end) <= Date.parse(other.start) || Date.parse(block.start) >= Date.parse(other.end));
    }
  }
});

test('empty inputs, missing locations, full window and expired deadlines', () => {
  assert.deepEqual(generateMockSchedule({ ...sampleRequest, classes: [], unavailablePeriods: [], tasks: [] }), { blocks: [], unscheduledTasks: [] });
  assert.equal(generateMockSchedule({ ...sampleRequest, locations: [] }).unscheduledTasks.length, 4);
  assert.equal(generateMockSchedule({ ...sampleRequest, unavailablePeriods: [{ id: 'all', title: 'Busy', start: sampleRequest.windowStart, end: sampleRequest.windowEnd }] }).blocks.length, 0);
  assert.equal(generateMockSchedule({ ...sampleRequest, tasks: [{ ...sampleRequest.tasks[0], dueAt: sampleRequest.windowStart }] }).blocks.length, 0);
});

test('invalid window, durations, IDs and ambiguous timestamps are rejected', () => {
  assert.throws(() => generateMockSchedule({ ...sampleRequest, windowEnd: sampleRequest.windowStart }));
  assert.throws(() => generateMockSchedule({ ...sampleRequest, tasks: [{ ...sampleRequest.tasks[0], durationMinutes: 0 }] }));
  assert.throws(() => generateMockSchedule({ ...sampleRequest, tasks: [sampleRequest.tasks[0], sampleRequest.tasks[0]] }));
  assert.throws(() => generateMockSchedule({ ...sampleRequest, windowStart: '2026-10-19T09:00:00' }));
});

test('A1 omits the property entirely for touching or disjoint intervals, even after placement', () => {
  const request = { ...sampleRequest, classes: sampleRequest.classes.filter(e => ['cse', 'math'].includes(e.id)) };
  const result = generateMockSchedule(request);
  assert.equal(Object.hasOwn(result, 'conflicts'), false);
  assert.deepEqual(result.blocks.map(b => [b.taskId, b.start]), [
    ['math-review', '2026-10-19T13:00:00.000Z'],
    ['writing', '2026-10-19T15:00:00.000Z'],
    ['cse-practice', '2026-10-19T19:00:00.000Z'],
  ]);
});

test('sample reports the 30 minute advising/math conflict even without tasks', () => {
  const expected = [{ firstId: 'advising', secondId: 'math', overlapMinutes: 30 }];
  assert.deepEqual(generateMockSchedule(sampleRequest).conflicts, expected);
  assert.deepEqual(generateMockSchedule({ ...sampleRequest, tasks: [] }), {
    blocks: [], unscheduledTasks: [], conflicts: expected,
  });
});

test('pairs cover class/class, class/unavailable and unavailable/unavailable once in stable ID order', () => {
  const event = (id: string, start: string, end: string) => ({ id, title: id, start: `2026-10-19T${start}:00-04:00`, end: `2026-10-19T${end}:00-04:00` });
  const request = { ...sampleRequest, tasks: [],
    classes: [event('c', '09:30', '11:00'), event('a', '09:00', '10:00')],
    unavailablePeriods: [event('d', '09:45', '10:15'), event('b', '09:15', '10:30')],
  };
  const original = structuredClone(request);
  const expected = [
    { firstId: 'a', secondId: 'b', overlapMinutes: 45 },
    { firstId: 'a', secondId: 'c', overlapMinutes: 30 },
    { firstId: 'a', secondId: 'd', overlapMinutes: 15 },
    { firstId: 'b', secondId: 'c', overlapMinutes: 60 },
    { firstId: 'b', secondId: 'd', overlapMinutes: 30 },
    { firstId: 'c', secondId: 'd', overlapMinutes: 30 },
  ];
  assert.deepEqual(generateMockSchedule(request).conflicts, expected);
  assert.deepEqual(generateMockSchedule({ ...request, classes: [...request.classes].reverse(), unavailablePeriods: [...request.unavailablePeriods].reverse() }).conflicts, expected);
  assert.deepEqual(request, original);
});

test('conflicts are clipped to the window; outside overlaps and touching endpoints are excluded', () => {
  const event = (id: string, start: string, end: string) => ({ id, title: id, start: `2026-10-19T${start}:00-04:00`, end: `2026-10-19T${end}:00-04:00` });
  const result = generateMockSchedule({ ...sampleRequest, tasks: [], unavailablePeriods: [], classes: [
    event('a', '08:00', '09:30'), event('b', '08:30', '10:00'),
    event('c', '07:00', '09:00'), event('d', '07:30', '08:45'),
    event('e', '16:30', '18:00'), event('f', '16:45', '18:30'),
    event('g', '17:00', '19:00'), event('h', '18:00', '20:00'),
  ] });
  assert.deepEqual(result.conflicts, [
    { firstId: 'a', secondId: 'b', overlapMinutes: 30 },
    { firstId: 'e', secondId: 'f', overlapMinutes: 15 },
  ]);
});

test('overlap uses actual instants across DST and preserves fractional minutes', () => {
  const event = (id: string, start: string, end: string) => ({ id, title: id, start, end });
  const base = { ...sampleRequest, tasks: [], unavailablePeriods: [] };
  const fall = generateMockSchedule({ ...base, windowStart: '2026-11-01T00:00:00-04:00', windowEnd: '2026-11-01T04:00:00-05:00', classes: [
    event('a', '2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00'),
    event('b', '2026-11-01T01:45:00-04:00', '2026-11-01T01:15:00-05:00'),
  ] });
  assert.deepEqual(fall.conflicts, [{ firstId: 'a', secondId: 'b', overlapMinutes: 30 }]);
  const spring = generateMockSchedule({ ...base, windowStart: '2027-03-14T00:00:00-05:00', windowEnd: '2027-03-14T04:00:00-04:00', classes: [
    event('a', '2027-03-14T01:45:00-05:00', '2027-03-14T03:15:00-04:00'),
    event('b', '2027-03-14T01:59:30-05:00', '2027-03-14T03:00:00-04:00'),
  ] });
  assert.deepEqual(spring.conflicts, [{ firstId: 'a', secondId: 'b', overlapMinutes: 0.5 }]);
});

test('optional task and location metadata never changes placement or conflicts', () => {
  const original = structuredClone(sampleRequest);
  const enriched = { ...sampleRequest,
    tasks: sampleRequest.tasks.map((task, i) => ({ ...task, priority: i === 0 ? 'low' as const : 'high' as const, courseCode: 'DEMO' })),
    locations: sampleRequest.locations.map(location => ({ ...location, building: location.name, room: 'Synthetic test room', hours: 'Simulated: closed all day' })),
  };
  assert.deepEqual(generateMockSchedule(enriched), generateMockSchedule(sampleRequest));
  assert.deepEqual(sampleRequest, original);
});

test('ambiguous conflict IDs across event collections or generated blocks are rejected', () => {
  const event = sampleRequest.classes[0];
  assert.throws(() => generateMockSchedule({ ...sampleRequest, classes: [event, event] }), /IDs must be unique across collections/);
  assert.throws(() => generateMockSchedule({ ...sampleRequest, unavailablePeriods: [{ ...sampleRequest.unavailablePeriods[0], id: event.id }] }), /IDs must be unique across collections/);
  assert.throws(() => generateMockSchedule({ ...sampleRequest, classes: [{ ...event, id: 'study-math-review' }] }), /IDs must be unique across collections/);
});
