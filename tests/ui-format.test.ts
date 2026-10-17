import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipToWindow,
  elapsedMinutes,
  formatDateTime,
  formatDateTimeWithZone,
  formatRangeDetailed,
  formatWindowLabel,
  parseCampusInput,
  windowSpansTransition,
} from '../src/ui/format.ts';
import { createResetState } from '../src/ui/dashboardReset.ts';
import { resolveTaskInput } from '../src/ui/taskValidation.ts';
import { sampleRequest } from '../src/sample.ts';

test('spring-forward gap is refused instead of being silently shifted', () => {
  const gap = parseCampusInput('2027-03-14T02:30');
  assert.equal(gap.status, 'nonexistent');
  if (gap.status === 'nonexistent') {
    assert.match(gap.message, /does not exist/);
  }

  // The neighbouring hours are real and must still resolve.
  assert.equal(parseCampusInput('2027-03-14T01:30').status, 'ok');
  assert.equal(parseCampusInput('2027-03-14T03:30').status, 'ok');
});

test('an unambiguous campus wall time resolves to the correct instant', () => {
  const result = parseCampusInput('2026-10-19T17:00');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.iso, '2026-10-19T21:00:00.000Z');
  }
});

test('fall-back repeated hour is reported with both offsets', () => {
  const result = parseCampusInput('2026-11-01T01:30');
  assert.equal(result.status, 'ambiguous');
  if (result.status === 'ambiguous') {
    assert.equal(result.options.length, 2);
    assert.deepEqual(
      result.options.map((option) => option.iso),
      ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'],
    );
    assert.match(result.options[0].label, /EDT/);
    assert.match(result.options[1].label, /EST/);
  }
});

test('elapsed time across fall-back uses real timestamps, not wall clock', () => {
  const start = '2026-11-01T01:45:00-04:00';
  const end = '2026-11-01T01:15:00-05:00';
  assert.equal(elapsedMinutes(end, start), 30);

  const midnight = '2026-11-01T00:00:00-04:00';
  assert.equal(elapsedMinutes('2026-11-01T01:30:00-04:00', midnight), 90);
  assert.equal(elapsedMinutes('2026-11-01T01:30:00-05:00', midnight), 150);
});

test('elapsed time across spring-forward skips the missing hour once', () => {
  const start = '2027-03-14T01:00:00-05:00';
  const end = '2027-03-14T04:00:00-04:00';
  assert.equal(elapsedMinutes(end, start), 120);
});

test('events outside the window are excluded and partial ones are clipped', () => {
  const windowStart = '2026-10-19T09:00:00-04:00';
  const windowEnd = '2026-10-19T17:00:00-04:00';

  assert.equal(clipToWindow('2026-10-19T07:00:00-04:00', '2026-10-19T08:00:00-04:00', windowStart, windowEnd), null);
  assert.equal(clipToWindow('2026-10-19T18:00:00-04:00', '2026-10-19T19:00:00-04:00', windowStart, windowEnd), null);

  assert.deepEqual(
    clipToWindow('2026-10-19T08:00:00-04:00', '2026-10-19T10:00:00-04:00', windowStart, windowEnd),
    { offsetMinutes: 0, durationMinutes: 60, clippedStart: true, clippedEnd: false },
  );
  assert.deepEqual(
    clipToWindow('2026-10-19T16:00:00-04:00', '2026-10-19T18:00:00-04:00', windowStart, windowEnd),
    { offsetMinutes: 420, durationMinutes: 60, clippedStart: false, clippedEnd: true },
  );
  assert.deepEqual(
    clipToWindow('2026-10-19T10:00:00-04:00', '2026-10-19T11:00:00-04:00', windowStart, windowEnd),
    { offsetMinutes: 60, durationMinutes: 60, clippedStart: false, clippedEnd: false },
  );
});

test('clipping never mutates the source event data', () => {
  const source = { start: '2026-10-19T08:00:00-04:00', end: '2026-10-19T10:00:00-04:00', title: 'Morning shift' };
  const snapshot = structuredClone(source);
  clipToWindow(source.start, source.end, '2026-10-19T09:00:00-04:00', '2026-10-19T17:00:00-04:00');
  assert.deepEqual(source, snapshot);
});

test('cross-day windows keep real offsets and label both dates', () => {
  const windowStart = '2026-10-19T09:00:00-04:00';
  assert.equal(elapsedMinutes('2026-10-20T01:00:00-04:00', windowStart), 960);

  const label = formatWindowLabel('2026-10-19T23:00:00-04:00', '2026-10-20T02:00:00-04:00');
  assert.match(label, /Oct 19/);
  assert.match(label, /Oct 20/);
});

test('deadline formatting always carries the calendar date', () => {
  const label = formatDateTime('2026-10-19T21:00:00.000Z');
  assert.match(label, /Oct 19, 2026/);
  assert.match(label, /5:00/);
});

test('transition detection separates normal and repeat-hour windows', () => {
  assert.equal(windowSpansTransition('2026-11-01T00:00:00-04:00', '2026-11-01T04:00:00-05:00'), true);
  assert.equal(windowSpansTransition(sampleRequest.windowStart, sampleRequest.windowEnd), false);
});

test('reset restores the initial request and forces a clean form remount', () => {
  const next = createResetState(sampleRequest, 3);
  assert.equal(next.request, sampleRequest);
  assert.equal(next.result, null);
  assert.equal(next.message, null);
  assert.equal(next.selectedId, null);
  assert.equal(next.formKey, 4);
  assert.notEqual(next.formKey, 3);
});

