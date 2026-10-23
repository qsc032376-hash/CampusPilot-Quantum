import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyWindows, generateMultiDaySchedule } from '../src/features/multi-day-schedule/index.ts';
import { expandRecurrenceDates, generateOccurrences, validateTaskSeries, validateRule } from '../src/features/recurring-tasks/index.ts';
import type { TaskSeries } from '../src/features/recurring-tasks/index.ts';
import { generateMockSchedule } from '../src/scheduler.ts';
import { sampleRequest } from '../src/sample.ts';

const series = (patch: Partial<TaskSeries> = {}): TaskSeries => ({
  id: 'review', title: 'Review', durationMinutes: 60, startDate: '2026-10-19',
  rule: { frequency: 'daily', interval: 1 }, ...patch,
});
const base = (startDate = '2026-10-19', dayCount = 7) => ({
  windows: createDailyWindows({ startDate, dayCount }), tasks: [],
  classes: [], unavailablePeriods: [], locations: [{ id: 'lib', name: 'Library' }],
});
test('daily every N days stays anchored before the visible range and includes end date', () => {
  const windows = createDailyWindows({ startDate: '2026-10-20', dayCount: 7 });
  const result = generateOccurrences([series({ rule: { frequency: 'daily', interval: 2 }, endDate: '2026-10-25' })], windows);
  assert.deepEqual(result.map(t => t.occurrenceDate), ['2026-10-21', '2026-10-23', '2026-10-25']);
});
test('weekly interval anchors to Monday of the start ISO week, never before start', () => {
  const result = generateOccurrences([series({
    startDate: '2026-12-30', rule: { frequency: 'weekly', interval: 2, weekdays: [1, 3, 7] },
  })], createDailyWindows({ startDate: '2026-12-28', dayCount: 21 }));
  assert.deepEqual(result.map(t => t.occurrenceDate), ['2026-12-30', '2027-01-03', '2027-01-11', '2027-01-13', '2027-01-17']);
});
test('weekly first match and start=end inclusivity', () => {
  assert.deepEqual(generateOccurrences([series({ startDate: '2026-10-20', rule: { frequency: 'weekly', interval: 1, weekdays: [1] } })],
    createDailyWindows({ startDate: '2026-10-19', dayCount: 9 })).map(t => t.occurrenceDate), ['2026-10-26']);
  assert.equal(generateOccurrences([series({ endDate: '2026-10-19' })], base().windows).length, 1);
});
test('occurrence IDs, metadata and windows are stable; input and regenerated plans do not accumulate', () => {
  const request = { ...base(), taskSeries: [series({ courseCode: 'CSE', priority: 'low' })] };
  const original = structuredClone(request);
  const a = generateMultiDaySchedule(request);
  assert.deepEqual(a, generateMultiDaySchedule(request));
  assert.deepEqual(request, original);
  assert.equal(a.tasks.length, 7);
  assert.equal(new Set(a.tasks.map(t => t.id)).size, 7);
  a.tasks.forEach((task, i) => {
    assert.equal(task.id, 'review@' + a.days[i].date);
    assert.equal(task.seriesId, 'review');
    assert.equal(task.courseCode, 'CSE');
    assert.equal(task.notBefore, request.windows[i].windowStart);
    assert.equal(task.dueAt, request.windows[i].windowEnd);
  });
});
test('future occurrences never fill spare capacity before their own day', () => {
  const result = generateMultiDaySchedule({ ...base(), taskSeries: [series()] });
  assert.equal(result.result.blocks.length, 7);
  result.days.forEach(day => {
    assert.equal(day.result.blocks.length, 1);
    assert.equal(day.result.blocks[0].start, day.windowStart);
    assert.equal(day.result.blocks[0].taskId, 'review@' + day.date);
  });
});
test('a full occurrence date remains unscheduled, never moved to tomorrow or dropped', () => {
  const request = base();
  const result = generateMultiDaySchedule({ ...request, taskSeries: [series()],
    classes: [{ id: 'busy', title: 'Busy', start: request.windows[1].windowStart, end: request.windows[1].windowEnd }] });
  assert.equal(result.result.blocks.length, 6);
  assert.deepEqual(result.result.unscheduledTasks.map(t => t.taskId), ['review@2026-10-20']);
  assert.equal(result.days[1].result.blocks.length, 0);
  assert.equal(result.days[2].result.blocks.length, 1);
});
test('long occurrences remain whole and fail once per date', () => {
  const result = generateMultiDaySchedule({ ...base(), taskSeries: [series({ durationMinutes: 481 })] });
  assert.equal(result.result.blocks.length, 0);
  assert.equal(result.result.unscheduledTasks.length, 7);
});
test('supports 1 through 30 days, default 7, rejects 0/31 in generation and manual windows', () => {
  assert.equal(createDailyWindows({ startDate: '2026-10-19' }).length, 7);
  for (const dayCount of [1, 8, 30]) {
    const result = generateMultiDaySchedule({ ...base('2026-10-19', dayCount), taskSeries: [series()] });
    assert.equal(result.days.length, dayCount);
    assert.equal(result.tasks.length, dayCount);
    assert.equal(result.result.blocks.length, dayCount);
  }
  for (const dayCount of [0, 31]) assert.throws(() => createDailyWindows({ startDate: '2026-10-19', dayCount }));
  assert.throws(() => generateMultiDaySchedule({ ...base(), windows: [] }));
  const thirtyOne = [...base('2026-10-19', 30).windows, ...base('2026-11-18', 1).windows];
  assert.throws(() => generateMultiDaySchedule({ ...base(), windows: thirtyOne }));
});
test('no-series single-day result remains exactly the legacy scheduler response', () => {
  const { windowStart, windowEnd, ...request } = sampleRequest;
  for (const taskSeries of [undefined, []]) {
    const output = generateMultiDaySchedule({ ...request, taskSeries, windows: [{ windowStart, windowEnd }] });
    assert.deepEqual(output.result, generateMockSchedule(sampleRequest));
    assert.deepEqual(output.tasks, sampleRequest.tasks);
  }
});
test('one-offs and occurrences share deadline then ID ordering and title lookup', () => {
  const one = { id: 'a', title: 'One-off', durationMinutes: 60, dueAt: base().windows[0].windowEnd };
  const result = generateMultiDaySchedule({ ...base(), tasks: [one], taskSeries: [series()] });
  assert.deepEqual(result.result.blocks.slice(0, 2).map(b => b.taskId), ['a', 'review@2026-10-19']);
  assert.ok(result.result.blocks.every(b => result.tasks.some(t => t.id === b.taskId && t.title === b.title)));
});
test('duplicate series, one-offs and generated ID collisions are rejected, not deduplicated silently', () => {
  assert.throws(() => generateMultiDaySchedule({ ...base(), taskSeries: [series(), series()] }), /Series IDs/);
  const task = { id: 'review@2026-10-19', title: 'Collision', durationMinutes: 60, dueAt: base().windows[0].windowEnd };
  assert.throws(() => generateMultiDaySchedule({ ...base(), tasks: [task], taskSeries: [series()] }), /IDs/);
  assert.throws(() => generateMultiDaySchedule({ ...base(), tasks: [task, task] }), /IDs/);
  const generated = generateOccurrences([series()], base().windows);
  assert.throws(() => generateMultiDaySchedule({ ...base(), tasks: generated, taskSeries: [series()] }), /IDs/);
});
test('invalid rule/date/duration/weekday values are rejected', () => {
  for (const interval of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => validateRule({ frequency: 'daily', interval }));
  for (const weekdays of [[], [0], [8], [1, 1], [1.5]]) assert.throws(() => validateRule({ frequency: 'weekly', interval: 1, weekdays } as never));
  assert.throws(() => validateRule({ frequency: 'monthly', interval: 1 } as never));
  for (const patch of [{ startDate: '2026-02-30' }, { endDate: '2026-10-18' }, { durationMinutes: 0 }, { id: '' }, { title: ' ' }]) {
    assert.throws(() => validateTaskSeries(series(patch)));
  }
});
test('expansion crosses month/year/leap dates and respects supplied date bounds', () => {
  for (const [start, expected] of [['2026-12-31', '2027-01-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01']]) {
    const result = generateOccurrences([series({ startDate: start })], base(start, 2).windows);
    assert.deepEqual(result.map(t => t.occurrenceDate), [start, expected]);
  }
  assert.deepEqual(expandRecurrenceDates(series(), ['2026-10-20', '2026-10-19']), ['2026-10-19', '2026-10-20']);
  assert.throws(() => expandRecurrenceDates(series(), ['2026-10-19', '2026-10-19']));
});
test('DST preserves occurrence local dates with 23/25-hour spacing, using existing windows', () => {
  for (const [start, hours] of [['2027-03-13', 23], ['2026-10-31', 25]] as const) {
    const result = generateMultiDaySchedule({ ...base(start, 3), taskSeries: [series({ startDate: start })] });
    const [a, b] = result.tasks;
    assert.equal((Date.parse(b.notBefore!) - Date.parse(a.notBefore!)) / 3600000, hours);
    result.days.forEach(day => assert.equal(day.result.blocks[0].start, day.windowStart));
  }
  assert.throws(() => createDailyWindows({ startDate: '2027-03-14', startTime: '02:30' }), /nonexistent/);
  assert.throws(() => createDailyWindows({ startDate: '2026-11-01', startTime: '01:30' }), /ambiguous/);
});
test('notBefore respects occupied gaps and validates offsets and ordering', () => {
  const request = { ...sampleRequest, classes: [], unavailablePeriods: [],
    tasks: [{ id: 'later', title: 'Later', durationMinutes: 60, dueAt: '2026-10-19T17:00:00-04:00', notBefore: '2026-10-19T13:00:00-04:00' }] };
  assert.equal(generateMockSchedule(request).blocks[0].start, '2026-10-19T17:00:00.000Z');
  assert.equal(generateMockSchedule({ ...request, classes: [{ id: 'busy', title: 'Busy', start: '2026-10-19T12:00:00-04:00', end: '2026-10-19T14:00:00-04:00' }] }).blocks[0].start, '2026-10-19T18:00:00.000Z');
  for (const notBefore of ['bad', '2026-10-19T13:00:00', request.tasks[0].dueAt, '2026-10-20T09:00:00-04:00']) {
    assert.throws(() => generateMockSchedule({ ...request, tasks: [{ ...request.tasks[0], notBefore }] }));
  }
  assert.equal(generateMockSchedule({ ...request, windowEnd: '2026-10-19T12:00:00-04:00' }).blocks.length, 0);
});

