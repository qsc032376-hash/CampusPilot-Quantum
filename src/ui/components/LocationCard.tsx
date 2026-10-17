import type { ScheduleRequest, StudyBlock } from '../../types.ts';
import { formatDayShort, formatDuration, formatRangeDetailed } from '../format.ts';
import { EmptyState } from './EmptyState.tsx';

interface LocationCardProps {
  block: StudyBlock | null;
  request: ScheduleRequest;
}

/**
 * Shows the campus location attached to the selected study block.
 *
 * Building, room and hours are optional in the shared contract. Missing values
 * are simply not rendered rather than filled in, and any supplied hours are
 * labelled as demo text: this prototype never claims live availability.
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

  const location = request.locations.find((candidate) => candidate.id === block.locationId);
  const minutes = (Date.parse(block.end) - Date.parse(block.start)) / 60_000;

  const details: { label: string; value: string }[] = [];
  if (location?.building) details.push({ label: 'Building', value: location.building });
  if (location?.room) details.push({ label: 'Room', value: location.room });
  if (location?.hours) details.push({ label: 'Listed hours', value: location.hours });

  return (
    <section className="cp-panel" aria-labelledby="cp-location-heading-detail">
      <div className="cp-panel__head">
        <h2 id="cp-location-heading-detail">Where</h2>
        <p className="cp-panel__meta">
          {formatDayShort(block.start)} · {formatRangeDetailed(block.start, block.end, true)}
        </p>
      </div>

      <p className="cp-location__name">{location ? location.name : 'No study location supplied'}</p>
      <p className="cp-location__task">
        {block.title} · {formatDuration(minutes)}
      </p>

      {details.length > 0 ? (
        <dl className="cp-location__details">
          {details.map((detail) => (
            <div key={detail.label} className="cp-location__row">
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cp-hint">No building or room details supplied for this location.</p>
      )}

      <p className="cp-panel__foot">
        {details.some((detail) => detail.label === 'Listed hours')
          ? 'Listed hours are demo text, not live availability. '
          : ''}
        This prototype does not verify room availability or travel time between sessions.
      </p>
    </section>
  );
}
