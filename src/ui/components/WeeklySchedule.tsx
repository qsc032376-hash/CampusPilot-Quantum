import type { ClassEvent, ScheduleConflict, StudyBlock, UnavailablePeriod } from '../../types.ts';
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
  /** Window of the day currently being viewed; null when no day is selected. */
  windowStart: string | null;
  windowEnd: string | null;
  dayLabel: string;
  classes: readonly ClassEvent[];
  unavailablePeriods: readonly UnavailablePeriod[];
  blocks: readonly StudyBlock[];
  conflicts?: readonly ScheduleConflict[];
  /** True once a schedule has been generated for the current range. */
  hasPlan: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const HOUR_HEIGHT = 56;
const HIT_PADDING = 6;
const TINY_HEIGHT = 18;

type BlockKind = 'class' | 'busy' | 'study';

interface TimelineItem {
  id: string;
  title: string;
  kind: BlockKind;
  start: string;
  end: string;
}

/**
 * The visual hero: a timeline for one selected day.
 *
 * Positions come from real timestamp differences, so elapsed time is never
 * negative across a fall-back hour. Commitments are passed through unchanged and
 * only drawn when they intersect this day's window; a day with no listed
 * commitments is never described as a day without classes.
 */
export function WeeklySchedule({
  windowStart,
  windowEnd,
  dayLabel,
  classes,
  unavailablePeriods,
  blocks: studyBlocks,
  conflicts = [],
  hasPlan,
  selectedId,
  onSelect,
}: WeeklyScheduleProps) {
  if (!windowStart || !windowEnd) {
    return (
      <section className="cp-panel cp-schedule" aria-labelledby="cp-schedule-heading">
        <div className="cp-panel__head">
          <h2 id="cp-schedule-heading">Your schedule</h2>
          <p className="cp-panel__meta">Choose a day to see its timeline.</p>
        </div>
        <p className="cp-hint">Start date or daily hours are not valid yet.</p>
      </section>
    );
  }

  const windowStartMs = Date.parse(windowStart);
  const totalMinutes = elapsedMinutes(windowEnd, windowStart);
  const timelineHeight = Math.max(HOUR_HEIGHT, (totalMinutes / 60) * HOUR_HEIGHT);
  const showZone = windowSpansTransition(windowStart, windowEnd);
  const crossDay = formatDayShort(windowStart) !== formatDayShort(windowEnd);

  const items: TimelineItem[] = [
    ...classes.map((event) => ({ id: event.id, title: event.title, kind: 'class' as const, start: event.start, end: event.end })),
    ...unavailablePeriods.map((period) => ({ id: period.id, title: period.title, kind: 'busy' as const, start: period.start, end: period.end })),
    ...studyBlocks.map((block) => ({ id: block.id, title: block.title, kind: 'study' as const, start: block.start, end: block.end })),
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

  const visible = items
    .map((item) => {
      const span = clipToWindow(item.start, item.end, windowStart, windowEnd);
      if (!span) return null;
      const top = Math.min(Math.max(0, (span.offsetMinutes / 60) * HOUR_HEIGHT), timelineHeight);
      const height = Math.max(0, Math.min((span.durationMinutes / 60) * HOUR_HEIGHT, timelineHeight - top));
      return { item, span, top, height };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // A click target may grow only into genuinely empty time, so it never covers
  // a neighbour's visible rectangle.
  const hitGaps = new Map<string, { up: number; down: number }>();
  const ordered = [...visible].sort((a, b) => a.top - b.top);
  ordered.forEach((entry, index) => {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const gapAbove = entry.top - (previous ? previous.top + previous.height : 0);
    const gapBelow = (next ? next.top : timelineHeight) - (entry.top + entry.height);
    hitGaps.set(entry.item.id, {
      up: Math.max(0, Math.min(HIT_PADDING, gapAbove)),
      down: Math.max(0, Math.min(HIT_PADDING, gapBelow)),
    });
  });

  const hasStudyBlocks = studyBlocks.length > 0;
  const hasCommitments = visible.some((entry) => entry.item.kind !== 'study');
  const isEmpty = visible.length === 0 && !hasPlan;

  const conflictIds = new Set<string>();
  for (const conflict of conflicts) {
    conflictIds.add(conflict.firstId);
    conflictIds.add(conflict.secondId);
  }

  return (
    <section className="cp-panel cp-schedule" aria-labelledby="cp-schedule-heading">
      <div className="cp-panel__head">
        <h2 id="cp-schedule-heading">Your schedule</h2>
        <p className="cp-panel__meta">
          {dayLabel} · {formatWindowLabel(windowStart, windowEnd)}
        </p>
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
        {conflicts.length > 0 && (
          <li className="cp-legend__item">
            <span className="cp-dot cp-dot--conflict" aria-hidden="true" /> Conflict
          </li>
        )}
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

          {visible.map(({ item, span, top, height }) => {
            const style = { top: `${top}px`, height: `${height}px` };
            const timeLabel = formatRangeDetailed(item.start, item.end, showZone);
            const clipped = span.clippedStart || span.clippedEnd;
            const isConflict = conflictIds.has(item.id);
            const label = `${item.title}, ${timeLabel}${clipped ? ', partly outside this day' : ''}${isConflict ? ', conflicting event' : ''}`;
            const clipClass = `${span.clippedStart ? ' is-clipped-start' : ''}${span.clippedEnd ? ' is-clipped-end' : ''}`;
            const tiny = height < TINY_HEIGHT ? ' is-tiny' : '';
            const conflictClass = isConflict ? ' is-conflict' : '';
            const badge = isConflict ? (
              <span className="cp-badge" aria-hidden="true">
                !
              </span>
            ) : null;

            const content = (
              <div className="cp-block__inner">
                <span className="cp-block__time">{timeLabel}</span>
                <span className="cp-block__title">{item.title}</span>
              </div>
            );

            if (item.kind === 'study') {
              const isSelected = item.id === selectedId;
              const gap = hitGaps.get(item.id) ?? { up: 0, down: 0 };
              return (
                <div
                  key={item.id}
                  className={`cp-slot${isSelected ? ' is-selected' : ''}`}
                  style={style}
                  data-block-id={item.id}
                >
                  <div className={`cp-block cp-block--study${clipClass}${tiny}${conflictClass}`} aria-hidden="true">
                    {content}
                    {badge}
                  </div>
                  <button
                    type="button"
                    className="cp-hit"
                    style={{ top: `${-gap.up}px`, height: `${height + gap.up + gap.down}px` }}
                    onClick={() => onSelect(isSelected ? null : item.id)}
                    aria-pressed={isSelected}
                    aria-label={label}
                    title={clipped ? `${timeLabel} (partly outside this day)` : timeLabel}
                  />
                </div>
              );
            }

            return (
              <div key={item.id} className={`cp-block cp-block--${item.kind}${clipClass}${tiny}${conflictClass}`} style={style} title={label}>
                {content}
                {badge}
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
        {!hasCommitments && ' Only commitments dated inside this window are drawn; a day without listed class data is not evidence of a free day.'}
        {conflicts.length > 0 &&
          ` ${conflicts.length} conflicting ${conflicts.length === 1 ? 'pair' : 'pairs'} reported by the scheduler.`}
        {totalMinutes > 0 && ` Visible window: ${Math.round(totalMinutes / 60)} hours.`}
      </p>
    </section>
  );
}
