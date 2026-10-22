import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyWindows, generateMultiDaySchedule } from '../src/features/multi-day-schedule/index.ts';
import { generateMockSchedule } from '../src/scheduler.ts';
import { sampleRequest } from '../src/sample.ts';
import type { MultiDayScheduleRequest } from '../src/features/multi-day-schedule/index.ts';

const task = (id: string, durationMinutes = 480, dueAt = '2026-10-26T00:00:00-04:00') => ({ id, title: id, durationMinutes, dueAt });
const base = (): MultiDayScheduleRequest => ({ windows: createDailyWindows({ startDate: '2026-10-19' }), tasks: [], classes: [], unavailablePeriods: [], locations: [{ id: 'default', name: 'Default' }] });

test('single-day response exactly matches existing scheduler including failures and A1', () => {
  for (const request of [sampleRequest, { ...sampleRequest, tasks: [], classes: [], unavailablePeriods: [] }, { ...sampleRequest, locations: [] }]) {
    const { windowStart, windowEnd, ...input } = request;
    assert.deepEqual(generateMultiDaySchedule({ ...input, windows: [{ windowStart, windowEnd }] }).result, generateMockSchedule(request));
  }
});
test('seven calendar days have daytime windows and include the last day only', () => {
  const request = { ...base(), tasks: Array.from({ length: 8 }, (_, i) => task(String(i))) };
  const output = generateMultiDaySchedule(request);
  assert.equal(output.days.length, 7);
  assert.equal(output.days[6].date, '2026-10-25');
  assert.equal(output.result.blocks.length, 7);
  assert.equal(new Set(output.result.blocks.map(b => b.taskId)).size, 7);
  assert.deepEqual(output.result.unscheduledTasks.map(t => t.taskId), ['7']);
  output.days.forEach(day => {
    assert.equal(day.result.blocks.length, 1);
    assert.equal(day.result.blocks[0].start, day.windowStart);
    assert.equal(day.result.blocks[0].end, day.windowEnd);
    assert.equal(Object.hasOwn(day.result, 'unscheduledTasks'), false);
  });
});
test('deadline then ID order is retained, independent of priority and input order', () => {
  const output = generateMultiDaySchedule({ ...base(), tasks: [
    { ...task('z'), priority: 'high' }, task('b'), task('a'), task('early', 480, '2026-10-19T17:00:00-04:00'),
  ] });
  assert.deepEqual(output.result.blocks.map(b => b.taskId), ['early', 'a', 'b', 'z']);
  assert.ok(output.result.blocks.every(b => b.locationId === 'default'));
});
test('deadlines are not extended: exact end is accepted, earlier deadline and expired task fail once', () => {
  const output = generateMultiDaySchedule({ ...base(), tasks: [
    task('exact', 480, '2026-10-19T17:00:00-04:00'),
    task('short', 480, '2026-10-19T16:59:00-04:00'),
    task('expired', 1, '2026-10-19T09:00:00-04:00'),
  ] });
  assert.deepEqual(output.result.blocks.map(b => b.taskId), ['exact']);
  assert.deepEqual(output.result.unscheduledTasks.map(t => t.taskId), ['expired', 'short']);
});
test('long tasks are not split; later deadlines do not extend the seven-day range', () => {
  const output = generateMultiDaySchedule({ ...base(), tasks: [task('long', 481), task('later', 480, '2027-01-01T00:00:00Z')] });
  assert.deepEqual(output.result.blocks.map(b => b.taskId), ['later']);
  assert.deepEqual(output.result.unscheduledTasks.map(t => t.taskId), ['long']);
});
test('empty days remain present and do not invent availability or conflicts', () => {
  const output = generateMultiDaySchedule(base());
  assert.equal(output.days.length, 7);
  assert.ok(output.days.every(d => d.result.blocks.length === 0 && !Object.hasOwn(d.result, 'conflicts')));
  assert.deepEqual(output.result, { blocks: [], unscheduledTasks: [] });
});
test('missing locations produce one final failure per task', () => {
  const output = generateMultiDaySchedule({ ...base(), locations: [], tasks: [task('a'), task('b')] });
  assert.deepEqual(output.result.unscheduledTasks, ['a', 'b'].map(taskId => ({ taskId, reason: 'No study location supplied.' })));
});
test('cross-midnight classes and unavailable events block both days without mutation', () => {
  const request = { ...base(), tasks: [task('a', 60), task('b', 480)],
    classes: [{ id: 'night-class', title: 'Class', start: '2026-10-19T08:00:00-04:00', end: '2026-10-20T10:00:00-04:00' }],
    unavailablePeriods: [{ id: 'night-busy', title: 'Busy', start: '2026-10-20T16:00:00-04:00', end: '2026-10-21T10:00:00-04:00' }],
  };
  const original = structuredClone(request);
  const output = generateMultiDaySchedule(request);
  assert.equal(output.result.blocks[0].start, '2026-10-20T14:00:00.000Z');
  assert.equal(output.result.blocks[1].start, '2026-10-22T13:00:00.000Z');
  assert.deepEqual(request, original);
  assert.deepEqual(output, generateMultiDaySchedule(request));
});
test('conflicts remain per day and aggregate only overlaps inside daily windows', () => {
  const event = (id: string) => ({ id, title: id, start: '2026-10-19T08:00:00-04:00', end: '2026-10-20T10:00:00-04:00' });
  const output = generateMultiDaySchedule({ ...base(), classes: [event('a'), event('b')] });
  assert.equal(output.days[0].result.conflicts![0].overlapMinutes, 480);
  assert.equal(output.days[1].result.conflicts![0].overlapMinutes, 60);
  assert.equal(Object.hasOwn(output.days[2].result, 'conflicts'), false);
  assert.deepEqual(output.result.conflicts, [{ firstId: 'a', secondId: 'b', overlapMinutes: 540 }]);
});
test('month, year and leap-day calendar boundaries', () => {
  for (const [startDate, last] of [['2026-10-29', '2026-11-04'], ['2026-12-29', '2027-01-04'], ['2028-02-27', '2028-03-04']]) {
    const output = generateMultiDaySchedule({ ...base(), windows: createDailyWindows({ startDate }) });
    assert.equal(output.days[6].date, last);
  }
});
test('DST changes UTC offsets without moving daily local hours (23/25 hour gaps)', () => {
  for (const [startDate, gapHours, first, second] of [
    ['2027-03-13', 23, '2027-03-13T14:00:00.000Z', '2027-03-14T13:00:00.000Z'],
    ['2026-10-31', 25, '2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z'],
  ] as const) {
    const windows = createDailyWindows({ startDate });
    assert.equal(windows[0].windowStart, first);
    assert.equal(windows[1].windowStart, second);
    assert.equal((Date.parse(second) - Date.parse(first)) / 3600000, gapHours);
    assert.ok(windows.every(w => Date.parse(w.windowEnd) - Date.parse(w.windowStart) === 480 * 60000));
  }
});
test('nonexistent and ambiguous custom wall times are rejected, never silently resolved', () => {
  assert.throws(() => createDailyWindows({ startDate: '2027-03-14', startTime: '02:30' }), /nonexistent/);
  assert.throws(() => createDailyWindows({ startDate: '2026-11-01', startTime: '01:30' }), /ambiguous/);
});
test('explicit-offset DST window preserves actual task duration', () => {
  const windows = [{ windowStart: '2026-11-01T00:00:00-04:00', windowEnd: '2026-11-01T04:00:00-05:00' }, ...createDailyWindows({ startDate: '2026-11-02', dayCount: 1 })];
  const output = generateMultiDaySchedule({ ...base(), windows, tasks: [task('dst', 300, '2026-11-01T04:00:00-05:00')] });
  assert.equal(output.result.blocks.length, 1);
  assert.equal(Date.parse(output.result.blocks[0].end) - Date.parse(output.result.blocks[0].start), 300 * 60000);
});
test('invalid dates, counts, hours and overnight settings rejected', () => {
  for (const startDate of ['2026-02-30', 'nonsense']) assert.throws(() => createDailyWindows({ startDate }));
  for (const dayCount of [0, 8, 1.5, NaN]) assert.throws(() => createDailyWindows({ startDate: '2026-10-19', dayCount }));
  for (const [startTime, endTime] of [['17:00', '09:00'], ['09:00', '09:00'], ['24:00', '25:00']]) assert.throws(() => createDailyWindows({ startDate: '2026-10-19', startTime, endTime }));
});
test('manual windows must be consecutive, ordered, minute-aligned and within one local date', () => {
  const windows = base().windows;
  for (const bad of [[], [windows[1], windows[0]], [windows[0], windows[2]], [windows[0], windows[0]],
    [{ windowStart: '2026-10-19T09:00:00', windowEnd: windows[0].windowEnd }],
    [{ windowStart: '2026-10-19T09:00:01-04:00', windowEnd: windows[0].windowEnd }],
    [{ windowStart: windows[0].windowStart, windowEnd: windows[1].windowEnd }]]) {
    assert.throws(() => generateMultiDaySchedule({ ...base(), windows: bad }));
  }
});
test('existing scheduler validation still rejects duplicate tasks and invalid durations', () => {
  assert.throws(() => generateMultiDaySchedule({ ...base(), tasks: [task('a'), task('a')] }));
  assert.throws(() => generateMultiDaySchedule({ ...base(), tasks: [task('a', 0)] }));
});
