import { useState } from 'react';
import type { ReservationPlan, ReservationPurpose, ReservationState } from '../../features/reservation-planning/index.ts';
import {
  ADVANCE_WINDOW_MEASUREMENT,
  LIVE_AVAILABILITY_NOTICE,
  applyReservationInput,
  createReservationPlan,
  listReservationLocations,
  markReservationReady,
  openOfficialSystem,
  reportUserBooking,
} from '../../features/reservation-planning/index.ts';
import { parseCampusInput } from '../format.ts';

interface ReservationPlannerProps {
  /** Injectable so tests can simulate a blocked or failing navigation. */
  openUrl?: (url: string) => boolean;
  /** Injectable clock keeps the advance-window check deterministic in tests. */
  now?: () => Date;
}

interface FormState {
  locationId: string;
  date: string;
  start: string;
  end: string;
  groupSize: string;
  purpose: string;
}

const EMPTY_FORM: FormState = { locationId: '', date: '', start: '', end: '', groupSize: '2', purpose: '' };

const STATE_LABEL: Record<ReservationState, string> = {
  draft: 'Draft',
  ready: 'Ready to open official system',
  opened: 'Official system opened',
  'user-reported': 'You reported the booking',
  verified: 'Officially confirmed',
};

function toCampusIso(date: string, time: string): string {
  if (!date || !time) return '';
  const parsed = parseCampusInput(`${date}T${time}`);
  return parsed.status === 'ok' ? parsed.iso : '';
}

function defaultOpen(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const opened = window.open(url, '_blank');
    return opened !== null && opened !== undefined;
  } catch {
    return false;
  }
}

/**
 * Minimal reservation planning workflow.
 *
 * It validates a proposed booking against the verified snapshot, keeps booking
 * eligibility, building access and live room availability as three separate
 * statements, and only ever moves the plan as far as the evidence allows:
 * opening the official page never means "booked", and nothing here can reach
 * "Officially confirmed" because CampusPilot has no trustworthy confirmation
 * source.
 */
