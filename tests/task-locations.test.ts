import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScheduleRequest, TaskLocation } from '../src/types.ts';
import { generateMockSchedule } from '../src/scheduler.ts';
import { generateSchedule } from '../src/features/schedule-intensity/index.ts';
import { createDailyWindows, generateMultiDaySchedule } from '../src/features/multi-day-schedule/index.ts';
import { generateOccurrences, validateTaskSeries } from '../src/features/recurring-tasks/index.ts';
import type { TaskSeries } from '../src/features/recurring-tasks/index.ts';
import { normalizeTaskLocation, taskLocationLabel } from '../src/features/task-locations/index.ts';
import { toScheduleLocations } from '../src/features/campus-locations/index.ts';
import { sampleRequest } from '../src/sample.ts';
const windows = createDailyWindows({ startDate: '2026-10-31', dayCount: 3 });
function request(location?: TaskLocation): ScheduleRequest {
  return { ...windows[0], classes: [], unavailablePeriods: [], locations: toScheduleLocations(),
    tasks: ['a', 'b', 'c'].map(id => ({ id, title: id, durationMinutes: 60, dueAt: windows[0].windowEnd,
      ...(location === undefined ? {} : { location }) })) };
}
function series(location?: TaskLocation): TaskSeries {
  return { id: 'series', title: 'Read', durationMinutes: 60, startDate: '2026-10-31', rule: { frequency: 'daily', interval: 1 },
    ...(location === undefined ? {} : { location }) };
}
const choices: TaskLocation[] = [{ kind: 'none' }, ...toScheduleLocations().map(l => ({ kind: 'campus' as const, locationId: l.id })), { kind: 'custom', name: 'My desk' }];
const times = (result: ReturnType<typeof generateMockSchedule>) => result.blocks.map(({ id, taskId, start, end }) => ({ id, taskId, start, end }));

