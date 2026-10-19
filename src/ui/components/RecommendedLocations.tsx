import type { ScheduleRequest, StudyBlock } from '../../types.ts';
import { formatDayShort, formatRangeDetailed } from '../format.ts';
import { LOCATION_AVAILABILITY_NOTE, buildLocationPlan } from '../locationPlan.ts';
import { EmptyState } from './EmptyState.tsx';

interface RecommendedLocationsProps {
  block: StudyBlock | null;
  request: ScheduleRequest;
}

/**
 * Standalone list of campus locations the shared recommender reports as open
 * for the selected study block.
 *
 * It sits beside the "Where" card rather than inside it: the Where card answers
 * "where did the scheduler put this block", this list answers "what else is
 * open at that time". Every row shows the match score, the recommender's own
 * reasons and the official Ohio State page for that location.
 */
export function RecommendedLocations({ block, request }: RecommendedLocationsProps) {
  if (!block) {
    return (
      <section className="cp-panel" aria-labelledby="cp-recommended-heading">
        <div className="cp-panel__head">
          <h2 id="cp-recommended-heading">Recommended study locations</h2>
        </div>
        <EmptyState
          title="No block selected"
          message="Select a study block to see which campus locations are open at that time."
        />
      </section>
    );
  }

  const plan = buildLocationPlan(block, request);
  const count = plan.recommendations.length;

  return (
    <section className="cp-panel" aria-labelledby="cp-recommended-heading-detail">
      <div className="cp-panel__head">
        <h2 id="cp-recommended-heading-detail">Recommended study locations</h2>
        <p className="cp-panel__meta">
          {formatDayShort(block.start)} · {formatRangeDetailed(block.start, block.end, true)}
        </p>
      </div>

      {plan.status === 'ok' && (
        <>
          <p className="cp-panel__meta">
            {count} {count === 1 ? 'place is' : 'places are'} listed as open for this block.
          </p>
          <ul className="cp-locations">
            {plan.recommendations.map((recommendation) => {
              const { location, score, reasons } = recommendation;
              const isScheduled =
                location.id === plan.scheduled?.id || location.name === plan.scheduled?.name;
              // Only claim booking when the official reservation page was verified.
              const link = location.reservationUrl
                ? { href: location.reservationUrl, label: 'Reserve study room' }
                : { href: location.infoUrl, label: 'Location details' };

              return (
                <li key={location.id} className="cp-locations__row">
                  <span className="cp-locations__name">
                    {location.name}
                    {isScheduled && <span className="cp-tag">Scheduled</span>}
                    <span className="cp-locations__score" title={`Match score ${score} of 100`}>
                      {score}
                    </span>
                  </span>
                  <span className="cp-locations__meta">{reasons.join(' ')}</span>
                  <a className="cp-locations__link" href={link.href} target="_blank" rel="noreferrer noopener">
                    {link.label}
                  </a>
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
        <p className="cp-hint">
          This block cannot be matched to a single campus day, so no location list is shown.
        </p>
      )}

      <p className="cp-panel__foot">{LOCATION_AVAILABILITY_NOTE} Official pages are linked; nothing is booked here.</p>
    </section>
  );
}
