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
