/**
 * Display and time-resolution helpers for the CampusPilot dashboard.
 *
 * Every wall-clock decision goes through Intl with an explicit America/New_York
 * time zone, so daylight-saving rules come from the platform instead of a
 * hard-coded UTC offset. Scheduling itself lives in src/scheduler.ts; nothing
 * here places, moves, or re-times a study block.
 */
export const CAMPUS_TIME_ZONE = 'America/New_York';

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const wallFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const dayShortFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const zoneFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_TIME_ZONE,
  timeZoneName: 'short',
});

const wallOnlyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

const pad = (value: number) => String(value).padStart(2, '0');

function partsAt(instant: number): WallTime {
  const parts = wallFormatter.formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Milliseconds that campus local time is ahead of UTC at the given instant. */
function offsetAt(instant: number): number {
  const truncated = Math.floor(instant / 1000) * 1000;
  const wall = partsAt(truncated);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - truncated;
}

/** UTC offset of campus time at an instant, e.g. "-04:00" or "-05:00". */
export function formatOffset(instant: number): string {
  const offsetMinutes = offsetAt(instant) / 60_000;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** Short zone abbreviation in force at an instant, e.g. "EDT" or "EST". */
export function abbreviationAt(instant: number): string {
  return zoneFormatter.formatToParts(new Date(instant)).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

export interface CampusInputOption {
  iso: string;
  label: string;
}

export type CampusInputResult =
  | { status: 'ok'; iso: string }
  | { status: 'ambiguous'; options: CampusInputOption[] }
  | { status: 'nonexistent'; message: string }
  | { status: 'invalid'; message: string };

function wallMatches(instant: number, wall: number): boolean {
  const parts = partsAt(instant);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) === wall;
}

/**
 * Resolves a datetime-local value interpreted as campus wall time.
 *
 * A wall time can map to no instant (spring-forward gap) or to two instants
 * (fall-back repeated hour). Both cases are reported instead of being silently
 * shifted onto a neighbouring time.
 */
export function parseCampusInput(value: string): CampusInputResult {
  const match = INPUT_PATTERN.exec(value);
  if (!match) return { status: 'invalid', message: 'Enter a date and time.' };

  const [, year, month, day, hour, minute] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!Number.isFinite(wall)) return { status: 'invalid', message: 'Enter a valid date and time.' };

  // Offsets in force before, at, and after the wall time cover both transitions.
  const offsets = new Set<number>([offsetAt(wall - 86_400_000), offsetAt(wall), offsetAt(wall + 86_400_000)]);
  const candidates: number[] = [];
  for (const offset of offsets) {
    const instant = wall - offset;
    if (wallMatches(instant, wall) && !candidates.includes(instant)) candidates.push(instant);
  }
  candidates.sort((a, b) => a - b);

  if (candidates.length === 0) {
    const label = wallOnlyFormatter.format(new Date(wall));
    return {
      status: 'nonexistent',
      message:
        `${Number(hour)}:${minute} does not exist on ${label} in New York: ` +
        'clocks jump forward and that hour is skipped. Pick a different time.',
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      options: candidates.map((instant, index) => ({
        iso: new Date(instant).toISOString(),
        label:
          `${index === 0 ? 'Earlier' : 'Later'} · ${formatClock(new Date(instant).toISOString())} ` +
          `${abbreviationAt(instant)} (UTC${formatOffset(instant)})`,
      })),
    };
  }

  return { status: 'ok', iso: new Date(candidates[0]).toISOString() };
}

/** ISO instant rendered as a datetime-local value in campus time. */
export function isoToCampusInput(iso: string): string {
  const parts = partsAt(Date.parse(iso));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Real elapsed minutes between two instants. This is a timestamp difference,
 * not a wall-clock subtraction, so a spring-forward hour does not vanish and a
 * fall-back hour is not counted twice.
 */
export function elapsedMinutes(iso: string, windowStartIso: string): number {
  return (Date.parse(iso) - Date.parse(windowStartIso)) / 60_000;
}

export interface VisibleSpan {
  /** Minutes from the window start to the first visible moment. */
  offsetMinutes: number;
  /** Duration of the visible portion, in minutes. */
  durationMinutes: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Returns the part of an event that is visible inside the window, or null when
 * the event lies entirely outside it. The caller keeps the original event data;
 * this only computes how much of it to draw.
 */
export function clipToWindow(
  startIso: string,
  endIso: string,
  windowStartIso: string,
  windowEndIso: string,
): VisibleSpan | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const windowStart = Date.parse(windowStartIso);
  const windowEnd = Date.parse(windowEndIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= windowStart || start >= windowEnd) return null;

  const visibleStart = Math.max(start, windowStart);
  const visibleEnd = Math.min(end, windowEnd);
  if (visibleEnd <= visibleStart) return null;

  return {
    offsetMinutes: (visibleStart - windowStart) / 60_000,
    durationMinutes: (visibleEnd - visibleStart) / 60_000,
    clippedStart: start < windowStart,
    clippedEnd: end > windowEnd,
  };
}

/** True when the window spans a daylight-saving transition. */
export function windowSpansTransition(windowStartIso: string, windowEndIso: string): boolean {
  return abbreviationAt(Date.parse(windowStartIso)) !== abbreviationAt(Date.parse(windowEndIso));
}

export function formatClock(iso: string): string {
  return clockFormatter.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return dayFormatter.format(new Date(iso));
}

export function formatDayShort(iso: string): string {
  return dayShortFormatter.format(new Date(iso));
}

/** "Oct 19, 2026, 5:00 PM" — always carries the calendar date. */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatClock(startIso)} – ${formatClock(endIso)}`;
}

/** Range that keeps zone abbreviations when the window crosses a transition. */
export function formatRangeDetailed(startIso: string, endIso: string, withZone: boolean): string {
  if (!withZone) return formatRange(startIso, endIso);
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const startZone = abbreviationAt(start);
  const endZone = abbreviationAt(end);
  return startZone === endZone
    ? `${formatClock(startIso)} – ${formatClock(endIso)} ${endZone}`
    : `${formatClock(startIso)} ${startZone} – ${formatClock(endIso)} ${endZone}`;
}

/** Window label that always shows both dates when the window crosses midnight. */
export function formatWindowLabel(windowStartIso: string, windowEndIso: string): string {
  const startDay = formatDayShort(windowStartIso);
  const endDay = formatDayShort(windowEndIso);
  const zone = abbreviationAt(Date.parse(windowStartIso));
  if (startDay === endDay) {
    return `${formatDay(windowStartIso)} · ${formatClock(windowStartIso)} – ${formatClock(windowEndIso)} ${zone}`;
  }
  return `${startDay} ${formatClock(windowStartIso)} – ${endDay} ${formatClock(windowEndIso)}`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}