export function ReservationPlanner({ openUrl = defaultOpen, now = () => new Date() }: ReservationPlannerProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [plan, setPlan] = useState<ReservationPlan>(() => createReservationPlan(null, now()));

  const locations = listReservationLocations();
  const policy = plan.policy;
  const clock = now();

  function inputFrom(next: FormState) {
    return {
      locationId: next.locationId,
      startIso: toCampusIso(next.date, next.start),
      endIso: toCampusIso(next.date, next.end),
      groupSize: Number(next.groupSize),
      purpose: next.purpose as ReservationPurpose,
    };
  }

  function update(patch: Partial<FormState>) {
    const next = { ...form, ...patch };
    setForm(next);
    setPlan((current) => applyReservationInput(current, inputFrom(next), now()));
  }

  const startParsed = form.date && form.start ? parseCampusInput(`${form.date}T${form.start}`) : null;
  const endParsed = form.date && form.end ? parseCampusInput(`${form.date}T${form.end}`) : null;
  const timeNote =
    startParsed?.status === 'ambiguous' || endParsed?.status === 'ambiguous'
      ? 'That campus time happens twice today. Pick a different minute.'
      : startParsed?.status === 'nonexistent' || endParsed?.status === 'nonexistent'
        ? 'That campus time does not exist today (clocks jump forward). Pick a different minute.'
        : null;

  return (
    <section className="cp-panel" aria-labelledby="cp-reservation-heading">
      <div className="cp-panel__head">
        <h2 id="cp-reservation-heading">Plan a room reservation</h2>
        <p className="cp-panel__meta">
          Separate from scheduling · state: <strong>{STATE_LABEL[plan.state]}</strong>
        </p>
      </div>

      <p className="cp-notice" role="note">
        {LIVE_AVAILABILITY_NOTICE}
      </p>

      <div className="cp-form">
        <label className="cp-field">
          <span className="cp-field__label">Library / location</span>
          <select
            className="cp-input"
            value={form.locationId}
            onChange={(event) => update({ locationId: event.target.value })}
          >
            <option value="">Choose a location…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.reservable ? '' : ' (no bookable rooms recorded)'}
              </option>
            ))}
          </select>
        </label>

        <label className="cp-field">
          <span className="cp-field__label">Reservation date</span>
          <input className="cp-input" type="date" value={form.date} onChange={(event) => update({ date: event.target.value })} />
        </label>

        <div className="cp-field-row cp-field-row--split">
          <label className="cp-field">
            <span className="cp-field__label">Start (campus time)</span>
            <input className="cp-input" type="time" value={form.start} onChange={(event) => update({ start: event.target.value })} />
          </label>
          <label className="cp-field">
            <span className="cp-field__label">End (campus time)</span>
            <input className="cp-input" type="time" value={form.end} onChange={(event) => update({ end: event.target.value })} />
          </label>
        </div>

        <div className="cp-field-row cp-field-row--split">
          <label className="cp-field">
            <span className="cp-field__label">Group size</span>
            <input
              className="cp-input"
              type="number"
              min={1}
              value={form.groupSize}
              onChange={(event) => update({ groupSize: event.target.value })}
            />
          </label>
          <label className="cp-field">
            <span className="cp-field__label">Purpose</span>
            <select
              className="cp-input"
              value={form.purpose}
              onChange={(event) => update({ purpose: event.target.value })}
            >
              <option value="">Not specified</option>
              <option value="group-study">Group study</option>
              <option value="individual-study">Individual study</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        {timeNote && (
          <p className="cp-error" role="alert">
            {timeNote}
          </p>
        )}

        {plan.validation.issues.map((issue) => (
          <p key={issue.code} className="cp-error" role="alert">
            {issue.message}
          </p>
        ))}
      </div>

      {policy ? (
        <>
          <h3 className="cp-subhead">Verified policy</h3>
          <dl className="cp-policy">
            <div className="cp-location__row">
              <dt>Booking eligibility</dt>
              <dd>
                {policy.eligibility}
                {policy.groupStudyOnly ? ' Group study rooms only; individual study is walk-in, not reservable.' : ''}
                {policy.reservable ? ' Room availability is not verified.' : ' No bookable study room is recorded.'}
              </dd>
            </div>
            <div className="cp-location__row">
              <dt>Official rules</dt>
              <dd>{policy.bookingRules}</dd>
            </div>
            <div className="cp-location__row">
              <dt>Limits</dt>
              <dd>
                {policy.maxDurationMinutes === null ? 'Duration limit not verified' : `Max ${policy.maxDurationMinutes} min`}
                {' · '}
                {policy.maxAdvanceDays === null
                  ? 'advance window not verified'
                  : `up to ${policy.maxAdvanceDays} days ahead (${ADVANCE_WINDOW_MEASUREMENT})`}
                {' · '}
                {policy.maxGroupSize === null ? 'group limit not verified' : `up to ${policy.maxGroupSize} people`}
              </dd>
            </div>
            {policy.lateArrivalRule && (
              <div className="cp-location__row">
                <dt>Late arrival</dt>
                <dd>{policy.lateArrivalRule}</dd>
              </div>
            )}
            {policy.unoccupiedReleaseRule && (
              <div className="cp-location__row">
                <dt>Unoccupied room</dt>
                <dd>{policy.unoccupiedReleaseRule}</dd>
              </div>
            )}
            <div className="cp-location__row">
              <dt>Building access</dt>
              <dd>{policy.buildingAccess ?? 'Not verified in CampusPilot.'}</dd>
            </div>
            <div className="cp-location__row">
              <dt>Room availability</dt>
              <dd>Not verified. CampusPilot has no live availability data.</dd>
            </div>
            <div className="cp-location__row">
              <dt>Rules source</dt>
              <dd>
                <a className="cp-locations__link" href={policy.rulesUrl} target="_blank" rel="noreferrer noopener">
                  Official booking rules
                </a>{' '}
                · rules read {policy.rulesVerifiedOn} · location data verified {policy.verifiedOn}
              </dd>
            </div>
          </dl>
          <p className="cp-panel__foot">{policy.statement}</p>
        </>
      ) : (
        <p className="cp-hint">Choose a location to see its verified reservation policy.</p>
      )}

      <div className="cp-actions">
        {plan.state === 'draft' && (
          <button type="button" className="cp-button" onClick={() => setPlan((current) => markReservationReady(current, now()))}>
            Validate plan
          </button>
        )}

        {plan.state === 'ready' && (
          <button
            type="button"
            className="cp-button"
            onClick={() => setPlan((current) => openOfficialSystem(current, openUrl, now()))}
          >
            Open official reservation system
          </button>
        )}

        {plan.state === 'opened' && (
          <>
            <p className="cp-hint">
              The official page was opened in a new tab. That is <strong>not</strong> a booking and CampusPilot has no
              confirmation from it.
            </p>
            <button
              type="button"
              className="cp-button cp-button--ghost"
              onClick={() => setPlan((current) => reportUserBooking(current, clock.toISOString()))}
            >
              I booked it in the official system
            </button>
          </>
        )}

        {plan.state === 'user-reported' && (
          <p className="cp-hint">
            Marked as booked <strong>based on your report only</strong>. “Officially confirmed” stays unavailable because
            CampusPilot has no trustworthy confirmation source, so it will not claim a verified reservation.
          </p>
        )}

        {plan.navigation.message && (
          <p className="cp-error" role="alert">
            {plan.navigation.message}
          </p>
        )}

        {policy?.reservationUrl && (
          <p className="cp-panel__foot">
            Direct link:{' '}
            <a className="cp-locations__link" href={policy.reservationUrl} target="_blank" rel="noreferrer noopener">
              {policy.reservationUrl}
            </a>
          </p>
        )}

        {policy && !policy.reservationUrl && (
          <p className="cp-panel__foot">No official reservation page is recorded for this location.</p>
        )}
      </div>
    </section>
  );
}
