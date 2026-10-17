/**
 * Display helpers for the CampusPilot dashboard.
 *
 * Every wall-clock decision goes through Intl with an explicit America/New_York
 * time zone, so daylight-saving changes are resolved by the platform instead of
 * a hard-coded UTC offset. Scheduling itself lives in src/scheduler.ts; nothing
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

function dayNumber(wall: WallTime): number {
  return Math.floor(Date.UTC(wall.year, wall.month - 1, wall.day) / 86_400_000);
}

/** Mirrors the scheduler's timestamp rule: an explicit offset or Z is required. */
export function isValidTimestamp(value: string): boolean {
  return /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Converts a datetime-local value ("2026-10-19T17:00") typed as campus local
 * time into an ISO instant with an explicit offset. Two passes resolve the
 * offset so a spring-forward or fall-back boundary still lands on a real
 * instant; a wall time that does not exist (2:30 AM in spring) maps forward.
 */
export function campusInputToIso(value: string): string | null {
  const match = INPUT_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!Number.isFinite(wall)) return null;
  let instant = wall - offsetAt(wall);
  const corrected = wall - offsetAt(instant);
  if (corrected !== instant) instant = corrected;
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/** ISO instant rendered as a datetime-local value in campus time. */
export function isoToCampusInput(iso: string): string {
  const parts = partsAt(Date.parse(iso));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Wall-clock minutes between two instants, counting each calendar day as 1440
 * minutes. Layout is calendar-like: a DST day still occupies one column-day
 * even though it is physically 23 or 25 hours long. Time-of-day arithmetic is
 * unaffected, and cross-day events land on the following day automatically.
 */
export function minutesFromWindowStart(iso: string, windowStartIso: string): number {
  const current = partsAt(Date.parse(iso));
  const start = partsAt(Date.parse(windowStartIso));
  return (
    (dayNumber(current) - dayNumber(start)) * 1440 +
    (current.hour * 60 + current.minute) -
    (start.hour * 60 + start.minute)
  );
}

export function minuteOfDay(iso: string): number {
  const parts = partsAt(Date.parse(iso));
  return parts.hour * 60 + parts.minute;
}

export function formatMinuteOfDay(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatClock(iso: string): string {
  return clockFormatter.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return dayFormatter.format(new Date(iso));
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatClock(startIso)} – ${formatClock(endIso)}`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}
