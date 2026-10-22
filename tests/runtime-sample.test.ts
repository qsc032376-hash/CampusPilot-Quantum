import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_SAMPLE_PREFIX, createRuntimeSampleRequest } from '../src/ui/sampleRuntime.ts';
import { buildDailyWindows, defaultScheduleRange } from '../src/ui/scheduleRange.ts';
import { generateMultiDaySchedule } from '../src/features/multi-day-schedule/index.ts';
import { generateMockSchedule } from '../src/scheduler.ts';
import { sampleRequest } from '../src/sample.ts';

/** 12:00 UTC is 08:00 EDT, so the New York date is still 2026-10-19. */
const NOW = new Date('2026-10-19T12:00:00Z');

function runtimePlan(now: Date) {
  const range = defaultScheduleRange(now);
  const windows = buildDailyWindows(range);
  const request = createRuntimeSampleRequest(now);
  const output = generateMultiDaySchedule({
    windows,
    tasks: request.tasks,
    classes: request.classes,
    unavailablePeriods: request.unavailablePeriods,
    locations: request.locations,
  });
  return { range, windows, request, output };
}

test('runtime example data sits inside the default New York range', () => {
  const { range, windows, request } = runtimePlan(NOW);

  assert.equal(range.startDate, '2026-10-20', 'default range starts tomorrow in New York');

  const stamps = [
    ...request.classes.flatMap((event) => [event.start, event.end]),
    ...request.unavailablePeriods.flatMap((event) => [event.start, event.end]),
    ...request.tasks.map((task) => task.dueAt),
  ];
  for (const stamp of stamps) {
    const ms = Date.parse(stamp);
    assert.ok(ms >= Date.parse(windows[0].windowStart), `${stamp} is before the range`);
    assert.ok(ms <= Date.parse(windows[windows.length - 1].windowEnd), `${stamp} is after the range`);
  }
});

test('the default range yields a meaningful example plan', () => {
  const { windows, output } = runtimePlan(NOW);

  assert.ok(output.result.blocks.length >= 2, 'the demo should place more than one block');
  assert.ok(output.days.some((day) => day.result.blocks.length > 0));
  assert.equal(output.result.unscheduledTasks.length, 0, 'the example should fit inside the range');

  for (const block of output.result.blocks) {
    assert.ok(Date.parse(block.start) >= Date.parse(windows[0].windowStart));
    assert.ok(Date.parse(block.end) <= Date.parse(windows[windows.length - 1].windowEnd));
  }
});

test('every runtime label is marked as an example', () => {
  const { request } = runtimePlan(NOW);
  const items = [...request.classes, ...request.unavailablePeriods, ...request.tasks];
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(item.title.startsWith(RUNTIME_SAMPLE_PREFIX), item.title);
  }
});

test('example classes are not copied to every day', () => {
  const { request } = runtimePlan(NOW);
  const dates = new Set(request.classes.map((event) => event.start.slice(0, 10)));
  assert.ok(dates.size < 7, 'no synthetic weekly repetition');
  assert.ok(dates.size >= 1);
});

test('a different clock produces different example dates', () => {
  const later = createRuntimeSampleRequest(new Date('2026-12-30T12:00:00Z'));
  assert.ok(later.classes[0].start.startsWith('2026-12-31'), later.classes[0].start);
  assert.notEqual(later.classes[0].start, createRuntimeSampleRequest(NOW).classes[0].start);
});

test('the fixed regression fixture is unchanged', () => {
  const result = generateMockSchedule(sampleRequest);
  assert.deepEqual(
    result.blocks.map((block) => [block.taskId, block.start]),
    [
      ['math-review', '2026-10-19T15:00:00.000Z'],
      ['writing', '2026-10-19T17:00:00.000Z'],
      ['cse-practice', '2026-10-19T19:00:00.000Z'],
    ],
  );
  assert.deepEqual(result.unscheduledTasks.map((item) => item.taskId), ['reading']);
});
