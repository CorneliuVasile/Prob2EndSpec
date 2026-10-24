# Questly — Habit quest tracker (Task 2)

This repository contains a Fastify + TypeScript API using persisted SQLite storage and a responsive Next.js interface. The API replays 68 legacy requests with matching responses on the original recording; this was independently confirmed on a Windows development machine. The frontend has been opened and navigated in the browser on the development machine.

## Prerequisites

Node.js 22+ (Node.js 24 works with updated `better-sqlite3`) and npm. On Windows PowerShell, use `npm.cmd` rather than `npm` if PowerShell script execution is restricted.

## Run locally — without Docker (recommended if WSL/virtualization is unavailable)

On a clean machine with Node.js 24 and npm, open a terminal **in this repository root** (the folder containing `package.json`, `api/`, `web/`). On Windows PowerShell use `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run setup
npm.cmd run verify
npm.cmd run dev
```

`npm.cmd run setup` installs both API and UI dependencies; `npm.cmd run verify` checks TypeScript for both and runs the **68-request recording replay plus additional edge tests**. Finally `npm.cmd run dev` starts **both services with one command** and keeps running until you press Ctrl+C. UI: **http://localhost:3000**; API: **http://localhost:3001/me**.

Run `npm.cmd run setup` only on first setup or after changing dependencies. The database lives under `api/data/habits.sqlite` and persists across restarts (do not delete it if you want to keep data). Stop any older standalone servers using ports 3000/3001 before starting the combined command.

The commands above are *provided but have not been run in a clean Windows environment for this exact ZIP*; the recipient should verify installation and the additional tests locally. If `better-sqlite3` needs a native build on Windows, supported C++ build tools and Windows SDK may be necessary.

## UI

Create one-time or daily quests, complete them, undo any completion from Recent activity, and see server-backed level, XP progress, and streak. A request in progress disables competing actions; after success, data is refetched from the API. Level-up feedback is displayed only when the server reports a higher level. If a request fails, the UI shows an error and reloads state; it does **not** award XP optimistically before server confirmation.

## Recording rules (JSONL line numbers 1–68)

- +2 XP day-one bonus, +2 more for each consecutive completion day, capped at +14/day: lines 9, 14, 16, 20–24, 27, 31.
- One streak bonus per active day even with multiple completions: lines 14–15, 17–18, 35–36, 65–66.
- Late one-off completion gets `floor(base_xp / 2)`: lines 17, 25.
- Level 1→2 costs 100 XP; next transitions cost 200, 300, etc.: lines 1, 17, 31.
- Streak remains visible on the day following last completion, then expires: lines 32–35.
- Undo removes the completion and recalculates bonuses and streak history: lines 42–46.
- New completions use timezone at completion; earlier recorded local days remain unchanged: lines 51–54 and 59–60.
- Duplicate completion returns 200 with same completion and no new XP: lines 9–10, 47–48, 51–52.
- Quest and completion listings are newest-first: lines 12, 37, 68.

## Tests and gaps

`cd api && npm.cmd test` replays all 68 recorded HTTP interactions using a fresh SQLite database and mapped IDs. `npm.cmd run typecheck` checks TypeScript. Re-run these after any API changes.

Known limitations: extra hidden edge cases beyond the recording have not been exhaustively tested. Extra edge-case tests exist but must be run locally; Docker Compose has not been executed in the packaging environment. No authentication, multiuser, or deployment features are included, per spec.

Where the recording is silent, the UI uses a single page, uses server-acknowledged mutations rather than speculative XP, and shows at most seven recent completions. UI design choices are not claimed as legacy behaviors.

**AI:** AI assisted with reverse engineering, code drafting, UI design, and documentation; API behavior was checked against the original recording and source code must still be tested manually in a browser.

## Docker Compose (new)

From the repository root, with Docker Desktop running:

```sh
docker compose up --build
```

The UI is served at **http://localhost:3000** and Fastify at **http://localhost:3001**. The SQLite database is stored in a named Docker volume (`questly_data`) and survives `docker compose down` and subsequent `up`. **Do not use `docker compose down -v`** unless you intend to delete saved data. If ports 3000/3001 are occupied by local `npm run dev` processes, stop those processes before starting Compose. If frontend API requests fail when opening the website from a remote computer, change the `NEXT_PUBLIC_API_URL` build argument to the browser-reachable API address and rebuild.

The Docker images use Node 24 and install compiler dependencies needed by `better-sqlite3` when a precompiled binary is not available. The API image runs TypeScript checking and recording replay at build time. The UI image builds Next.js during image build.

## Additional behavioral test (new)

```sh
cd api
npm install
npm run test:all
```

In addition to the original 68-event replay, `test:edge` covers duplicate same-day completion requests, a file-backed SQLite restart, Undo and re-completion, and invalid timezone validation. The extended tests are included but **have not been executed successfully in the packaging environment** (package installation was not available); run them on a development machine and review any failures. Docker Compose could not be executed in the packaging environment because Docker is not installed there.

## Delivery notes

The initial reference replay passed 68/68 and the API TypeScript check passed on a Windows machine (per local test results). Browser navigation and dashboard rendering were checked manually. The added Docker build, startup behavior, and new edge tests still need confirmation on the recipient machine. Known gaps: concurrent writes across multiple API processes are not designed for horizontal scaling; error-message text is not specified by the reference; a prior npm installation reported moderate/high dependency advisories, which must be checked using `npm audit` and resolved with compatible upgrades before production use. No authentication or deployment was added, in line with the task.
