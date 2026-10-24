// Component-level render regression checks for the timeline layout.
// Runs the real WeeklySchedule through server rendering and inspects the
// emitted style boxes, so positions and heights are verified end to end.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const entry = `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeeklySchedule } from './src/ui/components/WeeklySchedule.tsx';
import { ScheduleResults } from './src/ui/components/ScheduleResults.tsx';
import { LocationCard } from './src/ui/components/LocationCard.tsx';
import { RecommendedLocations } from './src/ui/components/RecommendedLocations.tsx';
import { ReservationPlanner } from './src/ui/components/ReservationPlanner.tsx';
import { CampusMap } from './src/features/campus-map/CampusMap.tsx';
import { TaskForm } from './src/ui/components/TaskForm.tsx';
import { sampleRequest } from './src/sample.ts';
import { generateMockSchedule } from './src/scheduler.ts';
import { createDailyWindows, generateMultiDaySchedule } from './src/features/multi-day-schedule/index.ts';

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

/** Props for the now per-day timeline component. */
function scheduleProps(request, blocks, conflicts) {
  return {
    windowStart: request.windowStart,
    windowEnd: request.windowEnd,
    dayLabel: 'Test day',
    classes: request.classes,
    unavailablePeriods: request.unavailablePeriods,
    blocks,
    conflicts: conflicts || [],
    hasPlan: true,
    selectedId: null,
    onSelect: () => {},
  };
}

const box = (style) => ({
  top: Number((/top:\\s*([-\\d.]+)px/.exec(style) || [])[1]),
  height: Number((/height:\\s*([-\\d.]+)px/.exec(style) || [])[1]),
});

function blocksOf(html) {
  return [...html.matchAll(/class="(cp-block[^"]*)" style="([^"]*)"/g)].map((m) => ({
    className: m[1],
    ...box(m[2]),
  }));
}
function slotsOf(html) {
  return [...html.matchAll(/class="(cp-slot[^"]*)" style="([^"]*)"/g)].map((m) => ({
    className: m[1],
    ...box(m[2]),
  }));
}

// Fall-back window: 00:00 EDT -> 04:00 EST is 5 real hours = 280px.
const fallBackRequest = {
  windowStart: '2026-11-01T00:00:00-04:00',
  windowEnd: '2026-11-01T04:00:00-05:00',
  classes: [{ id: 'c1', title: 'ShortClass', start: '2026-11-01T03:55:00-05:00', end: '2026-11-01T04:05:00-05:00' }],
  tasks: [],
  unavailablePeriods: [{ id: 'u1', title: 'ShortBusy', start: '2026-11-01T03:55:00-05:00', end: '2026-11-01T04:05:00-05:00' }],
  locations: [{ id: 'lib', name: 'Library' }],
};

const shortResult = {
  blocks: [
    { id: 's1', taskId: 't1', title: 'StudyShort', start: '2026-11-01T03:55:00-05:00', end: '2026-11-01T04:05:00-05:00', locationId: 'lib' },
  ],
  unscheduledTasks: [],
};

const html = renderToStaticMarkup(
  createElement(WeeklySchedule, scheduleProps(fallBackRequest, shortResult.blocks)),
);

const blocks = blocksOf(html);
const slots = slotsOf(html);
const events = [...blocks, ...slots];
const timelineHeight = 280;

check(
  'three event kinds render',
  blocks.length === 2 && slots.length === 1 && html.includes('cp-block--study'),
  'blocks=' + blocks.length + ' slots=' + slots.length,
);
check(
  'no visible block exceeds the window',
  events.every((b) => b.top >= -0.01 && b.top + b.height <= timelineHeight + 0.01),
  events.map((b) => 'top=' + b.top.toFixed(2) + ' h=' + b.height.toFixed(2)).join(' | '),
);
const shortEvents = events.filter((b) => Math.abs(b.height - (5 / 60) * 56) < 0.05);
check('a five minute event stays five minutes tall', shortEvents.length === 3, 'matched ' + shortEvents.length);
check('event past the window end is marked clipped', html.includes('is-clipped-end'), '');
check('study block keeps an exact visible rectangle', slots.length === 1 && Math.abs(slots[0].height - (5 / 60) * 56) < 0.05, JSON.stringify(slots[0]));
check('click target is separate from the visible rectangle', html.includes('cp-hit'), '');

