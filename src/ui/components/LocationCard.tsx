import type { ScheduleRequest, StudyBlock } from '../../types.ts';
import { formatDayShort, formatDuration, formatRangeDetailed } from '../format.ts';
import { EmptyState } from './EmptyState.tsx';
interface LocationCardProps {
  block: StudyBlock | null;
  request: ScheduleRequest;
}

/**
 * Shows the campus location attached to the selected study block. The shared
 * contract only carries a location id and name, so this card deliberately makes
 * no claim about opening hours, rooms, or current availability.
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

      <p className="cp-panel__foot">
        The prototype does not verify building hours, room availability, or travel time between sessions.
      </p>
    </section>
  );
}
