import type { ScheduleRequest, StudyBlock } from '../../types.ts';
import { formatDayShort, formatDuration, formatRangeDetailed } from '../format.ts';
import { buildLocationPlan } from '../locationPlan.ts';
import type { LocationPlanStatus } from '../locationPlan.ts';
import { describeBlockLocation } from '../taskLocationDraft.ts';
import { EmptyState } from './EmptyState.tsx';

interface LocationCardProps {
  block: StudyBlock | null;
  request: ScheduleRequest;
}

/** Plain-language reason for a skipped availability check. */
function statusReason(status: LocationPlanStatus): string {
  switch (status) {
    case 'crosses-dst':
      return 'the block spans a daylight-saving change.';
    case 'not-minute-aligned':
      return 'the block does not start and end on a whole minute.';
    case 'crosses-midnight':
      return 'the block crosses midnight.';
    case 'no-match':
      return 'no simulated availability covers it.';
    case 'invalid-range':
      return 'the block has no valid time range.';
    default:
      return 'its hours could not be verified.';
  }
}

/**
 * Answers one question: where did the scheduler place this block?
 *
 * The list of other open places lives in its own RecommendedLocations panel, so
 * this card stays focused. Building, room and hours are optional and are never
 * invented; a supplied `hours` value is labelled as demo text.
 */
export function LocationCard({ block, request }: LocationCardProps) {
  if (!block) {
    return (
      <section className="cp-panel" aria-labelledby="cp-location-heading">
        <div className="cp-panel__head">
          <h2 id="cp-location-heading">Where</h2>
        </div>
        <EmptyState title="No block selected" message="Select a study block to see where it happens." />
      </section>
    );
  }

  const minutes = (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
  const display = describeBlockLocation(block, request.locations);

  // An explicit choice never falls back to a scheduler default, and a custom
  // name is plain text the user typed, so neither goes through the availability
  // helper at all.
  if (display.kind !== 'legacy') {
    const name =
      display.kind === 'campus' ? display.name : display.kind === 'custom' ? display.name : 'No location set';
    const status =
      display.kind === 'campus'
        ? 'Chosen for this task. Opening hours and room availability are not verified, and nothing is booked.'
        : display.kind === 'custom'
          ? 'Your own name for this task. It is not checked against campus data, opening hours or availability.'
          : 'No location was chosen for this task, so none is assumed and no default is applied.';
    return (
      <section className="cp-panel" aria-labelledby="cp-location-heading-chosen">
        <div className="cp-panel__head">
          <h2 id="cp-location-heading-chosen">Where</h2>
          <p className="cp-panel__meta">
            {formatDayShort(block.start)} · {formatRangeDetailed(block.start, block.end, true)}
          </p>
        </div>

        <p className="cp-location__name">{name}</p>
        <p className="cp-location__task">
          {block.title} · {formatDuration(minutes)}
        </p>
        <p className="cp-location__status">{status}</p>

        <p className="cp-hint">
          This is task metadata for your own plan. The recommendation panel lists places separately; those suggestions are
          not the location chosen for this task.
        </p>

        <p className="cp-panel__foot">
          This prototype does not verify room availability or travel time between sessions.
        </p>
      </section>
    );
  }

  const plan = buildLocationPlan(block, request);
  const details = plan.scheduled?.details ?? null;

  const rows: { label: string; value: string }[] = [];
  if (plan.scheduled?.building) rows.push({ label: 'Building', value: plan.scheduled.building });
  if (plan.scheduled?.room) rows.push({ label: 'Room', value: plan.scheduled.room });
  if (plan.scheduled?.hours) rows.push({ label: 'Listed hours', value: plan.scheduled.hours });
  if (details?.address) rows.push({ label: 'Address', value: details.address });

  return (
    <section className="cp-panel" aria-labelledby="cp-location-heading-detail">
      <div className="cp-panel__head">
        <h2 id="cp-location-heading-detail">Where</h2>
        <p className="cp-panel__meta">
          {formatDayShort(block.start)} · {formatRangeDetailed(block.start, block.end, true)}
        </p>
      </div>

      <p className="cp-location__name">{plan.scheduled ? plan.scheduled.name : 'No study location supplied'}</p>
      <p className="cp-location__task">
        {block.title} · {formatDuration(minutes)}
      </p>

      {/*
        Always visible, including the ordinary case: the scheduler assigns one
        location by default and this prototype never verifies real opening
        hours, so the card must not look like a confirmed booking.
      */}
      <p className="cp-location__status">
        Default scheduler assignment; real opening hours have not been verified.
      </p>

      {rows.length > 0 ? (
        <dl className="cp-location__details">
          {rows.map((row) => (
            <div key={row.label} className="cp-location__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cp-hint">No building or room details supplied for this location.</p>
      )}

      {plan.status !== 'ok' && (
        <p className="cp-hint">
          The assigned location was <strong>not</strong> checked against opening hours for this block, because{' '}
          {statusReason(plan.status)} The schedule is unchanged; only the availability check was skipped.
        </p>
      )}

      {plan.status === 'ok' && plan.scheduled && !plan.scheduledIsRecommended && (
        <p className="cp-hint">
          This place is not covered by the simulated opening hours for this block. The recommendation panel lists the
          locations that are.
        </p>
      )}

      <p className="cp-panel__foot">
        {rows.some((row) => row.label === 'Listed hours') ? 'Listed hours are demo text, not live availability. ' : ''}
        This prototype does not verify room availability or travel time between sessions.
      </p>
    </section>
  );
}
