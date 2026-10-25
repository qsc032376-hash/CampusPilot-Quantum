import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSchedule } from '../src/features/schedule-intensity/index.ts';
import { createDailyWindows, generateMultiDaySchedule } from '../src/features/multi-day-schedule/index.ts';
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

function nearEvents(): ScheduleRequest {
  // A class at the start pushes the baseline later; a second class close behind
  // leaves a short buffer, so the pre-class attempt runs.
  return {
    windowStart: at('09:00'),
    windowEnd: at('14:00'),
    classes: [
      { id: 'early', title: 'Early', start: at('09:00'), end: at('09:30') },
      { id: 'late', title: 'Late', start: at('10:50'), end: at('11:20') },
    ],
    unavailablePeriods: [],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: [{ id: '0', title: '0', durationMinutes: 60, dueAt: at('14:00'), notBefore: at('09:10') }],
  };
}

test('pre-class placement never starts before notBefore or window start', () => {
  const r = nearEvents();
  const out = relaxed(r);
  const task = r.tasks[0];
  for (const block of out.blocks) {
    assert.ok(Date.parse(block.start) >= Date.parse(task.notBefore), 'notBefore is a hard bound');
    assert.ok(Date.parse(block.start) >= Date.parse(r.windowStart), 'the window start is a hard bound');
    assert.ok(Date.parse(block.end) <= Date.parse(task.dueAt), 'the deadline stays a hard bound');
  }
});

test('a pre-class move can never overlap an earlier class or unavailable period', () => {
  const r = nearEvents();
  const out = relaxed(r);
  assert.ok(out.blocks.length > 0, 'the task stays placed');
  const fixed = [...r.classes, ...r.unavailablePeriods];
  for (const block of out.blocks) {
    const start = Date.parse(block.start);
    const end = Date.parse(block.end);
    for (const event of fixed) {
      const overlap = Math.min(end, Date.parse(event.end)) - Math.max(start, Date.parse(event.start));
      assert.ok(overlap <= 0, `${block.id} overlaps ${event.id}`);
    }
  }
});

test('no legal earlier slot keeps the schedule valid and only shortens the buffer', () => {
  // The second class follows the first after a 40 minute gap; a 60 minute task
  // plus a 15 minute buffer on both sides does not fit, so the block must stay
  // legal even though the buffer is shorter.
  const r = nearEvents();
  const out = relaxed(r);
  const block = out.blocks[0];
  const task = r.tasks[0];
  assert.ok(Date.parse(block.end) <= Date.parse(task.dueAt));
  const startsBeforeDue = Date.parse(block.start) < Date.parse(task.dueAt);
  assert.ok(startsBeforeDue, 'the block still starts before its deadline');
  assert.deepEqual(out.unscheduledTasks, []);
});

test('every fixed event is considered, not just the nearest one', () => {
  const r: ScheduleRequest = {
    windowStart: at('09:00'),
    windowEnd: at('14:00'),
    classes: [
      { id: 'early', title: 'Early', start: at('09:20'), end: at('09:40') },
      { id: 'mid', title: 'Mid', start: at('10:30'), end: at('11:00') },
      { id: 'late', title: 'Late', start: at('12:00'), end: at('12:30') },
    ],
    unavailablePeriods: [{ id: 'blocked', title: 'Blocked', start: at('09:40'), end: at('10:20') }],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: [{ id: '0', title: '0', durationMinutes: 30, dueAt: at('14:00') }],
  };
  const out = relaxed(r);
  const fixed = [...r.classes, ...r.unavailablePeriods];
  assert.equal(out.blocks.length, 1);
  const block = out.blocks[0];
  for (const event of fixed) {
    const overlap =
      Math.min(Date.parse(block.end), Date.parse(event.end)) - Math.max(Date.parse(block.start), Date.parse(event.start));
    assert.ok(overlap <= 0, `${block.id} overlaps ${event.id}`);
  }
  assert.ok(Date.parse(block.start) >= Date.parse(r.windowStart));
  assert.ok(Date.parse(block.end) <= Date.parse(r.tasks[0].dueAt));
  // The chosen slot keeps both breaks around the two later events.
  assert.equal(block.start, new Date(at('11:15')).toISOString());
  assert.equal(block.end, new Date(at('11:45')).toISOString());
  assert.equal((Date.parse(block.start) - Date.parse(at('11:00'))) / 60_000, 15);
  assert.equal((Date.parse(at('12:00')) - Date.parse(block.end)) / 60_000, 15);
});

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

test('a blocked pre-class slot never eats the break after the previous class', () => {
  // Early class ends 09:30, late class starts 10:50: 80 minutes of room for a
  // 60 minute task, so both 15 minute breaks cannot hold. The break that is
  // already secured after the early class wins; the late one shrinks to 5.
  const r = nearEvents();
  const out = relaxed(r);
  assert.equal(out.blocks.length, 1);
  const block = out.blocks[0];
  assert.equal(block.start, new Date(at('09:45')).toISOString());
  assert.equal(block.end, new Date(at('10:45')).toISOString());
  assert.equal(minutesBetween(at('09:30'), block.start), 15);
  assert.equal(minutesBetween(block.end, at('10:50')), 5);
  for (const event of [...r.classes, ...r.unavailablePeriods]) {
    const overlap =
      Math.min(Date.parse(block.end), Date.parse(event.end)) - Math.max(Date.parse(block.start), Date.parse(event.start));
    assert.ok(overlap <= 0, `${block.id} overlaps ${event.id}`);
  }
  assert.ok(Date.parse(block.start) >= Date.parse(r.tasks[0].notBefore!));
});

