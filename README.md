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
npm run build
npm run preview
```

`npm test` runs scheduler tests with Node's built-in test runner and no extra test dependency. `npm run build` checks application TypeScript and creates `dist/`. `npm run preview` serves that production build, usually at http://127.0.0.1:4173.

Manual smoke test:

1. Start `npm run dev` and open its URL.
2. Click **Generate sample schedule**.
3. Expect three sessions on October 19, 2026, in Columbus time: calculus at 9:00 AM, writing at 11:00 AM, and CSE at 3:00 PM. Extended reading should appear under **Needs another time**.
4. Click again: the output should be identical. Reload: the initial empty state returns.
5. Check a narrow browser window: the two panels stack vertically. Tab to the button and activate it with Enter.

## Shared contracts and implementation

- `src/types.ts`: ClassEvent, StudyTask, UnavailablePeriod, StudyBlock, CampusLocation, ScheduleRequest, ScheduleResponse.
- `src/scheduler.ts`: pure `generateMockSchedule(request)` function.
- `src/sample.ts`: fixed demonstration request.
- `src/main.tsx`: sample page and result display.
- `tests/scheduler.test.ts`: repeatability, conflict, deadline, capacity and validation checks.

Timestamps must be ISO 8601 with an explicit offset or Z. Output timestamps use UTC; the UI always displays America/New_York, independent of the developer's computer timezone. Durations are positive integer minutes. Task IDs must be unique.

The mock processes tasks by earliest deadline, then task ID, and places each entire task into its earliest free gap inside one supplied window. Classes, unavailable periods and previously placed study blocks block time. Adjacent intervals may touch. The first supplied location is used; its hours and availability are not verified. Tasks that cannot fit are reported with reasons. It does not split tasks, optimize globally, add travel buffers, or infer overnight availability. Supply a suitable daytime window and unavailable periods. Invalid input throws an Error.

## Team workflow

Share this single repository. Commit source files and `package-lock.json`; do not share `node_modules` or `dist`. Each teammate runs `npm ci` on their own operating system. Use `npm install` only when intentionally changing dependencies, and commit the updated lockfile. Run tests and build before merging changes.
