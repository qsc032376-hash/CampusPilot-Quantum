/** Step definitions for the CampusPilot first-run product tour. */
export interface TourStep {
  id: string;
  chapter: 'build' | 'explore';
  /** Short accessible name, used in the progress label and the step list. */
  name: string;
  title: string;
  body: string[];
  /** CSS selector for the element to spotlight. Omit for a centered card. */
  anchor?: string;
  /** Fallback anchor when the primary element is not on screen. */
  fallbackAnchor?: string;
  placement?: 'auto' | 'center' | 'bottom';
  /** Extra class applied to the spotlight for a step-specific accent. */
  effect?: 'iris' | 'stagger' | 'timeline' | 'map' | 'success';
  /** Shown as a small action hint inside the card. */
  hint?: string;
  /** The tour waits for a real result before it can continue. */
  waitsForPlan?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    chapter: 'build',
    name: 'Welcome',
    title: 'Build your first study plan',
    body: [
      'A short tour from one task to a finished plan. Everything you see is example data, and a plan never means a place is open, a room is available or a booking exists.',
      'You can leave at any point and replay it later.',
    ],
    placement: 'center',
    effect: 'iris',
  },
  {
    id: 'task',
    chapter: 'build',
    name: 'Add a study task',
    title: 'Start with one task',
    body: [
      'Add a title, how many minutes it needs and when it is due. One-time is for a single deadline; Repeating spreads the same work across days.',
      'Course code, priority and location live under Optional details. A task without a location is perfectly normal.',
    ],
    anchor: '#cp-task-heading',
    effect: 'iris',
  },
  {
    id: 'repeating',
    chapter: 'build',
    name: 'Repeating task',
    title: 'Or let it repeat',
    body: [
      'Repeating schedules the same work several times: daily or weekly, with an interval and a start and end date.',
      'The tour points at the switch — you do not have to create a repeating task to continue.',
    ],
    anchor: '#cp-recurring-heading',
    fallbackAnchor: '.cp-modeswitch',
    effect: 'stagger',
  },
  {
    id: 'range',
    chapter: 'build',
    name: 'Schedule range',
    title: 'Choose the days to plan',
    body: [
      'Pick a range of 1 to 30 days, the first date, and the hours you study each day. Browsing a day later never re-runs the planner.',
    ],
    anchor: '#cp-range-heading',
    effect: 'iris',
  },
  {
    id: 'pace',
    chapter: 'build',
    name: 'Pace',
    title: 'Pick a study pace',
    body: [
      'Relaxed aims for 15-minute breaks and may shorten them to fit tasks. High intensity schedules without planned breaks.',
      'Pace only changes how your own time is spent — never availability or booking.',
    ],
    anchor: '#cp-intensity-label',
    effect: 'stagger',
  },
  {
    id: 'build',
    chapter: 'build',
    name: 'Build plan',
    title: 'Now build the real plan',
    body: [
      'Press Build plan below. The tour continues as soon as a plan exists — nothing is created on your behalf.',
      'If the form needs a fix, the plan is not built and this step stays here until it succeeds.',
    ],
    anchor: '[data-tour="build"]',
    effect: 'success',
    hint: 'Waiting for a real plan…',
    waitsForPlan: true,
  },
  {
    id: 'results',
    chapter: 'explore',
    name: 'Study plan',
    title: 'Your plan, grouped by day',
    body: [
      'Each day lists what fits, what could not be placed and why. A block is study time you own — not a room and not a class.',
    ],
    anchor: '#cp-results-heading',
    effect: 'timeline',
  },
  {
    id: 'block',
    chapter: 'explore',
    name: 'Where and recommendations',
    title: 'Open a study block',
    body: [
      'Selecting a block shows its Where card, and suggestions for places that tend to work. A suggestion is not an assignment, not live availability and not a reservation.',
    ],
    anchor: '[data-tour="where"]',
    fallbackAnchor: '#cp-schedule-heading',
    effect: 'iris',
    hint: 'Pick any block in the timeline to see its Where card.',
  },
  {
    id: 'map',
    chapter: 'explore',
    name: 'Campus map',
    title: 'Find places on campus',
    body: [
      'The map shows the campus places the app already lists. Coordinates are approximate building points — not entrances, not a route and not a guarantee.',
    ],
    anchor: '.cp-map-mount',
    effect: 'map',
  },
  {
    id: 'reservation',
    chapter: 'explore',
    name: 'Reservation planner',
    title: 'Plan a room, officially',
    body: [
      'This points you to the official reservation route and the policies the app knows about. It does not check live openings and does not book or confirm anything for you.',
    ],
    anchor: '#cp-reservation-heading',
    effect: 'iris',
  },
  {
    id: 'done',
    chapter: 'explore',
    name: 'Finished',
    title: 'That is the whole loop',
    body: [
      'You have a personal study plan on screen. Tasks, locations and recommendations stay editable, and nothing here claims a room is available.',
      'Replay the tour whenever you want from the header.',
    ],
    placement: 'center',
    effect: 'iris',
  },
];
