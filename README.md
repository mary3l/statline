# STATLINE

<img width="680" height="627" alt="image" src="https://github.com/user-attachments/assets/2abc1cf6-4858-4204-9970-bcc43f1c8e28" />
<img width="1889" height="931" alt="image" src="https://github.com/user-attachments/assets/ee972837-72c1-42f8-8bd8-1dfa7b622a47" />
<img width="1898" height="795" alt="image" src="https://github.com/user-attachments/assets/a3fbb6b5-7126-4a55-9b50-419cbfd77249" />




FIBA basketball league office and courtside scorer: player registry and profiles, live game recording, box scores, standings, leaders, lineups and season matchups, and the league office set-up (schedule, teams, rosters, leagues, seasons).
This is the first real build of the [prototype](../../../Downloads/STATLINE-handoff/README.md). All three recorders (Fast, Classic, Phone) are built **without voice input**: the Fast and Phone recorders take typed commands instead, and the Phone recorder still reads entries aloud and vibrates.

```
statline/
├── backend/    Fastify + TypeScript API, Drizzle ORM, PostgreSQL
└── frontend/   React + Vite + TypeScript, MUI, TanStack Query
```

## Run it locally

Needs Node 20.12 or newer. No database install is needed for development: the API uses an embedded Postgres (PGlite) stored in `backend/.data/` unless `DATABASE_URL` is set.

```bash
cd backend
npm install
cp .env.example .env        # then fill in JWT_SECRET and SEED_ADMIN_PASSWORD
npm run db:seed             # demo leagues, players and simulated games
npm run dev                 # API on http://127.0.0.1:3001, restarts when src/ changes (or type rs + Enter)
```

```bash
cd frontend
npm install
npm run dev                 # app on http://localhost:5173 (proxies /api to :3001)
```

### Test accounts

| Email | Role | Password (in `backend/.env`) | Can |
|---|---|---|---|
| `admin@statline.test` | admin | `SEED_ADMIN_PASSWORD` | everything |
| `organizer@statline.test` | organizer | `SEED_DEMO_PASSWORD` | everything in the league office: players and status, photos and birth certificates, schedule, teams, rosters, leagues, seasons; record, reopen or reset games |
| `scorer@statline.test` | scorer | `SEED_DEMO_PASSWORD` | view players and profiles, record games |

`npm run db:accounts` creates or resets these logins without touching other data (stop the API first).
The organizer and scorer accounts are development-only: they are skipped when `SEED_DEMO_PASSWORD` is empty or `NODE_ENV=production`.

Box scores and standings are public; the registry and profiles need a login because they hold minors' birthdates.

### The embedded database (PGlite)

- **One process at a time.** Run only one `npm run dev` for the backend, and **stop the API before** `npm run db:seed`, `db:reset` or `db:accounts`. Two processes on one folder corrupt it. A lock file (`backend/.data/pglite.lock`) guards this: a second process waits a few seconds, then refuses to start and names the process holding the database. A lock left by a process that is gone, or not refreshed for 30 s, is taken over automatically.
- **Stopping or killing the API is safe.** Ctrl+C, a restart, closing the terminal, even `Stop-Process -Force` while a game is being recorded: the next start recovers on its own. Repeated kill tests found no damage.
- **`npm run dev` restarts cleanly.** The dev runner (`backend/src/dev.ts`) asks the API to close the database before each restart. If `npm` is force-killed, the runner and the API stop too, instead of lingering in the background with port 3001 and the database still open.
- **A crash or power cut can lose data.** PGlite doesn't flush writes to disk itself, so if Windows crashes or the power goes out, recent writes can be lost or the database damaged. Back up `backend/.data/` (with the API stopped), or use Postgres for data you'd mind losing.

### Using Postgres instead

For a real league's data, run a local Postgres and point the API at it. Nothing else changes: migrations run on start as usual.

```bash
docker run -d --name statline-pg -p 5432:5432 -e POSTGRES_USER=statline -e POSTGRES_PASSWORD=password postgres:17
```

Then set `DATABASE_URL=postgres://statline:password@localhost:5432/statline` in `backend/.env`, run `npm run db:seed` once, and start the API with `npm run dev`. Remove the line to go back to PGlite.

