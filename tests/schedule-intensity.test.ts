import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSchedule } from '../src/features/schedule-intensity/index.ts';
import { generateMockSchedule } from '../src/scheduler.ts';
import { createDailyWindows, generateMultiDaySchedule } from '../src/features/multi-day-schedule/index.ts';
import type { ScheduleRequest } from '../src/types.ts';
const at = (time: string) => `2026-10-26T${time}:00-04:00`;
function request(end = '12:00', count = 3): ScheduleRequest {
  return { windowStart: at('09:00'), windowEnd: at(end), classes: [], unavailablePeriods: [],
    locations: [{ id: 'demo', name: 'Demo' }],
    tasks: Array.from({ length: count }, (_, i) => ({ id: String(i), title: String(i), durationMinutes: 60, dueAt: at(end) })) };
}
const relaxed = (r: ScheduleRequest) => generateSchedule(r, { intensity: 'relaxed' });
const gaps = (r: ReturnType<typeof relaxed>) => r.blocks.slice(1).map((b, i) => (Date.parse(b.start) - Date.parse(r.blocks[i].end)) / 60000);
test('omitted and intense are deeply equal to the old scheduler, without mutation', () => {
  const r = request(); const copy = structuredClone(r);
  assert.deepEqual(generateSchedule(r), generateMockSchedule(r));
  assert.deepEqual(generateSchedule(r, { intensity: 'intense' }), generateMockSchedule(r));
  relaxed(r); assert.deepEqual(r, copy);
});
test('relaxed adds 15 minutes only between study blocks', () => {
  const r = request('13:00'); const out = relaxed(r);
  assert.deepEqual(gaps(out), [15, 15]);
  assert.equal(out.blocks[0].start, new Date(at('09:00')).toISOString());
  assert.equal(out.blocks[2].end, new Date(at('12:30')).toISOString());
  assert.equal(relaxed(request('10:00', 1)).blocks[0].end, new Date(at('10:00')).toISOString());
});
test('class and unavailable time never counts toward the break', () => {
  for (const kind of ['classes', 'unavailablePeriods'] as const) {
    const r = request('13:00', 2);
    r[kind] = [{ id: 'event', title: 'event', start: at('10:00'), end: at('10:20') }];
    // 10 minute block, 20 minute event, then a full 15 minute break.
    assert.deepEqual(gaps(relaxed(r)), [35]);
    r[kind][0].end = at('10:10');
    assert.deepEqual(gaps(relaxed(r)), [25]);
  }
});
test('shortens only necessary later gaps and waives when no slack remains', () => {
  assert.deepEqual(gaps(relaxed(request('12:20'))), [15, 5]);
  assert.deepEqual(gaps(relaxed(request('12:10'))), [10, 0]);
  assert.deepEqual(gaps(relaxed(request())), [0, 0]);
});
test('failure reasons and high priority never reorder tasks or extend deadlines', () => {
  const r = request('11:00'); r.tasks[2].priority = 'high';
  const old = generateMockSchedule(r); const out = relaxed(r);
  assert.deepEqual(out, old);
  assert.deepEqual(out.blocks.map(b => b.taskId), ['0', '1']);
});
test('notBefore and individual deadlines bound every shifted block', () => {
  const r = request('13:00'); r.tasks[1].dueAt = at('11:05'); r.tasks[1].notBefore = at('10:00');
  const out = relaxed(r);
  for (const b of out.blocks) {
    const t = r.tasks.find(t => t.id === b.taskId)!;
    assert.ok(Date.parse(b.end) <= Date.parse(t.dueAt));
    if (t.notBefore) assert.ok(Date.parse(b.start) >= Date.parse(t.notBefore));
  }
  assert.equal(out.blocks.length, 3);
});
test('nested and overlapping obstacles cannot be crossed by backward bounds', () => {
  const r = request('17:00');
  r.classes = [{ id: 'long', title: 'long', start: at('12:00'), end: at('17:00') },
    { id: 'nested', title: 'nested', start: at('13:00'), end: at('14:00') }];
  assert.deepEqual(gaps(relaxed(r)), [0, 0]);
  assert.deepEqual(relaxed(r).conflicts, generateMockSchedule(r).conflicts);
});
test('multi-day intensity keeps occurrence dates across fall DST and resets breaks each day', () => {
  const windows = createDailyWindows({ startDate: '2026-10-31', dayCount: 3, startTime: '09:00', endTime: '12:00' });
  const input = { windows, tasks: [], classes: [], unavailablePeriods: [], locations: request().locations,
    taskSeries: ['a','b'].map(id => ({ id, title: id, durationMinutes: 60, startDate: '2026-10-31', rule: { frequency: 'daily' as const, interval: 1 } })) };
  const out = generateMultiDaySchedule({ ...input, intensity: 'relaxed' });
  assert.equal(out.result.blocks.length, 6);
  assert.equal(out.result.unscheduledTasks.length, 0);
  for (const day of out.days) {
    assert.equal(day.result.blocks[0].start, day.windowStart);
    assert.equal(Date.parse(day.result.blocks[1].start) - Date.parse(day.result.blocks[0].end), 900000);
  }
  assert.equal(Date.parse(windows[1].windowStart) - Date.parse(windows[0].windowStart), 25 * 3600000);
});
test('invalid runtime intensity is rejected, and one-day omission stays compatible', () => {
  assert.throws(() => generateSchedule(request(), { intensity: 'bad' as 'intense' }), /intensity/);
  const r = request();
  assert.deepEqual(generateMultiDaySchedule({ ...r, windows: [{ windowStart: r.windowStart, windowEnd: r.windowEnd }] }).result, generateMockSchedule(r));
});

