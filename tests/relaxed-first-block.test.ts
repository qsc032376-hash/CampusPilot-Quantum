import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSchedule } from '../src/features/schedule-intensity/index.ts';
import { sampleRequest } from '../src/sample.ts';
import type { ScheduleRequest } from '../src/types.ts';

const at = (time: string) => `2026-10-26T${time}:00-04:00`;
const relaxed = (r: ScheduleRequest) => generateSchedule(r, { intensity: 'relaxed' });

function base(end: string, count: number, minutes = 60): ScheduleRequest {
  return {
    windowStart: at('09:00'),
    windowEnd: at(end),
    classes: [],
    unavailablePeriods: [],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      title: String(i),
      durationMinutes: minutes,
      dueAt: at(end),
    })),
  };
}

test('the first block of the day keeps a break after an earlier class', () => {
  const r = base('15:00', 1);
  r.classes = [{ id: 'class', title: 'Class', start: at('09:00'), end: at('09:30') }];
  const out = relaxed(r);
  assert.equal(out.blocks.length, 1);
  assert.equal(Date.parse(out.blocks[0].start), Date.parse(at('09:45')));
  assert.equal(Date.parse(out.blocks[0].start) - Date.parse(at('09:30')), 15 * 60_000);
});

test('relaxed keeps a 15-minute buffer before a class when feasible', () => {
  const r = base('14:00', 3, 45);
  r.classes = [{ id: 'class', title: 'Class', start: at('11:00'), end: at('12:00') }];
  const out = relaxed(r);
  const beforeClass = out.blocks.filter((block) => Date.parse(block.end) <= Date.parse(at('11:00')));
  assert.ok(
    beforeClass.length >= 2,
    `two blocks should fit before the class, got ${JSON.stringify(out.blocks.map((block) => [block.taskId, block.start, block.end]))}`,
  );
  const lastBefore = beforeClass[beforeClass.length - 1];
  assert.equal(Date.parse(at('11:00')) - Date.parse(lastBefore.end), 15 * 60_000);
});

test('a tight window still finishes every task instead of forcing the buffer', () => {
  // Both 60 minute tasks fit only if the second one starts right when the class
  // ends, so the 15 minute buffer cannot be kept here.
  const r = base('11:20', 2);
  r.classes = [{ id: 'class', title: 'Class', start: at('10:00'), end: at('10:20') }];
  const out = relaxed(r);
  assert.equal(out.blocks.length, 2, 'both tasks must stay placed');
  for (const block of out.blocks) {
    const task = r.tasks.find((item) => item.id === block.taskId)!;
    assert.ok(Date.parse(block.end) <= Date.parse(task.dueAt));
  }
  const second = out.blocks[1];
  assert.equal(Date.parse(second.start), Date.parse(at('10:20')), 'the block starts when the class ends');
  const freeAfterClass = Date.parse(second.start) - Date.parse(at('10:20'));
  assert.ok(freeAfterClass < 15 * 60_000, 'the break is shorter than 15 minutes here');
});

test('the sample data records the lecture trade-off instead of forcing a buffer', () => {
  const out = generateSchedule(sampleRequest, { intensity: 'relaxed' });
  const lecture = sampleRequest.classes.find((item) => /Lecture/i.test(item.title))!;
  const lectureEnd = Date.parse(lecture.end);
  const math = out.blocks.find((block) => /math/i.test(block.taskId))!;
  const task = sampleRequest.tasks.find((item) => item.id === 'math-review')!;

  // 11:00-12:00 is the only placement that still meets this task's deadline, so
  // the 15 minute buffer cannot be kept here. Record that trade-off explicitly.
  assert.equal(Date.parse(math.start), lectureEnd, 'the block starts when the lecture ends');
  assert.equal(Date.parse(math.end), Date.parse(task.dueAt), 'and it ends exactly at its deadline');

  // Every block that has room still keeps a full break after its class.
  const writing = out.blocks.find((block) => /writing/i.test(block.taskId))!;
  assert.ok(Date.parse(writing.start) - Date.parse(math.end) >= 15 * 60_000);
});
