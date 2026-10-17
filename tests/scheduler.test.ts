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
    ['math-review', '2026-10-19T13:00:00.000Z'],
    ['writing', '2026-10-19T15:00:00.000Z'],
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
  assert.deepEqual(generateMockSchedule({ ...sampleRequest, tasks: [] }), { blocks: [], unscheduledTasks: [] });
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