test('deterministic obstacle cases preserve baseline placement set and all hard constraints', () => {
  let seed = 47;
  const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const iso = (minute: number) => new Date(Date.parse(at('09:00')) + minute * 60000).toISOString();
  for (let trial = 0; trial < 150; trial += 1) {
    const r = request('17:00', 0);
    r.tasks = Array.from({ length: 8 }, (_, i) => {
      const release = random(24) * 10;
      return { id: String(i), title: String(i), durationMinutes: 10 + random(10) * 10,
        notBefore: iso(release), dueAt: iso(release + 30 + random(22) * 10) };
    });
    r.classes = Array.from({ length: 5 }, (_, i) => {
      const start = random(45) * 10;
      return { id: `event-${i}`, title: 'event', start: iso(start), end: iso(start + 10 + random(8) * 10) };
    });
    const base = generateMockSchedule(r); const out = relaxed(r);
    assert.deepEqual(out.blocks.map(b => b.taskId), base.blocks.map(b => b.taskId));
    assert.deepEqual(out.unscheduledTasks, base.unscheduledTasks);
    assert.deepEqual(out.conflicts, base.conflicts);
    out.blocks.forEach((b, i) => {
      const t = r.tasks.find(t => t.id === b.taskId)!;
      const start = Date.parse(b.start); const end = Date.parse(b.end);
      assert.ok(start >= Date.parse(base.blocks[i].start));
      assert.ok(start >= Date.parse(t.notBefore!));
      assert.ok(end <= Math.min(Date.parse(t.dueAt), Date.parse(r.windowEnd)));
      assert.equal(end - start, t.durationMinutes * 60000);
      if (i) assert.ok(start >= Date.parse(out.blocks[i - 1].end));
      assert.ok(r.classes.every(e => end <= Date.parse(e.start) || start >= Date.parse(e.end)));
    });
  }
});
test('spring DST still uses actual elapsed minutes and missing location failures stay unchanged', () => {
  const windows = createDailyWindows({ startDate: '2027-03-14', dayCount: 1, startTime: '00:00', endTime: '04:00' });
  const r = { ...request('12:00', 2), ...windows[0] };
  r.tasks = r.tasks.map(t => ({ ...t, dueAt: r.windowEnd }));
  const out = relaxed(r);
  assert.deepEqual(gaps(out), [15]);
  assert.equal(Date.parse(out.blocks[1].end) - Date.parse(r.windowStart), 135 * 60000);
  r.locations = [];
  assert.deepEqual(relaxed(r), generateMockSchedule(r));
});
