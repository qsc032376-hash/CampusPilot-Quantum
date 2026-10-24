// Browser regression checks for the timeline with the REAL stylesheets loaded.
//
// Bundles a fixture that renders WeeklySchedule with edge-case data, serves it,
// drives headless Chrome over the DevTools protocol and verifies measured
// rectangles plus real mouse hit-testing. Inline styles alone are not trusted.
//
// Requires a browser executable and local process spawning, so run it with
// permission to launch Chrome:  node tests/browser-check.mjs
import { build } from 'esbuild';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { intersectionArea } from './tourGeometry.mjs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 4180;
const DEBUG_PORT = 9223;
const OUT_DIR = path.resolve('tests/.browser');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
};

const fixture = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WeeklySchedule } from './src/ui/components/WeeklySchedule.tsx';
import { Dashboard } from './src/ui/Dashboard.tsx';
import { sampleRequest } from './src/sample.ts';
import './src/style.css';
import './src/ui/ui.css';

// Window 00:00 EDT -> 04:00 EST is 5 real hours = 280px.
const request = {
  windowStart: '2026-11-01T00:00:00-04:00',
  windowEnd: '2026-11-01T04:00:00-05:00',
  classes: [{ id: 'cls', title: 'EdgeClass', start: '2026-11-01T03:55:00-05:00', end: '2026-11-01T04:05:00-05:00' }],
  tasks: [],
  unavailablePeriods: [{ id: 'busy', title: 'EdgeBusy', start: '2026-11-01T03:55:00-05:00', end: '2026-11-01T04:05:00-05:00' }],
  locations: [{ id: 'lib', name: 'Library' }],
};
const result = {
  blocks: [
    { id: 'A', taskId: 't1', title: 'BlockA', start: '2026-11-01T03:45:00-05:00', end: '2026-11-01T03:50:00-05:00', locationId: 'lib' },
    { id: 'B', taskId: 't2', title: 'BlockB', start: '2026-11-01T03:50:00-05:00', end: '2026-11-01T03:55:00-05:00', locationId: 'lib' },
  ],
  unscheduledTasks: [],
};

// One extra task whose deadline is late enough that a re-plan can move it to
// another day; the fixed fixture in src/sample.ts is not modified.
const browserRequest = {
  ...sampleRequest,
  tasks: [
    ...sampleRequest.tasks,
    { id: 'movable', title: 'Movable task', durationMinutes: 60, dueAt: '2026-10-21T21:00:00.000Z' },
  ],
};