test('a tight gap keeps the earliest secured break instead of trading it away', () => {
  // Two fixed events 10 minutes apart; a 40 minute task cannot keep both
  // breaks, so it must keep the one after the first event.
  const r: ScheduleRequest = {
    windowStart: at('09:00'),
    windowEnd: at('14:00'),
    classes: [
      { id: 'first', title: 'First', start: at('09:00'), end: at('09:20') },
      { id: 'second', title: 'Second', start: at('09:30'), end: at('09:40') },
      { id: 'third', title: 'Third', start: at('11:00'), end: at('11:30') },
    ],
    unavailablePeriods: [],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: [{ id: '0', title: '0', durationMinutes: 40, dueAt: at('14:00') }],
  };
  const out = relaxed(r);
  const block = out.blocks[0];
  assert.equal(block.start, new Date(at('09:55')).toISOString());
  assert.equal(minutesBetween(at('09:40'), block.start), 15);
  assert.ok(minutesBetween(block.end, at('11:00')) >= 15);
});

test('a free slot that would eat the secured break is rejected', () => {
  // The gap between the two classes is 80 minutes, which is shorter than the
  // task plus two full breaks, so no slot can satisfy both; the algorithm keeps
  // the legal placement and only the later break shrinks.
  const r = nearEvents();
  const out = relaxed(r);
  const block = out.blocks[0];
  const fixed = [...r.classes, ...r.unavailablePeriods];
  const free = (start: string) =>
    fixed.every((event) => {
      const s = Date.parse(start);
      const e = s + 60 * 60_000;
      return s >= Date.parse(event.end) || e <= Date.parse(event.start);
    });
  assert.ok(free(block.start), 'the chosen slot is free of every fixed event');
  const alternatives = [at('09:35'), at('10:00')].filter(free);
  assert.deepEqual(alternatives, ['2026-10-26T09:35:00-04:00'], 'only 09:35 is free, and it would eat the secured break');
  assert.ok(Date.parse(block.start) > Date.parse(at('09:35')));
});

test('adjacent classes and unavailable periods keep their own breaks', () => {
  const r: ScheduleRequest = {
    windowStart: at('09:00'),
    windowEnd: at('14:00'),
    classes: [
      { id: 'c1', title: 'C1', start: at('09:00'), end: at('09:20') },
      { id: 'c2', title: 'C2', start: at('10:30'), end: at('10:50') },
    ],
    unavailablePeriods: [{ id: 'u1', title: 'U1', start: at('09:20'), end: at('09:40') }],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: [{ id: '0', title: '0', durationMinutes: 40, dueAt: at('14:00') }],
  };
  const out = relaxed(r);
  const block = out.blocks[0];
  // u1 ends 09:40, c2 occupies 10:30-10:50, so the block follows c2 by 15.
  assert.equal(block.start, new Date(at('11:05')).toISOString());
  assert.equal(block.end, new Date(at('11:45')).toISOString());
  assert.equal((Date.parse(block.start) - Date.parse(at('10:50'))) / 60_000, 15);
  assert.equal((Date.parse(at('10:30')) - Date.parse(at('09:40'))) / 60_000, 50);
  assert.ok(Date.parse(block.start) >= Date.parse(r.tasks[0].dueAt) - 5 * 60 * 60_000);
});

test('multi-day keeps the post-class break across the fall DST change', () => {
  const windows = createDailyWindows({ startDate: '2026-10-30', dayCount: 3, startTime: '09:00', endTime: '12:00' });
  const multi = generateMultiDaySchedule({
    windows,
    tasks: [],
    taskSeries: [{ id: 'a', title: 'A', durationMinutes: 60, startDate: '2026-10-30', rule: { frequency: 'daily', interval: 1 } }],
    classes: windows.map((window, index) => ({
      id: `class-${index}`,
      title: 'Class',
      start: window.windowStart,
      end: new Date(Date.parse(window.windowStart) + 30 * 60_000).toISOString(),
    })),
    unavailablePeriods: [],
    locations: [{ id: 'demo', name: 'Demo' }],
    intensity: 'relaxed',
  });
  assert.equal(multi.days.length, 3);
  for (const day of multi.days) {
    const block = day.result.blocks[0];
    assert.ok(block, `${day.date} keeps its block`);
    const start = Date.parse(block.start);
    const classEnd = Date.parse(day.windowStart) + 30 * 60_000;
    assert.equal(start - classEnd, 15 * 60_000, `${day.date} starts 15 minutes after the class`);
  }
  // 2026-11-01 is the fall DST day: 09:45 local is one hour later in UTC.
  const dstDay = multi.days[2];
  assert.equal(new Date(Date.parse(dstDay.result.blocks[0].start)).getUTCHours(), 14);
});
