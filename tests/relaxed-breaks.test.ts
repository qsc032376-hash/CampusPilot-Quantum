import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSchedule } from '../src/features/schedule-intensity/index.ts';
import type { ScheduleRequest } from '../src/types.ts';

const at = (time: string) => `2026-10-26T${time}:00-04:00`;
const relaxed = (r: ScheduleRequest) => generateSchedule(r, { intensity: 'relaxed' });
const gapAfter = (r: ReturnType<typeof relaxed>, index: number) =>
  (Date.parse(r.blocks[index].start) - Date.parse(r.blocks[index - 1].end)) / 60_000;

function pair(end = '15:00', count = 2): ScheduleRequest {
  return {
    windowStart: at('09:00'),
    windowEnd: at(end),
    classes: [],
    unavailablePeriods: [],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      title: String(i),
      durationMinutes: 60,
      dueAt: at(end),
    })),
  };
}

test('a class after a task does not absorb the break', () => {
  const r = pair();
  r.classes = [{ id: 'class', title: 'Class', start: at('10:00'), end: at('10:20') }];
  const out = relaxed(r);
  assert.equal(out.blocks[0].start, new Date(at('09:00')).toISOString());
  assert.equal(out.blocks[1].start, new Date(at('10:35')).toISOString());
  assert.equal(gapAfter(out, 1), 35);
});

test('class time between two tasks never counts as the 15 minutes', () => {
  const r = pair();
  r.classes = [{ id: 'class', title: 'Class', start: at('10:05'), end: at('10:15') }];
  const out = relaxed(r);
  const beforeClass = Date.parse(at('10:05')) - Date.parse(out.blocks[0].end);
  assert.ok(beforeClass >= 0, 'the first block must end before the class');
  assert.ok(Date.parse(out.blocks[1].start) >= Date.parse(at('10:30')));
  // The class (10 minutes) sits between the blocks, so the real break is 15.
  assert.equal(gapAfter(out, 1), 30);
});

test('a task before a class leaves a break when it can start earlier', () => {
  const r = pair('14:00');
  r.tasks = r.tasks.map((task) => ({ ...task, durationMinutes: 45 }));
  r.classes = [{ id: 'class', title: 'Class', start: at('11:00'), end: at('12:00') }];
  const out = relaxed(r);
  assert.equal(out.blocks[0].start, new Date(at('09:00')).toISOString());
  const beforeClass = Date.parse(at('11:00')) - Date.parse(out.blocks[1].end);
  assert.ok(beforeClass >= 15, `expected a 15 minute buffer before the class, got ${beforeClass}`);
  assert.ok(Date.parse(out.blocks[1].end) <= Date.parse(r.tasks[1].dueAt));
});

test('a short window shortens the break instead of missing the deadline', () => {
  const r = pair('11:00');
  const out = relaxed(r);
  assert.equal(out.blocks.length, 2);
  for (const block of out.blocks) {
    const task = r.tasks.find((item) => item.id === block.taskId)!;
    assert.ok(Date.parse(block.end) <= Date.parse(task.dueAt), 'every placed block must stay on time');
  }
  assert.ok(gapAfter(out, 1) < 15, 'the break may shrink when the window is short');
});

test('relaxed still respects the placement set when no break fits at all', () => {
  const r = pair('11:00', 3);
  const out = relaxed(r);
  assert.deepEqual(out.blocks.map((block) => block.taskId), ['0', '1']);
  assert.equal(out.unscheduledTasks.length, 1);
  for (const block of out.blocks) {
    const task = r.tasks.find((item) => item.id === block.taskId)!;
    assert.ok(Date.parse(block.end) <= Date.parse(task.dueAt));
  }
});