// Adjacent short study blocks must not overlap visually.
const adjacentResult = {
  blocks: [
    { id: 'a1', taskId: 't1', title: 'AdjacentA', start: '2026-11-01T03:45:00-05:00', end: '2026-11-01T03:50:00-05:00', locationId: 'lib' },
    { id: 'a2', taskId: 't2', title: 'AdjacentB', start: '2026-11-01T03:50:00-05:00', end: '2026-11-01T03:55:00-05:00', locationId: 'lib' },
  ],
  unscheduledTasks: [],
};
const adjacentHtml = renderToStaticMarkup(
  createElement(
    WeeklySchedule,
    scheduleProps({ ...fallBackRequest, classes: [], unavailablePeriods: [] }, adjacentResult.blocks),
  ),
);
const adjacentSlots = slotsOf(adjacentHtml).sort((a, b) => a.top - b.top);
check(
  'adjacent short blocks do not overlap',
  adjacentSlots.length === 2 && adjacentSlots[1].top >= adjacentSlots[0].top + adjacentSlots[0].height - 0.01,
  JSON.stringify(adjacentSlots),
);

// A normal window keeps full-size blocks.
const normalRequest = {
  windowStart: '2026-10-19T09:00:00-04:00',
  windowEnd: '2026-10-19T17:00:00-04:00',
  classes: [{ id: 'n1', title: 'NormalClass', start: '2026-10-19T10:00:00-04:00', end: '2026-10-19T11:00:00-04:00' }],
  tasks: [],
  unavailablePeriods: [],
  locations: [],
};
const normalHtml = renderToStaticMarkup(
  createElement(WeeklySchedule, scheduleProps(normalRequest, [])),
);
const normalBlocks = blocksOf(normalHtml);
check(
  'normal hour block is one hour tall',
  normalBlocks.length === 1 && Math.abs(normalBlocks[0].height - 56) < 0.01 && Math.abs(normalBlocks[0].top - 56) < 0.01,
  JSON.stringify(normalBlocks[0]),
);
check('window label carries both zones', normalHtml.includes('EDT') || normalHtml.includes('EST'), '');

// --- shared contracts: conflicts, location details, task metadata ---
const contractResult = generateMockSchedule(sampleRequest);
const sampleMulti = generateMultiDaySchedule({
  windows: createDailyWindows({ startDate: '2026-10-19', dayCount: 1, startTime: '09:00', endTime: '17:00' }),
  tasks: sampleRequest.tasks,
  classes: sampleRequest.classes,
  unavailablePeriods: sampleRequest.unavailablePeriods,
  locations: sampleRequest.locations,
});
const conflicts = contractResult.conflicts || [];
check('sample schedule reports one conflict pair', conflicts.length === 1, JSON.stringify(conflicts));

const conflictScheduleHtml = renderToStaticMarkup(
  createElement(WeeklySchedule, scheduleProps(sampleRequest, contractResult.blocks, contractResult.conflicts)),
);
check(
  'conflicting events carry a conflict marker and badge',
  conflictScheduleHtml.includes('is-conflict') && conflictScheduleHtml.includes('cp-badge'),
  '',
);
check('conflict legend row appears', conflictScheduleHtml.includes('cp-dot--conflict'), '');
check('conflict count is announced to the user', conflictScheduleHtml.includes('conflicting'), '');

const conflictResultsHtml = renderToStaticMarkup(
  createElement(ScheduleResults, {
    request: sampleRequest,
    series: [],
    multi: sampleMulti,
    message: null,
    onBuild: () => {},
    selectedDate: '2026-10-19',
    selectedId: null,
    onSelect: () => {},
    onSelectDate: () => {},
  }),
);
check(
  'results list both conflicting events by title',
  conflictResultsHtml.includes('Math lecture') && conflictResultsHtml.includes('Advising slot'),
  '',
);
const seriesMulti = generateMultiDaySchedule({
  windows: createDailyWindows({ startDate: '2026-10-19', dayCount: 1, startTime: '09:00', endTime: '17:00' }),
  tasks: [],
  taskSeries: [
    { id: 'series-long', title: 'Long recurring', durationMinutes: 600, startDate: '2026-10-19', rule: { frequency: 'daily', interval: 1 } },
  ],
  classes: [],
  unavailablePeriods: [],
  locations: sampleRequest.locations,
});
const seriesResultsHtml = renderToStaticMarkup(
  createElement(ScheduleResults, {
    request: { ...sampleRequest, tasks: [] },
    series: [
      { id: 'series-long', title: 'Long recurring', durationMinutes: 600, startDate: '2026-10-19', rule: { frequency: 'daily', interval: 1 } },
    ],
    multi: seriesMulti,
    message: null,
    onBuild: () => {},
    selectedDate: '2026-10-19',
    selectedId: null,
    onSelect: () => {},
    onSelectDate: () => {},
  }),
);
check(
  'an unscheduled occurrence shows its own date',
  seriesResultsHtml.includes('Long recurring') && seriesResultsHtml.includes('Oct 19, 2026'),
  '',
);
check('results show the overlap duration', conflictResultsHtml.includes('30 min overlap'), '');

