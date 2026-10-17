import type { ScheduleRequest, ScheduleResponse } from '../../types.ts';
import { formatClock, formatDay, formatMinuteOfDay, formatRange, minuteOfDay, minutesFromWindowStart } from '../format.ts';

interface WeeklyScheduleProps {
  request: ScheduleRequest;
  result: ScheduleResponse | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const HOUR_HEIGHT = 56;
const MIN_BLOCK_HEIGHT = 26;

type BlockKind = 'class' | 'busy' | 'study';

interface TimelineItem {
  id: string;
  title: string;
  kind: BlockKind;
  start: string;
  end: string;
}

/**
 * The visual hero: a day timeline built from the request window. Fixed classes
 * and unavailable periods come from the request; study blocks come from the
 * scheduler's response. This component only positions what it is given.
 */
export function WeeklySchedule({ request, result, selectedId, onSelect }: WeeklyScheduleProps) {
  const totalMinutes = minutesFromWindowStart(request.windowEnd, request.windowStart);
  const timelineHeight = Math.max(HOUR_HEIGHT, (totalMinutes / 60) * HOUR_HEIGHT);
  const windowStartMinute = minuteOfDay(request.windowStart);

  const items: TimelineItem[] = [
    ...request.classes.map((event) => ({ id: event.id, title: event.title, kind: 'class' as const, start: event.start, end: event.end })),
    ...request.unavailablePeriods.map((period) => ({ id: period.id, title: period.title, kind: 'busy' as const, start: period.start, end: period.end })),
    ...(result?.blocks ?? []).map((block) => ({ id: block.id, title: block.title, kind: 'study' as const, start: block.start, end: block.end })),
  ];

  const ticks: number[] = [];
  for (let offset = 0; offset <= totalMinutes; offset += 60) ticks.push(offset);

  const hasStudyBlocks = (result?.blocks.length ?? 0) > 0;
  const isEmpty = items.length === 0 && !result;

  return (
    <section className="cp-panel cp-schedule" aria-labelledby="cp-schedule-heading">
      <div className="cp-panel__head">
        <h2 id="cp-schedule-heading">Your day</h2>
        <p className="cp-panel__meta">
          {formatDay(request.windowStart)} · {formatRange(request.windowStart, request.windowEnd)}
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
      </ul>

      <div className="cp-timeline" style={{ height: `${timelineHeight}px` }}>
        <div className="cp-timeline__gutter" aria-hidden="true">
          {ticks.map((offset) => (
            <span key={offset} className="cp-timeline__tick" style={{ top: `${(offset / 60) * HOUR_HEIGHT}px` }}>
              {formatMinuteOfDay(windowStartMinute + offset)}
            </span>
          ))}
        </div>

        <div className="cp-timeline__track">
          {ticks.map((offset) => (
            <span key={offset} className="cp-timeline__line" style={{ top: `${(offset / 60) * HOUR_HEIGHT}px` }} aria-hidden="true" />
          ))}

          {items.map((item) => {
            const startOffset = minutesFromWindowStart(item.start, request.windowStart);
            const endOffset = minutesFromWindowStart(item.end, request.windowStart);
            const rawTop = (startOffset / 60) * HOUR_HEIGHT;
            const top = Math.min(Math.max(0, rawTop), Math.max(0, timelineHeight - MIN_BLOCK_HEIGHT));
            const rawHeight = ((endOffset - startOffset) / 60) * HOUR_HEIGHT;
            const height = Math.max(MIN_BLOCK_HEIGHT, Math.min(rawHeight, timelineHeight - top));
            const style = { top: `${top}px`, height: `${height}px` };
            const label = `${item.title}, ${formatRange(item.start, item.end)}`;

            if (item.kind === 'study') {
              const isSelected = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cp-block cp-block--study${isSelected ? ' is-selected' : ''}`}
                  style={style}
                  onClick={() => onSelect(isSelected ? null : item.id)}
                  aria-pressed={isSelected}
                  aria-label={label}
                >
                  <span className="cp-block__time">{formatRange(item.start, item.end)}</span>
                  <span className="cp-block__title">{item.title}</span>
                </button>
              );
            }

            return (
              <div key={item.id} className={`cp-block cp-block--${item.kind}`} style={style} title={label}>
                <span className="cp-block__time">{formatRange(item.start, item.end)}</span>
                <span className="cp-block__title">{item.title}</span>
              </div>
            );
          })}

          {isEmpty && (
            <div className="cp-timeline__empty">
              <p className="cp-empty__title">Nothing scheduled yet</p>
              <p className="cp-empty__message">Add a study task, then build the day.</p>
            </div>
          )}
        </div>
      </div>

      <p className="cp-panel__foot">
        {hasStudyBlocks
          ? 'Study blocks are suggestions. Tap one to see its location.'
          : 'Study blocks appear here once the schedule is built.'}
      </p>
    </section>
  );
}
