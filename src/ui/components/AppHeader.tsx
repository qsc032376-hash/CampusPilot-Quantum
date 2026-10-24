import type { ScheduleRequest, ScheduleResponse } from '../../types.ts';
import { CAMPUS_TIME_ZONE, formatDuration } from '../format.ts';

interface AppHeaderProps {
  request: ScheduleRequest;
  result: ScheduleResponse | null;
  /** Human-readable label for the selected multi-day range. */
  rangeLabel: string;
  onReset: () => void;
}

/** Identity, at-a-glance counts, and the only global action. Purely presentational. */
export function AppHeader({ request, result, rangeLabel, onReset }: AppHeaderProps) {
  const placedMinutes = (result?.blocks ?? []).reduce(
    (total, block) => total + (Date.parse(block.end) - Date.parse(block.start)) / 60_000,
    0,
  );

  return (
    <header className="cp-header">
      <div className="cp-header__identity">
        <p className="cp-brand">CP / CAMPUSPILOT</p>
        <h1 className="cp-header__title">Make room for your next study session.</h1>
        <p className="cp-header__meta">
          {rangeLabel}
          <span className="cp-example-tag">Example data</span>
        </p>
        <p className="cp-caveat">
          A plan does not mean a place is open, a room is available or a booking exists.
        </p>
      </div>

      <dl className="cp-stats">
        <div className="cp-stats__item">
          <dt>Tasks</dt>
          <dd>{request.tasks.length}</dd>
        </div>
        <div className="cp-stats__item">
          <dt>Placed</dt>
          <dd>{result ? result.blocks.length : '—'}</dd>
        </div>
        <div className="cp-stats__item">
          <dt>Study time</dt>
          <dd>{result ? formatDuration(placedMinutes) : '—'}</dd>
        </div>
        <div className="cp-stats__item">
          <dt>Needs a slot</dt>
          <dd>{result ? result.unscheduledTasks.length : '—'}</dd>
        </div>
      </dl>

      <button type="button" className="cp-button cp-button--ghost" onClick={onReset}>
        Reset sample
      </button>
    </header>
  );
}
