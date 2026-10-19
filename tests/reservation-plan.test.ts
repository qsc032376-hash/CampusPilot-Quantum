import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_AVAILABILITY_NOTICE,
  NO_TRUSTED_CONFIRMATION_SOURCE,
  applyReservationInput,
  createReservationPlan,
  findReservationPolicy,
  markReservationReady,
  openOfficialSystem,
  reportUserBooking,
  validateReservation,
  verifyOfficialConfirmation,
} from '../src/features/reservation-planning/index.ts';
import type { ReservationPlan } from '../src/features/reservation-planning/index.ts';
import { OFFICIAL_LOCATION_SNAPSHOTS } from '../src/features/campus-locations/index.ts';

/** Fixed clock so the advance-window and past-time checks are deterministic. */
const NOW = new Date('2026-10-17T12:00:00Z');
const SOON_START = '2026-10-19T15:00:00-04:00';
const SOON_END = '2026-10-19T16:00:00-04:00';

function planFor(locationId: string): ReservationPlan {
  return createReservationPlan(findReservationPolicy(locationId), NOW);
}

function readyPlan(locationId = 'thompson-library', start = SOON_START, end = SOON_END, groupSize = 2): ReservationPlan {
  const plan = applyReservationInput(
    planFor(locationId),
    { locationId, startIso: start, endIso: end, groupSize, purpose: '' },
    NOW,
  );
  return markReservationReady(plan, NOW);
}

test('the mandatory live-availability notice is exact', () => {
  assert.equal(
    LIVE_AVAILABILITY_NOTICE,
    'Live room availability is not verified in CampusPilot. Check the official reservation system before relying on a time slot.',
  );
});

test('an end time before the start time is rejected', () => {
  const policy = findReservationPolicy('thompson-library');
  const result = validateReservation(
    { locationId: 'thompson-library', startIso: SOON_END, endIso: SOON_START, groupSize: 2, purpose: '' },
    policy,
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'end-before-start'));
});

test('a time in the past is rejected', () => {
  const policy = findReservationPolicy('thompson-library');
  const result = validateReservation(
    {
      locationId: 'thompson-library',
      startIso: '2026-10-10T15:00:00-04:00',
      endIso: '2026-10-10T16:00:00-04:00',
      groupSize: 2,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'invalid-time'));
});

test('the verified four-hour limit is enforced', () => {
  const policy = findReservationPolicy('thompson-library');
  const result = validateReservation(
    {
      locationId: 'thompson-library',
      startIso: '2026-10-19T10:00:00-04:00',
      endIso: '2026-10-19T15:00:00-04:00',
      groupSize: 2,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'exceeds-max-duration'));
});

test('the verified seven-day advance window is enforced', () => {
  const policy = findReservationPolicy('thompson-library');
  const result = validateReservation(
    {
      locationId: 'thompson-library',
      startIso: '2026-11-10T15:00:00-05:00',
      endIso: '2026-11-10T16:00:00-05:00',
      groupSize: 2,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'exceeds-advance-window'));
});

