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
 * It sits beside the "Where" card: Where answers "where did the scheduler put
 * this block", this list answers "what else is open at that time". Every row
 * shows the match score, the recommender's own reasons and the official Ohio
 * State page for that location.
 *
 * When the block cannot be converted into a campus-time window the list is not
 * drawn at all and the reason is stated, so the UI never implies a place was
 * checked when it was not.
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
            {count} {count === 1 ? 'place is' : 'places are'} recommended for this simulated block time.
          </p>

          {plan.scheduled !== null && !plan.scheduledIsRecommended && (
            <p className="cp-hint">
              The scheduled location ({plan.scheduled.name}) is not in this list: it is not covered by the simulated
              opening hours for this block.
            </p>
          )}

          <ul className="cp-locations">
            {plan.recommendations.map((recommendation) => {
              const { location, score, reasons } = recommendation;
              // Canonical dataset id only, so a legacy id cannot tag two rows.
              const isScheduled = location.id === plan.canonicalScheduledId;
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

      {plan.status === 'crosses-dst' && (
        <p className="cp-hint">
          This block spans a daylight-saving change, so its clock length is not its real length. Location matching is
          skipped rather than guessed.
        </p>
      )}

      {plan.status === 'not-minute-aligned' && (
        <p className="cp-hint">
          This block does not start and end on a whole minute. Location matching is skipped instead of rounding the
          block shorter.
        </p>
      )}

      {plan.status === 'crosses-midnight' && (
        <p className="cp-hint">
          This block crosses midnight, so it cannot be matched to a single campus day.
        </p>
      )}

      {plan.status === 'invalid-range' && (
        <p className="cp-hint">This block does not have a valid start and end time, so no location list is shown.</p>
      )}

      <p className="cp-panel__foot">
        These are suggestions for open places, not the location assigned to the task. {LOCATION_AVAILABILITY_NOTE} Official
        pages are linked; nothing is booked here.
      </p>
    </section>
  );
}