const detailedRequest = {
  ...sampleRequest,
  locations: [
    {
      id: 'thompson-library',
      name: 'Thompson Library',
      building: 'Thompson Library',
      room: 'Room 304',
      hours: '8:00 AM - 11:00 PM (demo only)',
    },
  ],
};
const detailedHtml = renderToStaticMarkup(
  createElement(LocationCard, { block: contractResult.blocks[0], request: detailedRequest }),
);
check(
  'location details render when supplied',
  detailedHtml.includes('Building') && detailedHtml.includes('Room 304') && detailedHtml.includes('Listed hours'),
  '',
);
check('listed hours are labelled as demo text', detailedHtml.includes('demo text'), '');

const plainHtml = renderToStaticMarkup(
  createElement(LocationCard, { block: contractResult.blocks[0], request: sampleRequest }),
);
check(
  'sample ids resolve to the verified address',
  plainHtml.includes('1858 Neil Avenue Mall'),
  '',
);
check(
  'the ordinary default assignment states it is unverified',
  plainHtml.includes('Default scheduler assignment; real opening hours have not been verified.'),
  '',
);

const unknownRequest = {
  ...sampleRequest,
  locations: [{ id: 'custom-room', name: 'Unverified Study Room' }],
};
const unknownHtml = renderToStaticMarkup(
  createElement(LocationCard, { block: contractResult.blocks[0], request: unknownRequest }),
);
check(
  'unknown location falls back without inventing details',
  unknownHtml.includes('No building or room details supplied') && !unknownHtml.includes('Listed hours'),
  '',
);

// --- the standalone recommendation list (the reported bug) ---
const threePmBlock = {
  id: 'study-a',
  taskId: 't1',
  title: 'Study',
  start: '2026-10-19T15:00:00-04:00',
  end: '2026-10-19T16:30:00-04:00',
  locationId: 'thompson-library',
};
const manyHtml = renderToStaticMarkup(
  createElement(RecommendedLocations, { block: threePmBlock, request: sampleRequest }),
);
check(
  'several locations are listed for an afternoon block',
  manyHtml.includes('5 places are recommended for this simulated block time') &&
    manyHtml.includes('18th Avenue Library') &&
    manyHtml.includes('Ohio Union'),
  '',
);
check('each recommendation shows a score', (manyHtml.match(/cp-locations__score/g) || []).length === 5, '');
check('each recommendation shows a reason', (manyHtml.match(/simulated hours/g) || []).length === 5, '');
check(
  'bookable locations link to the official reservation page',
  manyHtml.includes('Reserve study room') && manyHtml.includes('libraryroombooking.cloud.osu.edu'),
  '',
);
check(
  'non-bookable locations link to their official page instead',
  manyHtml.includes('Location details') && manyHtml.includes('ohiounion.osu.edu'),
  '',
);
check('recommendation reasons mark hours as simulated', manyHtml.includes('simulated hours'), '');
check('availability disclaimer is rendered', manyHtml.includes('Availability is simulated'), '');

const oneBlock = { ...threePmBlock, start: '2026-10-19T00:30:00-04:00', end: '2026-10-19T01:00:00-04:00' };
const oneHtml = renderToStaticMarkup(
  createElement(RecommendedLocations, { block: oneBlock, request: sampleRequest }),
);
check(
  'exactly one location renders a count of one',
  oneHtml.includes('1 place is recommended for this simulated block time') && oneHtml.includes('18th Avenue Library'),
  '',
);

const zeroBlock = { ...threePmBlock, start: '2026-10-18T02:00:00-04:00', end: '2026-10-18T03:00:00-04:00' };
const zeroHtml = renderToStaticMarkup(
  createElement(RecommendedLocations, { block: zeroBlock, request: sampleRequest }),
);
check(
  'no open location shows an explicit fallback',
  zeroHtml.includes('No location in the campus list is listed as open'),
  '',
);

// --- strict time conversion: DST, seconds, and unverified assignments ---
const dstBlock = {
  ...threePmBlock,
  start: '2026-11-01T01:30:00-04:00',
  end: '2026-11-01T01:45:00-05:00',
};
const dstHtml = renderToStaticMarkup(
  createElement(RecommendedLocations, { block: dstBlock, request: sampleRequest }),
);
check(
  'a cross-DST block explains why no list is shown',
  dstHtml.includes('daylight-saving change') && !dstHtml.includes('cp-locations__row'),
  '',
);

