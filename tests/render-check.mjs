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

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
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
  createElement(WeeklySchedule, { request: fallBackRequest, result: shortResult, selectedId: null, onSelect: () => {} }),
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
  createElement(WeeklySchedule, {
    request: { ...fallBackRequest, classes: [], unavailablePeriods: [] },
    result: adjacentResult,
    selectedId: null,
    onSelect: () => {},
  }),
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
  createElement(WeeklySchedule, { request: normalRequest, result: null, selectedId: null, onSelect: () => {} }),
);
const normalBlocks = blocksOf(normalHtml);
check(
  'normal hour block is one hour tall',
  normalBlocks.length === 1 && Math.abs(normalBlocks[0].height - 56) < 0.01 && Math.abs(normalBlocks[0].top - 56) < 0.01,
  JSON.stringify(normalBlocks[0]),
);
check('window label carries both zones', normalHtml.includes('EDT') || normalHtml.includes('EST'), '');

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