test('overlapping ranges and series input order preserve occurrence IDs and schedules', () => {
  const a = series();
  const b = series({ id: 'second', title: 'Second', durationMinutes: 30 });
  const first = generateOccurrences([a, b], base().windows);
  const shifted = generateOccurrences([b, a], base('2026-10-20').windows);
  assert.deepEqual(first.filter(t => t.occurrenceDate >= '2026-10-20'), shifted.filter(t => t.occurrenceDate <= '2026-10-25'));
  assert.deepEqual(generateMultiDaySchedule({ ...base(), taskSeries: [a, b] }), generateMultiDaySchedule({ ...base(), taskSeries: [b, a] }));
});
test('series outside the visible range generate no tasks; missing location preserves occurrences as failures', () => {
  for (const item of [series({ startDate: '2026-11-01' }), series({ startDate: '2026-10-01', endDate: '2026-10-18' })]) {
    assert.deepEqual(generateMultiDaySchedule({ ...base(), taskSeries: [item] }).tasks, []);
  }
  const result = generateMultiDaySchedule({ ...base(), locations: [], taskSeries: [series()] });
  assert.equal(result.tasks.length, 7);
  assert.equal(result.result.unscheduledTasks.length, 7);
  assert.ok(result.result.unscheduledTasks.every(t => t.reason === 'No study location supplied.'));
});
test('spring-transition day uses elapsed duration and not wall-clock subtraction', () => {
  const windows = createDailyWindows({ startDate: '2027-03-14', dayCount: 1, startTime: '00:00', endTime: '04:00' });
  const result = generateMultiDaySchedule({ ...base(), windows, taskSeries: [series({ startDate: '2027-03-14', durationMinutes: 180 })] });
  assert.equal(result.result.blocks.length, 1);
  assert.equal(result.result.blocks[0].start, windows[0].windowStart);
  assert.equal(result.result.blocks[0].end, windows[0].windowEnd);
  assert.equal(Date.parse(windows[0].windowEnd) - Date.parse(windows[0].windowStart), 180 * 60000);
});
