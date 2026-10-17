/** All timestamps must be ISO 8601 strings with an explicit UTC offset or Z. */
export interface ClassEvent {
  id: string;
  title: string;
  start: string;
  end: string;
}

export interface StudyTask {
  id: string;
  title: string;
  durationMinutes: number;
  dueAt: string;
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
  locationId: string;
}

export interface CampusLocation {
  id: string;
  name: string;
}

export interface ScheduleRequest {
  windowStart: string;
  windowEnd: string;
  classes: ClassEvent[];
  tasks: StudyTask[];
  unavailablePeriods: UnavailablePeriod[];
  locations: CampusLocation[];
}

export interface ScheduleResponse {
  blocks: StudyBlock[];
  unscheduledTasks: { taskId: string; reason: string }[];
}