## What's built

| Module (from the plan) | Status |
|---|---|
| M0 Platform | Two apps, typed end to end, migrations run on API start |
| M1 Accounts & roles | Login (httpOnly cookie, 7-day JWT), roles admin / organizer / scorer, login rate limit |
| M2 Leagues, seasons, teams, schedule | **League office** (`/admin`, organizers and admins): schedule games (Davao time, double-booking warning), edit, delete or record a forfeit (20–0); add/edit teams; sign players to a roster with a jersey (age/gender eligibility and jersey clash checked) or release them; add/edit leagues and their rules; add seasons and pick the current one |
| M3 Player registry | Search, filters, paging, summary tiles, register form with age group from birthdate, duplicate check, jersey clash check, league eligibility check |
| M4 Player profile | Linked from every row; eligibility, physical profile, awards, availability history, career and recent games from box scores; organizers can change status. **Photo** upload (shrunk in the browser, visible to signed-in users) and **birth certificate** upload (PDF/image, organizers and admins only) with *Mark verified*; a new document clears the verification |
| M6 Event engine | `backend/src/engine`: event schema v1, box score, PIR, minutes, +/-, shot zones, standings with FIBA head-to-head tie-break, age groups, live state (team fouls, penalty, timeouts, who is on court, free throws due). Unit tested |
| M7 Lineup & game start | Who dressed and the five starters per team (suspended players blocked), then the game goes live. Lineup can change until the first play |
| M8 Fast recorder | `/games/:id/record`: 2PT/3PT zone lock on the court, made/missed, shooter, then assist or rebound follow-ups (one *Rebound* everywhere: by the team that missed = offensive, by the other team = defensive, shot clock 14/24 to match); foul kind → foul drawn → free throws one by one (penalty from the 5th team foul); steal → who lost it, turnover → who stole it (or *No steal* for travels, bad passes, out of bounds); subs; timeouts per half; 5th-foul banner; tap any play-by-play line to fix or delete it. No voice/typed commands |
| M9 Classic scorer | Same screen, other mode, now game-driven: tap a player on court, then what happened, then answer the question it asks by tapping a lit roster row — assist after a make, rebound after a miss (any player; off./def. set for you), foul kind → who was fouled → each free throw, steal ↔ turnover, and a substitute after a 5th foul. Bench players can only be subbed in (tap one, then who goes out); the selection clears after every entry; a wrong tap says what to tap instead. Live line of the selected / last player, team fouls, Undo, timeouts |
| Typed commands | In the Fast recorder (and the Phone recorder): jersey first, then the play — “7 three made”, “21 two missed”, “12 defensive rebound” (or just “12 rebound”: decided from who missed), “5 foul”, “5 shooting foul 3”, “2 steal”, “2 steal 7” (both the steal and #7’s turnover), “7 turnover 2” (stolen by #2), “24 in 5 out”, “timeout home”, “home 7 two made” when both teams wear #7, “undo”, “score”, “next quarter”. Parser in `backend/src/engine/commands.ts` (unit tested) |
| Phone recorder (eyes-free) | Third mode, default on phone-sized screens: one gesture pad (swipe → yes/made/confirm/personal/home, ← no/missed/skip/cancel/away, ↓ undo, ↑ clock, double tap reads the score, hold opens the keyboard), typed commands and answers, tap-able jersey and answer chips, the same follow-up questions as the tablet (assist, rebound, foul kind → who was fouled → free throws, steal → who lost it, which team?, substitute after a 5th foul), every entry read aloud (speech synthesis) and confirmed by vibration codes, and a built-in guide. Conversation logic in `backend/src/engine/phoneFlow.ts` (unit tested). No microphone |
| M10 Game clock | Game clock and 24/14 shot clock on the device (resets per FIBA), set by hand to match the arena clock, period tabs (Q1–Q4, OT), period start/end recorded, stops at 0:00 |
| M11 Live sync | Every play is saved as it happens; an outbox on the device keeps plays through Wi-Fi drops and resends them safely. The box score is **pushed** to viewers (server-sent events, `GET /api/games/:id/stream`) as each play is recorded, with 30 s polling as a fallback; End game makes it final for standings and leaders. Late arrivals can be added to a live game; the lineup can change (or an organizer can cancel the start) until the first real play |
| M14 Lineups & season matchup | **Lineups** (`/lineups`): every five-player unit of a team with +/-, minutes together, points for/against and games, filter by player and minutes, several sorts. **Season matchup** (`/matchup`): two teams' head-to-head record and comparison bars (FGM-A, 3PM-A, FTM-A, points, rebounds, fouls, steals, turnovers, blocks, assists, PIR), totals or per game, with links to each meeting. Both linked from every box score |
| M12 Box score | Built from each game's event list: line score (incl. OT), team comparison, real shot chart, full box with MIN and +/- |
| M13 Leaders & standings | Per league and season; 2/1/0 points (forfeit loss = 0); leaders need half the team's games |

Not built: voice input (left out on purpose). M5 is not described anywhere in this repo or the prototype handoff.

### Recording a game

1. Sign in, open **Live scorer** (or a game's box score) and pick a scheduled game.
2. Tick who dressed and tap **Start** on each team's five starters, then **Start game**.
3. Press **Start** on the clock at tip-off and record each play (Fast or Classic mode, switch any time).
4. **End game** when it's over (not allowed on a tie). An organizer can **Reopen** a final game to fix mistakes, or **Cancel game start** before any play is recorded.

Plays are kept in the browser (`localStorage`) until the server has them, so a reload or a dropped connection loses nothing; the top bar shows "All plays saved" / "Offline · N waiting".

**Several devices can record one game** (e.g. a tablet for shots and a phone for fouls): the server numbers plays in the order they arrive, and each recorder pulls in the others' plays through the live stream, keeping its own unsent plays on top. Each device runs its own game clock, so set them to the arena clock (tap the clock) before tip-off. Two browser tabs on one computer share the same saved outbox; use separate devices or browsers in a real game.

## How the data works

A game is stored only as its **event list** (`events` table, schema in `backend/src/engine/types.ts`).
`recomputeGame()` runs the engine and caches the score (live and final games) and, for final games only, the per-player lines (`player_game_lines`) that leaders, standings and profiles read.
The recorder runs the same engine in the browser (the frontend imports `backend/src/engine` through the `@engine` alias), so what the scorer sees matches the box score.
Recorder API (`backend/src/routes/recorder.ts`): `GET /api/games/:id/recorder`, `POST …/start`, `POST …/participants` (late arrival), `POST …/events` (idempotent by event id), `PUT`/`DELETE …/events/:eventId`, `POST …/finish`, `…/reopen`, `…/reset`.
Lineups come from `computeLineups()` (`backend/src/engine/lineups.ts`), which follows the starters and substitutions like minutes and +/-.
Uploaded files are stored in `UPLOAD_DIR` (default `backend/.data/uploads`), never in the web root; the API checks each file's real type from its first bytes.
The demo games are produced by `backend/src/seed/simulate.ts`, which plays each game possession by possession, so every demo number comes out of the real engine.

## Useful commands

| | backend | frontend |
|---|---|---|
| Dev server | `npm run dev` (restarts on save; `rs` + Enter restarts by hand) | `npm run dev` |
| Type-check | `npm run typecheck` | `npm run typecheck` |
| Tests | `npm test` | — |
| Production build | `npm run build` then `npm start` | `npm run build` (output in `dist/`) |
| New migration after editing `src/db/schema.ts` | `npm run db:generate` | |
| Wipe and reseed | `npm run db:reset` | |

## Production notes

- Set `DATABASE_URL` to a real Postgres, `NODE_ENV=production`, and a fresh `JWT_SECRET`. Secrets live in `.env`, which is git-ignored.
- Set `UPLOAD_DIR` to a persistent folder and back it up with the database (player photos and birth certificates).
- Live push runs in one API process. With several API processes behind a load balancer, move `services/gameEvents.ts` to Postgres `LISTEN/NOTIFY`, and make sure the proxy doesn't buffer `text/event-stream` responses.
- Serve `frontend/dist` and proxy `/api` to the API from the same origin (the session cookie is same-site).
- Migrations apply automatically when the API starts.
- `npm install` uses `legacy-peer-deps` (see `.npmrc`), because npm 10.7 crashes on vitest 4's optional peers.