test('the Health Sciences group limit of five people is enforced', () => {
  const policy = findReservationPolicy('health-sciences-library');
  const tooBig = validateReservation(
    {
      locationId: 'health-sciences-library',
      startIso: SOON_START,
      endIso: SOON_END,
      groupSize: 6,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(tooBig.ok, false);
  assert.ok(tooBig.issues.some((issue) => issue.code === 'exceeds-max-group-size'));

  const fits = validateReservation(
    { locationId: 'health-sciences-library', startIso: SOON_START, endIso: SOON_END, groupSize: 5, purpose: '' },
    policy,
    NOW,
  );
  assert.equal(fits.ok, true);
});

test('FAES inherits the shared four-hour and seven-day group-study limits', () => {
  const policy = findReservationPolicy('faes-library');
  assert.equal(policy?.maxDurationMinutes, 240);
  assert.equal(policy?.maxAdvanceDays, 7);
  // Room capacity is not stated by the verified source, so it stays unknown.
  assert.equal(policy?.maxGroupSize, null);

  const tooLong = validateReservation(
    {
      locationId: 'faes-library',
      startIso: '2026-10-19T09:00:00-04:00',
      endIso: '2026-10-19T14:00:00-04:00',
      groupSize: 8,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.issues.some((issue) => issue.code === 'exceeds-max-duration'));
  assert.ok(!tooLong.issues.some((issue) => issue.code === 'exceeds-max-group-size'));
});

test('the four-hour limit is inclusive at exactly four hours', () => {
  const policy = findReservationPolicy('thompson-library');
  const atLimit = validateReservation(
    {
      locationId: 'thompson-library',
      startIso: '2026-10-19T12:00:00-04:00',
      endIso: '2026-10-19T16:00:00-04:00',
      groupSize: 2,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(atLimit.ok, true);

  const overLimit = validateReservation(
    {
      locationId: 'thompson-library',
      startIso: '2026-10-19T12:00:00-04:00',
      endIso: '2026-10-19T16:01:00-04:00',
      groupSize: 2,
      purpose: '',
    },
    policy,
    NOW,
  );
  assert.equal(overLimit.ok, false);
  assert.ok(overLimit.issues.some((issue) => issue.code === 'exceeds-max-duration'));
});

test('the seven-day window is measured in elapsed 24-hour periods', () => {
  const policy = findReservationPolicy('faes-library');
  // NOW is 2026-10-17T12:00:00Z, so exactly seven days later is inclusive.
  const atLimit = validateReservation(
    { locationId: 'faes-library', startIso: '2026-10-24T12:00:00Z', endIso: '2026-10-24T13:00:00Z', groupSize: 2, purpose: '' },
    policy,
    NOW,
  );
  assert.equal(atLimit.ok, true);

  const beyond = validateReservation(
    { locationId: 'faes-library', startIso: '2026-10-24T12:01:00Z', endIso: '2026-10-24T13:01:00Z', groupSize: 2, purpose: '' },
    policy,
    NOW,
  );
  assert.equal(beyond.ok, false);
  assert.ok(beyond.issues.some((issue) => issue.code === 'exceeds-advance-window'));
});

test('a location with no bookable rooms is blocked', () => {
  const result = validateReservation(
    { locationId: 'ohio-union', startIso: SOON_START, endIso: SOON_END, groupSize: 2, purpose: '' },
    findReservationPolicy('ohio-union'),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'location-not-reservable'));
});

test('a location without any policy record is blocked', () => {
  const result = validateReservation(
    { locationId: 'unknown-room', startIso: SOON_START, endIso: SOON_END, groupSize: 2, purpose: '' },
    findReservationPolicy('unknown-room'),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'missing-policy'));
});

test('an invalid group size is rejected', () => {
  const policy = findReservationPolicy('thompson-library');
  for (const groupSize of [0, -1, 2.5, 999]) {
    const result = validateReservation(
      { locationId: 'thompson-library', startIso: SOON_START, endIso: SOON_END, groupSize, purpose: '' },
      policy,
      NOW,
    );
    assert.equal(result.ok, false, `groupSize ${groupSize} should be rejected`);
    assert.ok(result.issues.some((issue) => issue.code === 'invalid-group-size'));
  }
});

test('a valid plan becomes ready, not verified', () => {
  const plan = readyPlan();
  assert.equal(plan.state, 'ready');
  assert.equal(plan.verifiedAt, null);
});

test('opening the official system records opened, never confirmed', () => {
  let openedUrl = '';
  const plan = openOfficialSystem(
    readyPlan(),
    (url) => {
      openedUrl = url;
      return true;
    },
    NOW,
  );
  assert.equal(openedUrl, 'https://libraryroombooking.cloud.osu.edu/');
  assert.equal(plan.state, 'opened');
  assert.equal(plan.navigation.succeeded, true);
  assert.equal(plan.verifiedAt, null);
});

test('a blocked navigation keeps the plan ready and reports the failure', () => {
  const plan = openOfficialSystem(readyPlan(), () => false, NOW);
  assert.equal(plan.state, 'ready');
  assert.equal(plan.navigation.attempted, true);
  assert.equal(plan.navigation.succeeded, false);
  assert.match(String(plan.navigation.message), /could not open/i);
});

test('a throwing navigation is handled without crashing', () => {
  const plan = openOfficialSystem(
    readyPlan(),
    () => {
      throw new Error('popup blocked');
    },
    NOW,
  );
  assert.equal(plan.state, 'ready');
  assert.equal(plan.navigation.succeeded, false);
});

test('opening is refused while the plan is still a draft', () => {
  const plan = openOfficialSystem(planFor('thompson-library'), () => true, NOW);
  assert.equal(plan.state, 'draft');
  assert.equal(plan.navigation.attempted, false);
});

test('the full state chain stops at a user report', () => {
  const opened = openOfficialSystem(readyPlan(), () => true, NOW);
  const reported = reportUserBooking(opened, '2026-10-19T20:00:00.000Z');
  assert.equal(reported.state, 'user-reported');
  assert.equal(reported.userReportedAt, '2026-10-19T20:00:00.000Z');
  assert.equal(reported.verifiedAt, null);
});

test('user reporting is ignored unless the official system was opened', () => {
  const plan = reportUserBooking(readyPlan(), '2026-10-19T20:00:00.000Z');
  assert.equal(plan.state, 'ready');
  assert.equal(plan.userReportedAt, null);
});

test('no caller-supplied evidence can mark a reservation verified', () => {
  const reported = reportUserBooking(openOfficialSystem(readyPlan(), () => true, NOW), '2026-10-19T20:00:00.000Z');
  assert.equal(reported.state, 'user-reported');

  const attempts: unknown[] = [
    'OSU-CONF-123',
    'https://library.osu.edu/confirmation/abc',
    { source: 'official-confirmation', reference: 'OSU-CONF-123' },
    { verified: true, reference: 'fake' },
    { status: 'confirmed' },
    null,
    undefined,
    42,
  ];

  for (const evidence of attempts) {
    const outcome = verifyOfficialConfirmation(reported, evidence);
    assert.equal(outcome.verified, false, `evidence ${JSON.stringify(evidence)} must not verify`);
    assert.equal(outcome.reason, NO_TRUSTED_CONFIRMATION_SOURCE);
    // The plan is returned untouched: still self-reported, never confirmed.
    assert.equal(outcome.plan.state, 'user-reported');
    assert.equal(outcome.plan.verifiedAt, null);
  }
});

test('an opened plan cannot jump straight to verified either', () => {
  const opened = openOfficialSystem(readyPlan(), () => true, NOW);
  assert.equal(opened.state, 'opened');
  const outcome = verifyOfficialConfirmation(opened, { source: 'official-confirmation', reference: 'x' });
  assert.equal(outcome.verified, false);
  assert.equal(outcome.plan.state, 'opened');
  assert.equal(outcome.plan.verifiedAt, null);
});

test('editing any field drops the plan back to draft', () => {
  const ready = readyPlan();
  const edited = applyReservationInput(ready, { groupSize: 3 }, NOW);
  assert.equal(edited.state, 'draft');
  assert.equal(edited.verifiedAt, null);
  assert.equal(edited.userReportedAt, null);
});

// --- group-study purpose eligibility ---------------------------------------

const GROUP_STUDY_LOCATIONS = ['thompson-library', '18th-avenue-library', 'faes-library'];

test('individual study is rejected at every University Libraries group-study room', () => {
  for (const locationId of GROUP_STUDY_LOCATIONS) {
    const policy = findReservationPolicy(locationId);
    const result = validateReservation(
      { locationId, startIso: SOON_START, endIso: SOON_END, groupSize: 1, purpose: 'individual-study' },
      policy,
      NOW,
    );
    assert.equal(result.ok, false, `${locationId} must reject individual study`);
    assert.ok(result.issues.some((issue) => issue.code === 'purpose-not-eligible'), locationId);
  }
});

test('group study, other and unspecified purposes remain valid', () => {
  for (const locationId of GROUP_STUDY_LOCATIONS) {
    for (const purpose of ['group-study', '', 'other'] as const) {
      const result = validateReservation(
        { locationId, startIso: SOON_START, endIso: SOON_END, groupSize: 2, purpose },
        findReservationPolicy(locationId),
        NOW,
      );
      assert.equal(result.ok, true, `${locationId} should accept purpose "${purpose}"`);
    }
  }
});

test('the group-only rule is not imposed on the Health Sciences Library', () => {
  const policy = findReservationPolicy('health-sciences-library');
  assert.equal(policy?.groupStudyOnly, false);
  const result = validateReservation(
    {
      locationId: 'health-sciences-library',
      startIso: SOON_START,
      endIso: SOON_END,
      groupSize: 1,
      purpose: 'individual-study',
    },
    policy,
    NOW,
  );
  assert.equal(result.ok, true);
});

test('no numeric minimum group size is invented', () => {
  for (const locationId of GROUP_STUDY_LOCATIONS) {
    const result = validateReservation(
      { locationId, startIso: SOON_START, endIso: SOON_END, groupSize: 1, purpose: 'group-study' },
      findReservationPolicy(locationId),
      NOW,
    );
    assert.equal(result.ok, true, `${locationId} must accept a group of one`);
  }
});

// --- displayed policy rules ------------------------------------------------

test('libraries policies carry the 15-minute forfeiture rule verbatim', () => {
  for (const locationId of GROUP_STUDY_LOCATIONS) {
    const policy = findReservationPolicy(locationId);
    assert.equal(
      policy?.lateArrivalRule,
      'a group more than 15 minutes late forfeits the reservation',
      locationId,
    );
    assert.equal(policy?.unoccupiedReleaseRule, null, locationId);

    const snapshot = OFFICIAL_LOCATION_SNAPSHOTS.find((entry) => entry.locationId === locationId);
    assert.ok(snapshot, locationId);
    assert.ok(String(snapshot!.booking.rules).includes(String(policy!.lateArrivalRule)));
    assert.equal(policy?.rulesVerifiedOn, snapshot!.booking.provenance.verifiedOn);
    assert.equal(policy?.rulesUrl, snapshot!.booking.rulesUrl);
  }
});

test('HSL keeps the conditional unoccupied-room wording', () => {
  const policy = findReservationPolicy('health-sciences-library');
  assert.equal(policy?.lateArrivalRule, null);
  assert.equal(policy?.unoccupiedReleaseRule, 'reservations may be released if unoccupied after 10 minutes');
  // Conditional, not a guaranteed grace period or an automatic cancellation.
  assert.match(String(policy?.unoccupiedReleaseRule), /may be released/);
  assert.doesNotMatch(String(policy?.unoccupiedReleaseRule), /automatic|guarantee|will be cancelled/);

  const snapshot = OFFICIAL_LOCATION_SNAPSHOTS.find((entry) => entry.locationId === 'health-sciences-library');
  assert.ok(String(snapshot!.booking.rules).includes(String(policy!.unoccupiedReleaseRule)));
});

test('structured limits stay traceable to the official rules text', () => {
  const libraries = OFFICIAL_LOCATION_SNAPSHOTS.find((entry) => entry.locationId === 'thompson-library');
  assert.ok(String(libraries!.booking.rules).includes('up to 4 hours'));
  assert.ok(String(libraries!.booking.rules).includes('one week ahead'));

  const hsl = OFFICIAL_LOCATION_SNAPSHOTS.find((entry) => entry.locationId === 'health-sciences-library');
  assert.ok(String(hsl!.booking.rules).includes('up to 5 people'));
  assert.ok(String(hsl!.booking.rules).includes('2-hour'));
  assert.ok(String(hsl!.booking.rules).includes('3 days ahead'));
});