test('legacy omission and undefined keep exact old block shape and missing-location failures', () => {
  const r = request(); const out = generateMockSchedule(r);
  assert.deepEqual(out.blocks[0], { id: 'study-a', taskId: 'a', title: 'a', start: windows[0].windowStart,
    end: new Date(Date.parse(windows[0].windowStart) + 3600000).toISOString(), locationId: r.locations[0].id });
  assert.deepEqual(generateMockSchedule({ ...r, tasks: r.tasks.map(t => ({ ...t, location: undefined })) }), out);
  assert.ok(out.blocks.every(b => !Object.hasOwn(b, 'location')));
  assert.deepEqual(generateMockSchedule({ ...r, locations: [] }).unscheduledTasks,
    r.tasks.map(t => ({ taskId: t.id, reason: 'No study location supplied.' })));
});
test('explicit none schedules without locations and never inherits a global default', () => {
  for (const locations of [[], toScheduleLocations()]) {
    const out = generateMockSchedule({ ...request({ kind: 'none' }), locations });
    assert.equal(out.blocks.length, 3); assert.deepEqual(out.unscheduledTasks, []);
    for (const b of out.blocks) { assert.deepEqual(b.location, { kind: 'none' }); assert.equal(Object.hasOwn(b, 'locationId'), false); }
  }
});
test('all five existing configured campus places including Ohio Union can be selected', () => {
  const locations = toScheduleLocations(); assert.equal(locations.length, 5);
  assert.ok(locations.some(l => l.id === 'ohio-union'));
  for (const l of locations) {
    const choice: TaskLocation = { kind: 'campus', locationId: l.id };
    const b = generateMockSchedule(request(choice)).blocks[0];
    assert.equal(b.locationId, l.id); assert.deepEqual(b.location, choice);
    assert.equal(taskLocationLabel(choice, locations), l.name);
  }
});
test('custom names are copied as plain display text, not campus IDs', () => {
  const r = request({ kind: 'custom', name: '  My desk <north>  ' }); r.locations = [];
  const before = structuredClone(r); const out = generateMockSchedule(r);
  assert.equal(out.blocks.length, 3);
  assert.deepEqual(out.blocks[0].location, { kind: 'custom', name: 'My desk <north>' });
  assert.equal(Object.hasOwn(out.blocks[0], 'locationId'), false);
  assert.equal(taskLocationLabel(out.blocks[0].location!, []), 'My desk <north>');
  assert.equal(taskLocationLabel({ kind: 'none' }, []), null);
  assert.deepEqual(r, before);
});
test('invalid locations fail clearly rather than defaulting or inventing configured places', () => {
  for (const value of [null, '', {}, { kind: 'other' }, { kind: 'campus', locationId: '' }, { kind: 'custom', name: ' ' },
    { kind: 'custom', name: 'x'.repeat(121) }, { kind: 'custom', name: 'a\nb' }]) {
    assert.throws(() => normalizeTaskLocation(value));
    assert.throws(() => validateTaskSeries({ ...series(), location: value as TaskLocation }));
  }
  assert.throws(() => generateMockSchedule(request({ kind: 'campus', locationId: 'invented' })), /not configured/);
  assert.throws(() => generateMockSchedule({ ...request({ kind: 'campus', locationId: 'ohio-union' }), locations: [] }), /not configured/);
});
test('location changes never alter times, ordering, failures, or intensity gaps', () => {
  for (const intensity of ['relaxed', 'intense'] as const) {
    const baseline = generateSchedule(sampleRequest, { intensity });
    for (const location of choices) {
      const input = { ...sampleRequest, tasks: sampleRequest.tasks.map(t => ({ ...t, location })) };
      const result = generateSchedule(input, { intensity });
      assert.deepEqual(times(result), times(baseline));
      assert.deepEqual(result.unscheduledTasks, baseline.unscheduledTasks);
      assert.deepEqual(result.conflicts, baseline.conflicts);
    }
  }
});
test('series occurrences inherit independent copies and preserve legacy omission', () => {
  assert.ok(generateOccurrences([series()], windows).every(o => !Object.hasOwn(o, 'location')));
  for (const choice of choices) {
    const input = series(choice); const before = structuredClone(input);
    const a = generateOccurrences([input], windows); const b = generateOccurrences([input], windows);
    assert.equal(a.length, 3); assert.deepEqual(a, b);
    assert.ok(a.every(o => JSON.stringify(o.location) === JSON.stringify(choice)));
    assert.notEqual(a[0].location, input.location); assert.notEqual(a[0].location, a[1].location);
    assert.deepEqual(input, before);
  }
});
test('multi-day occurrences preserve dates and times across fall DST for every location and intensity', () => {
  for (const intensity of ['relaxed', 'intense'] as const) {
    const base = { ...request(), tasks: [], windows, intensity, taskSeries: [series()] };
    const baseline = generateMultiDaySchedule(base);
    for (const location of choices) {
      const out = generateMultiDaySchedule({ ...base, taskSeries: [series(location)] });
      assert.deepEqual(times(out.result), times(baseline.result));
      assert.deepEqual(out.result.unscheduledTasks, []);
      assert.ok(out.tasks.every(t => JSON.stringify(t.location) === JSON.stringify(location)));
      assert.ok(out.result.blocks.every(b => JSON.stringify(b.location) === JSON.stringify(location)));
    }
  }
  assert.equal(Date.parse(windows[1].windowStart) - Date.parse(windows[0].windowStart), 25 * 3600000);
});
test('mixed explicit and legacy tasks preserve per-task semantics with no catalog', () => {
  const r = request(); r.locations = [];
  r.tasks[1].location = { kind: 'none' }; r.tasks[2].location = { kind: 'custom', name: 'Home' };
  const out = generateMockSchedule(r);
  assert.deepEqual(out.blocks.map(b => b.taskId), ['b', 'c']);
  assert.deepEqual(out.unscheduledTasks, [{ taskId: 'a', reason: 'No study location supplied.' }]);
});
