import type { ScheduleRequest, ScheduleResponse } from '../../types.ts';
import {
  abbreviationAt,
  clipToWindow,
  elapsedMinutes,
  formatClock,
  formatDayShort,
  formatRangeDetailed,
  formatWindowLabel,
  windowSpansTransition,
} from '../format.ts';

interface WeeklyScheduleProps {
  request: ScheduleRequest;
  result: ScheduleResponse | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const HOUR_HEIGHT = 56;

type BlockKind = 'class' | 'busy' | 'study';

interface TimelineItem {
  id: string;
  title: string;
  kind: BlockKind;
  start: string;
  end: string;
}

/**
 * The visual hero: a timeline built from the request window.
 *
 * Positions come from real timestamp differences, so elapsed time is never
 * negative across a fall-back hour and the repeated hour occupies its own
 * space. Events outside the window are dropped; partially visible events are
 * clipped for drawing only and keep their original data.
 *
 * A block's visible rectangle is always the exact clipped span, so a five
 * minute event stays five minutes tall instead of spilling past the window.
 * Study blocks get a separate, taller click target layered over that rectangle.
 */
export function WeeklySchedule({ request, result, selectedId, onSelect }: WeeklyScheduleProps) {
  const windowStartMs = Date.parse(request.windowStart);
  const totalMinutes = elapsedMinutes(request.windowEnd, request.windowStart);
  const timelineHeight = Math.max(HOUR_HEIGHT, (totalMinutes / 60) * HOUR_HEIGHT);
  const showZone = windowSpansTransition(request.windowStart, request.windowEnd);
  const crossDay = formatDayShort(request.windowStart) !== formatDayShort(request.windowEnd);

  const items: TimelineItem[] = [
    ...request.classes.map((event) => ({ id: event.id, title: event.title, kind: 'class' as const, start: event.start, end: event.end })),
    ...request.unavailablePeriods.map((period) => ({ id: period.id, title: period.title, kind: 'busy' as const, start: period.start, end: period.end })),
    ...(result?.blocks ?? []).map((block) => ({ id: block.id, title: block.title, kind: 'study' as const, start: block.start, end: block.end })),
  ];

  const ticks: { offset: number; label: string }[] = [];
  let previousDay = '';
  for (let offset = 0; offset <= totalMinutes; offset += 60) {
    const instant = new Date(windowStartMs + offset * 60_000).toISOString();
    const day = formatDayShort(instant);
    const label = [crossDay && day !== previousDay ? day : '', formatClock(instant), showZone ? abbreviationAt(Date.parse(instant)) : '']
      .filter(Boolean)
      .join(' ');
    ticks.push({ offset, label });
    previousDay = day;
  }

  const blocks = items
    .map((item) => {
      const span = clipToWindow(item.start, item.end, request.windowStart, request.windowEnd);
      if (!span) return null;
      const top = Math.min(Math.max(0, (span.offsetMinutes / 60) * HOUR_HEIGHT), timelineHeight);
      const height = Math.max(0, Math.min((span.durationMinutes / 60) * HOUR_HEIGHT, timelineHeight - top));
      return { item, span, top, height };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const hasStudyBlocks = (result?.blocks.length ?? 0) > 0;
  const isEmpty = blocks.length === 0 && !result;

  return (
    <section className="cp-panel cp-schedule" aria-labelledby="cp-schedule-heading">
      <div className="cp-panel__head">
        <h2 id="cp-schedule-heading">Your schedule</h2>
        <p className="cp-panel__meta">{formatWindowLabel(request.windowStart, request.windowEnd)}</p>
      </div>

      <ul className="cp-legend">
        <li className="cp-legend__item">
          <span className="cp-dot cp-dot--class" aria-hidden="true" /> Class or commitment
        </li>
        <li className="cp-legend__item">
          <span className="cp-dot cp-dot--busy" aria-hidden="true" /> Unavailable
        </li>
        <li className="cp-legend__item">
          <span className="cp-dot cp-dot--study" aria-hidden="true" /> Study block
        </li>
      </ul>

      <div className="cp-timeline" style={{ height: `${timelineHeight}px` }}>
        <div className="cp-timeline__gutter" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.offset} className="cp-timeline__tick" style={{ top: `${(tick.offset / 60) * HOUR_HEIGHT}px` }}>
              {tick.label}
            </span>
          ))}
        </div>

        <div className="cp-timeline__track">
          {ticks.map((tick) => (
            <span key={tick.offset} className="cp-timeline__line" style={{ top: `${(tick.offset / 60) * HOUR_HEIGHT}px` }} aria-hidden="true" />
          ))}

          {blocks.map(({ item, span, top, height }) => {
            const style = { top: `${top}px`, height: `${height}px` };
            const timeLabel = formatRangeDetailed(item.start, item.end, showZone);
            const clipped = span.clippedStart || span.clippedEnd;
            const label = `${item.title}, ${timeLabel}${clipped ? ', partly outside the window' : ''}`;
            const clipClass = `${span.clippedStart ? ' is-clipped-start' : ''}${span.clippedEnd ? ' is-clipped-end' : ''}`;

            if (item.kind === 'study') {
              const isSelected = item.id === selectedId;
              return (
                <div
                  key={item.id}
                  className={`cp-slot${isSelected ? ' is-selected' : ''}`}
                  style={style}
                  data-block-id={item.id}
                >
                  <div className={`cp-block cp-block--study${clipClass}`} aria-hidden="true">
                    <span className="cp-block__time">{timeLabel}</span>
                    <span className="cp-block__title">{item.title}</span>
                  </div>
                  <button
                    type="button"
                    className="cp-hit"
                    onClick={() => onSelect(isSelected ? null : item.id)}
                    aria-pressed={isSelected}
                    aria-label={label}
                    title={clipped ? `${timeLabel} (partly outside the window)` : timeLabel}
                  />
                </div>
              );
            }

            return (
              <div key={item.id} className={`cp-block cp-block--${item.kind}${clipClass}`} style={style} title={label}>
                <span className="cp-block__time">{timeLabel}</span>
                <span className="cp-block__title">{item.title}</span>
              </div>
            );
          })}

          {isEmpty && (
            <div className="cp-timeline__empty">
              <p className="cp-empty__title">Nothing scheduled yet</p>
              <p className="cp-empty__message">Add a study task, then build the schedule.</p>
            </div>
          )}
        </div>
      </div>

      <p className="cp-panel__foot">
        {hasStudyBlocks
          ? 'Study blocks are suggestions. Select one to see its location.'
          : 'Study blocks appear here once the schedule is built.'}
        {totalMinutes > 0 && ` Visible window: ${Math.round(totalMinutes / 60)} hours.`}
      </p>
    </section>
  );
}
