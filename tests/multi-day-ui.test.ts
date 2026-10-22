import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  buildDailyWindows,
  campusDateOf,
  campusToday,
  defaultScheduleRange,
  rangeDates,
  rangeDayCountLabel,
} from '../src/ui/scheduleRange.ts';
import { DEFAULT_END_TIME, DEFAULT_START_TIME } from '../src/ui/scheduleRange.ts';
import { rangeError, resolveSelection } from '../src/ui/scheduleState.ts';

test('campus dates come from New York, not the host time zone', () => {
  // 03:00 UTC on Oct 20 is still Oct 19 in New York (23:00 EDT).
  assert.equal(campusToday(new Date('2026-10-20T03:00:00Z')), '2026-10-19');
  // 13:00 UTC is 09:00 EDT on the same date.
  assert.equal(campusToday(new Date('2026-10-19T13:00:00Z')), '2026-10-19');
  assert.equal(campusDateOf('2026-10-20T01:30:00-04:00'), '2026-10-20');
});

test('calendar arithmetic crosses month and year boundaries', () => {
  assert.equal(addCalendarDays('2026-10-19', 1), '2026-10-20');
  assert.equal(addCalendarDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28');
});

test('the default range is seven days starting tomorrow in New York', () => {
  const now = new Date('2026-10-19T12:00:00Z'); // 08:00 EDT
  const range = defaultScheduleRange(now);
  assert.equal(range.mode, 'week');
  assert.equal(range.startDate, '2026-10-20');
  assert.equal(range.startTime, DEFAULT_START_TIME);
  assert.equal(range.endTime, DEFAULT_END_TIME);
  assert.equal(rangeDayCountLabel(range), '7 days');
});

test('range dates follow the selected mode', () => {
  const week = rangeDates({ mode: 'week', startDate: '2026-10-30', startTime: '09:00', endTime: '17:00' });
  assert.equal(week.length, 7);
  assert.deepEqual(week, [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
  ]);

  const single = rangeDates({ mode: 'single', startDate: '2026-10-30', startTime: '09:00', endTime: '17:00' });
  assert.deepEqual(single, ['2026-10-30']);
});

test('daily windows resolve each New York date separately, including across DST', () => {
  const windows = buildDailyWindows({
    mode: 'week',
    startDate: '2026-10-31',
    startTime: '09:00',
    endTime: '17:00',
  });
  assert.equal(windows.length, 7);
  // Oct 31 is still EDT (-04:00); Nov 1 falls back to EST (-05:00).
  assert.equal(windows[0].windowStart, '2026-10-31T13:00:00.000Z');
  assert.equal(windows[1].windowStart, '2026-11-01T14:00:00.000Z');
  assert.equal(windows[6].windowStart, '2026-11-06T14:00:00.000Z');
});

test('an invalid start date is rejected rather than guessed', () => {
  assert.throws(() =>
    buildDailyWindows({ mode: 'week', startDate: '2026-02-30', startTime: '09:00', endTime: '17:00' }),
  );
  assert.throws(() =>
    buildDailyWindows({ mode: 'single', startDate: '', startTime: '09:00', endTime: '17:00' }),
  );
});

test('daily hours must end after they start', () => {
  assert.throws(() =>
    buildDailyWindows({ mode: 'single', startDate: '2026-10-20', startTime: '17:00', endTime: '09:00' }),
  );
});

// --- selection and range-validity state helpers -----------------------------

const PLAN = {
  days: [
    { date: '2026-10-20', windowStart: '2026-10-20T13:00:00.000Z', windowEnd: '2026-10-20T21:00:00.000Z', result: { blocks: [] } },
    { date: '2026-10-21', windowStart: '2026-10-21T13:00:00.000Z', windowEnd: '2026-10-21T21:00:00.000Z', result: { blocks: [] } },
  ],
  result: {
    blocks: [
      { id: 'study-math', taskId: 'math', title: 'Math', start: '2026-10-21T14:00:00.000Z', end: '2026-10-21T15:00:00.000Z', locationId: 'lib' },
    ],
    unscheduledTasks: [],
  },
};

test('a selection follows its block to the new day', () => {
  assert.deepEqual(resolveSelection(PLAN, 'study-math'), { id: 'study-math', date: '2026-10-21' });
});

test('a selection whose block disappeared is cleared', () => {
  assert.deepEqual(resolveSelection(PLAN, 'study-gone'), { id: null, date: null });
  assert.deepEqual(resolveSelection(PLAN, null), { id: null, date: null });
});

test('range validity reports the exact validation message', () => {
  const valid = { mode: 'week', startDate: '2026-10-20', startTime: '09:00', endTime: '17:00' } as const;
  assert.equal(rangeError(valid), null);

  const inverted = { mode: 'week', startDate: '2026-10-20', startTime: '17:00', endTime: '08:00' } as const;
  const message = rangeError(inverted);
  assert.ok(typeof message === 'string' && message.length > 0);

  // Editing back to valid hours clears the error again, which is what the UI relies on.
  const restored = { mode: 'week', startDate: '2026-10-20', startTime: '09:00', endTime: '17:00' } as const;
  assert.equal(rangeError(restored), null);
});
