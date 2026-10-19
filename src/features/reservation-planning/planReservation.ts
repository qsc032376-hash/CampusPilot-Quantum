import { findReservationPolicy } from './policies.ts';
import type {
  ReservationInput,
  ReservationIssue,
  ReservationPlan,
  ReservationPolicy,
  ReservationValidation,
} from './types.ts';

/**
 * Pure reservation-planning logic.
 *
 * It validates a proposed reservation against verified policy limits and moves
 * a plan through explicit states. It never contacts Ohio State, never stores
 * credentials, and never marks anything confirmed: opening a link only records
 * "the official system was opened", which is not a booking.
 */

/** Exact Phase 2D fallback wording; do not reword. */
export const LIVE_AVAILABILITY_NOTICE =
  'Availability unknown. Please confirm the room and time in the official reservation system.';

const TIMESTAMP_PATTERN = /(Z|[+-]\d{2}:\d{2})$/;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** Guards against typos rather than imposing a real policy limit. */
const MAX_SANE_GROUP_SIZE = 50;

export function emptyReservationInput(): ReservationInput {
  return { locationId: '', startIso: '', endIso: '', groupSize: 2, purpose: '' };
}

function parseTimestamp(value: string): number | null {
  if (!value || !TIMESTAMP_PATTERN.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates a proposed reservation.
 *
 * Unknown policy limits are skipped, never guessed: when `maxDurationMinutes`
 * is null the duration is simply not checked, and the UI says so.
 */
export function validateReservation(
  input: ReservationInput,
  policy: ReservationPolicy | null,
  now: Date,
): ReservationValidation {
  const issues: ReservationIssue[] = [];

  if (!policy) {
    issues.push({ code: 'missing-policy', message: 'No verified reservation policy exists for this location.' });
  } else if (!policy.reservable) {
    issues.push({
      code: 'location-not-reservable',
      message: 'The verified snapshot does not record a bookable study room at this location.',
    });
  } else if (policy.groupStudyOnly && input.purpose === 'individual-study') {
    // The official Libraries rules cover "Group study rooms"; individual study
    // is separate walk-in use, so it cannot be planned as a reservation.
    issues.push({
      code: 'purpose-not-eligible',
      message:
        'These are group study rooms. Individual study cannot be reserved here; unscheduled rooms are walk-in with group priority.',
    });
  }

  const start = parseTimestamp(input.startIso);
  const end = parseTimestamp(input.endIso);

  if (!input.startIso || !input.endIso) {
    issues.push({ code: 'missing-time', message: 'Choose a start and end time.' });
  } else if (start === null || end === null) {
    issues.push({ code: 'invalid-time', message: 'Enter a valid campus date and time.' });
  } else if (end <= start) {
    issues.push({ code: 'end-before-start', message: 'The end time must be after the start time.' });
  } else {
    // A start exactly at "now" is still bookable; anything earlier is past.
    if (start < now.getTime()) {
      issues.push({ code: 'start-in-the-past', message: 'The start time is in the past. Choose a future time.' });
    }
    const durationMinutes = (end - start) / MINUTE;
    if (policy?.maxDurationMinutes != null && durationMinutes > policy.maxDurationMinutes) {
      issues.push({
        code: 'exceeds-max-duration',
        message: `The verified policy allows at most ${policy.maxDurationMinutes} minutes per booking.`,
      });
    }
    if (policy?.maxAdvanceDays != null && start - now.getTime() > policy.maxAdvanceDays * DAY) {
      issues.push({
        code: 'exceeds-advance-window',
        message: `The verified policy allows booking at most ${policy.maxAdvanceDays} days ahead.`,
      });
    }
  }

  if (!Number.isInteger(input.groupSize) || input.groupSize < 1 || input.groupSize > MAX_SANE_GROUP_SIZE) {
    issues.push({
      code: 'invalid-group-size',
      message: `Group size must be a whole number between 1 and ${MAX_SANE_GROUP_SIZE}.`,
    });
  } else if (policy?.maxGroupSize != null && input.groupSize > policy.maxGroupSize) {
    issues.push({
      code: 'exceeds-max-group-size',
      message: `The verified policy lists rooms for up to ${policy.maxGroupSize} people.`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    durationMinutes: start !== null && end !== null && end > start ? (end - start) / MINUTE : null,
  };
}

export function createReservationPlan(policy: ReservationPolicy | null, now: Date): ReservationPlan {
  const input = { ...emptyReservationInput(), locationId: policy?.locationId ?? '' };
  return {
    input,
    policy,
    state: 'draft',
    validation: validateReservation(input, policy, now),
    navigation: { attempted: false, succeeded: false, message: null },
    userReportedAt: null,
    verifiedAt: null,
  };
}

/**
 * Any edit drops the plan back to `draft`, so a previously "ready" plan can
 * never be opened with stale numbers.
 */
export function applyReservationInput(plan: ReservationPlan, patch: Partial<ReservationInput>, now: Date): ReservationPlan {
  const input: ReservationInput = { ...plan.input, ...patch };
  const policy = findReservationPolicy(input.locationId);
  return {
    ...plan,
    input,
    policy,
    state: 'draft',
    validation: validateReservation(input, policy, now),
    navigation: { attempted: false, succeeded: false, message: null },
    userReportedAt: null,
    verifiedAt: null,
  };
}

export function markReservationReady(plan: ReservationPlan, now: Date): ReservationPlan {
  const validation = validateReservation(plan.input, plan.policy, now);
  return { ...plan, validation, state: validation.ok ? 'ready' : 'draft' };
}

/**
 * Opens the official reservation page. Success only means the page opened; the
 * plan is never treated as confirmed here.
 */
export function openOfficialSystem(
  plan: ReservationPlan,
  openUrl: (url: string) => boolean,
  now: Date,
): ReservationPlan {
  const validation = validateReservation(plan.input, plan.policy, now);
  if (plan.state !== 'ready' || !validation.ok) {
    // Re-validated against the click-time clock: a plan that expired while the
    // page was open drops back to draft and never reaches openUrl.
    return {
      ...plan,
      validation,
      state: 'draft',
      navigation: {
        attempted: false,
        succeeded: false,
        message: validation.ok
          ? 'Validate the plan before opening the official reservation system.'
          : validation.issues[0].message,
      },
    };
  }

  const url = plan.policy?.reservationUrl;
  if (!url) {
    return {
      ...plan,
      validation,
      navigation: {
        attempted: false,
        succeeded: false,
        message: 'No verified reservation page is recorded for this location.',
      },
    };
  }

  let opened = false;
  try {
    opened = openUrl(url) === true;
  } catch {
    opened = false;
  }

  if (!opened) {
    return {
      ...plan,
      validation,
      navigation: {
        attempted: true,
        succeeded: false,
        message: 'The browser could not open the official page. Use the direct link below.',
      },
    };
  }

  return {
    ...plan,
    validation,
    state: 'opened',
    navigation: { attempted: true, succeeded: true, message: null },
  };
}

/** The user says they booked it. This stays self-reported. */
export function reportUserBooking(plan: ReservationPlan, nowIso: string): ReservationPlan {
  if (plan.state !== 'opened') return plan;
  return { ...plan, state: 'user-reported', userReportedAt: nowIso };
}

export interface VerificationAttempt {
  plan: ReservationPlan;
  verified: boolean;
  reason: string | null;
}

export const NO_TRUSTED_CONFIRMATION_SOURCE =
  'CampusPilot has no trusted official confirmation source, so a reservation can never be marked officially confirmed here.';

/**
 * Confirmation verification is intentionally unimplementable in this prototype.
 *
 * A caller-supplied string, URL, object or record is untrusted by definition: it
 * could be typed by the user or fabricated. Promoting a plan to `verified` would
 * require a server-side verifier that can actually query Ohio State, which does
 * not exist, so this function refuses every input and leaves the plan untouched.
 *
 * The `verified` state therefore stays defined but unreachable; the UI never
 * offers it and never claims an official booking.
 */
export function verifyOfficialConfirmation(plan: ReservationPlan, _evidence?: unknown): VerificationAttempt {
  return { plan, verified: false, reason: NO_TRUSTED_CONFIRMATION_SOURCE };
}
