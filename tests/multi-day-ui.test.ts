import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_END_TIME, DEFAULT_START_TIME } from '../src/ui/scheduleRange.ts';
import {
  addCalendarDays,
  buildDailyWindows,
  campusDateOf,
  campusToday,
  clampDayCount,
  defaultScheduleRange,
  rangeDates,
  rangeDayCountLabel,
} from '../src/ui/scheduleRange.ts';
import { rangeError, resolveSelection } from '../src/ui/scheduleState.ts';
import { dayCountError } from '../src/ui/scheduleRange.ts';
import { draftToSeries, emptyDraft, occurrenceCount, seriesToDraft, validateDraft } from '../src/ui/recurring.ts';
import type { SeriesDraft } from '../src/ui/recurring.ts';

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
  assert.equal(range.dayCount, 7);
  assert.equal(range.startDate, '2026-10-20');
  assert.equal(range.startTime, DEFAULT_START_TIME);
  assert.equal(range.endTime, DEFAULT_END_TIME);
  assert.equal(rangeDayCountLabel(range), '7 days');
});

test('range dates follow the selected mode', () => {
  const week = rangeDates({ dayCount: 7, startDate: '2026-10-30', startTime: '09:00', endTime: '17:00' });
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

  const single = rangeDates({ dayCount: 1, startDate: '2026-10-30', startTime: '09:00', endTime: '17:00' });
  assert.deepEqual(single, ['2026-10-30']);
});

