import type { ScheduleRequest } from './types.ts';

export const sampleRequest: ScheduleRequest = {
  windowStart: '2026-10-19T09:00:00-04:00',
  windowEnd: '2026-10-19T17:00:00-04:00',
  classes: [
    { id: 'early-class', title: 'Early class (outside window)', start: '2026-10-19T07:00:00-04:00', end: '2026-10-19T08:00:00-04:00' },
    { id: 'morning-class', title: 'Morning class (partly outside window)', start: '2026-10-19T08:00:00-04:00', end: '2026-10-19T10:00:00-04:00' },
    { id: 'advising', title: 'Advising slot', start: '2026-10-19T14:30:00-04:00', end: '2026-10-19T15:00:00-04:00' },
    { id: 'cse', title: 'CSE lecture', start: '2026-10-19T10:00:00-04:00', end: '2026-10-19T11:00:00-04:00' },
    { id: 'math', title: 'Math lecture', start: '2026-10-19T14:00:00-04:00', end: '2026-10-19T15:00:00-04:00' },
  ],
  unavailablePeriods: [
    { id: 'lunch', title: 'Lunch', start: '2026-10-19T12:00:00-04:00', end: '2026-10-19T13:00:00-04:00' },
  ],
  tasks: [
    { id: 'math-review', title: 'Review calculus notes', durationMinutes: 60, dueAt: '2026-10-19T12:00:00-04:00' },
    { id: 'cse-practice', title: 'Practice CSE problems', durationMinutes: 90, dueAt: '2026-10-19T17:00:00-04:00' },
    { id: 'writing', title: 'Outline writing assignment', durationMinutes: 60, dueAt: '2026-10-19T17:00:00-04:00' },
    { id: 'reading', title: 'Complete extended reading', durationMinutes: 180, dueAt: '2026-10-19T17:00:00-04:00' },
  ],
  locations: [{ id: 'thompson', name: 'Thompson Library' }],
};
