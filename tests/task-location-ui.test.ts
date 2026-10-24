import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskLocation,
  defaultLocationDraft,
  describeBlockLocation,
  draftFromLocation,
} from '../src/ui/taskLocationDraft.ts';
import { emptyDraft, draftToSeries, seriesToDraft, validateDraft } from '../src/ui/recurring.ts';
import { CAMPUS_LOCATIONS } from '../src/features/campus-locations/index.ts';

const locations = CAMPUS_LOCATIONS;

test('a new task defaults to an explicit none, never to a campus fallback', () => {
  const draft = defaultLocationDraft(locations);
  assert.equal(draft.choice, 'none');
  const built = buildTaskLocation(draft, locations);
  assert.deepEqual(built, { ok: true, location: { kind: 'none' } });
});

test('a campus choice must be one of the configured locations', () => {
  const built = buildTaskLocation({ choice: 'campus', locationId: 'ohio-union', customName: '' }, locations);
  assert.deepEqual(built, { ok: true, location: { kind: 'campus', locationId: 'ohio-union' } });

  const missing = buildTaskLocation({ choice: 'campus', locationId: 'not-a-place', customName: '' }, locations);
  assert.equal(missing.ok, false);
});

test('a custom name is trimmed and must not be blank', () => {
  const ok = buildTaskLocation({ choice: 'custom', locationId: '', customName: '  My desk  ' }, locations);
  assert.deepEqual(ok, { ok: true, location: { kind: 'custom', name: 'My desk' } });

  const blank = buildTaskLocation({ choice: 'custom', locationId: '', customName: '   ' }, locations);
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.match(blank.message, /name/i);

  const tooLong = buildTaskLocation({ choice: 'custom', locationId: '', customName: 'x'.repeat(121) }, locations);
  assert.equal(tooLong.ok, false);
});

test('a legacy undefined location keeps being undefined, not none', () => {
  const built = buildTaskLocation({ choice: 'legacy', locationId: '', customName: '' }, locations);
  assert.deepEqual(built, { ok: true, location: undefined });

  const legacyDraft = draftFromLocation(undefined, locations);
  assert.equal(legacyDraft.choice, 'legacy');
  const series = draftToSeries({ ...emptyDraft('2026-10-19', locations), location: legacyDraft }, 'series-x', locations);
  assert.equal('location' in series, false);
});

test('editing a legacy series keeps its location undefined after other edits', () => {
  const legacyDraft = {
    ...emptyDraft('2026-10-19', locations),
    location: { choice: 'legacy' as const, locationId: '', customName: '' },
  };
  const legacy = draftToSeries(legacyDraft, 'series-legacy', locations);
  assert.equal('location' in legacy, false);

  const draft = seriesToDraft(legacy, locations);
  assert.equal(draft.location.choice, 'legacy');
  draft.title = 'Renamed without touching location';
  const saved = draftToSeries(draft, legacy.id, locations);
  assert.equal('location' in saved, false);
});

test('a series keeps an explicit location and inherits it to its draft', () => {
  const draft = { ...emptyDraft('2026-10-19', locations), title: 'Library hour' };
  draft.location = { choice: 'campus', locationId: 'thompson-library', customName: '' };
  const series = draftToSeries(draft, 'series-campus', locations);
  assert.deepEqual(series.location, { kind: 'campus', locationId: 'thompson-library' });

  const round = seriesToDraft(series, locations);
  assert.deepEqual(round.location, {
    choice: 'campus',
    locationId: 'thompson-library',
    customName: '',
  });
});

test('the recurring form rejects a blank custom series location', () => {
  const draft = { ...emptyDraft('2026-10-19', locations), title: 'Study', frequency: 'daily' as const };
  draft.location = { choice: 'custom', locationId: '', customName: '   ' };
  assert.match(validateDraft(draft, locations) ?? '', /name/i);
});

test('the Where card distinguishes none, custom, campus and legacy blocks', () => {
  assert.deepEqual(describeBlockLocation({ location: { kind: 'none' } }, locations), { kind: 'none' });
  assert.deepEqual(describeBlockLocation({ location: { kind: 'custom', name: 'Dorm' } }, locations), {
    kind: 'custom',
    name: 'Dorm',
  });
  assert.deepEqual(describeBlockLocation({ location: { kind: 'campus', locationId: 'ohio-union' } }, locations), {
    kind: 'campus',
    name: 'Ohio Union',
    locationId: 'ohio-union',
  });
  assert.deepEqual(describeBlockLocation({ locationId: 'thompson-library' }, locations), {
    kind: 'legacy',
    locationId: 'thompson-library',
  });
  assert.deepEqual(describeBlockLocation({}, locations), { kind: 'none' });
});
