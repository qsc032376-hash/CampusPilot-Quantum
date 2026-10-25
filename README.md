# CampusPilot

One React + Vite + TypeScript web app for an Ohio State University hackathon. No database, API keys, external AI API, routing library, or backend. Data is in memory and resets on reload.

## Prerequisites

Use Node.js **24.x** with its bundled npm on all four development machines. This project uses Node's built-in TypeScript support for tests. `.nvmrc` specifies major version 24 for developers using nvm.

### Windows (PowerShell)

1. Install Node.js 24.x using the Windows installer from https://nodejs.org/en/download if needed. Include npm and the PATH option.
2. Close and reopen your terminal, then verify:

```powershell
node --version
npm --version
cd C:\Users\18658\Desktop\CampusPilot
npm ci
npm run dev
```

Use your own checkout path on teammates' machines. If PowerShell blocks `npm.ps1`, use `npm.cmd ci` and `npm.cmd run dev` (and `npm.cmd` for the commands below); changing system execution policy is unnecessary.

### macOS (Terminal)

1. Install Node.js 24.x using the macOS installer from https://nodejs.org/en/download. If you already use nvm, run `nvm install` and `nvm use` in this folder.
2. Open a new terminal and run:

```sh
node --version
npm --version
cd /path/to/CampusPilot
npm ci
npm run dev
```

Open the Local URL printed by Vite, usually http://127.0.0.1:5173. If that port is busy, Vite prints the next available port. Stop the server with Ctrl+C.

## Run and test

```sh
npm test
node --test tests/scheduler.test.ts tests/ui-format.test.ts tests/campus-locations.test.ts
node tests/render-check.mjs
node tests/browser-check.mjs
npm run build
npm run preview
```

`npm test` runs scheduler tests with Node's built-in test runner and no extra test dependency. `npm run build` checks application TypeScript and creates `dist/`. `npm run preview` serves that production build, usually at http://127.0.0.1:4173.

Manual smoke test:

1. Start `npm run dev` and open its URL.
2. The schedule range defaults to **7 consecutive days starting tomorrow in New York**, with daily study hours 09:00–17:00. Switch between **Single day** and **7 consecutive days**, change the start date or the daily hours.
3. Click **Build plan**. Results are grouped by day; each day lists its own sessions, and a day with nothing placed says "No study blocks planned for this day."
4. Use the day tabs (or the per-day rows in the result panel) to view one day's timeline at a time. Switching the viewed day does not re-run the planner; changing the range or the task list does.
5. Add or remove a task: an already-built plan is regenerated. **Reset** clears the range, viewed day, form draft, errors, plan and selection.
6. The running page now generates **labelled example data relative to the current New York date**, so the default seven-day range always contains example sessions. Every generated class, commitment and task title starts with “Example · ”, and these events are demo data: they are not real courses, opening hours or room availability. The fixed 2026-10-19 fixture in `src/sample.ts` is kept for regression tests and is no longer what the page displays. Only commitments dated inside the shown window are drawn, so a day without listed commitments is never described as a day without classes.
7. Conflict highlighting, priority and course-code tagging behave as before. Check a narrow browser window and keyboard navigation.

## Shared contracts and implementation

- `src/types.ts`: ClassEvent, StudyTask, UnavailablePeriod, StudyBlock, CampusLocation, ScheduleRequest, ScheduleResponse, ScheduleConflict.
- `src/scheduler.ts`: pure `generateMockSchedule(request)` function.
- `src/sample.ts`: fixed demonstration request.
- `src/main.tsx`: sample page and result display.
- `tests/scheduler.test.ts`: repeatability, conflict, deadline, capacity and validation checks.

Timestamps must be ISO 8601 with an explicit offset or Z. Output timestamps use UTC; the UI always displays America/New_York, independent of the developer's computer timezone. Durations are positive integer minutes. Task IDs must be unique. IDs across classes, unavailable periods and returned study blocks must also be unique so conflict references are unambiguous. Generated study block IDs remain `study-${task.id}`; avoid using those IDs for other events. Duplicate event IDs throw an Error.

The mock processes tasks by earliest deadline, then task ID, and places each entire task into its earliest free gap inside one supplied window. Classes, unavailable periods and previously placed study blocks block time. Adjacent intervals may touch. The first supplied location is used; its hours and availability are not verified. Tasks that cannot fit are reported with reasons. It does not split tasks, optimize globally, add travel buffers, or infer overnight availability. Supply a suitable daytime window and unavailable periods. Invalid input throws an Error.