test('daily windows resolve each New York date separately, including across DST', () => {
  const windows = buildDailyWindows({
    dayCount: 7,
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
    buildDailyWindows({ dayCount: 7, startDate: '2026-02-30', startTime: '09:00', endTime: '17:00' }),
  );
  assert.throws(() =>
    buildDailyWindows({ dayCount: 1, startDate: '', startTime: '09:00', endTime: '17:00' }),
  );
});

test('daily hours must end after they start', () => {
  assert.throws(() =>
    buildDailyWindows({ dayCount: 1, startDate: '2026-10-20', startTime: '17:00', endTime: '09:00' }),
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
  const valid = { dayCount: 7, startDate: '2026-10-20', startTime: '09:00', endTime: '17:00' } as const;
  assert.equal(rangeError(valid), null);

  const inverted = { dayCount: 7, startDate: '2026-10-20', startTime: '17:00', endTime: '08:00' } as const;
  const message = rangeError(inverted);
  assert.ok(typeof message === 'string' && message.length > 0);

  // Editing back to valid hours clears the error again, which is what the UI relies on.
  const restored = { dayCount: 7, startDate: '2026-10-20', startTime: '09:00', endTime: '17:00' } as const;
  assert.equal(rangeError(restored), null);
});

// --- 1-30 day range ---------------------------------------------------------

test('day counts clamp to the supported 1-30 range', () => {
  assert.equal(clampDayCount(0), 1);
  assert.equal(clampDayCount(-5), 1);
  assert.equal(clampDayCount(31), 30);
  assert.equal(clampDayCount(30), 30);
  assert.equal(clampDayCount(7.9), 7);
  assert.equal(clampDayCount(Number.NaN), 7);
});

test('range dates and windows follow the requested day count', () => {
  for (const count of [1, 7, 30]) {
    const range = { dayCount: count, startDate: '2026-10-19', startTime: '09:00', endTime: '17:00' };
    assert.equal(rangeDates(range).length, count);
    assert.equal(buildDailyWindows(range).length, count);
    assert.equal(rangeDates(range)[0], '2026-10-19');
  }
  assert.equal(rangeDayCountLabel({ dayCount: 1, startDate: '2026-10-19', startTime: '09:00', endTime: '17:00' }), '1 day');
  assert.equal(rangeDayCountLabel({ dayCount: 30, startDate: '2026-10-19', startTime: '09:00', endTime: '17:00' }), '30 days');
});

// --- repeating task drafts --------------------------------------------------

function draft(patch: Partial<SeriesDraft>): SeriesDraft {
  return { ...emptyDraft('2026-10-19'), title: 'Reading', ...patch };
}

test('the recurring draft rejects incomplete or impossible rules', () => {
  assert.match(validateDraft(draft({ title: '  ' })) ?? '', /title/i);
  assert.match(validateDraft(draft({ durationMinutes: 0 })) ?? '', /Duration/i);
  assert.match(validateDraft(draft({ durationMinutes: 601 })) ?? '', /Duration/i);
  assert.match(validateDraft(draft({ frequency: 'weekly', weekdays: [] })) ?? '', /weekday/i);
  assert.match(validateDraft(draft({ frequency: 'daily', interval: 0 })) ?? '', /Repeat/i);
  assert.match(validateDraft(draft({ frequency: 'daily', endDate: '2026-10-18' })) ?? '', /end date/i);
  assert.equal(validateDraft(draft({ frequency: 'daily', interval: 2 })), null);
  assert.equal(validateDraft(draft({ frequency: 'weekly', weekdays: [1, 3] })), null);
});

test('drafts map to the ISO weekday numbering A expects', () => {
  const weekly = draftToSeries(draft({ frequency: 'weekly', interval: 2, weekdays: [5, 1] }), 'series-a');
  assert.deepEqual(weekly.rule, { frequency: 'weekly', interval: 2, weekdays: [1, 5] });
  assert.equal(weekly.endDate, undefined);

  const daily = draftToSeries(draft({ frequency: 'daily', interval: 3, endDate: '2026-11-30' }), 'series-b');
  assert.deepEqual(daily.rule, { frequency: 'daily', interval: 3 });
  assert.equal(daily.endDate, '2026-11-30');

  assert.throws(() => draftToSeries(draft({ frequency: 'never' }), 'series-c'));
});

test('editing a series keeps its id and round-trips the draft', () => {
  const original = draftToSeries(draft({ frequency: 'weekly', weekdays: [2, 4] }), 'series-keep');
  const edited = draftToSeries(seriesToDraft(original), original.id);
  assert.equal(edited.id, 'series-keep');
  assert.deepEqual(edited.rule, original.rule);
});

test('occurrence counts follow the rule and the range dates', () => {
  const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  const everyOtherDay = draftToSeries(
    draft({ frequency: 'daily', interval: 2, startDate: '2026-10-19' }),
    'series-daily',
  );
  assert.equal(occurrenceCount(everyOtherDay, dates), 4);

  const monWed = draftToSeries(
    draft({ frequency: 'weekly', weekdays: [1, 3], startDate: '2026-10-19' }),
    'series-weekly',
  );
  assert.equal(occurrenceCount(monWed, dates), 2);

  const skippedWeek = draftToSeries(
    draft({ frequency: 'weekly', interval: 2, weekdays: [1], startDate: '2026-10-19' }),
    'series-skip',
  );
  assert.equal(occurrenceCount(skippedWeek, dates), 1);
});

// --- raw day-count validation ----------------------------------------------

test('the raw day count is rejected instead of silently clamped', () => {
  for (const bad of ['0', '31', '', 'abc', '7.5', '-1', ' 0 ']) {
    assert.match(dayCountError(bad) ?? '', /1 to 30/, 'expected a message for ' + JSON.stringify(bad));
  }
  for (const good of ['1', '7', '30', ' 7 ']) {
    assert.equal(dayCountError(good), null, 'expected no message for ' + JSON.stringify(good));
  }
});

test('thirty days across the fall-back transition resolve every window', () => {
  const windows = buildDailyWindows({ dayCount: 30, startDate: '2026-10-25', startTime: '09:00', endTime: '17:00' });
  assert.equal(windows.length, 30);
  const oct31 = windows.find((window) => window.windowStart.startsWith('2026-10-31'));
  const nov1 = windows.find((window) => window.windowStart.startsWith('2026-11-01'));
  assert.equal(oct31?.windowStart, '2026-10-31T13:00:00.000Z');
  assert.equal(nov1?.windowStart, '2026-11-01T14:00:00.000Z');
});