const secondsBlock = { ...threePmBlock, start: '2026-10-19T15:00:30-04:00' };
const secondsHtml = renderToStaticMarkup(
  createElement(RecommendedLocations, { block: secondsBlock, request: sampleRequest }),
);
check(
  'a block with seconds is rejected rather than rounded',
  secondsHtml.includes('whole minute') && !secondsHtml.includes('cp-locations__row'),
  '',
);

const manyTags = (manyHtml.match(/cp-tag">Scheduled/g) || []).length;
check('exactly one recommendation is marked as scheduled', manyTags === 1, 'tags=' + manyTags);

const earlyBlock = {
  ...threePmBlock,
  start: '2026-10-19T00:30:00-04:00',
  end: '2026-10-19T01:00:00-04:00',
};
const earlyWhere = renderToStaticMarkup(
  createElement(LocationCard, { block: earlyBlock, request: sampleRequest }),
);
check(
  'an unverified assignment is called out in the Where card',
  earlyWhere.includes('not</strong> checked against opening hours') ||
    earlyWhere.includes('not covered by the simulated opening hours'),
  '',
);

const dstWhere = renderToStaticMarkup(createElement(LocationCard, { block: dstBlock, request: sampleRequest }));
check(
  'a cross-DST block marks the assignment as unverified',
  dstWhere.includes('checked against opening hours') && dstWhere.includes('daylight-saving'),
  '',
);
check(
  'the default assignment note is shown in every state',
  earlyWhere.includes('Default scheduler assignment') && dstWhere.includes('Default scheduler assignment'),
  '',
);

const taskRequest = {
  ...sampleRequest,
  tasks: [
    {
      id: 't1',
      title: 'Tagged task',
      durationMinutes: 30,
      dueAt: sampleRequest.windowEnd,
      priority: 'high',
      courseCode: 'CSE 201',
    },
  ],
};
const formHtml = renderToStaticMarkup(
  createElement(TaskForm, { request: taskRequest, onAdd: () => {}, onRemove: () => {} }),
);
check(
  'task form exposes optional priority and course code',
  formHtml.includes('Priority (optional)') && formHtml.includes('Course code (optional)'),
  '',
);
check(
  'task list shows priority and course code',
  formHtml.includes('CSE 201') && formHtml.includes('cp-tag--high'),
  '',
);

// --- reservation planning ---
const plannerHtml = renderToStaticMarkup(
  createElement(ReservationPlanner, {
    now: () => new Date('2026-10-17T12:00:00Z'),
    openUrl: () => false,
  }),
);
check(
  'reservation planner shows the exact Phase 2D availability fallback',
  plannerHtml.includes(
    'Availability unknown. Please confirm the room and time in the official reservation system.',
  ),
  '',
);
check('reservation planner starts in the draft state', plannerHtml.includes('Draft'), '');
check(
  'reservation planner asks for a location before showing policy',
  plannerHtml.includes('Choose a location to see its verified reservation policy.'),
  '',
);
check('reservation planner makes no confirmation claim', !plannerHtml.includes('Officially confirmed'), '');

// --- campus map (server render: list and notices work without Leaflet) ---
const mapHtml = renderToStaticMarkup(createElement(CampusMap));
check(
  'map panel renders the verified locations as a list',
  ['Thompson Library', '18th Avenue Library', 'Health Sciences Library', 'FAES Library', 'Ohio Union'].every(
    (name) => mapHtml.includes(name),
  ),
  '',
);
check(
  'map panel carries the OpenStreetMap attribution and licence link',
  mapHtml.includes('OpenStreetMap contributors') && mapHtml.includes('https://www.openstreetmap.org/copyright'),
  '',
);
check(
  'map panel states building points and no live status',
  mapHtml.includes('approximate building points') && mapHtml.includes('No live opening hours'),
  '',
);
check('map panel makes no availability or booking claim', !/available now|open now|rooms? free/i.test(mapHtml), '');

const failed = results.filter((ok) => !ok).length;
console.log('\\nSUMMARY ' + (results.length - failed) + '/' + results.length + ' passed');
if (failed > 0) process.exitCode = 1;
`;

const outDir = path.resolve('tests');
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, '.render-check.cjs');

const result = await build({
  stdin: {
    contents: entry,
    resolveDir: process.cwd(),
    sourcefile: 'render-check-entry.tsx',
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  write: false,
  logLevel: 'error',
  loader: { '.css': 'empty' },
  jsx: 'automatic',
});

await writeFile(outFile, result.outputFiles[0].text, 'utf8');
try {
  await import(pathToFileURL(outFile).href);
} finally {
  await rm(outFile, { force: true });
}
