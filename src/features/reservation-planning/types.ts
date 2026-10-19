/**
 * Reservation planning types.
 *
 * This module is deliberately independent of the scheduling and recommendation
 * algorithms: it never calls `recommendLocations()` or `src/scheduler.ts`, and
 * it makes no claim that a room is free. Eligibility, building access and live
 * availability are separate concepts and are modelled separately.
 */

export type ReservationState = 'draft' | 'ready' | 'opened' | 'user-reported' | 'verified';

export interface ReservationInput {
  locationId: string;
  /** ISO 8601 with explicit offset, produced by the campus-time parser. */
  startIso: string;
  endIso: string;
  groupSize: number;
  purpose: string;
}

/**
 * Policy transcribed from the verified location snapshot.
 *
 * Every limit is either stated by the official page recorded in `sourceUrl`, or
 * `null` meaning "not verified". Nothing is inferred from convention.
 */
export interface ReservationPolicy {
  locationId: string;
  reservable: boolean;
  reservationUrl?: string;
  infoUrl: string;
  verifiedOn: string;
  /** Verbatim wording from the verified snapshot, shown so the user can check it. */
  statement: string;
  maxDurationMinutes: number | null;
  maxAdvanceDays: number | null;
  maxGroupSize: number | null;
  /** Building access rules, kept separate from booking eligibility. */
  buildingAccess: string | null;
}

export type ReservationIssueCode =
  | 'missing-policy'
  | 'location-not-reservable'
  | 'missing-time'
  | 'invalid-time'
  | 'end-before-start'
  | 'exceeds-max-duration'
  | 'exceeds-advance-window'
  | 'invalid-group-size'
  | 'exceeds-max-group-size';

export interface ReservationIssue {
  code: ReservationIssueCode;
  message: string;
}

export interface ReservationValidation {
  ok: boolean;
  issues: ReservationIssue[];
  durationMinutes: number | null;
}

export interface NavigationResult {
  attempted: boolean;
  succeeded: boolean;
  message: string | null;
}

export interface ReservationPlan {
  input: ReservationInput;
  policy: ReservationPolicy | null;
  state: ReservationState;
  validation: ReservationValidation;
  navigation: NavigationResult;
  /** Self-reported by the user; never treated as official confirmation. */
  userReportedAt: string | null;
  verifiedAt: string | null;
}

/** Evidence a state may only reach `verified` with. None exists in this prototype. */
export interface ConfirmationEvidence {
  source: 'official-confirmation';
  reference: string;
}
