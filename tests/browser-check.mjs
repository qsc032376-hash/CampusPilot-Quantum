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

function Fixture() {
  const [selected, setSelected] = useState(null);
  return (
    <>
      <div className="cp-app" id="layout">
        <WeeklySchedule request={request} result={result} selectedId={selected} onSelect={setSelected} />
        <p id="selected">{selected ?? 'none'}</p>
      </div>
      <div id="app">
        <Dashboard request={sampleRequest} />
      </div>
    </>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"></head>
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
      if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text ?? 'eval failed');
      return reply.result?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');

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

    // Shared contract integration, rendered by the real Dashboard.
    await evaluate("document.querySelector('#app .cp-schedule').scrollIntoView({block:'start'})");
    await evaluate(
      "[...document.querySelectorAll('#app button')].find((b) => b.textContent.includes('Build my day')).click()",
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
      'task form exposes optional priority and course code',
      appText.includes('Priority (optional)') && appText.includes('Course code (optional)'),
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
