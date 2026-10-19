import type { ScheduleRequest, StudyBlock } from '../../types.ts';
import { formatDayShort, formatDuration, formatRangeDetailed } from '../format.ts';
import { LOCATION_AVAILABILITY_NOTE, buildLocationPlan } from '../locationPlan.ts';
import { EmptyState } from './EmptyState.tsx';

interface LocationCardProps {
  block: StudyBlock | null;
  request: ScheduleRequest;
}

/**
 * Shows where a selected study block happens, plus every other verified campus
 * location the shared recommender reports as open for the same block.
 *
 * The scheduler still assigns a single location to each block; this card does
 * not change that, it simply surfaces the rest of the verified list. Building,
 * room and hours stay optional: missing values are never invented, and any
 * hours shown come from the clearly labelled simulated dataset.
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

      {plan.status === 'ok' && (
        <>
          <h3 className="cp-subhead">Also open for this block ({plan.recommendations.length})</h3>
          <ul className="cp-locations">
            {plan.recommendations.map((recommendation) => {
              const isScheduled =
                recommendation.location.id === plan.scheduled?.id ||
                recommendation.location.name === plan.scheduled?.name;
              return (
                <li key={recommendation.location.id} className="cp-locations__row">
                  <span className="cp-locations__name">
                    {recommendation.location.name}
                    {isScheduled && <span className="cp-tag">Scheduled</span>}
                  </span>
                  <span className="cp-locations__meta">
                    {recommendation.reasons[0]}
                    {recommendation.location.reservable && (
                      <span className="cp-tag cp-tag--low">Rooms bookable</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {plan.status === 'no-match' && (
        <p className="cp-hint">No location in the campus list is listed as open for this whole block.</p>
      )}

      {plan.status === 'unavailable-window' && (
        <p className="cp-hint">This block cannot be matched to a single campus day, so no location list is shown.</p>
      )}

      <p className="cp-panel__foot">
        {rows.some((row) => row.label === 'Listed hours') ? 'Listed hours are demo text, not live availability. ' : ''}
        {plan.status === 'ok' ? `${LOCATION_AVAILABILITY_NOTE} ` : ''}
        This prototype does not verify room availability or travel time between sessions.
      </p>
    </section>
  );
}