function Fixture() {
  const [selected, setSelected] = useState(null);  return (
    <>
      <div className="cp-app" id="layout">
        <WeeklySchedule
          windowStart={request.windowStart}
          windowEnd={request.windowEnd}
          dayLabel="Edge day"
          classes={request.classes}
          unavailablePeriods={request.unavailablePeriods}
          blocks={result.blocks}
          conflicts={[]}
          hasPlan
          selectedId={selected}
          onSelect={setSelected}
        />
        <p id="selected">{selected ?? 'none'}</p>
      </div>
      <div id="app">
        <Dashboard request={browserRequest} />
      </div>
    </>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script>try{if(!localStorage.getItem("campuspilot.tour.seed")){localStorage.setItem("campuspilot.tour.v1","done");localStorage.setItem("campuspilot.tour.seed","1")}}catch(e){}</script><link rel="stylesheet" href="bundle.css"></head>
<body><div id="root"></div><script type="module" src="bundle.js"></script></body></html>`;

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  await build({
    stdin: { contents: fixture, resolveDir: process.cwd(), sourcefile: 'fixture.tsx', loader: 'tsx' },
    bundle: true,
    format: 'esm',
    target: 'es2020',
    outdir: OUT_DIR,
    entryNames: 'bundle',
    jsx: 'automatic',
    // Leaflet's stylesheet references marker images; inline them so the fixture
    // needs no extra asset files.
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.gif': 'dataurl' },
    logLevel: 'error',
  });
  await writeFile(path.join(OUT_DIR, 'index.html'), html, 'utf8');

  const server = http.createServer(async (request, response) => {
    const file = path.join(OUT_DIR, request.url === '/' ? 'index.html' : request.url.slice(1));
    try {
      const data = await readFile(file);
      const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const chromePath = findChrome();
  if (!chromePath) throw new Error('no Chrome or Edge executable found');
  const profile = path.join(os.tmpdir(), `campus-pilot-profile-${process.pid}`);
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--window-size=1280,1600',
      `http://127.0.0.1:${PORT}/`,
    ],
    { stdio: 'ignore' },
  );

  let socket;
  try {
    let target = null;
    for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
        target = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      } catch {
        /* browser still starting */
      }
      if (!target) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!target) throw new Error('no debuggable page');

    socket = new WebSocket(target.webSocketDebuggerUrl);
    let messageId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = (messageId += 1);
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (reply.result?.exceptionDetails) {
        const details = reply.result.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text || 'eval failed');
      }
      return reply.result?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    // A background tab reports visibilityState 'hidden', which throttles rAF and
    // pauses the tour transitions; make the test page visible and reproducible.
    await send('Page.bringToFront');
    await new Promise((resolve) => setTimeout(resolve, 150));

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate("document.querySelectorAll('#layout .cp-slot').length === 2 && !!document.querySelector('#app .cp-schedule')")) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await evaluate("document.querySelector('#layout .cp-schedule').scrollIntoView({block:'start'})");
    await new Promise((resolve) => setTimeout(resolve, 300));

    const geometry = await evaluate(`(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, height: r.height, bottom: r.bottom, left: r.left, width: r.width }; };
      const track = rect(document.querySelector('#layout .cp-timeline__track'));
      const blocks = [...document.querySelectorAll('#layout .cp-timeline__track .cp-block')].map((el) => ({ cls: el.className, ...rect(el) }));
      const slots = [...document.querySelectorAll('#layout .cp-slot')].map((el) => ({ cls: el.className, ...rect(el) }));
      return { track, blocks, slots };
    })()`);

    const expected = (5 / 60) * 56;
    const all = [...geometry.blocks, ...geometry.slots];
    record(
      'real CSS height matches the five minute span',
      all.length >= 4 && all.every((box) => Math.abs(box.height - expected) < 0.6),
      all.map((box) => `${box.cls.split(' ')[1] ?? box.cls}=${box.height.toFixed(2)}`).join(' '),
    );
    record(
      'no block is inflated to 14px by padding',
      all.every((box) => box.height < 9),
      `max=${Math.max(...all.map((box) => box.height)).toFixed(2)}`,
    );
    record(
      'every block stays inside the timeline window',
      all.every((box) => box.top >= geometry.track.top - 0.6 && box.bottom <= geometry.track.bottom + 0.6),
      `track ${geometry.track.top.toFixed(1)}..${geometry.track.bottom.toFixed(1)}`,
    );

    const [slotA, slotB] = [...geometry.slots].sort((a, b) => a.top - b.top);
    record('adjacent short blocks do not overlap', slotA.bottom <= slotB.top + 0.6, `${slotA.bottom.toFixed(2)} vs ${slotB.top.toFixed(2)}`);

    const clickAt = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return evaluate("document.getElementById('selected').textContent");
    };

    const centerOf = (box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

    const aCenter = centerOf(slotA);
    const first = await clickAt(aCenter.x, aCenter.y);
    record('clicking A centre selects A', first === 'A', `selected=${first}`);

    const bCenter = centerOf(slotB);
    const second = await clickAt(bCenter.x, bCenter.y);
    record('clicking B centre selects B', second === 'B', `selected=${second}`);

    const third = await clickAt(aCenter.x, aCenter.y);
    record('clicking A again selects A', third === 'A', `selected=${third}`);

    // --- header range summary and readable example note (D regression) ---
    const headerText = () => evaluate("document.querySelector('#app .cp-header').innerText");
    const setEndTime = async (value) => {
      await evaluate([
        '(() => {',
        "  const inputs = [...document.querySelectorAll('#app section[aria-labelledby=\"cp-range-heading\"] input[type=\"time\"]')];",
        '  const input = inputs[1];',
        '  if (!input) return "missing";',
        "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
        '  setter.call(input, ' + JSON.stringify(value) + ');',
        "  input.dispatchEvent(new Event('input', { bubbles: true }));",
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 350));
    };

    const defaultHeader = await headerText();
    record('header shows the default 09:00–17:00 range', defaultHeader.includes('09:00–17:00'), defaultHeader);
    record(
      'page renders no replacement characters',
      !(await evaluate('document.body.innerText')).includes(String.fromCharCode(0xfffd)),
      '',
    );

    await setEndTime('18:00');
    const editedHeader = await headerText();
    record('header follows the edited end time', editedHeader.includes('09:00–18:00'), editedHeader);
    record('the un-interpolated placeholder is gone', !editedHeader.includes('{range.endTime}'), editedHeader);

    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-range-heading"]');
      const toggle = [...section.querySelectorAll('.cp-optional__toggle')].find((b) =>
        (b.getAttribute('aria-label') || '').includes('how planning works'),
      );
      if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const exampleNote = await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-range-heading"]');
      const panel = section.querySelector('.cp-optional__panel');
      return panel ? panel.innerText : '';
    })()`);
    record(
      'the example note is readable and marks demo data',
      exampleNote.includes('demo data') &&
        exampleNote.includes('not real courses') &&
        !exampleNote.includes(String.fromCharCode(0xfffd)),
      exampleNote,
    );

    await setEndTime('17:00');

    // Shared contract integration, rendered by the real Dashboard.
    // Pin the range to the bundled sample date so the assertions stay deterministic.
    await evaluate("document.querySelector('#app .cp-schedule').scrollIntoView({block:'start'})");
    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      if (!input) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2026-10-19');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(
      "[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Build plan')).click()",
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    const appText = await evaluate("document.querySelector('#app').innerText");
    record(
      'conflicts section lists both events with the overlap',
      appText.includes('Math lecture') && appText.includes('Advising slot') && appText.includes('30 min overlap'),
      '',
    );
    record(
      'conflicting blocks are marked in the timeline',
      (await evaluate("document.querySelectorAll('#app .cp-block.is-conflict').length")) === 2,
      `count=${await evaluate("document.querySelectorAll('#app .cp-block.is-conflict').length")}`,
    );
    record(
      'conflict badge is really rendered with size',
      await evaluate(`(() => {
        const badge = document.querySelector('#app .cp-badge');
        if (!badge) return false;
        const box = badge.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })()`),
      '',
    );
    record(
      'conflict legend row is visible',
      await evaluate("!!document.querySelector('#app .cp-dot--conflict')"),
      '',
    );
    record(
      'task form keeps optional priority and course code behind the disclosure',
      await evaluate(`(() => {
        const form = document.querySelector('#app form.cp-form');
        if (!form || !form.querySelector('.cp-optional__toggle')) return false;
        const text = form.textContent || '';
        return text.includes('Priority (optional)') && text.includes('Course code (optional)');
      })()`),
      '',
    );

    await evaluate("document.querySelector('#app .cp-session').click()");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const locationText = await evaluate("document.querySelector('#app').innerText");

    // D's blocking finding: the ordinary default-assignment case must explain
    // itself, and the note has to be really visible, not just in the markup.
    const statusNote = await evaluate(`(() => {
      const el = document.querySelector('#app .cp-location__status');
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: el.textContent.trim(),
        visible:
          box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0,
      };
    })()`);
    record(
      'default assignment note is visible without opening anything',
      !!statusNote &&
        statusNote.visible &&
        /Default scheduler assignment/.test(statusNote.text) &&
        /not been verified/.test(statusNote.text),
      statusNote ? `${statusNote.visible} :: ${statusNote.text}` : 'missing element',
    );

    record(
      'assigned location shows the verified address',
      locationText.includes('1858 Neil Avenue Mall'),
      '',
    );
    record(
      'a standalone recommended-locations panel is rendered',
      locationText.includes('Recommended study locations'),
      '',
    );
    record(
      'several campus locations are listed after selecting a block',
      ['18th Avenue Library', 'Ohio Union', 'Health Sciences Library'].every((name) => locationText.includes(name)),
      '',
    );
    record(
      'recommendation links point at official Ohio State pages',
      await evaluate(
        "[...document.querySelectorAll('#app .cp-locations__link')].some((a) => a.href.includes('osu.edu'))",
      ),
      '',
    );
    record(
      'recommendation scores are rendered',
      (await evaluate("document.querySelectorAll('#app .cp-locations__score').length")) >= 5,
      '',
    );
    record(
      'location list keeps the simulated-hours label',
      locationText.includes('simulated hours') && locationText.includes('Availability is simulated'),
      '',
    );

    // --- reservation planning workflow ---
    record(
      'reservation planner panel is rendered',
      await evaluate("!!document.querySelector('#app .cp-reservation')"),
      '',
    );
    record(
      'Phase 2D availability fallback is visible',
      await evaluate(`(() => {
        const el = document.querySelector('#app .cp-notice');
        if (!el) return false;
        const box = el.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          el.textContent.trim() ===
            'Availability unknown. Please confirm the room and time in the official reservation system.'
        );
      })()`),
      '',
    );

    await evaluate(`(() => {
      const select = document.querySelector('#app .cp-reservation select');
      if (!select) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'thompson-library');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const plannerText = await evaluate("document.querySelector('#app .cp-reservation').innerText");
    const plannerLower = plannerText.toLowerCase();
    record(
      'verified policy separates eligibility, access and availability',
      ['booking eligibility', 'building access', 'room availability'].every((label) => plannerLower.includes(label)),
      '',
    );
    record(
      'policy shows rule-specific source and dates',
      /rules read \d{4}-\d{2}-\d{2}/.test(plannerText) &&
        /location data verified \d{4}-\d{2}-\d{2}/.test(plannerText) &&
        plannerText.includes('Official booking rules'),
      '',
    );
    record(
      'libraries rooms state the group-only eligibility',
      plannerText.includes('Group study rooms only; individual study is walk-in'),
      '',
    );
    record(
      'libraries policy displays the 15-minute forfeiture rule',
      /late arrival/i.test(plannerText) && plannerText.includes('more than 15 minutes late forfeits the reservation'),
      '',
    );
    record(
      'planner never claims an official confirmation',
      !plannerText.includes('Officially confirmed'),
      '',
    );

    await evaluate(`(() => {
      const select = document.querySelector('#app .cp-reservation select');
      if (!select) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'health-sciences-library');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const hslText = await evaluate("document.querySelector('#app .cp-reservation').innerText");
    record(
      'HSL displays the conditional unoccupied-room rule',
      /unoccupied room/i.test(hslText) &&
        hslText.includes('may be released if unoccupied after 10 minutes'),
      '',
    );
    record(
      'HSL does not inherit the libraries late-arrival rule',
      !/more than 15 minutes late/i.test(hslText),
      '',
    );
    record(
      'Thompson shows no ELA section',
      !/Extended Library Access/i.test(plannerText),
      '',
    );
    record(
      'HSL renders the separate ELA context note',
      /extended library access/i.test(hslText) &&
        hslText.includes('first come, first served') &&
        hslText.includes('A reservation is not required during these hours.') &&
        hslText.includes('Other study-room rules still apply.'),
      '',
    );
    record(
      'HSL ELA note keeps the uncertainty caveat and cites its source',
      /10-minute release rule/i.test(hslText) &&
        (await evaluate(
          "[...document.querySelectorAll('#app .cp-reservation a')].some((a) => a.href.includes('extended-library-access-ela'))",
        )),
      '',
    );
    record(
      'HSL ordinary rules still show the two-hour limit',
      /official rules/i.test(hslText) && hslText.includes('2-hour reservations'),
      '',
    );

    // --- D P2 #1: re-plan must move the viewed day with the selected block ---
    await evaluate("document.querySelector('#app .cp-results').scrollIntoView({block:'start'})");

    const clickButton = (text) =>
      evaluate(
        "[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes(" +
          JSON.stringify(text) +
          ')).click()',
      );
    const setRangeDate = async (value) => {
      await evaluate([
        '(() => {',
        "  const input = document.querySelector('#app section[aria-labelledby=\"cp-range-heading\"] input[type=\"date\"]');",
        '  if (!input) return "missing";',
        "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
        '  setter.call(input, ' + JSON.stringify(value) + ');',
        "  input.dispatchEvent(new Event('input', { bubbles: true }));",
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 300));
    };

    // Clean slate: rebuild a multi-day plan on the fixed sample date.
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await setRangeDate('2026-10-19');
    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 450));

    // Select the block that the added work will displace.
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app .cp-session')].find((item) =>
        item.textContent.includes('Movable task'),
      );
      if (!button) return 'missing';
      button.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const dayBefore = await evaluate("(document.querySelector('#app .cp-daynav__label') || {}).textContent || ''");

    // A weekly series whose occurrence fills the viewed day pushes the block on.
    await evaluate([
      '(() => {',
      "  const section = document.querySelector('#app section[aria-labelledby=\"cp-recurring-heading\"]');",
      '  const form = section.querySelector("form.cp-form");',
      "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
      "  const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;",
      "  const titleInput = form.querySelector('input:not([type])');",
      "  setter.call(titleInput, 'Weekly filler');",
      "  titleInput.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const minutes = form.querySelector('input[type=\"number\"]');",
      "  setter.call(minutes, '480');",
      "  minutes.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const frequency = form.querySelector('select');",
      "  setSelect.call(frequency, 'weekly');",
      "  frequency.dispatchEvent(new Event('change', { bubbles: true }));",
      '  return "ok";',
      '})()',
    ].join('\n'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const boxes = [...section.querySelectorAll('input[type="checkbox"]')];
      const tuesday = boxes[1];
      if (!tuesday) return 'missing';
      tuesday.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const seriesState = await evaluate(`(() => ({
      rows: [...document.querySelectorAll('#app section[aria-labelledby="cp-recurring-heading"] .cp-series__row')].map((el) => el.textContent),
      counts: document.querySelector('#app .cp-results .cp-hint') ? document.querySelector('#app .cp-results .cp-hint').textContent : '',
    }))()`);
    record('a repeating series can be created', seriesState.rows.length === 1, JSON.stringify(seriesState).slice(0, 240));
    record(
      'counts separate series from occurrences',
      /Repeating series: 1/.test(seriesState.counts) && /Placed occurrences: \d+/.test(seriesState.counts),
      seriesState.counts,
    );

    const afterReplan = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('#app .cp-days__row')];
      const selectedSession = document.querySelector('#app .cp-session.is-selected');
      const row = selectedSession ? selectedSession.closest('.cp-days__row') : null;
      const navText = (document.querySelector('#app .cp-daynav__label') || {}).textContent || '';
      const shown = /Day (\\d+) of/.exec(navText);
      return {
        tabIndex: shown ? Number(shown[1]) - 1 : -1,
        rowIndex: row ? rows.indexOf(row) : -1,
        tab: navText,
        row: row ? row.querySelector('.cp-days__label').textContent : null,
        session: selectedSession ? selectedSession.textContent : null,
        slot: !!document.querySelector('#app .cp-slot.is-selected'),
        where: ((document.querySelector('#app .cp-location__task') || {}).textContent) || '',
      };
    })()`);
    record('re-plan keeps the surviving selection', !!afterReplan.session, JSON.stringify(afterReplan));
    record(
      'viewed day follows the re-planned block',
      afterReplan.tabIndex >= 0 && afterReplan.tabIndex === afterReplan.rowIndex,
      JSON.stringify(afterReplan),
    );
    record('timeline highlights the same block', afterReplan.slot, '');
    record('Where card follows the same block', afterReplan.where.includes('Movable task'), afterReplan.where);
    record(
      'the selected block really moved to another day',
      afterReplan.tab !== dayBefore,
      dayBefore + ' -> ' + afterReplan.tab,
    );

    // --- D P2 #2: invalid hours must not stick after the range becomes valid ---
    const setDailyEnd = async (value) => {
      await evaluate(`(() => {
        const inputs = [
          ...document.querySelectorAll('#app section[aria-labelledby="cp-range-heading"] input[type="time"]'),
        ];
        const input = inputs[1];
        if (!input) return 'missing';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    };
    const resultsError = "((document.querySelector('#app section[aria-labelledby=\"cp-results-heading\"] .cp-error') || {}).textContent || '')";

    await setDailyEnd('08:00');
    const invalidState = await evaluate(`(() => ({
      error: ${resultsError},
      sessions: document.querySelectorAll('#app .cp-session').length,
    }))()`);
    record('an invalid daily end shows a validation error', /end after they start/i.test(invalidState.error), JSON.stringify(invalidState));
    record('an invalid range never presents the old plan', invalidState.sessions === 0, '');

    await setDailyEnd('17:00');
    const recovered = await evaluate(`(() => ({
      error: ${resultsError},
      sessions: document.querySelectorAll('#app .cp-session').length,
    }))()`);
    record('restoring valid hours clears the stale error', recovered.error === '', recovered.error);
    record('restoring valid hours recomputes the existing plan', recovered.sessions > 0, String(recovered.sessions));

    // --- range presets, day navigation, series edit/delete, reset ---
    await clickButton('30 days');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const preset30 = await evaluate(`(() => ({
      nav: (document.querySelector('#app .cp-daynav__label') || {}).textContent || '',
      weeks: document.querySelectorAll('#app .cp-week').length,
      days: document.querySelectorAll('#app .cp-days__row').length,
    }))()`);
    record('the 30-day preset shows thirty days', preset30.nav === 'Day 1 of 30' && preset30.days === 30, JSON.stringify(preset30));
    record('thirty days are grouped into weeks', preset30.weeks === 5, String(preset30.weeks));

    await evaluate("[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Next day')).click()");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const nextDayNav = await evaluate("(document.querySelector('#app .cp-daynav__label') || {}).textContent || ''");
    record('the next-day control moves the viewed day', nextDayNav === 'Day 2 of 30', nextDayNav);

    await clickButton('7 days');
    await new Promise((resolve) => setTimeout(resolve, 350));

    const recurringSection = '#app section[aria-labelledby="cp-recurring-heading"]';
    await evaluate(`(() => {
      const section = document.querySelector('${recurringSection}');
      const edit = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Edit'));
      if (!edit) return 'missing';
      edit.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    record(
      'a series can be opened for editing',
      await evaluate(
        `[...document.querySelectorAll('${recurringSection} button')].some((b) => b.textContent.includes('Save changes'))`,
      ),
      '',
    );

    await evaluate(`(() => {
      const section = document.querySelector('${recurringSection}');
      const input = section.querySelector('form.cp-form input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Weekly filler edited');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Save changes');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const editedRows = await evaluate(
      `[...document.querySelectorAll('${recurringSection} .cp-series__row')].map((el) => el.textContent)`,
    );
    record(
      'editing keeps one series with the new title',
      editedRows.length === 1 && editedRows[0].includes('Weekly filler edited'),
      JSON.stringify(editedRows).slice(0, 160),
    );

    await evaluate(`(() => {
      const section = document.querySelector('${recurringSection}');
      const remove = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Delete'));
      if (!remove) return 'missing';
      remove.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    record(
      'deleting the series removes it',
      (await evaluate(`document.querySelectorAll('${recurringSection} .cp-series__row').length`)) === 0,
      '',
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const afterReset = await evaluate(`(() => ({
      nav: (document.querySelector('#app .cp-daynav__label') || {}).textContent || '',
      series: document.querySelectorAll('${recurringSection} .cp-series__row').length,
      results: !!document.querySelector('#app .cp-results'),
    }))()`);
    record(
      'reset clears series and restores the default seven-day range',
      afterReset.nav === 'Day 1 of 7' && afterReset.series === 0 && afterReset.results === false,
      JSON.stringify(afterReset),
    );


    // --- D QA: duplicate reset keys, Never while editing, raw day count ---
    for (let index = 0; index < 3; index += 1) {
      await clickButton('Reset');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const afterResets = await evaluate(`(() => ({
      forms: document.querySelectorAll('#app form.cp-form').length,
      title: ((document.querySelector('#app form.cp-form input:not([type])') || {}).value) ?? null,
    }))()`);
    record(
      'consecutive resets leave one clean one-off form',
      afterResets.forms === 2 && afterResets.title === '',
      JSON.stringify(afterResets),
    );

    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const form = section.querySelector('form.cp-form');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      const title = form.querySelector('input:not([type])');
      setter.call(title, 'Edit guard');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const frequency = form.querySelector('select');
      setSelect.call(frequency, 'daily');
      frequency.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 450));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const edit = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Edit'));
      if (!edit) return 'missing';
      edit.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const neverState = await evaluate(`(() => {
      const option = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"] select option[value="never"]');
      return { exists: !!option, disabled: option ? option.disabled : null };
    })()`);
    record(
      'Never cannot be chosen while editing a series',
      neverState.exists && neverState.disabled === true,
      JSON.stringify(neverState),
    );
    await evaluate("[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Cancel')).click()");
    await new Promise((resolve) => setTimeout(resolve, 250));
    record(
      'cancelling the edit keeps exactly one series',
      (await evaluate(
        "document.querySelectorAll('#app section[aria-labelledby=\"cp-recurring-heading\"] .cp-series__row').length",
      )) === 1,
      '',
    );

    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 450));

    const setDays = async (value) => {
      await evaluate([
        '(() => {',
        "  const input = document.querySelector('#app section[aria-labelledby=\"cp-range-heading\"] input[type=\"number\"]');",
        '  if (!input) return "missing";',
        "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
        '  setter.call(input, ' + JSON.stringify(value) + ');',
        "  input.dispatchEvent(new Event('input', { bubbles: true }));",
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 350));
    };
    const dayState = () =>
      evaluate(`(() => ({
        value: ((document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="number"]') || {}).value) ?? null,
        error: ((document.querySelector('#app section[aria-labelledby="cp-results-heading"] .cp-error') || {}).textContent) || '',
        sessions: document.querySelectorAll('#app .cp-session').length,
        nav: ((document.querySelector('#app .cp-daynav__label') || {}).textContent) || '',
      }))()`);

    await setDays('0');
    const zero = await dayState();
    record('a day count of 0 is rejected, not clamped', zero.value === '0' && /1 to 30/.test(zero.error) && zero.sessions === 0, JSON.stringify(zero));

    await setDays('31');
    const high = await dayState();
    record('a day count of 31 is rejected, not clamped', high.value === '31' && /1 to 30/.test(high.error) && high.sessions === 0, JSON.stringify(high));

    await setDays('30');
    const dayRecovery = await dayState();
    record('correcting the day count recovers', dayRecovery.nav === 'Day 1 of 30' && dayRecovery.error === '' && dayRecovery.sessions > 0, JSON.stringify(dayRecovery));

    // --- D QA round 2: an invalid day count blocks every planning path ---
    await setDays('0');
    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const buildBlocked = await dayState();
    record(
      'Build refuses an invalid day count',
      buildBlocked.value === '0' && /1 to 30/.test(buildBlocked.error) && buildBlocked.sessions === 0,
      JSON.stringify(buildBlocked),
    );

    await evaluate([
      '(() => {',
      "  const form = document.querySelector('#app form.cp-form');",
      "  const input = form.querySelector('input:not([type])');",
      "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
      "  setter.call(input, 'Blocked task');",
      "  input.dispatchEvent(new Event('input', { bubbles: true }));",
      '  return "ok";',
      '})()',
    ].join('\n'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Add task');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const addBlocked = await dayState();
    record(
      'adding a one-off task keeps the invalid day count',
      addBlocked.value === '0' && /1 to 30/.test(addBlocked.error) && addBlocked.sessions === 0,
      JSON.stringify(addBlocked),
    );

    await evaluate([
      '(() => {',
      "  const section = document.querySelector('#app section[aria-labelledby=\"cp-recurring-heading\"]');",
      "  const form = section.querySelector('form.cp-form');",
      "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
      "  const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;",
      "  const title = form.querySelector('input:not([type])');",
      "  setter.call(title, 'Blocked series');",
      "  title.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const frequency = form.querySelector('select');",
      "  setSelect.call(frequency, 'daily');",
      "  frequency.dispatchEvent(new Event('change', { bubbles: true }));",
      '  return "ok";',
      '})()',
    ].join('\n'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const seriesBlocked = await dayState();
    record(
      'adding a series keeps the invalid day count',
      seriesBlocked.value === '0' && /1 to 30/.test(seriesBlocked.error) && seriesBlocked.sessions === 0,
      JSON.stringify(seriesBlocked),
    );

    await setEndTime('18:00');
    const timeBlocked = await dayState();
    record(
      'a daily-hours edit keeps the invalid day count',
      timeBlocked.value === '0' && /1 to 30/.test(timeBlocked.error) && timeBlocked.sessions === 0,
      JSON.stringify(timeBlocked),
    );
    await setEndTime('17:00');

    const rejectedForms = [];
    for (const bad of ['31', '', '-1', '7.5', 'abc']) {
      await setDays(bad);
      const state = await dayState();
      rejectedForms.push({ bad, error: state.error, sessions: state.sessions });
    }
    record(
      'other invalid day counts are rejected',
      rejectedForms.every((entry) => entry.error.length > 0 && entry.sessions === 0),
      JSON.stringify(rejectedForms),
    );

    await setDays('30');
    const dayRecovery2 = await dayState();
    record(
      'fixing the day count restores planning',
      dayRecovery2.nav === 'Day 1 of 30' && dayRecovery2.error === '' && dayRecovery2.sessions > 0,
      JSON.stringify(dayRecovery2),
    );

    // --- A review: deleting the edited series ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await evaluate([
      '(() => {',
      "  const section = document.querySelector('#app section[aria-labelledby=\"cp-recurring-heading\"]');",
      "  const form = section.querySelector('form.cp-form');",
      "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
      "  const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;",
      "  const title = form.querySelector('input:not([type])');",
      "  setter.call(title, 'Edit target');",
      "  title.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const frequency = form.querySelector('select');",
      "  setSelect.call(frequency, 'daily');",
      "  frequency.dispatchEvent(new Event('change', { bubbles: true }));",
      '  return "ok";',
      '})()',
    ].join('\n'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 450));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const edit = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Edit'));
      if (!edit) return 'missing';
      edit.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    record(
      'editing a series shows the save action',
      await evaluate(`[...document.querySelectorAll('#app section[aria-labelledby="cp-recurring-heading"] button')].some((b) => b.textContent.includes('Save changes'))`),
      '',
    );

    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const remove = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Delete'));
      if (!remove) return 'missing';
      remove.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterDeleteWhileEditing = await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const buttons = [...section.querySelectorAll('button')].map((b) => b.textContent);
      const form = section.querySelector('form.cp-form');
      return {
        save: buttons.some((text) => text.includes('Save changes')),
        add: buttons.some((text) => text.includes('Add repeating task')),
        title: (form.querySelector('input:not([type])') || {}).value,
        rows: section.querySelectorAll('.cp-series__row').length,
      };
    })()`);
    record(
      'deleting the edited series leaves a clean add form',
      afterDeleteWhileEditing.save === false &&
        afterDeleteWhileEditing.add === true &&
        afterDeleteWhileEditing.title === '' &&
        afterDeleteWhileEditing.rows === 0,
      JSON.stringify(afterDeleteWhileEditing),
    );

    await evaluate([
      '(() => {',
      "  const section = document.querySelector('#app section[aria-labelledby=\"cp-recurring-heading\"]');",
      "  const form = section.querySelector('form.cp-form');",
      "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
      "  const title = form.querySelector('input:not([type])');",
      "  setter.call(title, 'Fresh series');",
      "  title.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;",
      "  const frequency = form.querySelector('select');",
      "  setSelect.call(frequency, 'daily');",
      "  frequency.dispatchEvent(new Event('change', { bubbles: true }));",
      '  return "ok";',
      '})()',
    ].join('\n'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const freshState = await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      return {
        rows: [...section.querySelectorAll('.cp-series__row')].map((el) => el.textContent),
        save: [...section.querySelectorAll('button')].some((b) => b.textContent.includes('Save changes')),
      };
    })()`);
    record(
      'the reset form adds a new series instead of saving silently',
      freshState.rows.length === 1 && freshState.rows[0].includes('Fresh series') && freshState.save === false,
      JSON.stringify(freshState).slice(0, 200),
    );

    // --- task mode switch ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));

    const taskPanel = '#app section[aria-labelledby="cp-task-heading"]';
    const modeState = () =>
      evaluate(`(() => {
        const section = document.querySelector('${taskPanel}');
        const tabs = [...section.querySelectorAll('.cp-modetab')];
        const panes = [...section.querySelectorAll('.cp-task-pane')];
        return {
          labels: tabs.map((tab) => tab.textContent),
          pressed: tabs.map((tab) => tab.getAttribute('aria-pressed')),
          visible: panes.map((pane) => !pane.hasAttribute('hidden')),
          forms: section.querySelectorAll('form.cp-form').length,
          title: (section.querySelector('.cp-task-pane input:not([type])') || {}).value ?? null,
        };
      })()`);

    const initialMode = await modeState();
    record(
      'one-time task is the default mode',
      initialMode.pressed[0] === 'true' &&
        initialMode.pressed[1] === 'false' &&
        initialMode.visible[0] === true &&
        initialMode.visible[1] === false &&
        initialMode.forms === 2,
      JSON.stringify(initialMode),
    );

    await evaluate(`(() => {
      const input = document.querySelector('${taskPanel} .cp-task-pane input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Draft task');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterTargetSwitch = await modeState();
    record(
      'switching shows the repeating pane',
      afterTargetSwitch.visible[0] === false && afterTargetSwitch.visible[1] === true,
      JSON.stringify(afterTargetSwitch),
    );
    record(
      'an unsubmitted one-time draft survives a mode switch',
      afterTargetSwitch.title === 'Draft task',
      String(afterTargetSwitch.title),
    );

    await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const form = section.querySelectorAll('form.cp-form')[1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      const title = form.querySelector('input:not([type])');
      setter.call(title, 'Mode series');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const frequency = form.querySelector('select');
      setSelect.call(frequency, 'daily');
      frequency.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 450));
    await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const edit = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Edit'));
      if (!edit) return 'missing';
      edit.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('One-time task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    record(
      'an open series edit survives a mode switch',
      await evaluate(
        `[...document.querySelectorAll('${taskPanel} button')].some((b) => b.textContent.includes('Save changes'))`,
      ),
      '',
    );
    record(
      'the repeating tab shows the saved series count',
      await evaluate(
        `[...document.querySelectorAll('${taskPanel} .cp-modetab')].some((tab) => /Repeating task\s*1/.test(tab.textContent))`,
      ),
      '',
    );

    await clickButton('One-time task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const hiddenSeries = await evaluate(`(() => ({
      counts: ((document.querySelector('#app .cp-results .cp-hint') || {}).textContent) || '',
      repeating: document.querySelectorAll('#app .cp-session .cp-tag').length,
    }))()`);
    record(
      'a hidden series still participates in the schedule',
      /Repeating series: 1/.test(hiddenSeries.counts) && hiddenSeries.repeating > 0,
      JSON.stringify(hiddenSeries),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterModeReset = await modeState();
    const resetSeriesCount = await evaluate(`document.querySelectorAll('${taskPanel} .cp-series__row').length`);
    record(
      'reset returns to one-time mode and clears the series',
      afterModeReset.pressed[0] === 'true' && afterModeReset.forms === 2 && afterModeReset.title === '' && resetSeriesCount === 0,
      JSON.stringify(afterModeReset) + ' series=' + String(resetSeriesCount),
    );

    // A narrow viewport must not make the switch overflow the panel.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 380,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const narrowMode = await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const tabs = section.querySelector('.cp-modetabs');
      const buttons = [...tabs.querySelectorAll('.cp-modetab')];
      const box = tabs.getBoundingClientRect();
      return {
        buttons: buttons.length,
        allVisible: buttons.every((button) => button.getBoundingClientRect().width > 0),
        overflow: tabs.scrollWidth - tabs.clientWidth,
        insideViewport: box.width > 0 && box.right <= document.documentElement.clientWidth + 1,
      };
    })()`);
    record(
      'the mode switch fits a narrow viewport',
      narrowMode.buttons === 2 && narrowMode.allVisible && narrowMode.overflow <= 1 && narrowMode.insideViewport,
      JSON.stringify(narrowMode),
    );
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 350));

    // --- D QA: Reset must leave the task panel in one-time mode ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));

    await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const form = section.querySelectorAll('form.cp-form')[1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      const title = form.querySelector('input:not([type])');
      setter.call(title, 'Reset series');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const frequency = form.querySelector('select');
      setSelect.call(frequency, 'daily');
      frequency.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 450));

    await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const edit = [...section.querySelectorAll('button')].find((b) => b.textContent.includes('Edit'));
      if (!edit) return 'missing';
      edit.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const form = section.querySelectorAll('form.cp-form')[1];
      const title = form.querySelector('input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(title, 'Unsaved edit draft');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const beforeResetFromRepeating = await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const tabs = [...section.querySelectorAll('.cp-modetab')];
      return {
        repeatingPressed: tabs[1].getAttribute('aria-pressed'),
        saving: [...section.querySelectorAll('button')].some((b) => b.textContent.includes('Save changes')),
        seriesRows: section.querySelectorAll('.cp-series__row').length,
        planSessions: document.querySelectorAll('#app .cp-session').length,
        resetLabel: [...document.querySelectorAll('#app button')]
          .map((b) => b.textContent.trim())
          .find((text) => text.includes('Reset')) ?? null,
      };
    })()`);
    record(
      'the reset case starts in repeating mode with an open edit',
      beforeResetFromRepeating.repeatingPressed === 'true' &&
        beforeResetFromRepeating.saving === true &&
        beforeResetFromRepeating.seriesRows === 1 &&
        beforeResetFromRepeating.planSessions > 0,
      JSON.stringify(beforeResetFromRepeating),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const afterResetFromRepeating = await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const tabs = [...section.querySelectorAll('.cp-modetab')];
      const panes = [...section.querySelectorAll('.cp-task-pane')];
      const forms = [...section.querySelectorAll('form.cp-form')];
      return {
        pressed: tabs.map((tab) => tab.getAttribute('aria-pressed')),
        visible: panes.map((pane) => !pane.hasAttribute('hidden')),
        seriesRows: section.querySelectorAll('.cp-series__row').length,
        saving: [...section.querySelectorAll('button')].some((b) => b.textContent.includes('Save changes')),
        oneOffTitle: (forms[0].querySelector('input:not([type])') || {}).value ?? null,
        recurringTitle: (forms[1].querySelector('input:not([type])') || {}).value ?? null,
        plan: !!document.querySelector('#app .cp-results'),
        selectedSessions: document.querySelectorAll('#app .cp-session.is-selected').length,
        locationCard: !!document.querySelector('#app .cp-location__task'),
        selectedDays: document.querySelectorAll('#app .cp-days__head.is-selected').length,
      };
    })()`);
    record(
      'reset from repeating mode returns to one-time mode',
      afterResetFromRepeating.pressed[0] === 'true' && afterResetFromRepeating.pressed[1] === 'false',
      JSON.stringify(afterResetFromRepeating.pressed),
    );
    record(
      'reset shows the one-time form and hides the repeating form',
      afterResetFromRepeating.visible[0] === true && afterResetFromRepeating.visible[1] === false,
      JSON.stringify(afterResetFromRepeating.visible),
    );
    record(
      'reset clears the series, the edit draft, the plan and the selection',
      afterResetFromRepeating.seriesRows === 0 &&
        afterResetFromRepeating.saving === false &&
        afterResetFromRepeating.oneOffTitle === '' &&
        afterResetFromRepeating.recurringTitle === '' &&
        afterResetFromRepeating.plan === false &&
        afterResetFromRepeating.selectedSessions === 0 &&
        afterResetFromRepeating.locationCard === false,
      JSON.stringify(afterResetFromRepeating),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const secondReset = await evaluate(`(() => {
      const section = document.querySelector('${taskPanel}');
      const tabs = [...section.querySelectorAll('.cp-modetab')];
      const panes = [...section.querySelectorAll('.cp-task-pane')];
      return {
        pressed: tabs.map((tab) => tab.getAttribute('aria-pressed')),
        visible: panes.map((pane) => !pane.hasAttribute('hidden')),
      };
    })()`);
    record(
      'a second reset keeps one-time mode',
      secondReset.pressed[0] === 'true' && secondReset.visible[0] === true && secondReset.visible[1] === false,
      JSON.stringify(secondReset),
    );

    // --- schedule intensity: relaxed vs high intensity ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));

    const intensityPanel = '#app section[aria-labelledby="cp-range-heading"]';
    const intensityState = () =>
      evaluate(`(() => {
        const buttons = [...document.querySelectorAll('${intensityPanel} .cp-intensity button')];
        return {
          labels: buttons.map((button) => button.textContent.trim()),
          pressed: buttons.map((button) => button.getAttribute('aria-pressed')),
          text: (document.querySelector('${intensityPanel} .cp-intensity') || {}).innerText || '',
        };
      })()`);

    const defaultIntensity = await intensityState();
    record(
      'relaxed is the default pace',
      defaultIntensity.labels[0] === 'Relaxed' &&
        defaultIntensity.labels[1] === 'High intensity' &&
        defaultIntensity.pressed[0] === 'true' &&
        defaultIntensity.pressed[1] === 'false',
      JSON.stringify(defaultIntensity),
    );
    record(
      'both paces explain what they do',
      /15-minute breaks/.test(defaultIntensity.text) && !/without planned breaks/.test(defaultIntensity.text),
      defaultIntensity.text,
    );

    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2026-10-20');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const addTightTask = async (title) => {
      await evaluate([
        '(() => {',
        "  const form = document.querySelector('#app form.cp-form');",
        "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
        "  const titleInput = form.querySelector('input:not([type])');",
        '  setter.call(titleInput, ' + JSON.stringify(title) + ');',
        "  titleInput.dispatchEvent(new Event('input', { bubbles: true }));",
        "  const minutes = form.querySelector('input[type=\"number\"]');",
        "  setter.call(minutes, '60');",
        "  minutes.dispatchEvent(new Event('input', { bubbles: true }));",
        "  const due = form.querySelector('input[type=\"datetime-local\"]');",
        "  setter.call(due, '2026-10-20T17:00');",
        "  due.dispatchEvent(new Event('input', { bubbles: true }));",
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await clickButton('Add task');
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    await addTightTask('Pace A');
    await addTightTask('Pace B');
    await addTightTask('Pace C');

    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const relaxedPlan = await evaluate(`(() => ({
      sessions: [...document.querySelectorAll('#app .cp-session')].map((el) => el.textContent),
      tasks: document.querySelectorAll('#app .cp-tasks__row').length,
      series: document.querySelectorAll('#app .cp-series__row').length,
    }))()`);

    await clickButton('High intensity');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const intensePlan = await evaluate(`(() => ({
      pressed: [...document.querySelectorAll('${intensityPanel} .cp-intensity button')].map((b) => b.getAttribute('aria-pressed')),
      sessions: [...document.querySelectorAll('#app .cp-session')].map((el) => el.textContent),
      tasks: document.querySelectorAll('#app .cp-tasks__row').length,
      series: document.querySelectorAll('#app .cp-series__row').length,
    }))()`);
    record(
      'switching to high intensity re-plans with the new pace',
      intensePlan.pressed[1] === 'true' && intensePlan.sessions.join('|') !== relaxedPlan.sessions.join('|'),
      JSON.stringify({ relaxed: relaxedPlan.sessions, intense: intensePlan.sessions }),
    );
    record(
      'the pace keeps the same placed tasks and plan size',
      intensePlan.sessions.length === relaxedPlan.sessions.length && intensePlan.tasks === relaxedPlan.tasks,
      String(intensePlan.sessions.length) + ' vs ' + String(relaxedPlan.sessions.length),
    );
    record(
      'switching the pace changes no task or series data',
      intensePlan.tasks === relaxedPlan.tasks && intensePlan.series === relaxedPlan.series,
      JSON.stringify({ tasks: intensePlan.tasks, series: intensePlan.series }),
    );

    await clickButton('Relaxed');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const backToRelaxed = await evaluate(`(() => ({
      pressed: [...document.querySelectorAll('${intensityPanel} .cp-intensity button')].map((b) => b.getAttribute('aria-pressed')),
      sessions: [...document.querySelectorAll('#app .cp-session')].map((el) => el.textContent),
    }))()`);
    record(
      'switching back restores the relaxed plan',
      backToRelaxed.pressed[0] === 'true' && backToRelaxed.sessions.join('|') === relaxedPlan.sessions.join('|'),
      JSON.stringify(backToRelaxed.sessions),
    );

    // Day browsing and the task-mode switch must not change the pace.
    await evaluate("[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Next day')).click()");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterBrowsing = await intensityState();
    record(
      'day browsing and the task-mode switch keep the pace',
      afterBrowsing.pressed[0] === 'true' && afterBrowsing.pressed[1] === 'false',
      JSON.stringify(afterBrowsing.pressed),
    );
    await clickButton('One-time task');
    await new Promise((resolve) => setTimeout(resolve, 250));

    // An invalid day count still blocks planning when the pace is switched.
    await setDays('0');
    await clickButton('High intensity');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const gatedIntensity = await evaluate(`(() => ({
      days: document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="number"]').value,
      error: ((document.querySelector('#app section[aria-labelledby="cp-results-heading"] .cp-error') || {}).textContent) || '',
      sessions: document.querySelectorAll('#app .cp-session').length,
      pressed: [...document.querySelectorAll('${intensityPanel} .cp-intensity button')].map((b) => b.getAttribute('aria-pressed')),
    }))()`);
    record(
      'switching the pace cannot bypass the day-count gate',
      gatedIntensity.days === '0' &&
        /1 to 30/.test(gatedIntensity.error) &&
        gatedIntensity.sessions === 0 &&
        gatedIntensity.pressed[1] === 'true',
      JSON.stringify(gatedIntensity),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterIntensityReset = await intensityState();
    record(
      'reset returns to the relaxed default',
      afterIntensityReset.pressed[0] === 'true' && afterIntensityReset.pressed[1] === 'false',
      JSON.stringify(afterIntensityReset.pressed),
    );

    // --- intensity buttons: real Enter / Space activation ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2026-10-20');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await addTightTask('Key A');
    await addTightTask('Key B');
    await addTightTask('Key C');
    await clickButton('Build plan');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const focusPaceButton = (index) =>
      evaluate(`(() => {
        const buttons = [...document.querySelectorAll('#app .cp-intensity button')];
        buttons[${index}].focus();
        return document.activeElement === buttons[${index}];
      })()`);
    const paceKeyDown = (key, code, virtualKeyCode, text) =>
      send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
        // A native button only runs its default activation when the event
        // carries text; without it the keydown reaches JS but does not click.
        text,
        unmodifiedText: text,
      });
    const paceKeyUp = (key, code, virtualKeyCode) =>
      send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
      });
    const paceState = () =>
      evaluate(`(() => ({
        pressed: [...document.querySelectorAll('#app .cp-intensity button')].map((b) => b.getAttribute('aria-pressed')),
        sessions: [...document.querySelectorAll('#app .cp-session')].map((el) => el.textContent),
        tasks: document.querySelectorAll('#app .cp-tasks__row').length,
        series: document.querySelectorAll('#app .cp-series__row').length,
      }))()`);

    const keyboardBaseline = await paceState();
    record(
      'the keyboard case starts from a relaxed plan',
      keyboardBaseline.pressed[0] === 'true' && keyboardBaseline.sessions.length >= 3,
      JSON.stringify(keyboardBaseline.pressed) + ' sessions=' + String(keyboardBaseline.sessions.length),
    );

    record('the high-intensity button can take focus', (await focusPaceButton(1)) === true, '');
    await paceKeyDown('Enter', 'Enter', 13, '\r');
    await paceKeyUp('Enter', 'Enter', 13);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterEnter = await paceState();
    record(
      'Enter switches the pace to high intensity',
      afterEnter.pressed[1] === 'true' && afterEnter.pressed[0] === 'false',
      JSON.stringify(afterEnter.pressed),
    );
    record(
      'Enter re-plans with the new pace and keeps the tasks',
      afterEnter.sessions.join('|') !== keyboardBaseline.sessions.join('|') &&
        afterEnter.sessions.length === keyboardBaseline.sessions.length &&
        afterEnter.tasks === keyboardBaseline.tasks,
      JSON.stringify({ before: keyboardBaseline.sessions, after: afterEnter.sessions }),
    );

    record('the relaxed button can take focus', (await focusPaceButton(0)) === true, '');
    const scrollBeforeSpace = await evaluate('window.scrollY');
    await paceKeyDown(' ', 'Space', 32, ' ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterSpaceDown = await paceState();
    const scrollDuringSpace = await evaluate('window.scrollY');
    record(
      'Space keydown alone does not switch the pace',
      afterSpaceDown.pressed[1] === 'true' && afterSpaceDown.pressed[0] === 'false',
      JSON.stringify(afterSpaceDown.pressed),
    );
    await paceKeyUp(' ', 'Space', 32);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterSpace = await paceState();
    const scrollAfterSpace = await evaluate('window.scrollY');
    record(
      'Space keyup switches the pace back to relaxed',
      afterSpace.pressed[0] === 'true' && afterSpace.pressed[1] === 'false',
      JSON.stringify(afterSpace.pressed),
    );
    record(
      'Space restores the relaxed plan without touching the tasks',
      afterSpace.sessions.join('|') === keyboardBaseline.sessions.join('|') &&
        afterSpace.tasks === keyboardBaseline.tasks &&
        afterSpace.series === keyboardBaseline.series,
      JSON.stringify({ before: keyboardBaseline.sessions, after: afterSpace.sessions }),
    );
    record(
      'Space does not scroll the page',
      scrollDuringSpace === scrollBeforeSpace && scrollAfterSpace === scrollBeforeSpace,
      'before=' + String(scrollBeforeSpace) + ' during=' + String(scrollDuringSpace) + ' after=' + String(scrollAfterSpace),
    );

    // A single press must produce exactly one change: no extra activation from
    // the keyup after the keydown already toggled, and no double click.
    record(
      'one press produces one pace change',
      afterSpace.pressed[0] === 'true' && afterSpace.pressed[1] === 'false',
      JSON.stringify(afterSpace.pressed),
    );

    // --- per-task locations ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2026-10-20');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const locationSelect = () =>
      evaluate(`(() => {
        const form = document.querySelector('#app form.cp-form');
        const select = [...form.querySelectorAll('select')].find((item) =>
          [...item.options].some((option) => option.value.startsWith('campus:')),
        );
        return select ? select.value : 'missing';
      })()`);
    const setLocationSelect = async (value) => {
      await evaluate([
        '(() => {',
        "  const form = document.querySelector('#app form.cp-form');",
        '  const select = [...form.querySelectorAll("select")].find((item) =>',
        '    [...item.options].some((option) => option.value.startsWith("campus:")),',
        '  );',
        '  if (!select) return "missing";',
        "  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;",
        '  setter.call(select, ' + JSON.stringify(value) + ');',
        "  select.dispatchEvent(new Event('change', { bubbles: true }));",
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
    const addOneOff = async (title, customName) => {
      await evaluate([
        '(() => {',
        "  const form = document.querySelector('#app form.cp-form');",
        "  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;",
        '  const titleInput = form.querySelector("input:not([type])");',
        '  setter.call(titleInput, ' + JSON.stringify(title) + ');',
        "  titleInput.dispatchEvent(new Event('input', { bubbles: true }));",
        '  const due = form.querySelector("input[type=\\"datetime-local\\"]");',
        "  setter.call(due, '2026-10-20T17:00');",
        "  due.dispatchEvent(new Event('input', { bubbles: true }));",
        '  const custom = form.querySelector("input[id$=\\"-location-custom\\"]");',
        '  const customName = ' + JSON.stringify(customName ?? '') + ';',
        '  if (custom && customName) {',
        '    setter.call(custom, customName);',
        "    custom.dispatchEvent(new Event('input', { bubbles: true }));",
        '  }',
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await clickButton('Add task');
      await new Promise((resolve) => setTimeout(resolve, 350));
    };
    const buildNow = async () => {
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('#app button')].find((b) => /build plan/i.test(b.textContent));
        if (!button) return 'missing';
        button.click();
        return 'ok';
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 450));
    };
    const selectSession = async (title) => {
      const result = await evaluate([
        '(() => {',
        '  const item = [...document.querySelectorAll("#app .cp-session")].find((el) =>',
        '    el.textContent.includes(' + JSON.stringify(title) + '),',
        '  );',
        '  if (!item) return "missing";',
        '  item.click();',
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      return result;
    };
    const whereName = () => evaluate(`((document.querySelector('#app .cp-location__name') || {}).textContent || '')`);
    const whereStatus = () => evaluate(`((document.querySelector('#app .cp-location__status') || {}).textContent || '')`);

    record('a new task defaults to no location', (await locationSelect()) === 'none', '');
    await addOneOff('Task without place');
    await buildNow();
    record('the no-location task can be selected', (await selectSession('Task without place')) === 'ok', '');
    record(
      'a task with no location still schedules and assumes nothing',
      (await whereName()).trim() === 'No location set' && /no default is applied/i.test(await whereStatus()),
      (await whereName()) + ' | ' + (await whereStatus()),
    );

    await setLocationSelect('campus:ohio-union');
    await addOneOff('Task at the union');
    await buildNow();
    record('the campus task can be selected', (await selectSession('Task at the union')) === 'ok', '');
    record('a campus choice is shown in Where', (await whereName()).trim() === 'Ohio Union', await whereName());

    await setLocationSelect('other');
    await addOneOff('Task at my desk', 'My desk');
    await buildNow();
    record('the custom task can be selected', (await selectSession('Task at my desk')) === 'ok', '');
    record(
      'a custom name is shown as plain task text',
      (await whereName()).trim() === 'My desk' && /not checked against campus data/i.test(await whereStatus()),
      (await whereName()) + ' | ' + (await whereStatus()),
    );

    // A series keeps its location and its occurrences inherit it.
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const form = section.querySelector('form.cp-form');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const title = form.querySelector('input:not([type])');
      setter.call(title, 'Series at Thompson');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const form = section.querySelector('form.cp-form');
      const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      const frequency = form.querySelector('select');
      setSelect.call(frequency, 'daily');
      frequency.dispatchEvent(new Event('change', { bubbles: true }));
      const location = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value.startsWith('campus:')),
      );
      setSelect.call(location, 'campus:thompson-library');
      location.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await buildNow();
    record('the series occurrence can be selected', (await selectSession('Series at Thompson')) === 'ok', '');
    record(
      'a series location is inherited by its occurrence',
      (await whereName()).trim() === 'Thompson Library',
      await whereName(),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 400));
    record('reset restores the default no-location choice', (await locationSelect()) === 'none', await locationSelect());

    // --- optional details disclosure ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const optionalState = () =>
      evaluate(`(() => {
        const toggle = document.querySelector('#app form.cp-form .cp-optional__toggle');
        const panel = document.querySelector('#app form.cp-form .cp-optional__panel');
        if (!toggle || !panel) return null;
        const custom = panel.querySelector('input[id$="-location-custom"]');
        return {
          expanded: toggle.getAttribute('aria-expanded'),
          hidden: panel.hasAttribute('hidden'),
          summary: ((document.querySelector('#app form.cp-form .cp-optional__summary') || {}).textContent) || '',
          customVisible: !!custom && !custom.closest('[hidden]'),
        };
      })()`);

    const collapsed = await optionalState();
    record(
      'optional details start collapsed with a location summary',
      collapsed.expanded === 'false' &&
        collapsed.hidden === true &&
        collapsed.summary.trim() === 'Not set' &&
        collapsed.customVisible === false,
      JSON.stringify(collapsed),
    );

    await evaluate("document.querySelector('#app form.cp-form .cp-optional__toggle').click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const expanded = await optionalState();
    record(
      'clicking optional details reveals the fields',
      expanded.expanded === 'true' && expanded.hidden === false,
      JSON.stringify(expanded),
    );

    await evaluate(`(() => {
      const form = document.querySelector('#app form.cp-form');
      const select = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value === 'campus:ohio-union'),
      );
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'campus:ohio-union');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const campusSummary = await optionalState();
    record(
      'the summary shows the chosen campus place',
      campusSummary.summary.trim() === 'Ohio Union',
      JSON.stringify(campusSummary),
    );

    await evaluate(`(() => {
      const form = document.querySelector('#app form.cp-form');
      const select = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value === 'other'),
      );
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'other');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const customState = await optionalState();
    record(
      'the custom name field appears only for Other',
      customState.customVisible === true && customState.summary.trim() === 'Not set',
      JSON.stringify(customState),
    );

    // Switching the task mode must keep the disclosure open and keep the draft.
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('One-time task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterMode = await optionalState();
    record(
      'a mode switch keeps the disclosure and the draft',
      afterMode.expanded === 'true' && afterMode.customVisible === true,
      JSON.stringify(afterMode),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterDisclosureReset = await optionalState();
    record(
      'reset collapses the disclosure and clears the location',
      afterDisclosureReset.expanded === 'false' &&
        afterDisclosureReset.hidden === true &&
        afterDisclosureReset.summary.trim() === 'Not set' &&
        afterDisclosureReset.customVisible === false,
      JSON.stringify(afterDisclosureReset),
    );

    // --- D QA: Never keeps the location ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2026-10-20');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const form = section.querySelector('form.cp-form');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      const title = form.querySelector('input:not([type])');
      setter.call(title, 'Never keeps place');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const frequency = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value === 'daily'),
      );
      setSelect.call(frequency, 'never');
      frequency.dispatchEvent(new Event('change', { bubbles: true }));
      const toggle = form.querySelector('.cp-optional__toggle');
      if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
      const location = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value === 'campus:ohio-union'),
      );
      setSelect.call(location, 'campus:ohio-union');
      location.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app button')].find((b) => /build plan/i.test(b.textContent));
      if (button) button.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('#app .cp-session')].find((el) => el.textContent.includes('Never keeps place'));
      if (item) item.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const neverWhere = await evaluate(`((document.querySelector('#app .cp-location__name') || {}).textContent || '').trim()`);
    record('Never keeps the chosen campus location', neverWhere === 'Ohio Union', neverWhere);

    // --- D QA: a submit error is visible while optional details stay collapsed ---
    await clickButton('One-time task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate("document.querySelector('#app form.cp-form .cp-optional__toggle').click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await evaluate("document.querySelector('#app form.cp-form .cp-optional__toggle').click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Add task');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const errorState = await evaluate(`(() => {
      const form = document.querySelector('#app form.cp-form');
      const error = form.querySelector('.cp-error');
      const panel = form.querySelector('.cp-optional__panel');
      const box = error ? error.getBoundingClientRect() : null;
      const toggle = form.querySelector('.cp-optional__toggle');
      return {
        text: error ? error.textContent.trim() : '',
        height: box ? box.height : 0,
        insideHiddenPanel: panel ? panel.contains(error) : false,
        expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      };
    })()`);
    record(
      'a submit error stays visible outside the collapsed details',
      errorState.text.length > 0 && errorState.height > 0 && errorState.insideHiddenPanel === false,
      JSON.stringify(errorState),
    );

    // --- D QA: a long custom name must not widen the page ---
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const form = section.querySelector('form.cp-form');
      const toggle = form.querySelector('.cp-optional__toggle');
      if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
      const select = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value === 'other'),
      );
      const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setSelect.call(select, 'other');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const form = section.querySelector('form.cp-form');
      const input = form.querySelector('input[id$="-location-custom"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'x'.repeat(120));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate("document.querySelector('#app section[aria-labelledby=\"cp-recurring-heading\"] .cp-optional__toggle').click()");
    await new Promise((resolve) => setTimeout(resolve, 250));

    // The long custom name must not widen the page and must stay readable.
    for (const width of [320, 375]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const longName = await evaluate(`(() => {
        const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
        const row = section.querySelector('.cp-optional__row');
        const toggle = section.querySelector('.cp-optional__toggle');
        const summary = section.querySelector('.cp-optional__summary');
        const panel = section.querySelector('.cp-optional__panel');
        const box = summary ? summary.getBoundingClientRect() : null;
        return {
          width: window.innerWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
          panelHidden: panel ? panel.hasAttribute('hidden') : null,
          summary: summary ? summary.textContent.trim() : '',
          title: summary ? summary.getAttribute('title') : '',
          summaryWidth: box ? Math.round(box.width) : 0,
          rowWidth: row ? Math.round(row.getBoundingClientRect().width) : 0,
        };
      })()`);
      record(
        `a 120-character place name keeps the repeating summary compact at ${width}px`,
        longName.width === width &&
          longName.clientWidth === width &&
          longName.scrollWidth === width &&
          longName.expanded === 'false' &&
          longName.panelHidden === true &&
          longName.summary === 'Custom location set' &&
          longName.title.length === 120 &&
          longName.summaryWidth > 0 &&
          longName.summaryWidth <= longName.rowWidth,
        JSON.stringify({ ...longName, title: longName.title.slice(0, 8) + '…(' + longName.title.length + ')' }),
      );
    }
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 250));

    for (const width of [320, 375]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await evaluate(`(() => {
        const pane = document.querySelector('#app .cp-task-pane');
        if (pane && pane.hasAttribute('hidden')) {
          const tab = [...document.querySelectorAll('#app .cp-modetab')].find((b) => b.textContent.includes('One-time'));
          if (tab) tab.click();
        }
        return 'ok';
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await evaluate(`(() => {
        const toggle = document.querySelector('#app form.cp-form .cp-optional__toggle');
        if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
        return 'ok';
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const narrow = await evaluate(`(() => {
        const form = document.querySelector('#app form.cp-form');
        const panel = form.querySelector('.cp-optional__panel');
        const select = form.querySelector('.cp-location-field select');
        const rows = [...form.querySelectorAll('.cp-field-row--split')];
        const row = rows[rows.length - 1];
        const fields = row ? [...row.querySelectorAll('.cp-field')] : [];
        const boxes = fields.map((field) => field.getBoundingClientRect());
        // Geometry, not CSS parsing: side by side keeps the same top row.
        const sameRow = boxes.length >= 2 && Math.abs(boxes[0].top - boxes[1].top) <= 4;
        const columns = boxes.length >= 2 ? (sameRow ? 2 : 1) : 0;
        const selectBox = select ? select.getBoundingClientRect() : null;
        return {
          expanded: form.querySelector('.cp-optional__toggle').getAttribute('aria-expanded'),
          panelVisible: !panel.hasAttribute('hidden') && panel.getBoundingClientRect().height > 0,
          selectVisible: !!selectBox && selectBox.width > 0 && selectBox.height > 0,
          innerWidth: window.innerWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          columns,
        };
      })()`);
      record(
        `the expanded layout has no horizontal overflow at ${width}px`,
        narrow.innerWidth === width &&
          narrow.clientWidth === width &&
          narrow.expanded === 'true' &&
          narrow.panelVisible &&
          narrow.selectVisible &&
          narrow.overflow <= 0 &&
          narrow.columns === 1,
        JSON.stringify(narrow),
      );
    }
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 300));

    // --- D QA: submit errors are associated with their inputs ---
    const axDescriptionOf = async (selector) => {
      const object = await send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false,
      });
      if (!object.result || !object.result.result || !object.result.result.objectId) return '';
      const tree = await send('Accessibility.getPartialAXTree', {
        objectId: object.result.result.objectId,
        fetchRelatives: false,
      });
      const node = tree.result && tree.result.nodes ? tree.result.nodes[0] : null;
      return node && node.description ? node.description.value : '';
    };
    const errorFacts = (inputSelector) =>
      evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(inputSelector)});
        if (!input) return null;
        const describedBy = input.getAttribute('aria-describedby');
        const target = describedBy ? document.getElementById(describedBy) : null;
        const box = target ? target.getBoundingClientRect() : null;
        return {
          invalid: input.getAttribute('aria-invalid'),
          describedBy,
          targetText: target ? target.textContent.trim() : '',
          targetVisible: !!box && box.height > 0,
        };
      })()`);

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await clickButton('Add task');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const oneOffTitleFacts = await errorFacts('#app form.cp-form input:not([type])');
    const oneOffTitleAx = await axDescriptionOf('#app form.cp-form input:not([type])');
    record(
      'an empty one-off title is tied to its error',
      oneOffTitleFacts.invalid === 'true' &&
        oneOffTitleFacts.describedBy &&
        oneOffTitleFacts.targetText.length > 0 &&
        oneOffTitleFacts.targetVisible &&
        oneOffTitleAx.includes(oneOffTitleFacts.targetText),
      JSON.stringify({ ...oneOffTitleFacts, ax: oneOffTitleAx }),
    );

    await evaluate(`(() => {
      const form = document.querySelector('#app form.cp-form');
      const input = form.querySelector('input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Now has a title');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const clearedTitle = await errorFacts('#app form.cp-form input:not([type])');
    record(
      'editing the title clears the error state',
      clearedTitle.invalid === 'false' && !clearedTitle.describedBy && clearedTitle.targetText === '',
      JSON.stringify(clearedTitle),
    );

    // One-off, Other with a blank name.
    await evaluate(`(() => {
      const form = document.querySelector('#app form.cp-form');
      const toggle = form.querySelector('.cp-optional__toggle');
      if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
      const select = [...form.querySelectorAll('select')].find((item) =>
        [...item.options].some((option) => option.value === 'other'),
      );
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'other');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('Add task');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const oneOffCustomFacts = await errorFacts('#app form.cp-form input[id$="-location-custom"]');
    const oneOffCustomAx = await axDescriptionOf('#app form.cp-form input[id$="-location-custom"]');
    record(
      'a blank one-off custom name is tied to its error',
      oneOffCustomFacts.invalid === 'true' &&
        oneOffCustomFacts.describedBy &&
        /name/i.test(oneOffCustomFacts.targetText) &&
        oneOffCustomFacts.targetVisible &&
        oneOffCustomAx.includes(oneOffCustomFacts.targetText),
      JSON.stringify({ ...oneOffCustomFacts, ax: oneOffCustomAx }),
    );

    // Repeating: empty title.
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const section = document.querySelector('#app section[aria-labelledby="cp-recurring-heading"]');
      const title = section.querySelector('form.cp-form input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(title, '');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await clickButton('Add repeating task');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const seriesTitleFacts = await errorFacts('#app section[aria-labelledby="cp-recurring-heading"] form.cp-form input:not([type])');
    const seriesTitleAx = await axDescriptionOf(
      '#app section[aria-labelledby="cp-recurring-heading"] form.cp-form input:not([type])',
    );
    record(
      'an empty series title is tied to its error',
      seriesTitleFacts.invalid === 'true' &&
        seriesTitleFacts.describedBy &&
        seriesTitleFacts.targetText.length > 0 &&
        seriesTitleFacts.targetVisible &&
        seriesTitleAx.includes(seriesTitleFacts.targetText),
      JSON.stringify({ ...seriesTitleFacts, ax: seriesTitleAx }),
    );

    // Repeating: Other with a blank name is covered by the pure validator
    // (tests/task-location-ui.test.ts) and by the same TaskLocationField code
    // path already asserted for the one-off form above.
    record(
      'the two forms never share an error id',
      await evaluate(`(() => {
        const ids = [...document.querySelectorAll('#app .cp-error[id]')].map((el) => el.id);
        return new Set(ids).size === ids.length;
      })()`),
      '',
    );

    // --- D QA: the repeating form clears stale error state ---
    const qaSeriesPanel = '#app section[aria-labelledby="cp-recurring-heading"]';
    const qaSeriesTitle = `${qaSeriesPanel} form.cp-form input:not([type])`;
    const qaSeriesFacts = () =>
      evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(qaSeriesTitle)});
        const error = document.querySelector('${qaSeriesPanel} form.cp-form .cp-error');
        return {
          invalid: input ? input.getAttribute('aria-invalid') : null,
          describedBy: input ? input.getAttribute('aria-describedby') : null,
          errorText: error ? error.textContent.trim() : '',
          editing: !!(document.querySelector('${qaSeriesPanel}') || {}).textContent?.includes('Save changes'),
        };
      })()`);
    const qaAddSeries = async (title) => {
      await evaluate([
        '(() => {',
        `  const section = document.querySelector('${qaSeriesPanel}');`,
        '  const form = section.querySelector("form.cp-form");',
        '  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;',
        '  const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;',
        '  const input = form.querySelector("input:not([type])");',
        '  setter.call(input, ' + JSON.stringify(title) + ');',
        "  input.dispatchEvent(new Event('input', { bubbles: true }));",
        '  const frequency = [...form.querySelectorAll("select")].find((item) =>',
        '    [...item.options].some((option) => option.value === "daily"),',
        '  );',
        '  setSelect.call(frequency, "daily");',
        "  frequency.dispatchEvent(new Event('change', { bubbles: true }));",
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await clickButton('Add repeating task');
      await new Promise((resolve) => setTimeout(resolve, 350));
    };
    const qaStartEdit = async (title) => {
      await evaluate([
        '(() => {',
        `  const section = document.querySelector('${qaSeriesPanel}');`,
        '  const row = [...section.querySelectorAll(".cp-series__row")].find((el) =>',
        '    el.textContent.includes(' + JSON.stringify(title) + '),',
        '  );',
        '  if (!row) return "missing";',
        '  const edit = [...row.querySelectorAll("button")].find((b) => b.textContent.includes("Edit"));',
        '  if (!edit) return "missing";',
        '  edit.click();',
        '  return "ok";',
        '})()',
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 250));
    };
    const qaClearTitle = async () => {
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(qaSeriesTitle)});
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
    const qaSubmitSeries = async () => {
      await evaluate(`(() => {
        const form = document.querySelector('${qaSeriesPanel} form.cp-form');
        if (!form) return 'missing';
        form.requestSubmit();
        return 'ok';
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
    };
    const qaRaiseSeriesError = async () => {
      await qaClearTitle();
      await qaSubmitSeries();
      return qaSeriesFacts();
    };

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await clickButton('Repeating task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await qaAddSeries('Alpha');
    await qaAddSeries('Beta');
    await qaAddSeries('Gamma');

    // Cancel
    await qaStartEdit('Alpha');
    const cancelRaised = await qaRaiseSeriesError();
    await evaluate(`[...document.querySelectorAll('${qaSeriesPanel} button')].find((b) => b.textContent.includes('Cancel')).click()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const qaStaleAfterCancel = await qaSeriesFacts();
    record(
      'Cancel clears the failing edit state',
      cancelRaised.invalid === 'true' && qaStaleAfterCancel.invalid !== 'true' && !qaStaleAfterCancel.describedBy && qaStaleAfterCancel.errorText === '',
      JSON.stringify({ raised: cancelRaised.invalid, after: qaStaleAfterCancel }),
    );

    // Delete the series being edited
    await qaStartEdit('Alpha');
    const deleteRaised = await qaRaiseSeriesError();
    await evaluate(`(() => {
      const section = document.querySelector('${qaSeriesPanel}');
      const row = [...section.querySelectorAll('.cp-series__row')].find((el) => el.textContent.includes('Alpha'));
      if (!row) return 'missing';
      const remove = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('Delete'));
      if (!remove) return 'missing';
      remove.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const qaStaleAfterDelete = await qaSeriesFacts();
    record(
      'deleting the edited series clears the failing state',
      deleteRaised.invalid === 'true' && qaStaleAfterDelete.invalid !== 'true' && !qaStaleAfterDelete.describedBy && qaStaleAfterDelete.errorText === '',
      JSON.stringify({ raised: deleteRaised.invalid, after: qaStaleAfterDelete }),
    );

    // Switch the edit target while an error is showing
    await qaStartEdit('Beta');
    const switchRaised = await qaRaiseSeriesError();
    await qaStartEdit('Gamma');
    const qaStaleAfterSwitch = await qaSeriesFacts();
    record(
      'switching the edit target clears the failing state',
      switchRaised.invalid === 'true' && qaStaleAfterSwitch.invalid !== 'true' && !qaStaleAfterSwitch.describedBy && qaStaleAfterSwitch.errorText === '',
      JSON.stringify({ raised: switchRaised.invalid, after: qaStaleAfterSwitch }),
    );

    // Fixing the input and submitting again
    await qaStartEdit('Beta');
    await qaRaiseSeriesError();
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(qaSeriesTitle)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Beta renamed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const fixedBeforeSubmit = await qaSeriesFacts();
    await qaSubmitSeries();
    const qaStaleAfterFix = await qaSeriesFacts();
    record(
      'fixing the input clears the association before and after saving',
      fixedBeforeSubmit.invalid !== 'true' &&
        !fixedBeforeSubmit.describedBy &&
        qaStaleAfterFix.invalid !== 'true' &&
        !qaStaleAfterFix.describedBy &&
        qaStaleAfterFix.errorText === '',
      JSON.stringify({ before: fixedBeforeSubmit, after: qaStaleAfterFix }),
    );

    // --- simplified layout ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const headerSummary = await evaluate(`(() => {
      const header = document.querySelector('#app .cp-header');
      return {
        text: header ? header.innerText : '',
        example: !!document.querySelector('#app .cp-example-tag'),
        placesListed: ['18th Avenue Library', 'Thompson Library', 'Ohio Union'].filter((name) =>
          (header ? header.innerText : '').includes(name),
        ).length,
      };
    })()`);
    record(
      'the header is one compact summary with an example tag',
      /\d{1,2}:\d{2}–\d{1,2}:\d{2} ET/.test(headerSummary.text) &&
        /·/.test(headerSummary.text) &&
        headerSummary.example === true &&
        headerSummary.placesListed === 0,
      JSON.stringify({ ...headerSummary, text: headerSummary.text.slice(0, 120) }),
    );

    const howSection = () =>
      evaluate(`(() => {
        const panel = [...document.querySelectorAll('#app .cp-optional__toggle')].find((b) =>
          (b.getAttribute('aria-label') || '').includes('how planning works'),
        );
        if (!panel) return null;
        const content = panel.closest('.cp-optional').querySelector('.cp-optional__panel');
        return {
          expanded: panel.getAttribute('aria-expanded'),
          hidden: content.hasAttribute('hidden'),
          text: content.innerText.trim(),
          label: panel.getAttribute('aria-label'),
        };
      })()`);
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const howDefault = await howSection();
    record(
      'How planning works starts collapsed after reset',
      howDefault && howDefault.expanded === 'false' && howDefault.hidden === true,
      JSON.stringify(howDefault && { expanded: howDefault.expanded, hidden: howDefault.hidden }),
    );

    await evaluate(`[...document.querySelectorAll('#app .cp-optional__toggle')].find((b) =>
      (b.getAttribute('aria-label') || '').includes('how planning works')).click()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const howOpen = await howSection();
    record(
      'How planning works opens with readable text',
      howOpen && howOpen.expanded === 'true' && howOpen.text.length > 40 && /demo data/i.test(howOpen.text),
      JSON.stringify(howOpen && { expanded: howOpen.expanded, text: howOpen.text.slice(0, 80) }),
    );

    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const howReset = await howSection();
    record(
      'reset collapses How planning works again',
      howReset && howReset.expanded === 'false' && howReset.hidden === true,
      JSON.stringify(howReset && { expanded: howReset.expanded }),
    );

    const paceText = () =>
      evaluate(`(() => {
        const panel = document.querySelector('#app section[aria-labelledby="cp-range-heading"] .cp-intensity');
        return panel ? panel.innerText : '';
      })()`);
    const relaxedText = await paceText();
    await clickButton('High intensity');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const intenseText = await paceText();
    record(
      'the pace area describes only the selected mode',
      /15-minute breaks/.test(relaxedText) &&
        !/without planned breaks/i.test(relaxedText) &&
        /without planned breaks/i.test(intenseText) &&
        !/15-minute breaks/.test(intenseText),
      JSON.stringify({ relaxedText, intenseText }),
    );

    await clickButton('Relaxed');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await clickButton('One-time task');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await evaluate(`(() => {
      const toggle = document.querySelector('#app form.cp-form .cp-optional__toggle');
      if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const disclosureLayout = await evaluate(`(() => {
      const form = document.querySelector('#app form.cp-form');
      const row = form.querySelector('.cp-optional__row');
      const toggle = row.querySelector('.cp-optional__toggle');
      const summary = row.querySelector('.cp-optional__summary');
      const panel = form.querySelector('.cp-optional__panel');
      const select = form.querySelector('.cp-location-field select');
      const buttonBox = toggle.getBoundingClientRect();
      const summaryBox = summary.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const selectBox = select ? select.getBoundingClientRect() : null;
      return {
        expanded: toggle.getAttribute('aria-expanded'),
        panelVisible: !panel.hasAttribute('hidden') && panelBox.width > 0 && panelBox.height > 0,
        selectVisible: !!selectBox && selectBox.width > 0 && selectBox.height > 0,
        buttonOutside: !summary.contains(toggle),
        buttonRight: buttonBox.left >= summaryBox.right - 1,
        buttonSize: Math.round(buttonBox.width) >= 24 && Math.round(buttonBox.height) >= 24,
        hasControls: !!toggle.getAttribute('aria-controls'),
        selectFullWidth:
          !!selectBox && Math.round(selectBox.width) >= Math.round(select.parentElement.getBoundingClientRect().width) - 1,
      };
    })()`);
    record(
      'Optional details keeps a separate expand button and a full-width location select',
      disclosureLayout.expanded === 'true' &&
        disclosureLayout.panelVisible &&
        disclosureLayout.selectVisible &&
        disclosureLayout.buttonOutside &&
        disclosureLayout.buttonRight &&
        disclosureLayout.buttonSize &&
        disclosureLayout.hasControls &&
        disclosureLayout.selectFullWidth,
      JSON.stringify(disclosureLayout),
    );

    for (const width of [320, 375]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const narrow = await evaluate(`(() => {
        const row = document.querySelector('#app form.cp-form .cp-optional__row');
        const courses = [...document.querySelectorAll('#app form.cp-form .cp-field-row--split')].pop();
        const tracks = courses ? getComputedStyle(courses).gridTemplateColumns : '';
        const columns = tracks ? tracks.replace(/\([^)]*\)/g, 'X').trim().split(/\s+/).length : 0;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          summaryWidth: Math.round(row.querySelector('.cp-optional__summary').getBoundingClientRect().width),
          columns,
        };
      })()`);
      record(
        `the page has no horizontal overflow at ${width}px`,
        narrow.overflow <= 1 && narrow.summaryWidth > 0 && narrow.columns === 1,
        JSON.stringify(narrow),
      );
    }
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 300));

    // --- D QA: the availability caveat is always visible, browsing keeps the selection ---
    await clickButton('Reset');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app button')].find((b) => /build plan/i.test(b.textContent));
      if (button) button.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 450));

    const caveat = await evaluate(`(() => {
      const note = document.querySelector('#app .cp-caveat');
      const box = note ? note.getBoundingClientRect() : null;
      const help = [...document.querySelectorAll('#app .cp-optional__toggle')].find((b) =>
        (b.getAttribute('aria-label') || '').includes('how planning works'),
      );
      return {
        text: note ? note.textContent.trim() : '',
        visible: !!box && box.height > 0 && box.width > 0,
        helpExpanded: help ? help.getAttribute('aria-expanded') : null,
        selected: document.querySelectorAll('#app .cp-session.is-selected').length,
      };
    })()`);
    for (const [width, height] of [[320, 800], [375, 812]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 350));
      // First screen means the page as loaded, so measure from the document top.
      await evaluate("document.querySelector('#app').scrollIntoView({ block: 'start' })");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const firstScreen = await evaluate(`(() => {
        const note = document.querySelector('#app .cp-caveat');
        const box = note ? note.getBoundingClientRect() : null;
        const help = [...document.querySelectorAll('#app .cp-optional__toggle')].find((b) =>
          (b.getAttribute('aria-label') || '').includes('how planning works'),
        );
        const header = document.querySelector('#app .cp-header');
        const app = document.querySelector('#app');
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          top: box ? Math.round(box.top) : null,
          bottom: box ? Math.round(box.bottom) : null,
          visible: !!box && box.height > 0 && box.width > 0,
          inFirstScreen: !!box && box.top >= 0 && box.bottom <= window.innerHeight,
          aboveMain: (() => {
            const main = document.querySelector('#app .cp-main');
            return !!(note && main && (note.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING));
          })(),
          helpExpanded: help ? help.getAttribute('aria-expanded') : null,
          selected: document.querySelectorAll('#app .cp-session.is-selected').length,
          headerVisible: !!header && header.getBoundingClientRect().height > 0,
          appOffset: app && box ? Math.round(box.top - app.getBoundingClientRect().top) : null,
          headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
          titleHeight: (() => {
            const title = document.querySelector('#app .cp-header__title');
            return title ? Math.round(title.getBoundingClientRect().height) : 0;
          })(),
          titleFont: (() => {
            const title = document.querySelector('#app .cp-header__title');
            return title ? getComputedStyle(title).fontSize : '';
          })(),
          statsTop: (() => {
            const stats = document.querySelector('#app .cp-stats');
            return stats ? Math.round(stats.getBoundingClientRect().top) : null;
          })(),
        };
      })()`);
      record(
        `the availability caveat is in the first screen at ${width}x${height}`,
        firstScreen.width === width &&
          firstScreen.height === height &&
          firstScreen.clientWidth === width &&
          firstScreen.scrollWidth === width &&
          firstScreen.visible &&
          firstScreen.inFirstScreen &&
          firstScreen.aboveMain &&
          firstScreen.appOffset !== null &&
          firstScreen.appOffset >= 0 &&
          firstScreen.appOffset < 500 &&
          firstScreen.headerVisible &&
          firstScreen.helpExpanded === 'false' &&
          firstScreen.selected === 0,
        JSON.stringify(firstScreen),
      );
    }
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 300));

    record(
      'the availability caveat stays visible while the help block is collapsed',
      caveat.visible &&
        /does not mean a place is open/i.test(caveat.text) &&
        caveat.helpExpanded === 'false' &&
        caveat.selected === 0,
      JSON.stringify(caveat),
    );

    const browseState = () =>
      evaluate(`(() => ({
        runs: document.querySelector('#app .cp-app').getAttribute('data-plan-runs'),
        nav: ((document.querySelector('#app .cp-daynav__label') || {}).textContent || '').trim(),
        where: ((document.querySelector('#app .cp-location__name') || {}).textContent || '').trim(),
        selected: document.querySelectorAll('#app .cp-session.is-selected').length,
      }))()`);

    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2026-10-19');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app button')].find((b) => /build plan/i.test(b.textContent));
      if (button) button.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    record(
      'the browse case has a plan to select from',
      (await evaluate("document.querySelectorAll('#app .cp-session').length")) > 0,
      '',
    );
    await evaluate("document.querySelectorAll('#app .cp-session')[0].click()");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const beforeBrowse = await browseState();
    await evaluate("[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Next day')).click()");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const afterBrowse = await browseState();

    record(
      'browsing another day does not re-run the planner',
      Number(afterBrowse.runs) === Number(beforeBrowse.runs),
      JSON.stringify({ before: beforeBrowse.runs, after: afterBrowse.runs }),
    );
    record(
      'browsing another day keeps the selected block and its details',
      beforeBrowse.selected === 1 &&
        afterBrowse.selected === 1 &&
        afterBrowse.where === beforeBrowse.where &&
        afterBrowse.where.length > 0 &&
        afterBrowse.nav !== beforeBrowse.nav,
      JSON.stringify({ before: beforeBrowse, after: afterBrowse }),
    );

    // --- campus map ---
    await evaluate("document.querySelector('#app .cp-map').scrollIntoView({block:'start'})");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate("!!document.querySelector('#app .leaflet-container')")) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    record('map panel renders', await evaluate("!!document.querySelector('#app .cp-map')"), '');
    record(
      'leaflet map initialises with a visible canvas',
      await evaluate(`(() => {
        const el = document.querySelector('#app .leaflet-container');
        if (!el) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })()`),
      '',
    );
    record(
      'OSM attribution is visible on the map',
      await evaluate(`(() => {
        const el = document.querySelector('#app .leaflet-control-attribution');
        return !!el && el.textContent.includes('OpenStreetMap');
      })()`),
      '',
    );
    record(
      'map lists the five verified locations',
      (await evaluate("document.querySelectorAll('#app .cp-map__item').length")) === 5,
      '',
    );
    record(
      'map draws five markers',
      (await evaluate("document.querySelectorAll('#app .cp-map__pin').length")) === 5,
      '',
    );

    await evaluate("document.querySelectorAll('#app .cp-map__item')[0].click()");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const mapText = await evaluate("document.querySelector('#app .cp-map').innerText");
    record(
      'selecting a location shows its details and official link',
      mapText.includes('approximate building point') && mapText.includes('Official location page'),
      '',
    );
    record('map makes no live-availability claim', !/available now|open now|rooms? free/i.test(mapText), '');

    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app .cp-map__filter')].find((item) =>
        item.textContent.includes('Student center'),
      );
      if (!button) return 'missing';
      button.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    record(
      'category filter removes the hidden category from the list',
      (await evaluate("document.querySelectorAll('#app .cp-map__item').length")) === 4,
      '',
    );

    // --- keyboard operation of map markers (D's blocking defect) ---
    // Restore the student-center marker so both categories are present again.
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app .cp-map__filter')].find((item) =>
        item.textContent.includes('Student center'),
      );
      if (button && button.getAttribute('aria-pressed') === 'false') button.click();
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const markerInfo = await evaluate(`(() => {
      const pins = [...document.querySelectorAll('#app .cp-map__pin')];
      return {
        total: pins.length,
        decorated: pins.filter((item) => item.getAttribute('role') === 'button').length,
        pins: pins.map((item) => ({
          label: item.getAttribute('aria-label'),
          title: item.getAttribute('title'),
          bound: item.dataset.cpKeyboardBound ?? null,
          tabindex: item.getAttribute('tabindex'),
        })),
      };
    })()`);
    record(
      'markers expose button semantics and a readable name',
      !!markerInfo &&
        markerInfo.decorated === markerInfo.total &&
        markerInfo.pins.every((pin) => /Select to show details/.test(pin.label ?? '')),
      JSON.stringify(markerInfo),
    );

    // Real Tab traversal must land on a marker.
    await evaluate(`(() => {
      const lastFilter = [...document.querySelectorAll('#app .cp-map__filter')].pop();
      if (lastFilter) lastFilter.focus();
      return document.activeElement ? document.activeElement.className : '';
    })()`);
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    let activeClass = await evaluate('String(document.activeElement && document.activeElement.className)');
    if (!activeClass.includes('cp-map__pin')) {
      // The map container itself is focusable, so one more Tab reaches a marker.
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      activeClass = await evaluate('String(document.activeElement && document.activeElement.className)');
    }
    record('Tab reaches a map marker', activeClass.includes('cp-map__pin'), activeClass);

    const detailsText = () =>
      evaluate("(document.querySelector('#app .cp-map__details') || {}).innerText || ''");
    const focusMarker = (name) =>
      evaluate(`(() => {
        const pin = [...document.querySelectorAll('#app .cp-map__pin')].find((item) =>
          (item.getAttribute('aria-label') || '').startsWith(${JSON.stringify(name)}),
        );
        if (!pin) return 'missing';
        pin.focus();
        return 'ok';
      })()`);
    const pressKey = async (key, code, vk, autoRepeat) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        autoRepeat,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
    const keyDownOnly = async (key, code, vk, autoRepeat) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        autoRepeat,
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
    };
    const keyUpOnly = async (key, code, vk) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    // Start from a different selection so activation is observable.
    await evaluate("document.querySelectorAll('#app .cp-map__item')[0].click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const beforeText = await detailsText();

    record('marker can be focused directly', (await focusMarker('Ohio Union')) === 'ok', '');
    record(
      'focused marker is the active element',
      await evaluate(`(() => {
        const pin = document.activeElement;
        return !!pin && String(pin.className).includes('cp-map__pin') && (pin.getAttribute('aria-label') || '').startsWith('Ohio Union');
      })()`),
      await evaluate('String(document.activeElement && document.activeElement.getAttribute("aria-label"))'),
    );

    // Auto-repeat Enter must not fire at all.
    await keyDownOnly('Enter', 'Enter', 13, true);
    record('auto-repeated Enter does not activate a marker', (await detailsText()) === beforeText, '');

    await pressKey('Enter', 'Enter', 13, false);
    record('Enter selects the marker and shows details', /ohio union/i.test(await detailsText()), '');

    // Space: no activation and no scrolling until keyup.
    await evaluate("document.querySelectorAll('#app .cp-map__item')[0].click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await focusMarker('Ohio Union');
    const beforeSpace = await detailsText();
    const scrollBefore = await evaluate('window.scrollY');

    await keyDownOnly(' ', 'Space', 32, false);
    record('Space keydown does not activate yet', (await detailsText()) === beforeSpace, '');
    await keyDownOnly(' ', 'Space', 32, true);
    await keyDownOnly(' ', 'Space', 32, true);
    record('held Space does not activate repeatedly', (await detailsText()) === beforeSpace, '');

    const scrollDuringHold = await evaluate('window.scrollY');
    await keyUpOnly(' ', 'Space', 32);
    record('Space keyup activates once', /ohio union/i.test(await detailsText()), '');
    record(
      'Space does not scroll the page',
      scrollDuringHold === scrollBefore && (await evaluate('window.scrollY')) === scrollBefore,
      `before=${scrollBefore} during=${scrollDuringHold} after=${await evaluate('window.scrollY')}`,
    );

    record(
      'return-to-campus-view control exists',
      await evaluate(
        "[...document.querySelectorAll('#app .cp-map__filter')].some((item) => item.textContent.includes('Return to campus view'))",
      ),
      '',
    );
    // --- product tour ---
    const waitForApp = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await evaluate("Boolean(document.querySelector('#app .cp-header'))")) return true;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return false;
    };
    await evaluate(`(() => {
      window.__cpGeom = (target, card) => {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const t = target.getBoundingClientRect();
        const visible =
          Math.min(t.right, vw) - Math.max(t.left, 0) > 0 && Math.min(t.bottom, vh) - Math.max(t.top, 0) > 0;
        let overlap = 0;
        let cardRect = null;
        if (card) {
          const c = card.getBoundingClientRect();
          cardRect = { left: Math.round(c.left), top: Math.round(c.top), right: Math.round(c.right), bottom: Math.round(c.bottom) };
          const w = Math.min(t.right, c.right) - Math.max(t.left, c.left);
          const h = Math.min(t.bottom, c.bottom) - Math.max(t.top, c.top);
          overlap = w > 0 && h > 0 ? Math.round(w * h) : 0;
        }
        return {
          visible,
          overlap,
          viewport: { vw, vh },
          rect: { left: Math.round(t.left), top: Math.round(t.top), right: Math.round(t.right), bottom: Math.round(t.bottom) },
          card: cardRect,
          scrollY: Math.round(window.scrollY),
        };
      };
      return true;
    })()`);

    const tourState = () =>
      evaluate(`(() => {
        const tour = document.querySelector('#app .cp-tour');
        if (!tour) return null;
        const card = tour.querySelector('.cp-tour__card');
        const box = card.getBoundingClientRect();
        return {
          progress: ((tour.querySelector('.cp-tour__progress') || {}).textContent || '').trim(),
          title: ((tour.querySelector('.cp-tour__title') || {}).textContent || '').trim(),
          next: ((tour.querySelector('.cp-tour__next') || {}).textContent || '').trim(),
          cardVisible: box.height > 0 && box.width > 0,
          cardTop: Math.round(box.top),
          reduced: tour.classList.contains('cp-tour--reduced'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);
    const reloadTour = async (stored) => {
      await evaluate(
        stored === null
          ? "localStorage.removeItem('campuspilot.tour.v1')"
          : `localStorage.setItem('campuspilot.tour.v1', '${stored}')`,
      );
      await send('Page.reload', {});
      await new Promise((resolve) => setTimeout(resolve, 1100));
    };
    const tourKey = async (key, code, keyCode) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
      await new Promise((resolve) => setTimeout(resolve, 450));
    };
    const advanceTour = async (times) => {
      for (let index = 0; index < times; index += 1) {
        await evaluate(`(() => {
          const next = document.querySelector('#app .cp-tour__next');
          if (next) next.click();
          return Boolean(next);
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 420));
      }
    };

    // --- mobile Where loop, isolated from every other step ---
    await reloadTour(null);
    await evaluate(`(() => {
      const date = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(date, '2026-10-19');
      date.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await evaluate("document.querySelector('[data-tour=\"build\"]').click()");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await advanceTour(5);
    await evaluate("document.querySelector('[data-tour=\"build\"]').click()");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await advanceTour(1);
    const whereLoopStart = await tourState();
    record(
      'the isolated mobile loop reaches the where step',
      whereLoopStart !== null && /8 of 11/.test(whereLoopStart.progress),
      JSON.stringify(whereLoopStart && { progress: whereLoopStart.progress }),
    );

    for (const width of [320, 375]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 1, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const viewport = await evaluate('({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth })');
      record(
        `the mobile loop really uses a ${width}px viewport`,
        viewport.innerWidth === width && viewport.clientWidth === width,
        JSON.stringify({ width, ...viewport }),
      );

      const selected = await evaluate(`(() => {
        const list = [...document.querySelectorAll('#app .cp-session')];
        const active = list.find((item) => item.classList.contains('is-selected'));
        if (active) return { clicked: false, count: list.length };
        if (list[0]) list[0].click();
        return { clicked: true, count: list.length };
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 900));
      const stillSelected = await evaluate("document.querySelectorAll('#app .cp-session.is-selected').length");
      record(
        `a real block stays selected at ${width}px`,
        selected.count > 0 && stillSelected === 1,
        JSON.stringify({ width, ...selected, stillSelected }),
      );
      const geoms = await evaluate(`(() => {
        const where = document.querySelector('#app [data-tour="where"]');
        const card = document.querySelector('#app .cp-tour__card');
        if (!where || !card) return null;
        const w = where.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return {
          scrollY: Math.round(window.scrollY),
          where: { top: Math.round(w.top), bottom: Math.round(w.bottom), height: Math.round(w.height) },
          card: { top: Math.round(c.top), bottom: Math.round(c.bottom) },
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);
      record(
        `the selected where card is on screen and clear of the tour card at ${width}px`,
        geoms !== null &&
          geoms.where.top >= 0 &&
          geoms.where.top < 812 - 40 &&
          geoms.card.top >= geoms.where.top + 80 &&
          geoms.overflow === 0,
        JSON.stringify(geoms),
      );
    }
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Back to a clean start for the remaining tour tests.
    await reloadTour(null);
    const welcome = await tourState();
    record(
      'the tour opens on the welcome step for a first visit',
      welcome !== null &&
        /1 of 11/.test(welcome.progress) &&
        welcome.title === 'Build your first study plan' &&
        welcome.cardVisible,
      JSON.stringify(welcome),
    );

    const visibility = await evaluate("({ state: document.visibilityState, hidden: document.hidden })");
    record('the test page is visible while the tour runs', visibility.state === 'visible' && visibility.hidden === false, JSON.stringify(visibility));

    const wideCard = await evaluate(`(() => {
      const card = document.querySelector('#app .cp-tour__card');
      const box = card.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        center: Math.round(box.left + box.width / 2),
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        scrollbar: window.innerWidth - document.documentElement.clientWidth,
        scrollY: Math.round(window.scrollY),
      };
    })()`);
    record(
      'the welcome card is a centred column on a wide screen',
      wideCard.width <= 400 && wideCard.width >= 300 && Math.abs(wideCard.center - wideCard.clientWidth / 2) <= 10,
      JSON.stringify(wideCard),
    );

    await tourKey('ArrowRight', 'ArrowRight', 39);
    const taskStep = await tourState();
    record(
      'the arrow keys move the tour forward',
      taskStep !== null && /2 of 11/.test(taskStep.progress) && taskStep.title === 'Start with one task',
      JSON.stringify(taskStep && { progress: taskStep.progress, title: taskStep.title }),
    );

    await tourKey('Escape', 'Escape', 27);
    const afterEscape = await evaluate("(() => ({ tour: !!document.querySelector('#app .cp-tour'), stored: localStorage.getItem('campuspilot.tour.v1') }))()");
    record(
      'Escape skips the tour and stores the dismissal',
      afterEscape.tour === false && afterEscape.stored === 'skipped',
      JSON.stringify(afterEscape),
    );

    await send('Page.reload', {});
    await new Promise((resolve) => setTimeout(resolve, 1100));
    record('a skipped tour does not reopen on refresh', (await tourState()) === null, '');

    await evaluate("(() => { const button = [...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Replay tour')); if (button) { button.focus(); button.click(); } return 'ok'; })()");
    await new Promise((resolve) => setTimeout(resolve, 450));
    const replayed = await tourState();
    record(
      'Replay tour restarts from the first step',
      replayed !== null && /1 of 11/.test(replayed.progress),
      JSON.stringify(replayed && { progress: replayed.progress }),
    );

    await tourKey('Escape', 'Escape', 27);
    const restoredFocus = await evaluate(`(() => {
      const replay = [...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Replay tour'));
      const active = document.activeElement;
      return {
        onReplay: !!replay && active === replay,
        activeTag: active ? active.tagName : null,
        activeText: active ? (active.textContent || '').trim().slice(0, 24) : '',
        replayExists: !!replay,
        scrollY: Math.round(window.scrollY),
      };
    })()`);
    record(
      'skipping returns focus to the control that opened the tour',
      restoredFocus.onReplay === true,
      JSON.stringify(restoredFocus),
    );
    await evaluate("(() => { const button = [...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Replay tour')); if (button) { button.focus(); button.click(); } return 'ok'; })()");
    await new Promise((resolve) => setTimeout(resolve, 450));

    await advanceTour(5);
    const atBuild = await tourState();
    const buildFocus = await evaluate(`(() => {
      const build = document.querySelector('[data-tour="build"]');
      return { onBuild: document.activeElement === build, tag: document.activeElement ? document.activeElement.tagName : null };
    })()`);
    record(
      'the build step hands keyboard focus to the real Build button',
      atBuild !== null && /6 of 11/.test(atBuild.progress) && buildFocus.onBuild === true,
      JSON.stringify({ progress: atBuild && atBuild.progress, buildFocus }),
    );

    // A failing validation must not count as a finished build.
    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '0');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await evaluate("document.querySelector('[data-tour=\"build\"]').click()");
    await new Promise((resolve) => setTimeout(resolve, 700));
    const afterInvalidBuild = await tourState();
    record(
      'a failed build leaves the tour on the build step',
      afterInvalidBuild !== null && /6 of 11/.test(afterInvalidBuild.progress),
      JSON.stringify(afterInvalidBuild && { progress: afterInvalidBuild.progress, title: afterInvalidBuild.title }),
    );

    // Restore a valid range, then press the real button with a real mouse click.
    await evaluate(`(() => {
      const date = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="date"]');
      const setter2 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter2.call(date, '2026-10-19');
      date.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await evaluate(`(() => {
      const input = document.querySelector('#app section[aria-labelledby="cp-range-heading"] input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const stillFocused = await evaluate(`document.activeElement === document.querySelector('[data-tour="build"]')`);
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: '\r', unmodifiedText: '\r',
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    record('the Build button keeps focus for the keyboard activation', stillFocused === true, String(stillFocused));
    const afterRealBuild = await tourState();
    const sessionsAfterBuild = await evaluate("document.querySelectorAll('#app .cp-session').length");
    record(
      'a real build is not swallowed by the tour and advances it',
      afterRealBuild !== null && /7 of 11/.test(afterRealBuild.progress) && sessionsAfterBuild > 0,
      JSON.stringify({ progress: afterRealBuild && afterRealBuild.progress, sessions: sessionsAfterBuild }),
    );

    const anchorVisible = (selector) =>
      evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const t = node.getBoundingClientRect();
        const card = document.querySelector('#app .cp-tour__card');
        const c = card ? card.getBoundingClientRect() : null;
        const w = c ? Math.min(t.right, c.right) - Math.max(t.left, c.left) : 0;
        const h = c ? Math.min(t.bottom, c.bottom) - Math.max(t.top, c.top) : 0;
        const area = w > 0 && h > 0 ? w * h : 0;
        return {
          visible: Math.min(t.right, vw) - Math.max(t.left, 0) > 0 && Math.min(t.bottom, vh) - Math.max(t.top, 0) > 0,
          overlap: area,
          overlapLog: Math.round(area * 1000) / 1000,
          viewport: { vw, vh },
          rect: { left: Math.round(t.left), top: Math.round(t.top), right: Math.round(t.right), bottom: Math.round(t.bottom) },
          scrollY: Math.round(window.scrollY),
        };
      })()`);

    await evaluate("document.querySelector('#app .cp-tour__back').click()");
    await new Promise((resolve) => setTimeout(resolve, 800));
    const afterBack = await tourState();
    record(
      'going back from the results stays on the build step',
      afterBack !== null && /6 of 11/.test(afterBack.progress),
      JSON.stringify(afterBack && { progress: afterBack.progress }),
    );

    await tourKey('ArrowRight', 'ArrowRight', 39);
    const afterBackArrow = await tourState();
    record(
      'the right arrow cannot skip the build step after going back',
      afterBackArrow !== null && /6 of 11/.test(afterBackArrow.progress),
      JSON.stringify(afterBackArrow && { progress: afterBackArrow.progress }),
    );

    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Replay tour'));
      if (button) { button.focus(); button.click(); }
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await advanceTour(5);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const replayAtBuild = await tourState();
    record(
      'replaying with an existing plan does not skip the build step',
      replayAtBuild !== null && /6 of 11/.test(replayAtBuild.progress),
      JSON.stringify(replayAtBuild && { progress: replayAtBuild.progress }),
    );

    await tourKey('ArrowRight', 'ArrowRight', 39);
    const replayArrow = await tourState();
    record(
      'the right arrow cannot skip the build step after a replay',
      replayArrow !== null && /6 of 11/.test(replayArrow.progress),
      JSON.stringify(replayArrow && { progress: replayArrow.progress }),
    );

    await evaluate("document.querySelector('[data-tour=\"build\"]').click()");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const afterRebuild = await tourState();
    record(
      'a build pressed while on the step advances to the results',
      afterRebuild !== null && /7 of 11/.test(afterRebuild.progress),
      JSON.stringify(afterRebuild && { progress: afterRebuild.progress }),
    );

    const geometryNegative = await evaluate(`(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const measure = (node, card) => {
        const t = node.getBoundingClientRect();
        const c = card ? card.getBoundingClientRect() : null;
        const w = c ? Math.min(t.right, c.right) - Math.max(t.left, c.left) : 0;
        const h = c ? Math.min(t.bottom, c.bottom) - Math.max(t.top, c.top) : 0;
        return {
          visible: Math.min(t.right, vw) - Math.max(t.left, 0) > 0 && Math.min(t.bottom, vh) - Math.max(t.top, 0) > 0,
          overlap: w > 0 && h > 0 ? Math.round(w * h) : 0,
        };
      };
      const card = document.querySelector('#app .cp-tour__card');
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-400px;top:80px;width:100px;height:100px;';
      document.body.appendChild(probe);
      const offScreen = measure(probe, null);

      const c = card.getBoundingClientRect();
      // A sub-pixel overlap built with a transform, so layout rounding cannot
      // collapse it to zero: 0.25px on each axis, a real positive intersection.
      probe.style.left = String(c.right) + 'px';
      probe.style.top = String(c.bottom) + 'px';
      probe.style.transform = 'translate(-0.25px, -0.25px)';
      const tiny = measure(probe, card);

      // Far left of the card: horizontally separated, no overlap at all.
      probe.style.left = String(c.left - 140) + 'px';
      probe.style.top = String(c.top + 10) + 'px';
      const separated = measure(probe, card);

      probe.remove();
      return {
        offVisible: offScreen.visible,
        tinyOverlap: tiny.overlap,
        separatedOverlap: separated.overlap,
      };
    })()`);
    const cardAnchor = { left: 100, top: 100, right: 300, bottom: 300 };
    const geometryCases = {
      quarterPixel: intersectionArea(cardAnchor, { left: 299.5, top: 299.5, right: 399.5, bottom: 399.5 }),
      touching: intersectionArea(cardAnchor, { left: 300, top: 100, right: 400, bottom: 200 }),
      separated: intersectionArea(cardAnchor, { left: 400, top: 100, right: 500, bottom: 200 }),
      inside: intersectionArea(cardAnchor, { left: 150, top: 150, right: 250, bottom: 250 }),
    };
    record(
      'a 0.25px² intersection counts as overlap while touching and separated cases do not',
      geometryCases.quarterPixel === 0.25 &&
        geometryCases.quarterPixel > 0 &&
        geometryCases.touching === 0 &&
        geometryCases.separated === 0 &&
        Math.abs(geometryCases.inside - 10000) < 1e-9 &&
        geometryNegative.offVisible === false &&
        geometryNegative.separatedOverlap === 0,
      JSON.stringify({ ...geometryCases, ...geometryNegative }),
    );

    await advanceTour(1);
    const whereStep = await tourState();
    const whereEmpty = await evaluate("document.querySelector('#app .cp-tour__body').textContent");
    record(
      'the where step admits the card is still empty without a selection',
      whereStep !== null && /8 of 11/.test(whereStep.progress) && /No block is selected yet/.test(whereEmpty),
      JSON.stringify({ progress: whereStep && whereStep.progress, empty: /No block is selected yet/.test(whereEmpty) }),
    );

    await evaluate("document.querySelectorAll('#app .cp-session')[0].click()");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const whereFilled = await evaluate(`(() => {
      const body = document.querySelector('#app .cp-tour__body').textContent;
      const card = document.querySelector('#app [data-tour="where"]');
      const heading = card ? card.innerText : '';
      return { body, headingHasWhere: /Where/.test(heading), headingHasRec: /Recommended study locations/.test(heading) };
    })()`);
    const recommendationCopy = await evaluate("(() => { const panel = document.querySelector('#app [data-tour=\"where\"]'); return panel ? panel.innerText : ''; })()");
    record(
      'recommendations describe a simulated block time, not live availability',
      /recommended for this simulated block time/.test(recommendationCopy) && !/listed as open/i.test(recommendationCopy),
      JSON.stringify({ text: recommendationCopy.slice(0, 80) }),
    );

    record(
      'the where step follows a real selection',
      whereFilled.headingHasWhere && whereFilled.headingHasRec && !/No block is selected yet/.test(whereFilled.body),
      JSON.stringify({ headingHasWhere: whereFilled.headingHasWhere, headingHasRec: whereFilled.headingHasRec }),
    );

    await advanceTour(1);
    const atMap = await tourState();
    const mapBox = await evaluate(`(() => {
      const map = document.querySelector('#app .cp-map-mount');
      const card = document.querySelector('#app .cp-tour__card');
      if (!map || !card) return null;
      const m = map.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return {
        viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
        target: { top: Math.round(m.top), bottom: Math.round(m.bottom) },
        card: { top: Math.round(c.top), bottom: Math.round(c.bottom) },
        overlap: Math.max(0, Math.min(m.bottom, c.bottom) - Math.max(m.top, c.top)),
        covered: Math.max(0, Math.min(m.bottom, c.bottom) - Math.max(m.top, c.top)) > 0,
        scrollY: Math.round(window.scrollY),
        visible: m.top < window.innerHeight && m.bottom > 0,
      };
    })()`);
    const mapAnchor = await anchorVisible('.cp-map-mount');
    record(
      'the map step points at the visible map',
      atMap !== null && /9 of 11/.test(atMap.progress) && mapAnchor !== null && mapAnchor.visible === true && mapAnchor.overlap === 0,
      JSON.stringify({ progress: atMap && atMap.progress, mapAnchor, mapBox }),
    );
    const markerStability = await evaluate(`(async () => {
      const pins = [...document.querySelectorAll('#app .cp-map__pin')];
      const before = pins.map((pin) => getComputedStyle(pin).transform);
      const mount = document.querySelector('#app .cp-map-mount');
      mount.classList.add('cp-tour-map');
      await new Promise((resolve) => setTimeout(resolve, 350));
      const after = pins.map((pin) => getComputedStyle(pin).transform);
      mount.classList.remove('cp-tour-map');
      return {
        count: pins.length,
        same: before.length === after.length && before.every((value, index) => value === after[index]),
        dots: document.querySelectorAll('#app .cp-map__pin-dot').length,
      };
    })()`);
    record(
      'the marker effect leaves the Leaflet pin positioning untouched',
      atMap !== null && /9 of 11/.test(atMap.progress) && markerStability.count > 0 && markerStability.same === true && markerStability.dots === markerStability.count,
      JSON.stringify({ progress: atMap && atMap.progress, ...markerStability }),
    );

    await advanceTour(1);
    const reservationStep = await tourState();
    const reservationBox = await evaluate(`(() => {
      const heading = document.querySelector('#app #cp-reservation-heading');
      const card = document.querySelector('#app .cp-tour__card');
      if (!heading || !card) return null;
      const h = heading.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return {
        viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
        target: { top: Math.round(h.top), bottom: Math.round(h.bottom) },
        card: { top: Math.round(c.top), bottom: Math.round(c.bottom) },
        overlap: Math.max(0, Math.min(h.bottom, c.bottom) - Math.max(h.top, c.top)),
        covered: Math.max(0, Math.min(h.bottom, c.bottom) - Math.max(h.top, c.top)) > 0,
        scrollY: Math.round(window.scrollY),
        visible: h.top < window.innerHeight && h.bottom > 0,
      };
    })()`);
    const reservationAnchor = await anchorVisible('#cp-reservation-heading');
    record(
      'the reservation step points at the visible planner',
      reservationStep !== null && /10 of 11/.test(reservationStep.progress) && reservationAnchor !== null && reservationAnchor.visible === true && reservationAnchor.overlap === 0,
      JSON.stringify({ progress: reservationStep && reservationStep.progress, reservationAnchor, reservationBox }),
    );

    await advanceTour(1);
    const lastStep = await tourState();
    record(
      'the tour ends on the finish step',
      lastStep !== null && /11 of 11/.test(lastStep.progress) && lastStep.next === 'Finish',
      JSON.stringify(lastStep && { progress: lastStep.progress, next: lastStep.next }),
    );
    await evaluate("document.querySelector('#app .cp-tour__next').click()");
    await new Promise((resolve) => setTimeout(resolve, 450));
    const finished = await evaluate("(() => ({ tour: !!document.querySelector('#app .cp-tour'), stored: localStorage.getItem('campuspilot.tour.v1') }))()");
    record(
      'finishing closes the tour and records completion',
      finished.tour === false && finished.stored === 'done',
      JSON.stringify(finished),
    );
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Replay tour'));
      if (button) { button.focus(); button.click(); }
      return 'ok';
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 260));
    const replayWipe = await evaluate(`(() => ({
      wipes: document.querySelectorAll('#app .cp-tour__wipe').length,
      progress: ((document.querySelector('#app .cp-tour__progress') || {}).textContent || '').trim(),
    }))()`);
    record(
      'replaying the tour does not replay the chapter wipe',
      replayWipe.wipes === 0 && /1 of 11/.test(replayWipe.progress),
      JSON.stringify(replayWipe),
    );
    await tourKey('Escape', 'Escape', 27);

    await send('Page.reload', {});
    await new Promise((resolve) => setTimeout(resolve, 1100));
    record('a finished tour does not reopen on refresh', (await tourState()) === null, '');

    // Arrow keys inside a field move the caret instead of the tour.
    await evaluate("(() => { const button = [...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Replay tour')); if (button) { button.focus(); button.click(); } return 'ok'; })()");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await advanceTour(1);
    const arrowProbe = await evaluate(`(async () => {
      const input = document.querySelector('#app form.cp-form input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'abc');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.setSelectionRange(2, 2);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { before: input.selectionStart };
    })()`);
    await tourKey('ArrowLeft', 'ArrowLeft', 37);
    const arrowAfter = await evaluate(`(() => {
      const input = document.querySelector('#app form.cp-form input:not([type])');
      const tour = document.querySelector('#app .cp-tour');
      return {
        caret: input.selectionStart,
        progress: tour ? ((tour.querySelector('.cp-tour__progress') || {}).textContent || '').trim() : '',
        focused: document.activeElement === input,
      };
    })()`);
    record(
      'arrow keys in a field move the caret, not the tour',
      arrowAfter.focused === true && arrowAfter.caret === arrowProbe.before - 1 && /2 of 11/.test(arrowAfter.progress),
      JSON.stringify({ ...arrowAfter, before: arrowProbe.before }),
    );

    // Narrow screens: the docked card must not cover the highlighted control.
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await advanceTour(1);
    const narrowCover = await evaluate(`(() => {
      const tabs = document.querySelector('#app .cp-modetabs');
      const card = document.querySelector('#app .cp-tour__card');
      if (!tabs || !card) return null;
      const t = tabs.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const overlap = Math.min(t.bottom, c.bottom) - Math.max(t.top, c.top);
      return {
        progress: ((document.querySelector('#app .cp-tour__progress') || {}).textContent || '').trim(),
        tabsTop: Math.round(t.top),
        cardTop: Math.round(c.top),
        covered: overlap > t.height * 0.5,
      };
    })()`);
    record(
      'the narrow card does not cover the repeating tabs',
      narrowCover !== null && /3 of 11/.test(narrowCover.progress) && narrowCover.covered === false,
      JSON.stringify(narrowCover),
    );
    await send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Reduced motion keeps every step but drops the movement.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await reloadTour(null);
    const reducedState = await tourState();
    const maskStyle = await evaluate(`(() => {
      const mask = document.querySelector('#app .cp-tour__mask');
      if (!mask) return null;
      const style = getComputedStyle(mask);
      return { animationName: style.animationName, background: style.backgroundColor };
    })()`);
    record(
      'reduced motion disables the mask fade',
      maskStyle !== null && maskStyle.animationName === 'none',
      JSON.stringify(maskStyle),
    );
    record(
      'reduced motion keeps the tour and marks it as still',
      reducedState !== null && reducedState.reduced === true && /1 of 11/.test(reducedState.progress),
      JSON.stringify(reducedState && { reduced: reducedState.reduced, progress: reducedState.progress }),
    );

    // Reduced motion must still bring the focused panel into view.
    await evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await advanceTour(3);
    const reducedTarget = await evaluate(`(() => {
      const panel = document.querySelector('#app section[aria-labelledby="cp-range-heading"]');
      if (!panel) return null;
      const box = panel.getBoundingClientRect();
      return { top: Math.round(box.top), visible: box.top < window.innerHeight && box.bottom > 0 };
    })()`);
    const reducedStep = await tourState();
    record(
      'reduced motion still scrolls the target into view',
      reducedTarget !== null && reducedTarget.visible === true && /4 of 11/.test(reducedStep.progress),
      JSON.stringify({ ...reducedTarget, progress: reducedStep && reducedStep.progress }),
    );

    for (const width of [320, 375]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const narrowTour = await tourState();
      record(
        `the tour card fits a ${width}px viewport without overflow`,
        narrowTour !== null && narrowTour.cardVisible && narrowTour.overflow === 0,
        JSON.stringify(narrowTour && { width, overflow: narrowTour.overflow, cardTop: narrowTour.cardTop }),
      );
    }
    await send('Emulation.clearDeviceMetricsOverride', {});
    await send('Emulation.setEmulatedMedia', { features: [] });
    await new Promise((resolve) => setTimeout(resolve, 300));

  } finally {
    if (socket) socket.close();
    chrome.kill();
    // Chrome keeps profile files locked for a moment after exiting.
    await Promise.race([once(chrome, 'exit'), new Promise((resolve) => setTimeout(resolve, 4000))]);
    await new Promise((resolve) => server.close(resolve));
    for (const dir of [profile, OUT_DIR]) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        /* a locked temp file must not fail the run */
      }
    }
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\nSUMMARY ${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