test('impossible calendar dates are rejected instead of rolled forward', () => {
  const result = parseCampusInput('2026-02-30T12:00');
  assert.equal(result.status, 'invalid');
  if (result.status === 'invalid') {
    assert.match(result.message, /not a real calendar date/);
  }
  assert.equal(parseCampusInput('2026-02-28T12:00').status, 'ok');
  assert.equal(parseCampusInput('2026-13-01T12:00').status, 'invalid');
});

test('a fall-back window labels each end with the zone in force', () => {
  const label = formatWindowLabel('2026-11-01T00:00:00-04:00', '2026-11-01T04:00:00-05:00');
  assert.match(label, /12:00 AM EDT/);
  assert.match(label, /4:00 AM EST/);
});

test('the two repeated 01:30 deadlines are distinguishable in a task list', () => {
  const earlier = formatDateTimeWithZone('2026-11-01T05:30:00.000Z');
  const later = formatDateTimeWithZone('2026-11-01T06:30:00.000Z');
  assert.notEqual(earlier, later);
  assert.match(earlier, /EDT/);
  assert.match(later, /EST/);
});

test('result rows keep zone meaning instead of naked wall time', () => {
  const beforeChange = formatRangeDetailed('2026-11-01T05:30:00.000Z', '2026-11-01T06:00:00.000Z', true);
  const acrossChange = formatRangeDetailed('2026-11-01T05:45:00.000Z', '2026-11-01T06:15:00.000Z', true);
  const afterChange = formatRangeDetailed('2026-11-01T06:15:00.000Z', '2026-11-01T06:45:00.000Z', true);
  assert.match(beforeChange, /EDT/);
  assert.match(afterChange, /EST/);
  assert.match(acrossChange, /EDT/);
  assert.match(acrossChange, /EST/);
});

const ambiguousDue = '2026-11-01T01:30';
const ambiguousBase = {
  title: 'Review notes',
  duration: '60',
  due: ambiguousDue,
  windowStart: '2026-11-01T00:00:00-04:00',
};

test('submitting a repeated hour with no choice fails', () => {
  const result = resolveTaskInput({ ...ambiguousBase, choice: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /happens twice/);
});

test('choosing EDT or EST succeeds and stores different timestamps', () => {
  const earlier = resolveTaskInput({
    ...ambiguousBase,
    choice: { due: ambiguousDue, iso: '2026-11-01T05:30:00.000Z' },
  });
  const later = resolveTaskInput({
    ...ambiguousBase,
    choice: { due: ambiguousDue, iso: '2026-11-01T06:30:00.000Z' },
  });

  assert.equal(earlier.ok, true);
  assert.equal(later.ok, true);
  if (earlier.ok && later.ok) {
    assert.equal(earlier.draft.dueAt, '2026-11-01T05:30:00.000Z');
    assert.equal(later.draft.dueAt, '2026-11-01T06:30:00.000Z');
    assert.notEqual(earlier.draft.dueAt, later.draft.dueAt);
  }
});

test('a choice made for a previous deadline is never reused', () => {
  const staleChoice = { due: '2026-11-01T01:45', iso: '2026-11-01T05:45:00.000Z' };
  const result = resolveTaskInput({ ...ambiguousBase, due: '2026-11-01T01:30', choice: staleChoice });
  assert.equal(result.ok, false);

  // The same choice is valid again once it matches the current deadline.
  const matching = resolveTaskInput({ ...ambiguousBase, due: '2026-11-01T01:45', choice: staleChoice });
  assert.equal(matching.ok, true);

  // An instant that does not belong to this wall time is refused as well.
  const mismatched = resolveTaskInput({
    ...ambiguousBase,
    due: '2026-11-01T01:45',
    choice: { due: '2026-11-01T01:45', iso: '2026-11-01T05:30:00.000Z' },
  });
  assert.equal(mismatched.ok, false);
});

test('ordinary and spring-gap times still validate as before', () => {
  const ordinary = resolveTaskInput({
    title: 'Read',
    duration: '30',
    due: '2026-10-19T12:00',
    choice: null,
    windowStart: '2026-10-19T09:00:00-04:00',
  });
  assert.equal(ordinary.ok, true);
  if (ordinary.ok) assert.equal(ordinary.draft.dueAt, '2026-10-19T16:00:00.000Z');

  const gap = resolveTaskInput({
    title: 'Read',
    duration: '30',
    due: '2027-03-14T02:30',
    choice: null,
    windowStart: '2027-03-14T01:00:00-05:00',
  });
  assert.equal(gap.ok, false);

  const emptyTitle = resolveTaskInput({ ...ambiguousBase, title: '   ', choice: null });
  assert.equal(emptyTitle.ok, false);
});

const plainBase = {
  title: 'Read',
  duration: '30',
  due: '2026-10-19T12:00',
  choice: null,
  windowStart: '2026-10-19T09:00:00-04:00',
};

test('optional priority and course code reach the draft', () => {
  const result = resolveTaskInput({ ...plainBase, priority: 'high', courseCode: 'CSE 201' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.priority, 'high');
    assert.equal(result.draft.courseCode, 'CSE 201');
  }
});

test('blank optional metadata is omitted rather than stored empty', () => {
  const result = resolveTaskInput({ ...plainBase, priority: '', courseCode: '   ' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.priority, undefined);
    assert.equal(result.draft.courseCode, undefined);
    assert.equal('priority' in result.draft, false);
    assert.equal('courseCode' in result.draft, false);
  }
});

test('invalid priority and overlong course codes are rejected', () => {
  assert.equal(resolveTaskInput({ ...plainBase, priority: 'urgent' }).ok, false);
  assert.equal(resolveTaskInput({ ...plainBase, courseCode: 'C'.repeat(13) }).ok, false);
  assert.equal(resolveTaskInput({ ...plainBase, priority: 'medium' }).ok, true);
});