## Optional UI contract (A1)

- `CampusLocation`: optional `building?: string`, `room?: string`, `hours?: string`. These are display metadata, not an availability check. Supply only sourced values; label simulated hours explicitly. This change supplies no invented rooms or hours. C's existing `toScheduleLocations()` still returns only id/name; richer location data needs deliberate UI integration.
- `StudyTask`: optional `priority?: 'low' | 'medium' | 'high'` and `courseCode?: string`. Neither affects earliest-deadline/ID ordering. Optional fields are not UI capability flags; B should provide optional controls with an empty value rather than infer support from whether sample tasks contain them.
- `ScheduleResponse.conflicts?: ScheduleConflict[]`: **omitted entirely** when empty (A1), including in JSON. Consumers use `response.conflicts ?? []`. Omission means no detected conflict for responses from this scheduler; older producers may not implement detection.
- Each conflict has `firstId`, `secondId`, `overlapMinutes`. Resolve IDs against classes, unavailable periods and returned blocks, not task IDs. Each unordered pair appears once, with IDs and pairs sorted lexically, independent of input order.
- Scan runs after placement and does not reschedule anything. Only positive overlap inside `[windowStart, windowEnd)` counts. Boundary-touching and wholly outside overlaps are excluded. Minutes use actual timestamps (including DST), may be fractional and are not rounded. Original event intervals are not mutated.
- Unscheduled tasks remain separate: a task that cannot fit is not itself a conflicting event. Successfully placed blocks cannot overlap existing busy time under the current algorithm.

B's UI work should start from updated main **after this foundation PR merges**, on `feature/ui-contracts`. It should consume the shared conflicts rather than duplicate detection. This PR does not change UI files.

The browser test currently locates Chrome/Edge on Windows and uses ports 4180/9223. macOS browser verification remains a separate D task. GitHub having no Checks is not a successful CI run.

## Team workflow

Share this single repository. Commit source files and `package-lock.json`; do not share `node_modules` or `dist`. Each teammate runs `npm ci` on their own operating system. Use `npm install` only when intentionally changing dependencies, and commit the updated lockfile. Run tests and build before merging changes.

## AI assistant

The assistant is a Vercel Node Function at `api/assistant.ts`, called by the browser as `POST /api/assistant`. It turns a plain description into structured task drafts; the planner itself is unchanged, and nothing is added until the user confirms the preview.

### Server environment

Set these in the Vercel project (Project Settings → Environment Variables). They are read only by the function:

| Variable | Purpose |
| --- | --- |
| `AI_API_KEY` | Model key. Server only — never prefix it with `VITE_`, which would inline it into the browser bundle. |
| `AI_BASE_URL` | OpenAI-compatible base URL, e.g. `https://api.openai.com/v1` or `https://api.deepseek.com/v1`. |
| `AI_MODEL` | Model name, e.g. `gpt-4o-mini` or `deepseek-chat`. |

When any of the three is missing the function answers `503 {"error":"unconfigured"}` and the panel shows `AI 助手尚未配置 / The AI assistant is not configured on this deployment` instead of inventing a reply.

### Running locally

`npm run dev` only serves the static app, so `/api/assistant` is not available there and the panel reports an unreachable assistant. To exercise the function locally, use the Vercel CLI:

```sh
npm i -g vercel
vercel dev
```

`vercel dev` serves the Vite app and the `api/` function on the same origin. No `vercel.json` or Vite proxy is required: Vercel detects `api/*.ts` automatically, and the function is only reachable through that deployment.

### Privacy

The chat text and the current schedule context are sent to the configured AI service for the duration of the request. Nothing is stored: the function keeps no logs of message content, and the browser keeps no transcript beyond the open panel.

### Rate limiting (not configured)

`api/assistant.ts` caps the body size (16 KB, 12 messages, 2000 characters each), the upstream timeout (20 s) and the reply length (600 tokens). It has **no per-user or per-IP rate limit**, so a public URL can be called repeatedly and bill every model request. A process-memory counter is not a fix on serverless hosts: instances are recycled and requests are spread across them.

Minimum options, all outside this repository:

- Vercel Firewall / WAF rate limiting on the `/api/assistant` route (plan-dependent).
- Vercel KV or Upstash Redis with a token-bucket check inside the function (`KV_REST_API_URL` + `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).
- A Cloudflare Worker or API gateway in front of the function with per-IP limits.

Until one of those exists, treat the endpoint as unbounded: keep the deployment private, or add the platform limit before sharing the URL.
