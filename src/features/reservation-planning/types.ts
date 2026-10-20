/**
 * Reservation planning types.
 *
 * This module is deliberately independent of the scheduling and recommendation
 * algorithms: it never calls `recommendLocations()` or `src/scheduler.ts`, and
 * it makes no claim that a room is free. Eligibility, building access and live
 * availability are separate concepts and are modelled separately.
 */

export type ReservationState = 'draft' | 'ready' | 'opened' | 'user-reported' | 'verified';

/**
 * Structured purpose, not free text: the eligibility rule is about group study,
 * so the choice must be explicit rather than inferred from keywords.
 */
export type ReservationPurpose = '' | 'group-study' | 'individual-study' | 'other';

export interface ReservationInput {
  locationId: string;
  /** ISO 8601 with explicit offset, produced by the campus-time parser. */
  startIso: string;
  endIso: string;
  groupSize: number;
  purpose: ReservationPurpose;
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
  /** True for the University Libraries group-study rooms. */
  groupStudyOnly: boolean;
  /** Official eligibility sentence, verbatim from the snapshot. */
  eligibility: string;
  /** Official booking rules sentence, verbatim from the snapshot. */
  bookingRules: string;
  /** Ordinary reservation rules stated explicitly, without the ELA context. */
  ordinaryRules: string;
  /** Extended Library Access context; HSL only, documentation only. */
  ela: ElaScopeNote | null;
  /** Official page the booking rules came from. */
  rulesUrl: string;
  /** Date that rule page was read, separate from the location identity data. */
  rulesVerifiedOn: string;
  /** "More than 15 minutes late forfeits the reservation", when stated. */
  lateArrivalRule: string | null;
  /** "may be released if unoccupied after 10 minutes", when stated. */
  unoccupiedReleaseRule: string | null;
}

/**
 * Extended Library Access context for HSL. Documentation only: it is not a
 * reservation mode, and it never relaxes ordinary reservation validation.
 */
export interface ElaScopeNote {
  label: string;
  requirements: readonly string[];
  /** What the cited page does not settle; kept explicit instead of guessed. */
  caveat: string;
  sourceUrl: string;
  /** Null when this snapshot did not record a read date for the ELA page. */
  verifiedOn: string | null;
}

export type ReservationIssueCode =
  | 'missing-policy'
  | 'location-not-reservable'
  | 'purpose-not-eligible'
  | 'missing-time'
  | 'invalid-time'
  | 'start-in-the-past'
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
