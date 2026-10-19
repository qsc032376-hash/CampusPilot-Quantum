import type { ScheduleRequest, StudyBlock } from '../../types.ts';
import { formatDayShort, formatDuration, formatRangeDetailed } from '../format.ts';
import { buildLocationPlan } from '../locationPlan.ts';
import { EmptyState } from './EmptyState.tsx';

interface LocationCardProps {
  block: StudyBlock | null;
  request: ScheduleRequest;
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

  const plan = buildLocationPlan(block, request);
  const minutes = (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
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

      <p className="cp-panel__foot">
        {rows.some((row) => row.label === 'Listed hours') ? 'Listed hours are demo text, not live availability. ' : ''}
        This prototype does not verify room availability or travel time between sessions.
      </p>
    </section>
  );
}
