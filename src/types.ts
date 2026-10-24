/** All timestamps must be ISO 8601 strings with an explicit UTC offset or Z. */
export interface ClassEvent {
  id: string;
  title: string;
  start: string;
  end: string;
}

/** Task-level display choice only; never a booking or availability claim. */
export type TaskLocation =
  | { kind: 'none' }
  | { kind: 'campus'; locationId: string }
  | { kind: 'custom'; name: string };

export interface StudyTask {
  id: string;
  title: string;
  durationMinutes: number;
  dueAt: string;
  /** Earliest allowed instant, with explicit offset. Must precede dueAt. */
  notBefore?: string;
  /** Occurrence metadata; neither field implies a reservation. */
  seriesId?: string;
  occurrenceDate?: string;
  /** Display metadata only; does not affect scheduling order. */
  priority?: 'low' | 'medium' | 'high';
  courseCode?: string;
  /** Omitted/undefined: legacy default. Explicit none: never use a default. */
  location?: TaskLocation;
}

export interface UnavailablePeriod {
  id: string;
  title: string;
  start: string;
  end: string;
}

export interface StudyBlock {
  id: string;
  taskId: string;
  title: string;
  start: string;
  end: string;
  /** Legacy/default or explicit campus ID; absent for none/custom. */
  locationId?: string;
  /** Explicit task selection; omitted for legacy tasks. */
  location?: TaskLocation;
}

export interface CampusLocation {
  id: string;
  name: string;
  building?: string;
  room?: string;
  /** Display-only text, never used to validate availability. Label simulated hours explicitly. */
  hours?: string;
}

export interface ScheduleRequest {
  windowStart: string;
  windowEnd: string;
  classes: ClassEvent[];
  tasks: StudyTask[];
  unavailablePeriods: UnavailablePeriod[];
  locations: CampusLocation[];
}

/** A positive overlap inside the scheduling window; touching endpoints do not conflict. */
export interface ScheduleConflict {
  /** IDs refer to classes, unavailable periods or returned study blocks; unique across those collections. */
  firstId: string;
  secondId: string;
  /** Real elapsed minutes, possibly fractional; never wall-clock subtraction. */
  overlapMinutes: number;
}

export interface ScheduleResponse {
  blocks: StudyBlock[];
  unscheduledTasks: { taskId: string; reason: string }[];
  /** A1: omitted entirely when no conflicts exist. Pairs sorted lexically by ID. */
  conflicts?: ScheduleConflict[];
}
